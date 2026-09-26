"""Employee notification when the Annual Leave settlement window opens.

``leaves.tasks.send_annual_leave_settlement_window_open_notifications`` runs daily and tells each
employee once per contract cycle, through the standard dispatcher (in-app, WhatsApp first, email
fallback), that the settlement request is available. ``build_annual_leave_eligibility`` stays the
single source of truth for whether the window is open and the request can be made.
"""

from contextlib import contextmanager
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase, override_settings

from employees.models import EmployeeProfile
from in_app_notifications.i18n import localized_notification_field
from in_app_notifications.models import Notification, NotificationDelivery
from in_app_notifications.tasks import deliver_email_notification, deliver_whatsapp_notification
from leaves.models import AnnualLeavePaymentRequest, LeaveRequest, LeaveType
from leaves.tasks import (
    SETTLEMENT_WINDOW_OPEN_EVENT,
    send_annual_leave_settlement_window_open_notifications,
    settlement_window_open_notification_kwargs,
)
from leaves.utils import build_annual_leave_eligibility
from organization.models import OrganizationNode, UserOrganizationAccess

User = get_user_model()
IN_MEMORY_CHANNELS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}

CONTRACT_START = date(2026, 2, 24)
CYCLE_START = date(2026, 2, 24)
CYCLE_END = date(2027, 2, 23)


