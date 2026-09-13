from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase, override_settings

from core.notifications import send_sms_notification
from core.services.messaging_providers import TextBeeSmsProvider, render_template_message
from core.services.pending_approval_email import notify_users_for_pending_status
from core.services.whatsapp_service import WhatsAppService
from core.services.whatsapp_template_library import CAPTION_MAX_CHARS, render_generic_notification
from employees.models import EmployeeProfile
from loans.models import LoanRequest
from organization.models import OrganizationNode

EVOLUTION_SETTINGS = {
    "EVOLUTION_API_BASE_URL": "http://evolution-api:8080",
    "EVOLUTION_API_KEY": "evolution-key",
    "EVOLUTION_INSTANCE_NAME": "ffi-staging",
}


class DefaultTemplateMixin:
    def setUp(self):
        super().setUp()
        # Rendering tests exercise default templates, independently of
        # tenant-configured template storage (covered by template library tests).
        template = patch("core.services.whatsapp_template_library.get_custom_template_body", return_value=None)
        template.start()
        self.addCleanup(template.stop)


class MessagingProviderTests(DefaultTemplateMixin, SimpleTestCase):
    @patch("core.services.messaging_providers.requests.post")
    def test_evolution_whatsapp_provider_sends_rendered_template_message(self, post):
        post.return_value = Mock(status_code=201, text="", json=lambda: {"key": {"id": "wamid-1"}, "status": "PENDING"})

        service = WhatsAppService(timeout_seconds=5)

        with override_settings(**EVOLUTION_SETTINGS):
            result = service.send_template_message(
                phone_number="+201013530963",
                template_name="new_announcement_notification",
                template_variables={"employee_name": "Test User", "announcement_title": "Policy Update"},
            )

        self.assertTrue(result["success"])
        self.assertEqual(result["provider"], "evolution_whatsapp")
        self.assertEqual(result["provider_status"], "PENDING")
        post.assert_called_once()
        _, kwargs = post.call_args
        self.assertEqual(kwargs["headers"]["apikey"], "evolution-key")
        self.assertEqual(kwargs["json"]["number"], "201013530963")
        self.assertLess(kwargs["json"]["text"].find("إعلان جديد"), kwargs["json"]["text"].find("New announcement"))
        self.assertIn("Policy Update", kwargs["json"]["text"])
        self.assertNotIn("attachment-public", kwargs["json"]["text"])
        self.assertIn("/message/sendText/ffi-staging", post.call_args.args[0])

    @override_settings(EVOLUTION_API_BASE_URL="", EVOLUTION_API_KEY="")
    def test_evolution_whatsapp_provider_missing_credentials_fails_cleanly(self):
        result = WhatsAppService().send_template_message(
            phone_number="+201013530963",
            template_name="new_announcement_notification",
            template_variables={"employee_name": "Test User", "announcement_title": "Policy Update"},
        )

        self.assertFalse(result["success"])
        self.assertEqual(result["provider"], "evolution_whatsapp")
        self.assertIn("not configured", result["error"])

    @override_settings(**EVOLUTION_SETTINGS)
    def test_evolution_whatsapp_provider_invalid_phone_fails_cleanly(self):
        result = WhatsAppService().send_template_message(
            phone_number="123",
            template_name="new_announcement_notification",
            template_variables={"employee_name": "Test User", "announcement_title": "Policy Update"},
        )

        self.assertFalse(result["success"])
        self.assertEqual(result["provider"], "evolution_whatsapp")
        self.assertIn("E.164", result["error"])

    @override_settings(**EVOLUTION_SETTINGS)
    @patch("core.services.messaging_providers.requests.post")
    def test_whatsapp_service_uses_evolution_without_provider_switch(self, post):
        post.return_value = Mock(status_code=201, text="", json=lambda: {"id": "evolution-1"})
        result = WhatsAppService().send_template_message(
            phone_number="+201013530963",
            template_name="new_announcement_notification",
            template_variables={"employee_name": "Test User", "announcement_title": "Policy Update"},
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["provider"], "evolution_whatsapp")
        post.assert_called_once()
        self.assertIn("/message/sendText/ffi-staging", post.call_args.args[0])

    @override_settings(
        MESSAGING_SMS_PROVIDER="textbee",
        TEXTBEE_API_BASE_URL="https://api.textbee.dev",
        TEXTBEE_API_KEY="textbee-key",
        TEXTBEE_DEVICE_ID="device-1",
    )
    @patch("core.services.messaging_providers.requests.post")
    def test_textbee_sms_provider_sends_expected_payload(self, post):
        post.return_value = Mock(status_code=200, text="", json=lambda: {"id": "sms-1"})

        result = send_sms_notification("+201013530963", "Hello from HR", event="manual_sms_test")

        self.assertTrue(result["sent"])
        self.assertEqual(result["provider"], "textbee_sms")
        post.assert_called_once()
        self.assertEqual(
            post.call_args.args[0],
            "https://api.textbee.dev/api/v1/gateway/devices/device-1/send-sms",
        )
        self.assertEqual(post.call_args.kwargs["headers"]["x-api-key"], "textbee-key")
        self.assertEqual(post.call_args.kwargs["json"], {"recipients": ["+201013530963"], "message": "Hello from HR"})

    @override_settings(TEXTBEE_API_BASE_URL="https://api.textbee.dev", TEXTBEE_API_KEY="", TEXTBEE_DEVICE_ID="")
    def test_textbee_sms_provider_missing_credentials_fails_cleanly(self):
        result = TextBeeSmsProvider().send_sms(phone_number="+201013530963", message="Hello", event="manual_sms_test")

        self.assertFalse(result["sent"])
        self.assertEqual(result["provider"], "textbee_sms")
        self.assertIn("not configured", result["reason"])

    @override_settings(
        TEXTBEE_API_BASE_URL="https://api.textbee.dev",
        TEXTBEE_API_KEY="textbee-key",
        TEXTBEE_DEVICE_ID="device-1",
    )
    def test_textbee_sms_provider_invalid_phone_fails_cleanly(self):
        result = TextBeeSmsProvider().send_sms(phone_number="123", message="Hello", event="manual_sms_test")

        self.assertFalse(result["sent"])
        self.assertEqual(result["provider"], "textbee_sms")
        self.assertIn("E.164", result["reason"])


