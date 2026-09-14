"""Attendance-penalty claims for DRAFT payroll runs.

A DRAFT run is the only mutable payroll state.  ``claimed_amount`` records
exactly how much of each deduction is already inside the run item, payslip,
and run totals, so a sync applies only the difference: newly due pending
penalties are claimed, changed claim amounts are adjusted, and voided claims
are released.  Repeating a sync is a no-op.

Only monetary penalties (occurrence 2 onward) are claimed; a first-occurrence
warning never becomes a deduction, and a zero-value row a draft still holds is
released without changing totals.

COMPLETED and PAID runs are never touched.  A penalty for an already locked
period stays pending until the next eligible draft; invalidating an applied
deduction is an attendance-policy manual-review exception, never a credit.
"""

from __future__ import annotations

from decimal import Decimal

from django.db import transaction
from django.db.models import Q

from attendance.models import AttendanceLateViolation
from audit.utils import audit
from employees.models import EmployeeProfile

from .models import AttendancePayrollDeduction, PayrollRun, PayrollRunItem, Payslip

ZERO = Decimal("0.00")
Status = AttendancePayrollDeduction.Status


class PayrollRunNotDraftError(Exception):
    """Raised when attendance claims would change a locked payroll run."""


def _due_for_run(run) -> Q:
    return Q(intended_year__lt=run.year) | Q(intended_year=run.year, intended_month__lte=run.month)


@transaction.atomic
def sync_attendance_deductions(run, *, request=None) -> dict:
    """Bring a DRAFT run's attendance claims up to date, exactly once per change."""
    run = PayrollRun.objects.select_for_update().get(pk=run.pk)
    if run.status != PayrollRun.Status.DRAFT:
        raise PayrollRunNotDraftError(f"Payroll run {run.pk} is {run.status}; only DRAFT runs accept attendance claims.")

    # A held row is always re-examined (so a zero-value leftover is released);
    # only monetary pending penalties are ever newly claimed.
    candidates = Q(payroll_run=run) | (
        Q(company_id=run.company_id, status=Status.PENDING, payroll_run__isnull=True, amount__gt=0)
        & _due_for_run(run)
    )
    counts = {"claimed": 0, "adjusted": 0, "released": 0}
    profile_ids = sorted(
        set(AttendancePayrollDeduction.objects.filter(candidates).values_list("employee_profile_id", flat=True))
    )
    if not profile_ids:
        return counts

    # Attendance reconciliation locks profile -> violation -> deduction; taking
    # the profile locks first keeps both writers in one lock order.  Rows are
    # re-read after the locks so a concurrent reconciliation is fully visible.
    profiles = {
        profile.pk: profile
        for profile in EmployeeProfile.objects.select_for_update().filter(pk__in=profile_ids).order_by("pk")
    }
    deductions = list(
        AttendancePayrollDeduction.objects.select_for_update(of=("self",))
        .select_related("violation")
        .filter(candidates, employee_profile_id__in=profile_ids)
        .order_by("pk")
    )
    items = list(PayrollRunItem.objects.select_for_update().filter(payroll_run=run).order_by("pk"))
    items_by_id = {item.pk: item for item in items}
    items_by_employee_id = {item.employee_id: item for item in items}
    payslips_by_user_id = {
        payslip.employee_id: payslip
        for payslip in Payslip.objects.select_for_update().filter(payroll_run=run, is_active=True).order_by("pk")
    }

    changed_items, changed_payslips = {}, {}
    run_delta = ZERO
    for deduction in deductions:
        if deduction.status in (Status.APPLIED, Status.MANUAL_REVIEW):
            continue
        profile = profiles[deduction.employee_profile_id]
        # A first-occurrence warning is never a payroll deduction.
        chargeable = (
            deduction.status != Status.VOID
            and deduction.amount > 0
            and deduction.violation.lifecycle == AttendanceLateViolation.Lifecycle.ACTIVE
        )
        held = deduction.payroll_run_id == run.pk
        if held:
            item = items_by_id.get(deduction.payroll_run_item_id)
        else:
            item = items_by_employee_id.get(profile.employee_id) if chargeable else None
        if item is None:
            # Employee is not in this run; the penalty stays pending for the next eligible draft.
            continue

        target = deduction.amount if chargeable else ZERO
        delta = target - deduction.claimed_amount
        if delta:
            item.total_deductions += delta
            item.net_salary -= delta
            changed_items[item.pk] = item
            payslip = payslips_by_user_id.get(profile.user_id)
            if payslip is not None:
                payslip.total_deductions += delta
                payslip.net_salary -= delta
                changed_payslips[payslip.pk] = payslip
            run_delta += delta

        if not held:
            deduction.payroll_run = run
            deduction.payroll_run_item = item
            deduction.status = Status.CLAIMED
            action, key = "attendance_penalty_claimed_by_payroll", "claimed"
        elif chargeable:
            if not delta and deduction.status == Status.CLAIMED:
                continue
            deduction.status = Status.CLAIMED
            action, key = "attendance_penalty_claim_adjusted", "adjusted"
        else:
            deduction.payroll_run = None
            deduction.payroll_run_item = None
            deduction.status = Status.VOID
            action, key = "attendance_penalty_released_from_payroll", "released"
        deduction.claimed_amount = target
        deduction.save(update_fields=["payroll_run", "payroll_run_item", "status", "claimed_amount", "updated_at"])
        counts[key] += 1
        audit(
            request,
            action,
            entity="AttendancePayrollDeduction",
            entity_id=deduction.id,
            metadata={
                "payroll_run_id": run.pk,
                "violation_id": deduction.violation_id,
                "amount": str(target),
                "delta": str(delta),
            },
        )

    if changed_items:
        PayrollRunItem.objects.bulk_update(changed_items.values(), ["total_deductions", "net_salary"])
    if changed_payslips:
        Payslip.objects.bulk_update(changed_payslips.values(), ["total_deductions", "net_salary"])
    if run_delta:
        run.total_net -= run_delta
        run.save(update_fields=["total_net", "updated_at"])
    return counts


@transaction.atomic
def finalize_attendance_deductions(run, *, request=None) -> dict:
    """Sync a DRAFT run one last time, then lock every held claim as applied.

    The caller transitions the run to COMPLETED in the same transaction.
    """
    counts = sync_attendance_deductions(run, request=request)
    claims = list(
        AttendancePayrollDeduction.objects.select_for_update(of=("self",))
        .select_related("violation")
        .filter(payroll_run_id=run.pk, status=Status.CLAIMED, amount__gt=0)
        .order_by("pk")
    )
    for claim in claims:
        claim.status = Status.APPLIED
        claim.save(update_fields=["status", "updated_at"])
        violation = claim.violation
        violation.lifecycle = AttendanceLateViolation.Lifecycle.APPLIED
        violation.save(update_fields=["lifecycle", "updated_at"])
        audit(
            request,
            "attendance_penalty_applied_to_payroll",
            entity="AttendancePayrollDeduction",
            entity_id=claim.id,
            metadata={"payroll_run_id": run.pk, "violation_id": claim.violation_id, "amount": str(claim.claimed_amount)},
        )
    counts["applied"] = len(claims)
    return counts