@override_settings(
    CHANNEL_LAYERS=IN_MEMORY_CHANNELS,
    NOTIFICATION_WHATSAPP_DELIVERY_ENABLED=True,
    NOTIFICATION_EMAIL_FALLBACK_ENABLED=True,
    FRONTEND_URL="https://hr.example.test",
)
class SettlementWindowOpenNotificationTests(TestCase):
    def setUp(self):
        self.company = OrganizationNode.objects.create(
            code="WINDOW_CO", name="Window Co", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.other_company = OrganizationNode.objects.create(
            code="WINDOW_OTHER", name="Window Other", node_type=OrganizationNode.NodeType.COMPANY
        )
        employee_group, _ = Group.objects.get_or_create(name="Employee")
        self.user = User.objects.create_user(email="zeyad@window.test", password="password", is_active=True)
        self.user.groups.add(employee_group)
        UserOrganizationAccess.objects.create(user=self.user, organization=self.company)
        self.profile = EmployeeProfile.objects.create(
            user=self.user,
            company=self.company,
            employee_id="WIN-1",
            full_name="Zeyad Hassan",
            full_name_ar="زياد حسن",
            mobile="+201001234567",
            contract_date=CONTRACT_START,
            hire_date=CONTRACT_START,
            total_salary=Decimal("3000.00"),
        )
        # An HR user in the same company must never receive the employee-facing notice.
        hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.hr_user = User.objects.create_user(email="hr@window.test", password="password", is_active=True)
        self.hr_user.groups.add(hr_group)
        UserOrganizationAccess.objects.create(user=self.hr_user, organization=self.company)
        EmployeeProfile.objects.create(
            user=self.hr_user,
            company=self.company,
            employee_id="WIN-HR",
            full_name="Window HR",
            contract_date=date(2025, 6, 1),
            hire_date=date(2025, 6, 1),
        )
        self.annual = LeaveType.objects.create(company=self.company, name="Annual Leave", code="ANNUAL", is_active=True)

    # -- helpers -----------------------------------------------------------------------------

    @contextmanager
    def _today(self, today):
        with patch("leaves.tasks.timezone.localdate", return_value=today):
            yield

    def _run(self, today):
        with self._today(today):
            with patch("in_app_notifications.tasks.deliver_whatsapp_notification.delay") as delay:
                with self.captureOnCommitCallbacks(execute=True):
                    result = send_annual_leave_settlement_window_open_notifications()
        return result, delay

    def _notices(self, user=None):
        return Notification.objects.filter(event_key=SETTLEMENT_WINDOW_OPEN_EVENT, recipient=user or self.user)

    # -- window edges ------------------------------------------------------------------------

    def test_window_edges(self):
        cases = [
            (CYCLE_END - timedelta(days=5), False),
            (CYCLE_END - timedelta(days=4), True),
            (CYCLE_END, True),
            (CYCLE_END + timedelta(days=1), False),
        ]
        for today, expected in cases:
            with self.subTest(today=today):
                Notification.objects.all().delete()
                result, _ = self._run(today)
                self.assertEqual(self._notices().exists(), expected)
                self.assertEqual(result["window_open_sent"], 1 if expected else 0)

    def test_notification_content_and_scope(self):
        result, delay = self._run(CYCLE_END - timedelta(days=2))

        self.assertEqual(result, {"window_open_sent": 1, "failed": 0})
        notice = self._notices().get()
        self.assertEqual(notice.category, Notification.Category.LEAVE)
        self.assertEqual(notice.action_url, "/employee/leave/balance?focus=settlement")
        self.assertEqual(notice.company_id, self.company.id)
        self.assertEqual(notice.deduplication_key, f"{SETTLEMENT_WINDOW_OPEN_EVENT}:{self.profile.id}:2027-02-23")
        self.assertEqual(notice.metadata["cycle_start"], CYCLE_START.isoformat())
        self.assertEqual(notice.metadata["cycle_end"], CYCLE_END.isoformat())
        self.assertIn("eligible_unused_days", notice.metadata)
        self.assertIn("locked_unused_days", notice.metadata)
        self.assertIn("2027-02-23", notice.message)
        self.assertIn("Leave Balance", notice.message)
        self.assertNotIn("Leave-only", notice.message)
        self.assertIn("2027-02-23", localized_notification_field(notice, "message", "ar"))
        # Only the employee is told; HR keeps its own separate reminders.
        self.assertFalse(self._notices(self.hr_user).exists())
        delay.assert_called_once()

    # -- blockers ----------------------------------------------------------------------------

    def test_existing_settlement_blocks(self):
        AnnualLeavePaymentRequest.objects.create(
            employee=self.user,
            employee_profile=self.profile,
            company=self.company,
            cycle_start=CYCLE_START,
            cycle_end=CYCLE_END,
            eligible_unused_days=Decimal("10.00"),
            payment_amount=Decimal("1000.00"),
            submitted_by=self.user,
            status=AnnualLeavePaymentRequest.Status.PENDING_HR,
        )
        self._run(CYCLE_END - timedelta(days=1))
        self.assertFalse(self._notices().exists())

    def test_pending_annual_leave_blocks_then_notifies_when_cleared(self):
        leave = LeaveRequest.objects.create(
            employee=self.user,
            employee_profile=self.profile,
            company=self.company,
            leave_type=self.annual,
            start_date=CYCLE_END + timedelta(days=10),
            end_date=CYCLE_END + timedelta(days=11),
            status=LeaveRequest.RequestStatus.PENDING_MANAGER,
        )
        self._run(CYCLE_END - timedelta(days=4))
        self.assertFalse(self._notices().exists())

        LeaveRequest.objects.filter(pk=leave.pk).update(status=LeaveRequest.RequestStatus.REJECTED)
        result, _ = self._run(CYCLE_END - timedelta(days=3))
        self.assertEqual(result["window_open_sent"], 1)
        self.assertEqual(self._notices().count(), 1)

    def test_less_than_six_months_of_service_blocks(self):
        today = CYCLE_END - timedelta(days=1)
        with patch("leaves.utils.get_completed_calendar_months", return_value=5):
            eligibility = build_annual_leave_eligibility(self.profile, active_company=self.company, as_of=today)
            self._run(today)
        self.assertTrue(eligibility["window_open"])
        self.assertIn("6 months of service", eligibility["reason"])
        self.assertFalse(self._notices().exists())

    def test_zero_eligible_days_blocks(self):
        # Approved Annual Leave covering more than the whole accrual leaves nothing to settle.
        LeaveRequest.objects.create(
            employee=self.user,
            employee_profile=self.profile,
            company=self.company,
            leave_type=self.annual,
            start_date=date(2026, 5, 1),
            end_date=date(2026, 5, 31),
            status=LeaveRequest.RequestStatus.APPROVED,
        )
        today = CYCLE_END - timedelta(days=1)
        eligibility = build_annual_leave_eligibility(self.profile, active_company=self.company, as_of=today)
        self.assertEqual(eligibility["eligible_unused_days"], Decimal("0"))
        self.assertIn("no eligible whole Annual Leave days", eligibility["reason"])
        self._run(today)
        self.assertFalse(self._notices().exists())

    # -- dedupe ------------------------------------------------------------------------------

    def test_sent_once_per_cycle_across_daily_runs(self):
        first, first_delay = self._run(CYCLE_END - timedelta(days=4))
        second, second_delay = self._run(CYCLE_END - timedelta(days=3))
        third, _ = self._run(CYCLE_END)

        self.assertEqual(first["window_open_sent"], 1)
        self.assertEqual(second["window_open_sent"], 0)
        self.assertEqual(third["window_open_sent"], 0)
        self.assertEqual(self._notices().count(), 1)
        first_delay.assert_called_once()
        second_delay.assert_not_called()

    # -- skipped recipients ------------------------------------------------------------------

    def test_inactive_user_is_skipped(self):
        User.objects.filter(pk=self.user.pk).update(is_active=False)
        self._run(CYCLE_END - timedelta(days=1))
        self.assertFalse(Notification.objects.filter(event_key=SETTLEMENT_WINDOW_OPEN_EVENT).exists())

    def test_terminated_and_archived_employees_are_skipped(self):
        for field, value in (
            ("employment_status", EmployeeProfile.EmploymentStatus.TERMINATED),
            ("is_archived", True),
        ):
            with self.subTest(field=field):
                original = getattr(self.profile, field)
                EmployeeProfile.objects.filter(pk=self.profile.pk).update(**{field: value})
                self._run(CYCLE_END - timedelta(days=1))
                self.assertFalse(self._notices().exists())
                EmployeeProfile.objects.filter(pk=self.profile.pk).update(**{field: original})

    def test_each_notice_is_scoped_to_the_employee_company(self):
        other_user = User.objects.create_user(email="other@window.test", password="password", is_active=True)
        other_profile = EmployeeProfile.objects.create(
            user=other_user,
            company=self.other_company,
            employee_id="WIN-OTHER",
            full_name="Other Company Employee",
            contract_date=CONTRACT_START,
            hire_date=CONTRACT_START,
        )
        self._run(CYCLE_END - timedelta(days=1))

        self.assertEqual(self._notices().get().company_id, self.company.id)
        other_notice = self._notices(other_user).get()
        self.assertEqual(other_notice.company_id, self.other_company.id)
        self.assertEqual(other_notice.related_object_id, str(other_profile.id))

    def test_eligibility_is_built_for_the_profile_company(self):
        with patch("leaves.tasks.build_annual_leave_eligibility", wraps=build_annual_leave_eligibility) as build:
            self._run(CYCLE_END - timedelta(days=1))
        companies = {call.kwargs["active_company"].id for call in build.call_args_list}
        self.assertEqual(companies, {self.company.id})
        self.assertNotIn(self.other_company.id, companies)

    def test_one_failing_profile_does_not_stop_the_run(self):
        second_user = User.objects.create_user(email="second@window.test", password="password", is_active=True)
        EmployeeProfile.objects.create(
            user=second_user,
            company=self.company,
            employee_id="WIN-2",
            full_name="Second Employee",
            contract_date=CONTRACT_START,
            hire_date=CONTRACT_START,
        )

        def flaky(profile, **kwargs):
            if profile.pk == self.profile.pk:
                raise RuntimeError("boom")
            return build_annual_leave_eligibility(profile, **kwargs)

        with patch("leaves.tasks.build_annual_leave_eligibility", side_effect=flaky):
            with self.assertLogs("leaves.tasks", level="ERROR"):
                result, _ = self._run(CYCLE_END - timedelta(days=1))
        self.assertEqual(result, {"window_open_sent": 1, "failed": 1})
        self.assertTrue(self._notices(second_user).exists())

    # -- wording -----------------------------------------------------------------------------

    def _mock_eligibility(self, locked):
        return {
            "can_request": True,
            "window_open": True,
            "cycle_start": CYCLE_START,
            "cycle_end": CYCLE_END,
            "eligible_unused_days": Decimal("10.00"),
            "locked_unused_days": Decimal(locked),
        }

    def test_locked_days_are_described_as_not_payable(self):
        with patch("leaves.tasks.build_annual_leave_eligibility", return_value=self._mock_eligibility("33.00")):
            self._run(CYCLE_END - timedelta(days=1))
        notice = self._notices().get()
        self.assertIn("Cash-eligible days: 10.", notice.message)
        self.assertIn("Leave-only days (not payable, can only be taken as leave): 33.", notice.message)
        arabic = localized_notification_field(notice, "message", "ar")
        self.assertIn("الأيام المستحقة للصرف النقدي: 10.", arabic)
        self.assertIn("غير قابلة للصرف", arabic)
        self.assertIn("33", arabic)
        self.assertEqual(notice.metadata["locked_unused_days"], "33.00")

    def test_no_locked_sentence_when_zero(self):
        kwargs = settlement_window_open_notification_kwargs(self.profile, self._mock_eligibility("0.00"))
        self.assertEqual(kwargs["i18n"]["key"], "annual_leave.settlement_window_open")
        self.assertNotIn("Leave-only", kwargs["message"])
        self.assertEqual(len(kwargs["email_context"]["rows"]), 3)

    # -- channels ----------------------------------------------------------------------------

    def _dispatch_and_capture_task_payload(self, locked="33.00"):
        with patch("leaves.tasks.build_annual_leave_eligibility", return_value=self._mock_eligibility(locked)):
            _, delay = self._run(CYCLE_END - timedelta(days=1))
        delay.assert_called_once()
        notification_id = delay.call_args.args[0]
        return notification_id, delay.call_args.kwargs

    @patch("in_app_notifications.dispatcher.EvolutionWhatsAppProvider")
    def test_in_app_and_whatsapp_channels_are_dispatched(self, provider):
        provider.return_value.send_text.return_value = {
            "success": True,
            "provider": "evolution_whatsapp",
            "message_id": "wa-1",
        }
        notification_id, payload = self._dispatch_and_capture_task_payload()
        self.assertTrue(payload["whatsapp_enabled"])
        self.assertTrue(payload["email_enabled"])

        deliver_whatsapp_notification.run(notification_id, **payload)

        provider.return_value.send_text.assert_called_once()
        call = provider.return_value.send_text.call_args.kwargs
        self.assertEqual(call["phone_number"], "+201001234567")
        text = call["text"]
        # Arabic first, English second, with the deep link to the settlement card.
        self.assertLess(text.index("فترة تسوية الإجازة السنوية"), text.index("Your Annual Leave settlement window"))
        self.assertIn("/employee/leave/balance?focus=settlement", text)
        delivery = NotificationDelivery.objects.get(
            notification_id=notification_id, channel=NotificationDelivery.Channel.WHATSAPP
        )
        self.assertEqual(delivery.status, NotificationDelivery.Status.SENT)

    @patch("in_app_notifications.dispatcher.EmailService")
    @patch("in_app_notifications.dispatcher.EvolutionWhatsAppProvider")
    def test_email_fallback_is_dispatched_when_whatsapp_cannot_deliver(self, provider, email_service):
        EmployeeProfile.objects.filter(pk=self.profile.pk).update(mobile="")
        email_service.return_value.send_html_email.return_value = {
            "success": True,
            "provider": "bird",
            "message_id": "mail-1",
            "status_code": 202,
        }
        notification_id, payload = self._dispatch_and_capture_task_payload()

        with patch("in_app_notifications.tasks.deliver_email_notification.delay") as email_delay:
            deliver_whatsapp_notification.run(notification_id, **payload)
        provider.return_value.send_text.assert_not_called()
        email_delay.assert_called_once()
        deliver_email_notification.run(*email_delay.call_args.args)

        email_service.return_value.send_html_email.assert_called_once()
        sent = email_service.return_value.send_html_email.call_args.kwargs
        self.assertEqual(sent["to_email"], "zeyad@window.test")
        self.assertEqual(sent["subject"], "Your Annual Leave settlement window is open")
        html = sent["html_content"]
        for fragment in (
            "فترة تسوية الإجازة السنوية مفتوحة لك الآن",
            "Leave-only days (not payable)",
            "33",
            "https://hr.example.test/employee/leave/balance?focus=settlement",
        ):
            self.assertIn(fragment, html)
        delivery = NotificationDelivery.objects.get(
            notification_id=notification_id, channel=NotificationDelivery.Channel.EMAIL
        )
        self.assertEqual(delivery.status, NotificationDelivery.Status.SENT)

    def test_whatsapp_and_email_opt_outs_are_respected(self):
        self.user.preferences.create(
            scope="notifications", key="channels", value={"whatsapp_enabled": False, "email_enabled": False}
        )
        _, payload = self._dispatch_and_capture_task_payload()
        self.assertFalse(payload["whatsapp_enabled"])
        self.assertFalse(payload["email_enabled"])
        # The in-app notification is still recorded.
        self.assertTrue(self._notices().exists())
