"""Notification text follows the reader's language, and raw status codes never reach people."""

from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from core.services.pending_approval_email import notify_users_for_pending_status
from core.services.whatsapp_template_library import render_configured_template_message
from employees.models import EmployeeProfile
from leaves.models import LeaveRequest, LeaveType

from .i18n import (
    MESSAGES,
    contract_rating_event_label,
    localized_notification_field,
    notification_text,
    render,
    request_type_label,
    status_label,
    template_placeholders,
    with_arabic_request_labels,
)
from .models import Notification
from .services import create_notification
from .tests import IN_MEMORY_CHANNELS, make_company, make_user


class NotificationCatalogTests(SimpleTestCase):
    def test_every_message_has_english_and_arabic_with_the_same_placeholders(self):
        for key, fields in MESSAGES.items():
            for field in ("title", "message"):
                en, ar = fields[field]
                with self.subTest(key=key, field=field):
                    self.assertTrue(en.strip())
                    self.assertTrue(ar.strip())
                    self.assertEqual(template_placeholders(en), template_placeholders(ar))

    def test_raw_status_codes_become_human_labels(self):
        self.assertEqual(
            status_label("pending_hr_completion"),
            {"en": "Pending HR Completion", "ar": "بانتظار استكمال الموارد البشرية"},
        )
        self.assertEqual(status_label("PENDING_MGR")["en"], "Pending Manager")
        self.assertEqual(status_label("Pending CEO")["ar"], "بانتظار الرئيس التنفيذي")
        self.assertEqual(status_label("Approved and disbursed")["ar"], "معتمد وتم الصرف")
        self.assertEqual(status_label("some_new_status")["en"], "Some new status")

    def test_renders_per_language_and_ignores_unknown_keys(self):
        text = notification_text(
            "approval.pending",
            request_type=request_type_label("Leave Request"),
            requester_name="Sara",
            request_id=7,
            status=status_label("pending_hr"),
        )
        self.assertEqual(text["title"], "Leave Request requires your review")
        self.assertEqual(text["message"], "Sara's request #7 is Pending HR.")
        self.assertEqual(render(text["i18n"], "title", "ar"), "طلب إجازة بانتظار مراجعتك")
        self.assertEqual(render(text["i18n"], "message", "ar-SA"), "الطلب رقم 7 من Sara: بانتظار الموارد البشرية.")
        self.assertIsNone(render({"key": "not.a.key", "params": {}}, "title", "ar"))
        self.assertIsNone(render(None, "title", "ar"))

    def test_contract_rating_event_uses_a_human_arabic_label(self):
        self.assertEqual(contract_rating_event_label("opened"), {"en": "Opened", "ar": "تم فتحه"})

    def test_whatsapp_variables_get_arabic_labels(self):
        variables = with_arabic_request_labels({"request_type": "Loan Request", "status_label": "pending_cfo"})
        self.assertEqual(variables["request_type_ar"], "طلب سلفة")
        self.assertEqual(variables["status_label"], "Pending CFO")
        self.assertEqual(variables["status_label_ar"], "بانتظار المدير المالي")


def legacy_row(event_key, title, message, metadata=None):
    """A notification stored before the catalog existed: English text only."""
    return SimpleNamespace(event_key=event_key, title=title, message=message, metadata=metadata or {})


class LegacyNotificationTranslationTests(SimpleTestCase):
    def assertLocalized(self, row, field, language, expected):
        self.assertEqual(localized_notification_field(row, field, language), expected)

    def test_pending_approval_with_raw_status(self):
        row = legacy_row(
            "approval.pending",
            "Leave Request requires your review",
            "Ansari's request #10 is pending_hr_completion.",
            {"request_type": "Leave Request", "status": "pending_hr_completion"},
        )
        self.assertLocalized(row, "title", "ar", "طلب إجازة بانتظار مراجعتك")
        self.assertLocalized(row, "message", "ar", "الطلب رقم 10 من Ansari: بانتظار استكمال الموارد البشرية.")
        self.assertLocalized(row, "message", "en", "Ansari's request #10 is Pending HR Completion.")

    def test_request_status_change_title_uses_metadata_to_split(self):
        row = legacy_row(
            "request.status_changed",
            "Loan Request Rejected",
            "Request #9 is now Rejected.",
            {"request_type": "Loan Request", "status": "Rejected"},
        )
        self.assertLocalized(row, "title", "ar", "طلب سلفة: مرفوض")
        self.assertLocalized(row, "message", "ar", "حالة الطلب رقم 9 الآن: مرفوض.")

    def test_contract_notifications(self):
        completed = legacy_row(
            "contract.expiry",
            "Contract decision completed",
            "Contract decision for ZEYAD ABDELHAMID: Automatically renewed. New expiry: 2027-02-23.",
        )
        self.assertLocalized(completed, "title", "ar", "اكتمل قرار العقد")
        self.assertLocalized(
            completed, "message", "ar", "قرار العقد للموظف ZEYAD ABDELHAMID: تم التجديد تلقائياً. تاريخ الانتهاء الجديد: 2027-02-23."
        )

        milestone = legacy_row(
            "contract.expiry",
            "Contract expiry: SALHA ALGHAMDI",
            "SALHA ALGHAMDI's contract expires on 2026-10-13 (31 days remaining).",
        )
        self.assertLocalized(milestone, "title", "ar", "انتهاء العقد: SALHA ALGHAMDI")
        self.assertLocalized(
            milestone, "message", "ar", "ينتهي عقد SALHA ALGHAMDI في 2026-10-13 (الأيام المتبقية: 31)."
        )

    def test_legacy_contract_rating_notification_is_translated(self):
        row = legacy_row(
            "contract.rating",
            "Contract Rating: Opened",
            "Please review the employee contract rating.",
        )
        self.assertLocalized(row, "title", "ar", "تقييم العقد: تم فتحه")
        self.assertLocalized(row, "message", "ar", "يرجى مراجعة تقييم عقد الموظف.")

    def test_job_offer_decision_keeps_reason_and_recommendation(self):
        row = legacy_row(
            "job_offer.approved",
            "Job offer approved",
            "Job offer JO-1 is approved. Reason: Budget ok Recommendation: Hire",
        )
        self.assertLocalized(row, "title", "ar", "عرض العمل: معتمد")
        self.assertLocalized(row, "message", "ar", "عرض العمل JO-1: معتمد. السبب: Budget ok التوصية: Hire")

    def test_unrecognized_text_is_shown_as_stored(self):
        self.assertLocalized(legacy_row("announcement.created", "Policy update", "Read it."), "title", "ar", "Policy update")
        self.assertLocalized(
            legacy_row("approval.pending", "Something custom", "Free text"), "message", "ar", "Free text"
        )


