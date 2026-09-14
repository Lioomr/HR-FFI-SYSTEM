from datetime import date, datetime, time
from decimal import Decimal
from types import SimpleNamespace

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from admin_portal.models import SystemSettings
from audit.models import AuditLog
from employees.models import EmployeeProfile
from organization.models import OrganizationNode
from payroll.models import AttendancePayrollDeduction

from .models import (
    AttendanceAdjustment,
    AttendanceDailyResult,
    AttendanceGraceUse,
    AttendanceLateViolation,
    BioTimeEmployeeMap,
)
from .policy import AttendancePolicyService, penalty_percent, union_permission_minutes
from .serializers import AttendanceLateViolationSerializer
from .services import SyncBioTimeService

User = get_user_model()
Lifecycle = AttendanceLateViolation.Lifecycle
DeductionStatus = AttendancePayrollDeduction.Status


class AttendancePolicyTestBase(TestCase):
    def setUp(self):
        self.company = OrganizationNode.objects.create(
            code="ATT_POLICY", name="Attendance Policy", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.user = User.objects.create_user(email="policy@ffi.test", password="password")
        self.profile = EmployeeProfile.objects.create(
            user=self.user, company=self.company, employee_id="POLICY-001", total_salary=Decimal("3000.00")
        )
        settings_obj = SystemSettings.get_solo()
        settings_obj.work_day_start_time = time(9, 0)
        settings_obj.default_shift_end_time = time(18, 0)
        settings_obj.grace_window_minutes = 15
        settings_obj.grace_use_limit_per_month = 3
        settings_obj.post_grace_tolerance_minutes = 5
        settings_obj.save()

    def _result(self, day, minute, hour=9):
        start = timezone.make_aware(datetime.combine(day, time(9, 0)))
        return AttendanceDailyResult.objects.create(
            employee_profile=self.profile,
            company=self.company,
            date=day,
            shift_start_at=start,
            shift_end_at=start.replace(hour=18),
            scheduled_minutes=540,
            first_check_in_at=start.replace(hour=hour, minute=minute),
            final_check_out_at=start.replace(hour=18),
        )

    def _late(self, day):
        # 09:30 is outside the 15-minute grace window whether or not grace remains.
        self._result(day, 30)
        AttendancePolicyService.reconcile_month(self.profile, day)
        return AttendanceLateViolation.objects.get(employee_profile=self.profile, date=day)

    def _excuse(self, day):
        AttendanceAdjustment.objects.create(
            employee_profile=self.profile,
            company=self.company,
            date=day,
            effective_date=day,
            kind=AttendanceAdjustment.Kind.LATE_PERMISSION,
            source_key=f"late-{day.isoformat()}",
            approved_minutes=0,
            reason="late:TEST",
        )
        AttendancePolicyService.reconcile_month(self.profile, day)


class AttendancePolicyEnforcementTests(AttendancePolicyTestBase):
    def test_three_grace_arrivals_succeed_then_0906_is_late_and_penalized(self):
        for day in (date(2026, 5, 1), date(2026, 5, 2), date(2026, 5, 3)):
            self._result(day, 10)
        fourth = self._result(date(2026, 5, 4), 6)
        AttendancePolicyService.reconcile_month(self.profile, fourth.date)
        self.assertEqual(AttendanceLateViolation.objects.count(), 1)
        violation = AttendanceLateViolation.objects.get()
        self.assertEqual(violation.occurrence_number, 1)
        self.assertEqual(violation.penalty_amount, Decimal("0.00"))
        self.assertEqual(violation.reason, "post_grace_late")
        self.assertEqual(AttendanceGraceUse.objects.filter(consumed=True).count(), 3)
        fourth.refresh_from_db()
        self.assertEqual(fourth.status_input, "LATE")

    def test_0905_after_grace_exhaustion_is_within_post_grace_tolerance(self):
        for day in (date(2026, 5, 1), date(2026, 5, 2), date(2026, 5, 3)):
            self._result(day, 10)
        fourth = self._result(date(2026, 5, 4), 5)
        AttendancePolicyService.reconcile_month(self.profile, fourth.date)
        self.assertFalse(AttendanceLateViolation.objects.exists())
        self.assertEqual(AttendanceGraceUse.objects.get(date=fourth.date).reason, "post_grace_tolerance")

    def test_late_marker_excuses_arrival_without_paid_minutes(self):
        day = date(2026, 6, 1)
        result = self._result(day, 30)
        self._excuse(day)
        result.refresh_from_db()
        self.assertEqual(result.status_input, "PRESENT")
        self.assertEqual(result.approved_permission_minutes, 0)
        self.assertFalse(AttendanceLateViolation.objects.exists())
        self.assertFalse(AttendanceGraceUse.objects.get(date=day).consumed)

    def test_exempt_employee_consumes_no_grace_and_records_no_violation(self):
        self.profile.attendance_exempt = True
        self.profile.save(update_fields=["attendance_exempt"])
        self._result(date(2026, 5, 1), 10)
        self._result(date(2026, 5, 2), 45)
        AttendancePolicyService.reconcile_month(self.profile, date(2026, 5, 2))
        self.assertFalse(AttendanceLateViolation.objects.exists())
        self.assertEqual(
            set(AttendanceGraceUse.objects.values_list("consumed", "reason")), {(False, "attendance_exempt")}
        )

    def test_penalty_schedule_is_warning_then_five_ten_and_fifty_percent(self):
        self.assertEqual(
            [penalty_percent(occurrence) for occurrence in (1, 2, 3, 4, 9)],
            [Decimal("0"), Decimal("0.05"), Decimal("0.10"), Decimal("0.50"), Decimal("0.50")],
        )


class AttendanceViolationLifecycleTests(AttendancePolicyTestBase):
    def test_first_occurrence_is_a_warning_without_a_payroll_deduction(self):
        warning = self._late(date(2026, 5, 4))

        self.assertEqual(
            (warning.occurrence_number, warning.penalty_percent, warning.penalty_amount, warning.lifecycle),
            (1, Decimal("0"), Decimal("0.00"), Lifecycle.ACTIVE),
        )
        self.assertFalse(AttendancePayrollDeduction.objects.filter(violation=warning).exists())
        self.assertIsNone(AttendanceLateViolationSerializer(warning).data["payroll_status"])

    def test_second_occurrence_creates_the_five_percent_deduction(self):
        self._late(date(2026, 5, 4))
        charged = self._late(date(2026, 5, 5))

        self.assertEqual((charged.occurrence_number, charged.penalty_percent), (2, Decimal("0.05")))
        deduction = AttendancePayrollDeduction.objects.get(violation=charged)
        self.assertEqual((deduction.status, deduction.amount), (DeductionStatus.PENDING, Decimal("5.00")))
        self.assertEqual(AttendancePayrollDeduction.objects.count(), 1)
        self.assertEqual(AttendanceLateViolationSerializer(charged).data["payroll_status"], "pending")

    def test_excusing_an_uncharged_warning_voids_it_without_manual_review(self):
        warning = self._late(date(2026, 5, 4))

        self._excuse(date(2026, 5, 4))

        warning.refresh_from_db()
        self.assertEqual((warning.lifecycle, warning.void_reason), (Lifecycle.VOID, "late_permission"))
        self.assertFalse(AttendancePayrollDeduction.objects.exists())
        self.assertFalse(AuditLog.objects.filter(action="attendance_late_violation_manual_review").exists())

    def test_renumbering_between_penalty_and_warning_removes_then_recreates_the_deduction(self):
        first = self._late(date(2026, 5, 4))
        second = self._late(date(2026, 5, 5))
        self._excuse(date(2026, 5, 4))
        second.refresh_from_db()
        self.assertEqual(second.occurrence_number, 1)
        self.assertFalse(AttendancePayrollDeduction.objects.filter(violation=second).exists())

        AttendanceAdjustment.objects.filter(source_key="late-2026-05-04").delete()
        AttendancePolicyService.reconcile_month(self.profile, date(2026, 5, 4))
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual((first.lifecycle, first.occurrence_number), (Lifecycle.ACTIVE, 1))
        self.assertEqual((second.occurrence_number, second.penalty_amount), (2, Decimal("5.00")))
        self.assertEqual(AttendancePayrollDeduction.objects.get(violation=second).amount, Decimal("5.00"))
        self.assertFalse(AttendancePayrollDeduction.objects.filter(violation=first).exists())

    def test_excusing_an_open_violation_voids_it_and_removing_the_marker_reactivates_it(self):
        self._late(date(2026, 5, 4))
        second = self._late(date(2026, 5, 5))
        self.assertEqual((second.occurrence_number, second.penalty_amount), (2, Decimal("5.00")))

        self._excuse(date(2026, 5, 5))
        second.refresh_from_db()
        self.assertEqual((second.lifecycle, second.void_reason), (Lifecycle.VOID, "late_permission"))
        self.assertEqual(second.payroll_deduction.status, DeductionStatus.VOID)

        AttendanceAdjustment.objects.filter(source_key="late-2026-05-05").delete()
        AttendancePolicyService.reconcile_month(self.profile, date(2026, 5, 5))
        reactivated = AttendanceLateViolation.objects.get(date=date(2026, 5, 5))
        self.assertEqual(reactivated.pk, second.pk)
        self.assertEqual((reactivated.lifecycle, reactivated.occurrence_number), (Lifecycle.ACTIVE, 2))
        deduction = AttendancePayrollDeduction.objects.get(violation=reactivated)
        self.assertEqual((deduction.status, deduction.amount), (DeductionStatus.PENDING, Decimal("5.00")))

    def test_void_violations_do_not_count_toward_the_lifetime_sequence(self):
        first = self._late(date(2026, 5, 4))
        second = self._late(date(2026, 5, 5))
        self._excuse(date(2026, 5, 4))
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(first.lifecycle, Lifecycle.VOID)
        self.assertEqual((second.occurrence_number, second.penalty_amount), (1, Decimal("0.00")))
        # Now a warning: its never-claimed deduction is removed.
        self.assertFalse(AttendancePayrollDeduction.objects.exists())

    def test_delayed_earlier_month_resequences_later_open_violations(self):
        june_first = self._late(date(2026, 6, 3))
        june_second = self._late(date(2026, 6, 4))
        self.assertEqual([june_first.occurrence_number, june_second.occurrence_number], [1, 2])

        may = self._late(date(2026, 5, 20))
        june_first.refresh_from_db()
        june_second.refresh_from_db()
        self.assertEqual(may.occurrence_number, 1)
        self.assertEqual((june_first.occurrence_number, june_first.penalty_amount), (2, Decimal("5.00")))
        self.assertEqual((june_second.occurrence_number, june_second.penalty_amount), (3, Decimal("10.00")))
        self.assertEqual(
            list(
                AttendancePayrollDeduction.objects.order_by("violation__date").values_list("violation", "amount")
            ),
            [(june_first.id, Decimal("5.00")), (june_second.id, Decimal("10.00"))],
        )


class AttendancePolicyRawPunchTests(AttendancePolicyTestBase):
    def setUp(self):
        super().setUp()
        BioTimeEmployeeMap.objects.create(employee_profile=self.profile, biotime_emp_code="POLICY-001")

    def _punch(self, hour, minute, punch_id, punch_state=None, day="2026-04-01"):
        punch = {
            "emp_code": "POLICY-001",
            "punch_time": f"{day} {hour:02d}:{minute:02d}:00",
            "is_attendance": 1,
            "terminal_sn": "TERM-01",
            "id": punch_id,
        }
        if punch_state is not None:
            punch["punch_state"] = punch_state
        return punch

    def _adjustment(self, kind, key, start=None, end=None):
        return AttendanceAdjustment.objects.create(
            employee_profile=self.profile,
            company=self.company,
            date=date(2026, 4, 1),
            effective_date=date(2026, 4, 1),
            kind=kind,
            source_key=key,
            start_time=start,
            end_time=end,
            approved_minutes=0,
            reason=f"{kind}:TEST",
        )

    def test_policy_recalculation_from_raw_punches_is_idempotent(self):
        SyncBioTimeService.ingest_transactions(
            [
                self._punch(9, 30, "idem-in-1", day="2026-04-01"),
                self._punch(18, 0, "idem-out-1", day="2026-04-01"),
                self._punch(9, 30, "idem-in-2", day="2026-04-02"),
                self._punch(18, 0, "idem-out-2", day="2026-04-02"),
            ]
        )
        violation = AttendanceLateViolation.objects.get(employee_profile=self.profile, date=date(2026, 4, 2))
        deduction = AttendancePayrollDeduction.objects.get(violation=violation)
        snapshot = (violation.updated_at, violation.occurrence_number, violation.penalty_amount, deduction.updated_at)

        AttendancePolicyService.recalculate(self.profile, date(2026, 4, 2))
        AttendancePolicyService.recalculate(self.profile, date(2026, 4, 2))

        violation.refresh_from_db()
        deduction.refresh_from_db()
        self.assertEqual(
            (violation.updated_at, violation.occurrence_number, violation.penalty_amount, deduction.updated_at),
            snapshot,
        )
        self.assertEqual(AttendanceLateViolation.objects.count(), 2)
        # Only the monetary second occurrence has a deduction; the first is a warning.
        self.assertEqual(AttendancePayrollDeduction.objects.count(), 1)
        self.assertEqual(AttendanceGraceUse.objects.count(), 2)
        self.assertEqual(AuditLog.objects.filter(action="attendance_late_violation_created").count(), 2)
        result = AttendanceDailyResult.objects.get(employee_profile=self.profile, date=date(2026, 4, 2))
        self.assertEqual(result.status_input, "LATE")

    def test_during_shift_intervals_are_unioned_against_normalized_punch_intervals(self):
        kind = AttendanceAdjustment.Kind
        self._adjustment(kind.DURING_SHIFT_PERMISSION, "during-a", time(12, 0), time(13, 30))
        self._adjustment(kind.DURING_SHIFT_PERMISSION, "during-b", time(12, 30), time(14, 0))
        self._adjustment(kind.EXIT_PERMISSION, "exit-a", time(16, 0), time(17, 0))
        SyncBioTimeService.ingest_transactions(
            [
                self._punch(9, 0, "ds1", punch_state=0),
                self._punch(12, 0, "ds2", punch_state=2),
                self._punch(13, 0, "ds3", punch_state=3),
                self._punch(18, 0, "ds4", punch_state=1),
            ]
        )
        result = AttendanceDailyResult.objects.get(employee_profile=self.profile, date=date(2026, 4, 1))
        # Union 12:00-14:00 minus physical work from 13:00 leaves the 12:00-13:00 break.
        self.assertEqual(result.unpaid_break_minutes, 60)
        self.assertEqual(result.physical_work_minutes, 480)
        self.assertEqual(result.approved_permission_minutes, 60)
        self.assertEqual(result.accounted_attendance_minutes, 540)
        self.assertEqual(result.missing_minutes, 0)
        self.assertEqual(result.status_input, "PRESENT")


class DuringShiftIntervalTests(SimpleTestCase):
    def test_overlapping_intervals_are_unioned_and_physical_overlap_is_excluded(self):
        start = timezone.make_aware(datetime(2026, 5, 1, 9, 0))
        adjustments = [
            SimpleNamespace(kind="during_shift_permission", start_time=time(12, 0), end_time=time(13, 0)),
            SimpleNamespace(kind="during_shift_permission", start_time=time(12, 30), end_time=time(13, 30)),
            SimpleNamespace(kind="late_permission", start_time=None, end_time=None),
        ]
        self.assertEqual(
            union_permission_minutes(
                adjustments,
                shift_start=start,
                shift_end=start.replace(hour=18),
                physical_intervals=[(start.replace(hour=12), start.replace(hour=12, minute=45))],
            ),
            45,
        )
