from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase, override_settings

from core.notifications import send_sms_notification
from core.services.messaging_providers import TextBeeSmsProvider, render_template_message
from core.services.pending_approval_email import notify_users_for_pending_status
from core.services.whatsapp_service import WhatsAppService


class MessagingProviderTests(SimpleTestCase):
    @patch("core.services.messaging_providers.requests.post")
    def test_evolution_whatsapp_provider_sends_rendered_template_message(self, post):
        post.return_value = Mock(status_code=201, text="", json=lambda: {"key": {"id": "wamid-1"}, "status": "PENDING"})

        service = WhatsAppService(timeout_seconds=5)

        with override_settings(
            EVOLUTION_API_BASE_URL="http://evolution-api:8080",
            EVOLUTION_API_KEY="evolution-key",
            EVOLUTION_INSTANCE_NAME="ffi-staging",
        ):
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
        self.assertLess(kwargs["json"]["text"].find("مرحباً"), kwargs["json"]["text"].find("Hello"))
        self.assertIn("Policy Update", kwargs["json"]["text"])
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

    @override_settings(
        EVOLUTION_API_BASE_URL="http://evolution-api:8080",
        EVOLUTION_API_KEY="evolution-key",
        EVOLUTION_INSTANCE_NAME="ffi-staging",
    )
    def test_evolution_whatsapp_provider_invalid_phone_fails_cleanly(self):
        result = WhatsAppService().send_template_message(
            phone_number="123",
            template_name="new_announcement_notification",
            template_variables={"employee_name": "Test User", "announcement_title": "Policy Update"},
        )

        self.assertFalse(result["success"])
        self.assertEqual(result["provider"], "evolution_whatsapp")
        self.assertIn("E.164", result["error"])

    @override_settings(EVOLUTION_API_BASE_URL="http://evolution-api:8080", EVOLUTION_API_KEY="evolution-key", EVOLUTION_INSTANCE_NAME="ffi-staging")
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


class EvolutionTemplateRenderingTests(SimpleTestCase):
    def test_renders_announcement_template(self):
        message = render_template_message(
            "new_announcement_notification",
            {
                "employee_name": "Sara",
                "announcement_title": "Policy Update",
                "attachment_url": "https://api.example.com/attachment.pdf",
            },
        )

        self.assertLess(message.find("مرحباً Sara"), message.find("Hello Sara"))
        self.assertIn("إعلان من نظام الموارد البشرية FFI", message)
        self.assertIn("Hello Sara", message)
        self.assertIn("FFI HR announcement", message)
        self.assertIn("Policy Update", message)
        self.assertIn("https://api.example.com/attachment.pdf", message)

    @override_settings(
        EVOLUTION_API_BASE_URL="http://evolution-api:8080",
        EVOLUTION_API_KEY="evolution-key",
        EVOLUTION_INSTANCE_NAME="ffi-staging",
    )
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

        self.assertLess(message.find("دعوة اجتماع"), message.find("FFI HR meeting invitation"))
        self.assertIn("FFI HR meeting invitation", message)
        self.assertIn("Safety Briefing", message)
        self.assertIn("Microsoft Teams: https://teams.example/meeting", message)
        self.assertNotIn("Google Meet:", message)

    def test_renders_document_expiry_template(self):
        message = render_template_message(
            "document_expiry_reminder",
            {"employee_name": "Sara", "document_type": "Passport", "expiry_date": "30-06-2026"},
        )

        self.assertLess(message.find("تذكير بانتهاء مستند"), message.find("FFI HR document expiry reminder"))
        self.assertIn("document expiry reminder", message)
        self.assertIn("Document: Passport", message)
        self.assertIn("Expiry date: 30-06-2026", message)

    def test_renders_leave_lifecycle_templates(self):
        submitted = render_template_message(
            "leave_request_submitted_v1",
            {
                "manager_name": "Manager",
                "employee_name": "Sara",
                "leave_type": "Annual Leave",
                "start_date": "2026-07-01",
                "end_date": "2026-07-03",
                "total_days": 3,
            },
        )
        approved = render_template_message(
            "leave_request_approved_v1",
            {
                "employee_name": "Sara",
                "leave_type": "Annual Leave",
                "start_date": "2026-07-01",
                "end_date": "2026-07-03",
                "total_days": 3,
            },
        )
        rejected = render_template_message(
            "leave_request_rejected_v1",
            {
                "employee_name": "Sara",
                "leave_type": "Annual Leave",
                "start_date": "2026-07-01",
                "end_date": "2026-07-03",
                "rejection_reason": "Coverage needed",
            },
        )

        self.assertLess(submitted.find("طلب إجازة يحتاج إلى مراجعتك"), submitted.find("requires your review"))
        self.assertLess(approved.find("تمت الموافقة"), approved.find("has been approved"))
        self.assertLess(rejected.find("تم رفض"), rejected.find("has been rejected"))
        self.assertIn("requires your review", submitted)
        self.assertIn("has been approved", approved)
        self.assertIn("has been rejected", rejected)
        self.assertIn("Coverage needed", rejected)

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

        self.assertLess(message.find("تم تعيينك"), message.find("assigned as leave delegate"))
        self.assertIn("Hello Omar", message)
        self.assertIn("assigned as leave delegate", message)
        self.assertIn("Employee: Sara", message)

    def test_renders_pending_approval_template_for_future_whatsapp_flow(self):
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

        self.assertLess(message.find("طلب يحتاج إلى مراجعتك"), message.find("A request requires your review"))
        self.assertIn("A request requires your review", message)
        self.assertIn("Request type: LOAN", message)
        self.assertIn("- Amount: 5000", message)
        self.assertIn("Review link: http://localhost:5173/hr/loan-requests/12", message)

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

        self.assertLess(message.find("تحديث حالة الطلب"), message.find("FFI HR request status update"))
        self.assertIn("الحالة: Rejected", message)
        self.assertIn("Status: Rejected", message)
        self.assertIn("Coverage needed", message)

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

        self.assertLess(message.find("دعوة للانضمام"), message.find("FFI HR system invitation"))
        self.assertIn(f"رابط الدعوة: {invite_link}", message)
        self.assertIn(f"Invitation link: {invite_link}", message)

    def test_renders_whatsapp_provider_test_arabic_before_english(self):
        message = render_template_message(
            "whatsapp_provider_test",
            {"provider_name": "Evolution"},
        )

        self.assertLess(message.find("رسالة اختبار"), message.find("FFI HR WhatsApp provider test"))
        self.assertIn("مزود واتساب: Evolution", message)
        self.assertIn("WhatsApp provider: Evolution", message)


class PendingApprovalWhatsAppTests(SimpleTestCase):
    @patch("in_app_notifications.integrations.dispatch_notification_channels")
    def test_pending_approval_uses_whatsapp_first_dispatcher(self, dispatch):
        dispatch.return_value = {
            "whatsapp": {"status": "sent", "provider": "evolution_whatsapp"},
            "email": None,
        }
        user = SimpleNamespace(
            id=1,
            email="approver@example.com",
            full_name="Approver",
            employee_profile=SimpleNamespace(mobile="+201013530963"),
        )

        result = notify_users_for_pending_status(
            users=[user],
            request_type="Loan Request",
            request_id=7,
            requester_name="Sara",
            status_label="Pending HR",
            details=["Amount: 5000"],
            action_path="/hr/loan-requests/7",
        )

        self.assertEqual(result["sent"], 0)
        self.assertEqual(result["whatsapp_sent"], 1)
        dispatch.assert_called_once()
        self.assertEqual(dispatch.call_args.kwargs["whatsapp_template"], "pending_approval")
