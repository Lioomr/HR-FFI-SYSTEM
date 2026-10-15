from datetime import date, datetime, time, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from attendance.models import AttendanceDailyResult, BioTimeEmployeeMap
from audit.models import AuditLog
from employees.models import EmployeeProfile
from in_app_notifications.models import Notification
from organization.models import OrganizationNode, UserOrganizationAccess

from .catalog import CATALOG
from .checks import check_penalties_effective_from
from .models import PenaltyCatalog, PenaltyDeduction, PenaltyRecord
from .notifications import notify_late_arrival, notify_penalty, queue_penalty_notification
from .services import sync_attendance_candidates, waive
from .tasks import notify_late_arrivals

EVENT = "penalty.late_arrival_recorded"


@override_settings(
    PENALTIES_EFFECTIVE_FROM="2026-09-29",
    PENALTY_AUTO_WARNINGS_EFFECTIVE_FROM="",
    PENALTY_LATE_NOTIFICATIONS_EFFECTIVE_FROM="2026-10-15",
    NOTIFICATION_WHATSAPP_DELIVERY_ENABLED=False,
    NOTIFICATION_EMAIL_FALLBACK_ENABLED=False,
    CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}},
    SECURE_SSL_REDIRECT=False,
)
class LateArrivalNotificationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        for row in CATALOG:
            PenaltyCatalog.objects.update_or_create(code=row["code"], defaults=row)
        cls.company = OrganizationNode.objects.create(code="LATE", name="Late Co", node_type="company")
        cls.user = get_user_model().objects.create_user(email="late@ffi.test", password="test")
        cls.profile = EmployeeProfile.objects.create(
            company=cls.company,
            user=cls.user,
            employee_id="LN-1",
            full_name="Late Employee",
            total_salary=0,
            mobile="+966500000001",
        )
        BioTimeEmployeeMap.objects.create(employee_profile=cls.profile, biotime_emp_code="LN-1")
        cls.hr = get_user_model().objects.create_user(email="late-hr@ffi.test", password="test")
        cls.hr.groups.add(Group.objects.get_or_create(name="HRManager")[0])
        UserOrganizationAccess.objects.create(user=cls.hr, organization=cls.company)
        UserOrganizationAccess.objects.create(user=cls.user, organization=cls.company)

    def _late(self, day=date(2026, 10, 15), minutes=5):
        start = timezone.make_aware(datetime.combine(day, time(9)))
        result = AttendanceDailyResult.objects.create(
            company=self.company,
            employee_profile=self.profile,
            date=day,
            shift_start_at=start,
            shift_end_at=start + timedelta(hours=9),
            first_check_in_at=start + timedelta(minutes=minutes),
            final_check_out_at=start + timedelta(hours=9),
            scheduled_minutes=540,
        )
        sync_attendance_candidates(result)
        return PenaltyRecord.objects.get(attendance_result=result, source_kind="late_arrival")

    def _notifications(self):
        return Notification.objects.filter(recipient=self.user, event_key=EVENT)

    def _client(self):
        client = APIClient()
        client.force_authenticate(self.hr)
        client.defaults["HTTP_X_ACTIVE_COMPANY_ID"] = str(self.company.pk)
        return client

    def test_all_four_bands_notify_without_hr_or_salary_and_preserve_pending_state(self):
        for day, minutes, code in [(15, 5, "W01"), (16, 20, "W03"), (17, 45, "W05"), (18, 75, "W07")]:
            with self.subTest(code=code), self.captureOnCommitCallbacks(execute=True):
                record = self._late(date(2026, 10, day), minutes)
            record.refresh_from_db()
            self.assertEqual(record.catalog.code, code)
            self.assertEqual(record.status, PenaltyRecord.Status.PENDING_HR_MARK)
            self.assertEqual(record.occurrence_number, 0)
            self.assertEqual(record.total_deduction_amount, Decimal("0"))
            self.assertIsNotNone(record.late_arrival_notified_at)
        self.assertEqual(self._notifications().count(), 4)
        self.assertFalse(PenaltyDeduction.objects.exists())

    def test_cutoff_uses_incident_date_including_old_records_reprocessed_today(self):
        with self.captureOnCommitCallbacks(execute=True):
            before = self._late(date(2026, 10, 14))
            today = self._late()
            sync_attendance_candidates(before.attendance_result)
        self.assertEqual(list(self._notifications().values_list("related_object_id", flat=True)), [str(today.pk)])
        self.assertFalse(notify_late_arrival(before.pk))
        self.assertEqual(notify_late_arrivals(), {"notified": 0})

    def test_sync_retry_and_notification_cleanup_do_not_resend(self):
        with self.captureOnCommitCallbacks(execute=True):
            record = self._late()
            sync_attendance_candidates(record.attendance_result)
        self.assertEqual(self._notifications().count(), 1)
        self.assertFalse(notify_late_arrival(record.pk))
        self.assertEqual(notify_late_arrivals(), {"notified": 0})
        self._notifications().delete()
        with self.captureOnCommitCallbacks(execute=True):
            sync_attendance_candidates(record.attendance_result)
        self.assertFalse(notify_late_arrival(record.pk))
        self.assertFalse(self._notifications().exists())

    def test_hourly_sweep_recovers_notification_creation_failure(self):
        with patch("penalties.notifications.dispatch_notification_channels", return_value={"notification": None}):
            with self.captureOnCommitCallbacks(execute=True):
                record = self._late()
        record.refresh_from_db()
        self.assertIsNone(record.late_arrival_notified_at)
        self.assertEqual(notify_late_arrivals(), {"notified": 1})
        self.assertEqual(notify_late_arrivals(), {"notified": 0})
        self.assertEqual(self._notifications().count(), 1)

    def test_waiver_before_commit_cancels_queued_arrival_and_keeps_hr_audit(self):
        with self.captureOnCommitCallbacks(execute=True):
            record = self._late()
            waive(record, reason="Permission confirmed")
        self.assertFalse(self._notifications().exists())
        self.assertFalse(Notification.objects.filter(recipient=self.user).exists())
        self.assertTrue(Notification.objects.filter(recipient=self.hr, event_key="penalty.waived").exists())
        self.assertTrue(AuditLog.objects.filter(action="penalty_waived", entity_id=str(record.pk)).exists())

    def test_accepted_permission_before_callback_is_respected(self):
        with self.captureOnCommitCallbacks(execute=True):
            record = self._late()
            result = record.attendance_result
            result.calculation_inputs = {"policy": {"late_excused": True}}
            result.save(update_fields=["calculation_inputs"])
        self.assertFalse(self._notifications().exists())

    def test_executives_inactive_users_and_unmapped_employees_are_not_notified(self):
        record = self._late()
        with self.subTest("executive"):
            self.profile.job_title = "General Manager"
            self.profile.save(update_fields=["job_title"])
            self.assertFalse(notify_late_arrival(record.pk))
        self.profile.job_title = ""
        self.profile.save(update_fields=["job_title"])
        with self.subTest("inactive"):
            get_user_model().objects.filter(pk=self.user.pk).update(is_active=False)
            self.assertFalse(notify_late_arrival(record.pk))
        get_user_model().objects.filter(pk=self.user.pk).update(is_active=True)
        with self.subTest("unmapped"):
            BioTimeEmployeeMap.objects.filter(employee_profile=self.profile).delete()
            self.assertFalse(notify_late_arrival(record.pk))
        self.assertFalse(self._notifications().exists())

    def test_hr_excuse_is_silent_for_employee_but_not_hr(self):
        record = self._late(date(2026, 10, 14))
        with self.captureOnCommitCallbacks(execute=True):
            response = self._client().post(
                f"/api/penalties/{record.pk}/mark-disruption/",
                {"disruption": "excused", "note": "Permission confirmed"},
                format="json",
            )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(Notification.objects.filter(recipient=self.user).exists())
        self.assertTrue(Notification.objects.filter(recipient=self.hr, event_key="penalty.waived").exists())

    @patch("penalties.notifications.dispatch_notification_channels")
    def test_direct_and_queued_waiver_events_never_dispatch_to_employee(self, dispatch):
        record = self._late(date(2026, 10, 14))
        for event in ("waived", "warning_withdrawn"):
            notify_penalty(record, event)
            with self.captureOnCommitCallbacks(execute=True):
                queue_penalty_notification(record, event)
        record.status = PenaltyRecord.Status.WAIVED
        notify_penalty(record, "resolved")
        dispatch.assert_not_called()

    @override_settings(NOTIFICATION_WHATSAPP_DELIVERY_ENABLED=True)
    @patch("in_app_notifications.dispatcher._queue_whatsapp")
    def test_whatsapp_is_queued_once_and_company_link_uses_incident_company(self, enqueue):
        other = OrganizationNode.objects.create(code="OTHER_LATE", name="Other", node_type="company")
        with self.captureOnCommitCallbacks(execute=True):
            record = self._late()
            self.profile.company = other
            self.profile.save(update_fields=["company"])
        notification = self._notifications().get()
        self.assertEqual(sum(call.args[0] == notification.pk for call in enqueue.call_args_list), 1)
        self.assertEqual(notification.company_id, self.company.pk)
        self.assertIn(f"company={self.company.pk}", notification.action_url)
        self.assertIn("2026-10-15", notification.message)
        self.assertIn("HR review is pending", notification.message)
        with self.captureOnCommitCallbacks(execute=True):
            sync_attendance_candidates(record.attendance_result)
        self.assertEqual(sum(call.args[0] == notification.pk for call in enqueue.call_args_list), 1)

    @override_settings(PENALTY_LATE_NOTIFICATIONS_EFFECTIVE_FROM="")
    def test_empty_cutoff_disables_automatic_notification(self):
        with self.captureOnCommitCallbacks(execute=True):
            record = self._late()
        self.assertFalse(notify_late_arrival(record.pk))
        self.assertEqual(notify_late_arrivals(), {"notified": 0})
        self.assertFalse(self._notifications().exists())

    @override_settings(PENALTY_LATE_NOTIFICATIONS_EFFECTIVE_FROM="invalid")
    def test_invalid_cutoff_is_a_system_check_error(self):
        self.assertIn("penalties.E004", [error.id for error in check_penalties_effective_from(None)])