class WhatsAppDocumentDeliveryTests(DefaultTemplateMixin, SimpleTestCase):
    @override_settings(**EVOLUTION_SETTINGS)
    @patch("core.services.messaging_providers.requests.post")
    def test_evolution_whatsapp_provider_sends_pdf_document(self, post):
        post.return_value = Mock(status_code=201, text="", json=lambda: {"key": {"id": "doc-1"}, "status": "PENDING"})

        result = WhatsAppService().send_document_message(
            phone_number="+201013530963",
            document_url="https://api.example.com/file.pdf",
            file_name="policy.pdf",
            caption="Policy PDF",
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["message_id"], "doc-1")
        self.assertIn("/message/sendMedia/ffi-staging", post.call_args.args[0])
        self.assertEqual(post.call_args.kwargs["json"]["mediatype"], "document")
        self.assertEqual(post.call_args.kwargs["json"]["mimetype"], "application/pdf")
        self.assertEqual(post.call_args.kwargs["json"]["media"], "https://api.example.com/file.pdf")
        self.assertEqual(post.call_args.kwargs["json"]["fileName"], "policy.pdf")

    @override_settings(**EVOLUTION_SETTINGS)
    @patch("core.services.messaging_providers.requests.post")
    def test_evolution_whatsapp_provider_sends_base64_pdf_document(self, post):
        post.return_value = Mock(status_code=201, text="", json=lambda: {"key": {"id": "doc-2"}, "status": "PENDING"})

        result = WhatsAppService().send_document_message(
            phone_number="+201013530963",
            document_base64="JVBERi0xLjQK",
            file_name="offer.pdf",
            caption="Offer PDF",
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["message_id"], "doc-2")
        self.assertEqual(post.call_args.kwargs["json"]["media"], "JVBERi0xLjQK")
        self.assertEqual(post.call_args.kwargs["json"]["fileName"], "offer.pdf")

    @override_settings(**EVOLUTION_SETTINGS, WHATSAPP_DOCUMENT_TIMEOUT_SECONDS=60)
    @patch("core.services.messaging_providers.requests.post")
    def test_document_upload_gets_longer_timeout_than_text(self, post):
        post.return_value = Mock(status_code=201, text="", json=lambda: {"key": {"id": "doc-3"}})

        WhatsAppService(timeout_seconds=10).send_document_message(
            phone_number="+201013530963", document_base64="JVBERi0xLjQK", file_name="offer.pdf"
        )

        self.assertEqual(post.call_args.kwargs["timeout"], 60)

    @override_settings(**EVOLUTION_SETTINGS)
    @patch("core.services.messaging_providers.requests.post")
    def test_short_text_is_the_document_caption(self, post):
        post.return_value = Mock(status_code=201, text="", json=lambda: {"key": {"id": "doc-4"}})

        result = WhatsAppService().send_document_with_text(
            phone_number="+201013530963", text="Policy update", document_base64="JVBERi0xLjQK", file_name="p.pdf"
        )

        self.assertTrue(result["success"])
        post.assert_called_once()
        self.assertEqual(post.call_args.kwargs["json"]["caption"], "Policy update")

    @override_settings(**EVOLUTION_SETTINGS)
    @patch("core.services.messaging_providers.requests.post")
    def test_text_too_long_for_a_caption_is_sent_before_the_document(self, post):
        post.return_value = Mock(status_code=201, text="", json=lambda: {"key": {"id": "doc-5"}})
        long_text = "x" * (CAPTION_MAX_CHARS + 1)

        result = WhatsAppService().send_document_with_text(
            phone_number="+201013530963", text=long_text, document_base64="JVBERi0xLjQK", file_name="p.pdf"
        )

        self.assertTrue(result["success"])
        self.assertEqual(post.call_count, 2)
        first, second = post.call_args_list
        self.assertIn("/message/sendText/", first.args[0])
        self.assertEqual(first.kwargs["json"]["text"], long_text)
        self.assertIn("/message/sendMedia/", second.args[0])
        self.assertEqual(second.kwargs["json"]["caption"], "")

    @override_settings(**EVOLUTION_SETTINGS, FRONTEND_URL="https://app.example.com")
    @patch("core.services.messaging_providers.requests.post")
    def test_dispatcher_sends_template_caption_with_attached_pdf(self, post):
        from in_app_notifications.dispatcher import _send_whatsapp

        post.return_value = Mock(status_code=201, text="", json=lambda: {"key": {"id": "doc-6"}})
        recipient = SimpleNamespace(employee_profile=SimpleNamespace(mobile="+201013530963"))
        attachment = {"file_name": "starting-work.pdf", "document_base64": "JVBERi0xLjQK"}

        with patch("in_app_notifications.dispatcher._load_whatsapp_document", return_value=attachment):
            result = _send_whatsapp(
                recipient=recipient,
                title="Verify starting work",
                message="",
                action_url="",
                template="starting_work_acknowledgment_v1",
                variables={
                    "recipient_name": "Huda",
                    "employee_name": "Sara Ali",
                    "employee_id": "EMP-7",
                    "start_date": "2026-08-01",
                    "action_url": "/hr/starting-work-acknowledgments/3",
                },
                timeout=5,
                document={"starting_work_acknowledgment_id": 3},
            )

        self.assertTrue(result["success"])
        post.assert_called_once()
        payload = post.call_args.kwargs["json"]
        self.assertIn("/message/sendMedia/", post.call_args.args[0])
        self.assertEqual(payload["media"], "JVBERi0xLjQK")
        self.assertEqual(payload["fileName"], "starting-work.pdf")
        self.assertIn("Starting work acknowledgment to verify", payload["caption"])
        self.assertIn("EMP-7", payload["caption"])
        self.assertIn("🔗 https://app.example.com/hr/starting-work-acknowledgments/3", payload["caption"])

    @patch("core.services.messaging_providers.requests.post")
    def test_dispatcher_reports_missing_attachment_instead_of_sending_text(self, post):
        from in_app_notifications.dispatcher import _send_whatsapp

        recipient = SimpleNamespace(employee_profile=SimpleNamespace(mobile="+201013530963"))
        with patch("in_app_notifications.dispatcher._load_whatsapp_document", return_value=None):
            result = _send_whatsapp(
                recipient=recipient,
                title="Announcement",
                message="",
                action_url="",
                template="announcement_notification_v2",
                variables={"employee_name": "Sara", "announcement_title": "Policy", "announcement_message": ""},
                timeout=5,
                document={"announcement_id": 99},
            )

        self.assertFalse(result["success"])
        self.assertIn("attachment is unavailable", result["error"])
        post.assert_not_called()


