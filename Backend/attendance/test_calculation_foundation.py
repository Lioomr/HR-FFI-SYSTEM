from datetime import date, datetime

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase
from django.utils import timezone

from admin_portal.models import SystemSettings
from employees.models import EmployeeProfile
from hr_reference.models import Department, Position
from organization.models import OrganizationNode

from .biotime_policy import is_attendance_exempt
from .calculation import AttendanceCalculationService
from .models import (
    AttendanceDailyResult,
    AttendanceRecord,
    BioTimeEmployeeMap,
    BioTimeRawPunch,
    NormalizedAttendanceEvent,
)
from .schedule import classify_check_in, get_work_schedule
from .services import SyncBioTimeService

User = get_user_model()


class AttendanceCalculationFoundationTests(TestCase):
    def setUp(self):
        self.company = OrganizationNode.objects.create(
            code="ATT_FOUNDATION", name="Attendance Foundation", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.department = Department.objects.create(company=self.company, code="OPS-F", name="Operations")
        self.position = Position.objects.create(company=self.company, code="OP-F", name="Operator")
        self.user = User.objects.create_user(email="foundation@ffi.test", password="password")
        self.profile = EmployeeProfile.objects.create(
            user=self.user,
            company=self.company,
            employee_id="FOUND-001",
            department_ref=self.department,
            position_ref=self.position,
            hire_date=date(2026, 1, 1),
        )
        BioTimeEmployeeMap.objects.create(employee_profile=self.profile, biotime_emp_code="FOUND-001")

    def _transaction(self, hour, minute=0, punch_state=None, punch_id=None, day="2026-04-01"):
        transaction = {
            "emp_code": "FOUND-001",
            "punch_time": f"{day} {hour:02d}:{minute:02d}:00",
            "is_attendance": 1,
            "terminal_sn": "TERM-01",
        }
        if punch_state is not None:
            transaction["punch_state"] = punch_state
        if punch_id is not None:
            transaction["id"] = punch_id
        return transaction

    def _ingest(self, transactions):
        return SyncBioTimeService.ingest_transactions(transactions)

    def _result(self, work_date=date(2026, 4, 1)):
        return AttendanceDailyResult.objects.get(employee_profile=self.profile, date=work_date)

    def test_normal_attendance_and_early_arrival_are_calculated_without_penalties(self):
        self._ingest([self._transaction(9, punch_id="n1"), self._transaction(18, punch_id="n2")])
        normal = self._result()
        self.assertEqual(normal.physical_work_minutes, 540)
        self.assertEqual(normal.missing_minutes, 0)
        self.assertEqual(normal.status_input, "PRESENT")

        self._ingest(
            [
                self._transaction(8, 45, punch_id="e1", day="2026-04-02"),
                self._transaction(18, punch_id="e2", day="2026-04-02"),
            ]
        )
        early = self._result(date(2026, 4, 2))
        self.assertEqual(early.status_input, "PRESENT")
        self.assertEqual(early.missing_minutes, 0)

    def test_arrival_after_full_grace_window_is_late_candidate_without_post_grace_extension(self):
        settings_obj = SystemSettings.get_solo()
        settings_obj.grace_window_minutes = 15
        settings_obj.late_grace_minutes = 15
        settings_obj.post_grace_tolerance_minutes = 5
        settings_obj.save()
        self._ingest(
            [
                self._transaction(9, 16, punch_id="g1", day="2026-04-02"),
                self._transaction(18, punch_id="g2", day="2026-04-02"),
            ]
        )
        self.assertEqual(self._result(date(2026, 4, 2)).status_input, "LATE")
        self.assertEqual(get_work_schedule().grace_minutes, 15)
        late_check_in = timezone.make_aware(datetime(2026, 4, 2, 9, 16))
        self.assertEqual(classify_check_in(late_check_in, date(2026, 4, 2), self.profile), "LATE")

    def test_typed_and_multiple_breaks_are_normalized_and_unpaid(self):
        self._ingest(
            [
                self._transaction(9, punch_state=0, punch_id="b1"),
                self._transaction(12, punch_state=2, punch_id="b2"),
                self._transaction(12, 30, punch_state=3, punch_id="b3"),
                self._transaction(15, punch_state=2, punch_id="b4"),
                self._transaction(15, 15, punch_state=3, punch_id="b5"),
                self._transaction(18, punch_state=1, punch_id="b6"),
            ]
        )
        result = self._result()
        self.assertEqual(result.unpaid_break_minutes, 45)
        self.assertEqual(result.physical_work_minutes, 495)
        self.assertEqual(
            list(NormalizedAttendanceEvent.objects.values_list("event_type", flat=True)),
            ["CHECK_IN", "BREAK_OUT", "BREAK_IN", "BREAK_OUT", "BREAK_IN", "CHECK_OUT"],
        )

    def test_final_unreturned_break_out_is_final_departure_and_raw_event_is_unchanged(self):
        self._ingest(
            [self._transaction(9, punch_state=0, punch_id="u1"), self._transaction(15, punch_state=2, punch_id="u2")]
        )
        result = self._result()
        self.assertEqual(timezone.localtime(result.final_check_out_at).hour, 15)
        self.assertEqual(result.unpaid_break_minutes, 0)
        self.assertEqual(result.missing_minutes, 180)
        raw = BioTimeRawPunch.objects.get(provider_punch_id="u2")
        self.assertEqual(raw.raw_punch_type, "2")

    def test_duplicate_ingestion_and_normalization_are_idempotent(self):
        transactions = [self._transaction(9, punch_id="d1"), self._transaction(18, punch_id="d2")]
        first = self._ingest(transactions)
        event_snapshot = list(NormalizedAttendanceEvent.objects.values_list("raw_punch_id", "event_type", "sequence"))
        second = self._ingest(transactions)
        self.assertEqual(first["raw_created"], 2)
        self.assertEqual(second["raw_created"], 0)
        self.assertEqual(second["raw_duplicates"], 2)
        self.assertEqual(BioTimeRawPunch.objects.count(), 2)
        self.assertEqual(
            list(NormalizedAttendanceEvent.objects.values_list("raw_punch_id", "event_type", "sequence")),
            event_snapshot,
        )

    def test_timezone_boundary_uses_local_attendance_day(self):
        with timezone.override("Asia/Riyadh"):
            self._ingest(
                [
                    {"emp_code": "FOUND-001", "punch_time": "2026-04-01T21:30:00Z", "is_attendance": 1, "id": "tz1"},
                    {"emp_code": "FOUND-001", "punch_time": "2026-04-02T15:00:00Z", "is_attendance": 1, "id": "tz2"},
                ]
            )
            result = self._result(date(2026, 4, 2))
        self.assertEqual(result.date, date(2026, 4, 2))
        self.assertEqual(BioTimeRawPunch.objects.get(provider_punch_id="tz1").attendance_date, date(2026, 4, 2))

    def test_legacy_attendance_record_is_never_rewritten(self):
        legacy_check_in = timezone.make_aware(datetime(2026, 4, 1, 10, 0))
        legacy = AttendanceRecord.objects.create(
            employee_profile=self.profile,
            date=date(2026, 4, 1),
            check_in_at=legacy_check_in,
            source=AttendanceRecord.Source.HR,
            status=AttendanceRecord.Status.PRESENT,
            is_overridden=True,
            override_reason="Existing approved Exit Permission compatibility row",
        )
        self._ingest([self._transaction(9, punch_id="l1"), self._transaction(18, punch_id="l2")])
        legacy.refresh_from_db()
        self.assertEqual(legacy.check_in_at, legacy_check_in)
        self.assertTrue(legacy.is_overridden)
        self.assertFalse(legacy.is_biotime_projection)
        self.assertTrue(
            AttendanceDailyResult.objects.filter(employee_profile=self.profile, date=date(2026, 4, 1)).exists()
        )

    def test_recalculation_entry_point_is_safe_to_repeat(self):
        self._ingest([self._transaction(9, punch_id="r1"), self._transaction(18, punch_id="r2")])
        first = AttendanceCalculationService.recalculate(self.profile, date(2026, 4, 1))
        second = AttendanceCalculationService.recalculate(self.profile, date(2026, 4, 1))
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(NormalizedAttendanceEvent.objects.count(), 2)

    def test_explicit_and_ceo_role_attendance_exemptions_are_not_name_based(self):
        self.assertFalse(is_attendance_exempt(self.profile))
        self.profile.attendance_exempt = True
        self.profile.save(update_fields=["attendance_exempt"])
        self.assertTrue(is_attendance_exempt(self.profile))
        self.profile.attendance_exempt = False
        self.profile.save(update_fields=["attendance_exempt"])
        ceo_group, _ = Group.objects.get_or_create(name="CEO")
        self.user.groups.add(ceo_group)
        self.assertTrue(is_attendance_exempt(self.profile))