@override_settings(CHANNEL_LAYERS=IN_MEMORY_CHANNELS)
class NotificationLanguageApiTests(TestCase):
    def setUp(self):
        self.company = make_company("I18N-CO")
        self.user = make_user("i18n-owner@example.com", self.company)
        EmployeeProfile.objects.create(
            user=self.user,
            company=self.company,
            employee_id="I18N-1",
            full_name="Sara Ali",
            full_name_ar="سارة علي",
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.client.credentials(HTTP_X_FORWARDED_PROTO="https", HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id))

    def _items(self, language):
        response = self.client.get("/api/notifications/", HTTP_ACCEPT_LANGUAGE=language)
        self.assertEqual(response.status_code, 200)
        return {item["id"]: item for item in response.data["data"]["items"]}

    def test_catalog_notifications_follow_the_reader_language(self):
        notification, _ = create_notification(
            recipient=self.user,
            company=self.company,
            event_key="request.status_changed",
            **notification_text(
                "request.status_changed",
                request_type=request_type_label("Loan Request"),
                status=status_label("rejected"),
                request_id=12,
            ),
        )
        legacy = Notification.objects.create(
            recipient=self.user, company=self.company, event_key="legacy", title="Legacy title", category="system"
        )

        arabic = self._items("ar")
        self.assertEqual(arabic[notification.id]["title"], "طلب سلفة: مرفوض")
        self.assertEqual(arabic[notification.id]["message"], "حالة الطلب رقم 12 الآن: مرفوض.")
        self.assertEqual(arabic[legacy.id]["title"], "Legacy title")

        english = self._items("en")
        self.assertEqual(english[notification.id]["title"], "Loan Request Rejected")
        self.assertEqual(english[notification.id]["message"], "Request #12 is now Rejected.")

    def test_rows_stored_before_the_catalog_are_translated_on_read(self):
        legacy = Notification.objects.create(
            recipient=self.user,
            company=self.company,
            event_key="annual_leave.year_end_reminder",
            title="Annual Leave year-end is approaching",
            message="NZME AHMED's contract year ends on 2026-09-14. Review unused Annual Leave during the final 5 days.",
            category="leave",
        )
        item = self._items("ar")[legacy.id]
        self.assertEqual(item["title"], "اقتراب نهاية سنة الإجازة السنوية")
        self.assertIn("تنتهي سنة العقد للموظف NZME AHMED في 2026-09-14.", item["message"])

    @patch("in_app_notifications.tasks.deliver_whatsapp_notification.delay")
    def test_pending_approval_never_shows_the_raw_status_code(self, delay):
        leave_type = LeaveType.objects.create(company=self.company, name="I18N Annual", code="I18N_ANNUAL")
        leave_request = LeaveRequest.objects.create(
            employee=self.user,
            employee_profile=self.user.employee_profile,
            company=self.company,
            leave_type=leave_type,
            start_date=timezone.localdate() + timedelta(days=1),
            end_date=timezone.localdate() + timedelta(days=2),
        )
        with self.captureOnCommitCallbacks(execute=True):
            notify_users_for_pending_status(
                users=[self.user],
                request_type="Leave Request",
                request_id=leave_request.id,
                requester_name="Sara Ali",
                status_label="pending_hr_completion",
            )

        notification = Notification.objects.get(event_key="approval.pending")
        self.assertEqual(notification.message, f"Sara Ali's request #{leave_request.id} is Pending HR Completion.")
        # Dedup keys keep the value the workflow passed, so rows created before this change still match.
        self.assertEqual(
            notification.deduplication_key,
            f"approval.pending:Leave Request:{leave_request.id}:pending_hr_completion",
        )
        variables = delay.call_args.kwargs["whatsapp_variables"]
        self.assertEqual(variables["status_label"], "Pending HR Completion")
        self.assertEqual(variables["status_label_ar"], "بانتظار استكمال الموارد البشرية")
        self.assertEqual(variables["request_type_ar"], "طلب إجازة")
        self.assertIn("بانتظار استكمال الموارد البشرية", self._items("ar")[notification.id]["message"])

    def test_whatsapp_pending_approval_arabic_section_is_arabic(self):
        message = render_configured_template_message(
            "pending_approval",
            {
                "approver_name": "HR",
                "request_type": "Leave Request",
                "request_id": 7,
                "requester_name": "Sara",
                "status_label": "pending_hr",
                "details": [],
                "action_url": "",
            },
        )
        arabic, _, english = message.partition("━━━━━━━━━━━━")
        self.assertIn("طلب إجازة من Sara", arabic)
        self.assertIn("*الحالة:* بانتظار الموارد البشرية", arabic)
        self.assertNotIn("Leave Request", arabic)
        self.assertIn("*Status:* Pending HR", english)
        self.assertNotIn("pending_hr", message)