class EvolutionTemplateRenderingTests(DefaultTemplateMixin, SimpleTestCase):
    def test_renders_announcement_template(self):
        message = render_template_message(
            "new_announcement_notification",
            {
                "employee_name": "Sara",
                "announcement_title": "Policy Update",
                "announcement_message": "Please review the attendance policy.",
                "attachment_url": "https://api.example.com/attachment.pdf",
            },
        )

        self.assertLess(message.find("إعلان جديد"), message.find("New announcement"))
        self.assertIn("*Policy Update*", message)
        self.assertIn("Please review the attendance policy.", message)
        self.assertNotIn("https://api.example.com/attachment.pdf", message)
        self.assertNotIn("{{", message)

    def test_renders_meeting_template_with_optional_links(self):
        message = render_template_message(
            "meeting_notification_v1",
            {
                "employee_name": "Sara",
                "meeting_title": "Safety Briefing",
                "meeting_date": "2026-06-30",
                "meeting_time": "10:00 AM",
                "organizer_name": "HR",
                "google_meet_url": "",
                "microsoft_teams_url": "https://teams.example/meeting",
                "zoom_url": "",
            },
        )

        self.assertLess(message.find("دعوة لاجتماع"), message.find("Meeting invitation"))
        self.assertIn("*Safety Briefing*", message)
        self.assertIn("🗓️ 2026-06-30", message)
        self.assertIn("Microsoft Teams: https://teams.example/meeting", message)
        self.assertNotIn("Google Meet", message)
        self.assertNotIn("Zoom", message)
        self.assertNotIn("📍", message)

    def test_legacy_meeting_key_uses_the_same_template(self):
        variables = {"meeting_title": "Safety Briefing", "meeting_date": "2026-06-30"}
        self.assertEqual(
            render_template_message("meeting_notification", variables),
            render_template_message("meeting_notification_v1", variables),
        )

    def test_renders_document_expiry_template(self):
        message = render_template_message(
            "document_expiry_reminder",
            {"employee_name": "Sara", "document_type": "Passport", "expiry_date": "30-06-2026"},
        )

        self.assertLess(message.find("تذكير بتجديد مستند"), message.find("Document renewal reminder"))
        self.assertIn("Hi Sara,", message)
        self.assertIn("*Document:* Passport", message)
        self.assertIn("*Expiry date:* 30-06-2026", message)

    def test_renders_leave_lifecycle_templates(self):
        leave = {"leave_type": "Annual Leave", "start_date": "2026-07-01", "end_date": "2026-07-03"}
        submitted = render_template_message(
            "leave_request_submitted_v1", {"manager_name": "Manager", "employee_name": "Sara", **leave, "total_days": 3}
        )
        received = render_template_message(
            "leave_request_received_v1", {"employee_name": "Sara", **leave, "total_days": 3}
        )
        approved = render_template_message(
            "leave_request_approved_v1", {"employee_name": "Sara", **leave, "total_days": 3}
        )
        rejected = render_template_message(
            "leave_request_rejected_v1", {"employee_name": "Sara", **leave, "rejection_reason": "Coverage needed"}
        )

        self.assertLess(submitted.find("وصلك طلب إجازة"), submitted.find("requires your review"))
        self.assertIn("Sara has requested leave", submitted)
        self.assertLess(received.find("تم استلام طلب إجازتك"), received.find("Leave request received"))
        self.assertNotIn("requires your review", received)
        self.assertLess(approved.find("تمت الموافقة"), approved.find("has been approved"))
        self.assertLess(rejected.find("تم رفض"), rejected.find("has been rejected"))
        self.assertIn("*Reason:* Coverage needed", rejected)
        self.assertIn("*Days:* 3", approved)

    def test_renders_leave_delegation_template(self):
        message = render_template_message(
            "leave_delegation_assigned_v1",
            {
                "delegate_name": "Omar",
                "employee_name": "Sara",
                "leave_type": "Annual Leave",
                "start_date": "2026-07-01",
                "end_date": "2026-07-03",
                "total_days": 3,
            },
        )

        self.assertLess(message.find("تم تعيينك"), message.find("assigned as a delegate"))
        self.assertIn("Hi Omar,", message)
        self.assertIn("covering for Sara", message)

    def test_renders_pending_approval_template(self):
        message = render_template_message(
            "pending_approval",
            {
                "approver_name": "HR User",
                "request_type": "LOAN",
                "request_id": 12,
                "requester_name": "Sara",
                "status_label": "Pending HR",
                "details": ["Amount: 5000", "Reason: Emergency"],
                "action_url": "http://localhost:5173/hr/loan-requests/12",
            },
        )

        self.assertLess(message.find("طلب بانتظار مراجعتك"), message.find("Request awaiting your review"))
        self.assertIn("Hi HR User,", message)
        self.assertIn("*Request ID:* 12", message)
        self.assertIn("• Amount: 5000", message)
        self.assertIn("🔗 http://localhost:5173/hr/loan-requests/12", message)

    def test_renders_request_status_update_template(self):
        message = render_template_message(
            "request_status_update",
            {
                "employee_name": "Sara",
                "request_type": "Loan Request",
                "request_id": 9,
                "status_label": "Rejected",
                "reason": "Coverage needed",
                "details": ["Amount: 5000"],
                "action_url": "http://localhost:5173/employee/loans",
            },
        )

        self.assertTrue(message.startswith("❌"))
        self.assertLess(message.find("أصبحت حالة طلبك"), message.find("Your request is now"))
        # The Arabic half uses Arabic labels; the English half keeps the English ones.
        self.assertIn("تحديث حالة طلب سلفة", message)
        self.assertIn("أصبحت حالة طلبك: *مرفوض*", message)
        self.assertIn("Your request is now *Rejected*.", message)
        self.assertIn("*Reason:* Coverage needed", message)

    @override_settings(FRONTEND_URL="https://app.example.com/")
    def test_empty_values_drop_their_lines_and_paths_become_links(self):
        message = render_template_message(
            "request_status_update",
            {
                "employee_name": "there",
                "request_type": "Leave Request",
                "request_id": 5,
                "status_label": "approved",
                "reason": "",
                "details": [],
                "action_url": "/employee/leave/requests",
            },
        )

        self.assertNotIn("there", message)
        self.assertNotIn("Hi ,", message)
        self.assertNotIn("Reason", message)
        self.assertNotIn("السبب", message)
        self.assertNotIn("\n\n\n", message)
        self.assertIn("🔗 https://app.example.com/employee/leave/requests", message)
        self.assertTrue(message.startswith("✅"))

    def test_relative_link_is_dropped_without_frontend_url(self):
        with override_settings(FRONTEND_URL=""):
            message = render_template_message("document_expiry_reminder", {"employee_name": "Sara", "action_url": "/x"})
        self.assertNotIn("🔗", message)

    def test_work_license_reminder_addresses_hr_not_the_employee(self):
        message = render_template_message(
            "work_license_expiry_hr_v1",
            {
                "recipient_name": "Huda",
                "employee_name": "Sara Ali",
                "employee_id": "EMP-7",
                "expiry_date": "01-09-2026",
            },
        )

        self.assertIn("Hi Huda,", message)
        self.assertIn("Sara Ali's work license is about to expire", message)
        # Without an Arabic name the Arabic half falls back to the English one.
        self.assertIn("رخصة عمل Sara Ali", message)

    def test_renders_employee_invitation_arabic_before_english(self):
        invite_link = "http://localhost:5173/register?token=abc"
        message = render_template_message(
            "employee_invitation",
            {
                "role": "Employee",
                "invite_link": invite_link,
                "expires_in_hours": 72,
                "inviter_name": "HR",
            },
        )

        self.assertLess(message.find("دعوة للانضمام"), message.find("You're invited to the FFI HR System"))
        self.assertIn(f"🔗 {invite_link}", message)
        self.assertIn("*Role:* Employee", message)
        self.assertIn("*Link valid for:* 72 hours", message)

    def test_renders_whatsapp_provider_test_arabic_before_english(self):
        message = render_template_message(
            "whatsapp_provider_test",
            {"provider_name": "Evolution"},
        )

        self.assertLess(message.find("اختبار واتساب"), message.find("WhatsApp test successful"))
        self.assertIn("*مزود واتساب:* Evolution", message)
        self.assertIn("*WhatsApp provider:* Evolution", message)

    @override_settings(FRONTEND_URL="https://app.example.com")
    def test_generic_notification_is_arabic_first_with_real_arabic_text(self):
        message = render_generic_notification(
            title="Payslip available",
            message="Your payslip for 2026-08 is available.",
            title_ar="كشف الراتب متاح",
            message_ar="كشف راتبك لفترة 2026-08 متاح الآن.",
            action_url="/employee/payslips",
        )

        self.assertLess(message.find("كشف الراتب متاح"), message.find("Payslip available"))
        self.assertIn("🔗 https://app.example.com/employee/payslips", message)
        self.assertEqual(message.count("Payslip available"), 1)

    def test_generic_notification_without_translation_is_not_repeated(self):
        message = render_generic_notification(title="Asset returned", message="Laptop was returned.")

        self.assertEqual(message.count("Asset returned"), 1)
        self.assertNotIn("━", message)


