from datetime import date, datetime, time
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from admin_portal.models import SystemSettings
from employees.models import EmployeeProfile
from leaves.models import LeaveRequest, LeaveType
from organization.models import OrganizationNode

from .absence import mark_absentees_for_date
from .models import AttendanceRecord, BioTimeEmployeeMap
from .schedule import classify_check_in, get_work_schedule
from .services import SyncBioTimeService
from .tasks import mark_daily_absentees


User = get_user_model()


def _aware(y, m, d, hh, mm):
    return timezone.make_aware(datetime(y, m, d, hh, mm), timezone.get_current_timezone())


class WorkScheduleTests(TestCase):
    def setUp(self):
        s = SystemSettings.get_solo()
        s.work_day_start_time = time(9, 0)
        s.late_grace_minutes = 15
        s.work_week_days = [0, 1, 2, 3, 4]  # Mon-Fri for deterministic tests
        s.absence_detection_enabled = True
        s.save()

    def test_on_time_is_present(self):
        # 2026-01-05 is a Monday
        self.assertEqual(
            classify_check_in(_aware(2026, 1, 5, 9, 10), date(2026, 1, 5)),
            AttendanceRecord.Status.PRESENT,
        )

    def test_past_grace_is_late(self):
        self.assertEqual(
            classify_check_in(_aware(2026, 1, 5, 9, 16), date(2026, 1, 5)),
            AttendanceRecord.Status.LATE,
        )

    def test_non_working_day_never_late(self):
        # 2026-01-10 is a Saturday
        self.assertEqual(
            classify_check_in(_aware(2026, 1, 10, 11, 0), date(2026, 1, 10)),
            AttendanceRecord.Status.PRESENT,
        )

    def test_late_minutes(self):
        schedule = get_work_schedule()
        self.assertEqual(schedule.late_minutes(_aware(2026, 1, 5, 9, 45), date(2026, 1, 5)), 30)
        self.assertEqual(schedule.late_minutes(_aware(2026, 1, 5, 9, 5), date(2026, 1, 5)), 0)


