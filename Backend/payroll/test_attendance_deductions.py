from datetime import date, datetime, time
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import transaction
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from admin_portal.models import SystemSettings
from attendance.models import AttendanceAdjustment, AttendanceDailyResult, AttendanceLateViolation
from attendance.policy import AttendancePolicyService
from employees.models import EmployeeProfile
from organization.models import OrganizationNode, UserOrganizationAccess

from .models import AttendancePayrollDeduction, PayrollRun, PayrollRunItem, Payslip
from .services import PayrollRunNotDraftError, finalize_attendance_deductions, sync_attendance_deductions
from .views import _generate_payroll_items

User = get_user_model()
Lifecycle = AttendanceLateViolation.Lifecycle
Status = AttendancePayrollDeduction.Status
NO_CHANGES = {"claimed": 0, "adjusted": 0, "released": 0}


class AttendancePayrollDeductionTests(TestCase):
    """Daily rate is 3000 / 30 = 100.00, so occurrence 2 is 5.00, 3 is 10.00."""

    def setUp(self):
        self.company = OrganizationNode.objects.create(
            code="ATT_PAYROLL", name="Attendance Payroll", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.user = User.objects.create_user(email="attendance-payroll@ffi.test", password="password")
        self.profile = EmployeeProfile.objects.create(
            user=self.user,
            company=self.company,
            employee_id="ATTPAY-001",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            basic_salary=Decimal("3000.00"),
            total_salary=Decimal("3000.00"),
        )
        settings_obj = SystemSettings.get_solo()
        settings_obj.grace_window_minutes = 15
        settings_obj.grace_use_limit_per_month = 3
        settings_obj.post_grace_tolerance_minutes = 5
        settings_obj.save()

    def _late(self, day):
        start = timezone.make_aware(datetime.combine(day, time(9, 0)))
        AttendanceDailyResult.objects.create(
            employee_profile=self.profile,
            company=self.company,
            date=day,
            shift_start_at=start,
            shift_end_at=start.replace(hour=18),
            scheduled_minutes=540,
            first_check_in_at=start.replace(minute=30),
            final_check_out_at=start.replace(hour=18),
        )
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

    def _draft(self, year, month):
        run = PayrollRun.objects.create(company=self.company, year=year, month=month)
        with transaction.atomic():
            _generate_payroll_items(run)
        run.refresh_from_db()
        return run

    @staticmethod
    def _finalize(run):
        with transaction.atomic():
            finalize_attendance_deductions(run)
            run.status = PayrollRun.Status.COMPLETED
            run.save(update_fields=["status", "updated_at"])
        run.refresh_from_db()

    @staticmethod
    def _totals(run):
        """(item deductions, item net, payslip deductions, payslip net, run net)."""
        run.refresh_from_db()
        item = PayrollRunItem.objects.get(payroll_run=run)
        payslip = Payslip.objects.get(payroll_run=run)
        return item.total_deductions, item.net_salary, payslip.total_deductions, payslip.net_salary, run.total_net

    @staticmethod
    def _expected(deductions):
        deductions = Decimal(deductions)
        net = Decimal("3000.00") - deductions
        return deductions, net, deductions, net, net

    def test_payroll_run_never_claims_or_applies_a_warning(self):
        warning = self._late(date(2026, 5, 4))
        run = self._draft(2026, 5)
        self.assertEqual(self._totals(run), self._expected("0.00"))

        self._finalize(run)

        warning.refresh_from_db()
        self.assertEqual(self._totals(run), self._expected("0.00"))
        self.assertEqual(warning.lifecycle, Lifecycle.ACTIVE)
        self.assertFalse(AttendancePayrollDeduction.objects.exists())

    def test_repeated_sync_and_finalize_claim_each_penalty_exactly_once(self):
        warning = self._late(date(2026, 5, 4))
        charged = self._late(date(2026, 5, 5))
        run = self._draft(2026, 5)
        self.assertEqual(self._totals(run), self._expected("5.00"))

        self.assertEqual(sync_attendance_deductions(run), NO_CHANGES)
        self.assertEqual(sync_attendance_deductions(run), NO_CHANGES)
        self.assertEqual(self._totals(run), self._expected("5.00"))
        self.assertEqual(
            list(AttendancePayrollDeduction.objects.values_list("violation", "status", "claimed_amount")),
            [(charged.id, Status.CLAIMED, Decimal("5.00"))],
        )

        self._finalize(run)
        warning.refresh_from_db()
        charged.refresh_from_db()
        self.assertEqual(self._totals(run), self._expected("5.00"))
        self.assertEqual(set(AttendancePayrollDeduction.objects.values_list("status", flat=True)), {Status.APPLIED})
        self.assertEqual((warning.lifecycle, charged.lifecycle), (Lifecycle.ACTIVE, Lifecycle.APPLIED))
        self.assertFalse(AttendancePayrollDeduction.objects.filter(violation=warning).exists())
        with self.assertRaises(PayrollRunNotDraftError):
            sync_attendance_deductions(run)

        next_run = self._draft(2026, 6)
        self.assertEqual(self._totals(next_run), self._expected("0.00"))
        self.assertEqual(self._totals(run), self._expected("5.00"))

    def test_penalty_pending_after_draft_creation_is_included_at_api_finalization(self):
        self._late(date(2026, 5, 4))
        self._late(date(2026, 5, 5))
        run = self._draft(2026, 5)
        after_draft = self._late(date(2026, 5, 6))
        self.assertEqual(
            (after_draft.payroll_deduction.status, after_draft.payroll_deduction.amount),
            (Status.PENDING, Decimal("10.00")),
        )

        hr = User.objects.create_user(email="attendance-payroll-hr@ffi.test", password="password")
        hr.groups.add(Group.objects.get_or_create(name="HRManager")[0])
        UserOrganizationAccess.objects.create(user=hr, organization=self.company)
        client = APIClient()
        client.force_authenticate(user=hr)
        url = f"/payroll-runs/{run.id}/finalize/"
        headers = {"HTTP_X_ACTIVE_COMPANY_ID": str(self.company.id)}

        first = client.post(url, {"confirm": True}, format="json", **headers)
        second = client.post(url, {"confirm": True}, format="json", **headers)

        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(second.data["data"]["message"], "Payroll run already finalized.")
        run.refresh_from_db()
        self.assertEqual(run.status, PayrollRun.Status.COMPLETED)
        self.assertEqual(self._totals(run), self._expected("15.00"))
        self.assertEqual(
            sorted(AttendancePayrollDeduction.objects.values_list("status", "claimed_amount")),
            [(Status.APPLIED, Decimal("5.00")), (Status.APPLIED, Decimal("10.00"))],
        )

    def test_penalty_for_a_locked_period_carries_forward_to_the_next_eligible_draft(self):
        may = self._draft(2026, 5)
        self._finalize(may)
        self._late(date(2026, 5, 20))
        self._late(date(2026, 5, 21))

        self.assertEqual(self._totals(may), self._expected("0.00"))
        self.assertEqual(set(AttendancePayrollDeduction.objects.values_list("status", flat=True)), {Status.PENDING})
        # An earlier period never claims a later period's penalty.
        april = self._draft(2026, 4)
        self.assertEqual(self._totals(april), self._expected("0.00"))

        june = self._draft(2026, 6)
        self.assertEqual(self._totals(june), self._expected("5.00"))
        self.assertEqual(set(AttendancePayrollDeduction.objects.values_list("payroll_run", flat=True)), {june.id})
        may.refresh_from_db()
        self.assertEqual(may.status, PayrollRun.Status.COMPLETED)

    def test_excused_warning_in_a_finalized_period_voids_without_manual_review(self):
        warning = self._late(date(2026, 5, 4))
        may = self._draft(2026, 5)
        self._finalize(may)
        warning.refresh_from_db()
        self.assertEqual(warning.lifecycle, Lifecycle.ACTIVE)

        self._excuse(date(2026, 5, 4))

        warning.refresh_from_db()
        self.assertEqual((warning.lifecycle, warning.void_reason), (Lifecycle.VOID, "late_permission"))
        self.assertFalse(AttendancePayrollDeduction.objects.exists())
        # The void warning no longer counts, so the next late day is again only a warning.
        later = self._late(date(2026, 5, 12))
        self.assertEqual((later.occurrence_number, later.penalty_amount), (1, Decimal("0.00")))
        self.assertFalse(AttendancePayrollDeduction.objects.exists())
        self.assertEqual(self._totals(may), self._expected("0.00"))

    def test_invalidating_an_applied_deduction_needs_manual_review_and_keeps_locked_totals(self):
        self._late(date(2026, 5, 4))
        charged = self._late(date(2026, 5, 5))
        may = self._draft(2026, 5)
        self._finalize(may)
        self.assertEqual(self._totals(may), self._expected("5.00"))

        self._excuse(date(2026, 5, 5))

        charged.refresh_from_db()
        self.assertEqual(
            (charged.lifecycle, charged.occurrence_number, charged.penalty_amount),
            (Lifecycle.MANUAL_REVIEW, 2, Decimal("5.00")),
        )
        deduction = AttendancePayrollDeduction.objects.get(violation=charged)
        self.assertEqual(
            (deduction.status, deduction.amount, deduction.claimed_amount, deduction.payroll_run_id),
            (Status.MANUAL_REVIEW, Decimal("5.00"), Decimal("5.00"), may.id),
        )
        self.assertEqual(self._totals(may), self._expected("5.00"))
        # Reviewed monetary history still counts toward later occurrences.
        later = self._late(date(2026, 5, 12))
        self.assertEqual((later.occurrence_number, later.penalty_amount), (3, Decimal("10.00")))
        # Removing the excusal never reactivates or renumbers reviewed history.
        AttendanceAdjustment.objects.filter(source_key="late-2026-05-05").delete()
        AttendancePolicyService.reconcile_month(self.profile, date(2026, 5, 12))
        charged.refresh_from_db()
        self.assertEqual((charged.lifecycle, charged.occurrence_number), (Lifecycle.MANUAL_REVIEW, 2))
        # No automatic credit is created for a later draft; June claims only the new penalty.
        self.assertEqual(self._totals(self._draft(2026, 6)), self._expected("10.00"))
        self.assertEqual(self._totals(may), self._expected("5.00"))

    def test_leftover_zero_value_rows_are_released_without_changing_totals(self):
        warning = self._late(date(2026, 5, 4))
        charged = self._late(date(2026, 5, 5))
        run = self._draft(2026, 5)
        # A row the earlier worktree created for a warning and a draft claimed.
        leftover = AttendancePayrollDeduction.objects.create(
            violation=warning,
            employee_profile=self.profile,
            company=self.company,
            intended_year=2026,
            intended_month=5,
            amount=Decimal("0.00"),
            status=Status.CLAIMED,
            payroll_run=run,
            payroll_run_item=PayrollRunItem.objects.get(payroll_run=run),
        )

        self.assertEqual(sync_attendance_deductions(run), {"claimed": 0, "adjusted": 0, "released": 1})
        self.assertEqual(self._totals(run), self._expected("5.00"))
        leftover.refresh_from_db()
        self.assertEqual((leftover.status, leftover.payroll_run_id), (Status.VOID, None))

        self._finalize(run)
        warning.refresh_from_db()
        self.assertEqual(self._totals(run), self._expected("5.00"))
        self.assertEqual(warning.lifecycle, Lifecycle.ACTIVE)
        self.assertEqual(AttendancePayrollDeduction.objects.get(violation=charged).status, Status.APPLIED)
        # The next reconciliation removes the released warning row entirely.
        AttendancePolicyService.reconcile_month(self.profile, date(2026, 5, 4))
        self.assertFalse(AttendancePayrollDeduction.objects.filter(violation=warning).exists())

    def test_leftover_pending_zero_value_row_is_never_claimed(self):
        warning = self._late(date(2026, 5, 4))
        leftover = AttendancePayrollDeduction.objects.create(
            violation=warning,
            employee_profile=self.profile,
            company=self.company,
            intended_year=2026,
            intended_month=5,
            amount=Decimal("0.00"),
        )

        run = self._draft(2026, 5)
        self._finalize(run)

        leftover.refresh_from_db()
        self.assertEqual((leftover.status, leftover.payroll_run_id), (Status.PENDING, None))
        self.assertEqual(self._totals(run), self._expected("0.00"))
        AttendancePolicyService.reconcile_month(self.profile, date(2026, 5, 4))
        self.assertFalse(AttendancePayrollDeduction.objects.exists())

    def test_voided_draft_claim_is_released_exactly_once(self):
        self._late(date(2026, 5, 4))
        voided = self._late(date(2026, 5, 5))
        run = self._draft(2026, 5)
        self.assertEqual(self._totals(run), self._expected("5.00"))

        self._excuse(date(2026, 5, 5))
        self.assertEqual(sync_attendance_deductions(run), {"claimed": 0, "adjusted": 0, "released": 1})
        self.assertEqual(sync_attendance_deductions(run), NO_CHANGES)
        self.assertEqual(self._totals(run), self._expected("0.00"))
        deduction = AttendancePayrollDeduction.objects.get(violation=voided)
        self.assertEqual(
            (deduction.status, deduction.payroll_run_id, deduction.claimed_amount), (Status.VOID, None, Decimal("0.00"))
        )

        # The void day does not count, so the next late day is occurrence 2.
        later = self._late(date(2026, 5, 6))
        self.assertEqual(later.occurrence_number, 2)
        self._finalize(run)
        self.assertEqual(self._totals(run), self._expected("5.00"))
        deduction.refresh_from_db()
        self.assertEqual(deduction.status, Status.VOID)

    def test_resequenced_draft_claims_are_adjusted_by_the_difference_only(self):
        self._late(date(2026, 5, 10))
        self._late(date(2026, 5, 11))
        run = self._draft(2026, 5)
        self.assertEqual(self._totals(run), self._expected("5.00"))

        # Delayed ingestion for an earlier day renumbers both claimed violations.
        self._late(date(2026, 5, 2))
        # May 10 becomes occurrence 2 (new 5.00 claim); May 11 becomes 3 (5.00 -> 10.00 adjustment).
        self.assertEqual(sync_attendance_deductions(run), {"claimed": 1, "adjusted": 1, "released": 0})
        self.assertEqual(sync_attendance_deductions(run), NO_CHANGES)
        self.assertEqual(self._totals(run), self._expected("15.00"))