class PendingApprovalWhatsAppTests(TestCase):
    @patch("in_app_notifications.integrations.dispatch_notification_channels")
    def test_pending_approval_uses_whatsapp_first_dispatcher(self, dispatch):
        dispatch.return_value = {
            "whatsapp": {"status": "sent", "provider": "evolution_whatsapp"},
            "email": None,
        }
        company = OrganizationNode.objects.create(code="WA-APPROVAL", name="Approval", node_type="company")
        user = get_user_model().objects.create_user(email="approver@example.com", full_name="Approver")
        profile = EmployeeProfile.objects.create(
            user=user,
            company=company,
            full_name="Approver",
            employee_id="WA-APPROVAL",
            mobile="+201013530963",
        )
        loan = LoanRequest.objects.create(
            employee=user, employee_profile=profile, company=company, requested_amount=100
        )

        result = notify_users_for_pending_status(
            users=[user],
            request_type="Loan Request",
            request_id=loan.id,
            requester_name="Sara",
            status_label="Pending HR",
            details=["Amount: 5000"],
            action_path="/hr/loan-requests/7",
        )

        self.assertEqual(result["sent"], 0)
        self.assertEqual(result["whatsapp_sent"], 1)
        dispatch.assert_called_once()
        self.assertEqual(dispatch.call_args.kwargs["whatsapp_template"], "pending_approval")