class BioTimeLateClassificationTests(TestCase):
    def setUp(self):
        s = SystemSettings.get_solo()
        s.work_day_start_time = time(9, 0)
        s.late_grace_minutes = 15
        s.work_week_days = [0, 1, 2, 3, 4]
        s.save()
        self.company = OrganizationNode.objects.create(
            code="ATT_SCHED", name="Sched Co", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.profile = EmployeeProfile.objects.create(
            full_name="Late Riser", company=self.company, employee_id="SCHED001"
        )
        BioTimeEmployeeMap.objects.create(employee_profile=self.profile, biotime_emp_code="900")

    # The starting-work acknowledgment gate (HR BioTime verification) is
    # exercised by job_offers tests; here we isolate the late-classification.
    _ack_patch = "job_offers.starting_work_service.generate_starting_work_acknowledgment"

    def test_ingest_marks_late_record(self):
        with mock.patch(self._ack_patch, return_value=None):
            SyncBioTimeService.ingest_transactions(
                [{"emp_code": "900", "punch_time": "2026-01-05 09:40:00", "is_attendance": True}]
            )
        record = AttendanceRecord.objects.get(employee_profile=self.profile, date=date(2026, 1, 5))
        self.assertEqual(record.status, AttendanceRecord.Status.LATE)
        self.assertTrue(record.is_late_flagged)

    def test_ingest_marks_present_when_on_time(self):
        with mock.patch(self._ack_patch, return_value=None):
            SyncBioTimeService.ingest_transactions(
                [{"emp_code": "900", "punch_time": "2026-01-05 08:55:00", "is_attendance": True}]
            )
        record = AttendanceRecord.objects.get(employee_profile=self.profile, date=date(2026, 1, 5))
        self.assertEqual(record.status, AttendanceRecord.Status.PRESENT)
        self.assertFalse(record.is_late_flagged)


class AbsenceDetectionTests(TestCase):
    def setUp(self):
        s = SystemSettings.get_solo()
        s.work_week_days = [0, 1, 2, 3, 4]
        s.absence_detection_enabled = True
        s.save()
        self.company = OrganizationNode.objects.create(
            code="ATT_ABS", name="Abs Co", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.present_emp = EmployeeProfile.objects.create(
            full_name="Shows Up", company=self.company, employee_id="ABS001"
        )
        self.absent_emp = EmployeeProfile.objects.create(
            full_name="No Show", company=self.company, employee_id="ABS002"
        )
        self.leave_emp = EmployeeProfile.objects.create(
            full_name="On Leave", company=self.company, employee_id="ABS003"
        )
        self.archived_emp = EmployeeProfile.objects.create(
            full_name="Gone", company=self.company, is_archived=True, employee_id="ABS004"
        )
        self.workday = date(2026, 1, 5)  # Monday
        AttendanceRecord.objects.create(
            employee_profile=self.present_emp,
            date=self.workday,
            status=AttendanceRecord.Status.PRESENT,
            source=AttendanceRecord.Source.SYSTEM,
        )
        leave_type = LeaveType.objects.create(company=self.company, name="Annual", code="ANNUAL")
        LeaveRequest.objects.create(
            employee_profile=self.leave_emp,
            company=self.company,
            leave_type=leave_type,
            start_date=self.workday,
            end_date=self.workday,
            status=LeaveRequest.RequestStatus.APPROVED,
        )

    def test_marks_only_the_true_no_show(self):
        result = mark_absentees_for_date(self.workday)
        self.assertEqual(result["created"], 1)
        self.assertTrue(
            AttendanceRecord.objects.filter(
                employee_profile=self.absent_emp, date=self.workday, status=AttendanceRecord.Status.ABSENT
            ).exists()
        )
        self.assertFalse(AttendanceRecord.objects.filter(employee_profile=self.leave_emp).exists())
        self.assertFalse(AttendanceRecord.objects.filter(employee_profile=self.archived_emp).exists())

    def test_idempotent(self):
        mark_absentees_for_date(self.workday)
        second = mark_absentees_for_date(self.workday)
        self.assertEqual(second["created"], 0)
        # present_emp + absent_emp (created on the first run) both now have rows.
        self.assertEqual(second["skipped_existing"], 2)
        self.assertEqual(second["skipped_on_leave"], 1)

    def test_non_working_day_skipped(self):
        result = mark_absentees_for_date(date(2026, 1, 10))  # Saturday
        self.assertTrue(result["non_working_day"])
        self.assertEqual(result["created"], 0)

    def test_disabled_setting_blocks_scheduled_task(self):
        s = SystemSettings.get_solo()
        s.absence_detection_enabled = False
        s.save()
        result = mark_daily_absentees(self.workday.isoformat())
        self.assertTrue(result["disabled"])
        self.assertEqual(result["created"], 0)

    def test_non_active_employees_are_not_marked_absent(self):
        suspended = EmployeeProfile.objects.create(
            full_name="Suspended", company=self.company, employee_id="ABS010",
            employment_status=EmployeeProfile.EmploymentStatus.SUSPENDED,
        )
        terminated = EmployeeProfile.objects.create(
            full_name="Terminated", company=self.company, employee_id="ABS011",
            employment_status=EmployeeProfile.EmploymentStatus.TERMINATED,
        )
        disabled_user = User.objects.create_user(
            email="disabled@ffi.com", password="pw", is_active=False
        )
        disabled_profile = EmployeeProfile.objects.create(
            full_name="Disabled Login", company=self.company, employee_id="ABS012",
            user=disabled_user,
        )

        mark_absentees_for_date(self.workday)

        for profile in (suspended, terminated, disabled_profile):
            self.assertFalse(
                AttendanceRecord.objects.filter(employee_profile=profile).exists(),
                f"{profile.full_name} should not be auto-marked absent",
            )

    def test_run_writes_a_summary_audit_log(self):
        from audit.models import AuditLog

        mark_absentees_for_date(self.workday)
        entry = AuditLog.objects.filter(
            action="attendance.absence_detection_run", entity_id=self.workday.isoformat()
        ).first()
        self.assertIsNotNone(entry)
        self.assertEqual(entry.metadata["created"], 1)
        self.assertIsNone(entry.actor)
