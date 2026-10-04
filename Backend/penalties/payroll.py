"""Idempotent schedule-penalty claims for mutable DRAFT payroll runs."""

import logging
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.db.models import Q

from audit.utils import audit
from employees.models import EmployeeProfile
from payroll.models import AttendancePayrollDeduction, PayrollRun, PayrollRunItem, Payslip

from .models import PenaltyDeduction, PenaltyRecord

ZERO = Decimal("0.00")
Status = PenaltyDeduction.Status
logger = logging.getLogger(__name__)


def _due_for_run(run):
    return Q(intended_year__lt=run.year) | Q(intended_year=run.year, intended_month__lte=run.month)


@transaction.atomic
def sync_penalty_deductions(run, *, request=None):
    run = PayrollRun.objects.select_for_update().get(pk=run.pk)
    if run.status != PayrollRun.Status.DRAFT:
        raise ValueError("Only DRAFT payroll runs accept penalty claims.")
    candidates = Q(payroll_run=run) | (
        Q(company_id=run.company_id, status=Status.APPROVED, payroll_run__isnull=True, amount__gt=0) & _due_for_run(run)
    )
    profile_ids = sorted(set(PenaltyDeduction.objects.filter(candidates).values_list("employee_profile_id", flat=True)))
    if not profile_ids:
        return {"claimed": 0, "released": 0}
    profiles = {
        row.pk: row for row in EmployeeProfile.objects.select_for_update().filter(pk__in=profile_ids).order_by("pk")
    }
    penalty_ids = PenaltyDeduction.objects.filter(candidates, employee_profile_id__in=profile_ids).values_list(
        "penalty_id", flat=True
    )
    locked_penalties = {
        row.pk: row for row in PenaltyRecord.objects.select_for_update().filter(pk__in=penalty_ids).order_by("pk")
    }
    deductions = list(
        PenaltyDeduction.objects.select_for_update(of=("self",))
        .select_related("penalty")
        .filter(candidates, employee_profile_id__in=profile_ids)
        .order_by("pk")
    )
    for deduction in deductions:
        deduction.penalty = locked_penalties[deduction.penalty_id]
    # Article 70 limits the fines settled from one month's wages. Legacy late
    # deductions are fines too and are synchronized before this service in the
    # payroll generation/finalization path. Unworked-time withholding is not a
    # disciplinary fine and does not use the fine budget.
    used_fines = {profile_id: ZERO for profile_id in profile_ids}
    for profile_id, claimed_amount in AttendancePayrollDeduction.objects.filter(
        payroll_run=run, employee_profile_id__in=profile_ids, claimed_amount__gt=0
    ).values_list("employee_profile_id", "claimed_amount"):
        used_fines[profile_id] += claimed_amount
    selected = set()
    for deduction in sorted(
        deductions,
        key=lambda row: (row.status != Status.CLAIMED or row.payroll_run_id != run.pk, row.pk),
    ):
        if not (
            deduction.status in {Status.APPROVED, Status.CLAIMED}
            and deduction.penalty.status == PenaltyRecord.Status.ISSUED
            and (deduction.penalty.resolution or {}).get("decision") != "manual_review"
            and deduction.amount > 0
        ):
            continue
        profile = profiles[deduction.employee_profile_id]
        cap = ((profile.total_salary or ZERO) / Decimal("30") * Decimal("5")).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        fine = deduction.penalty.amount
        if fine <= cap and used_fines[profile.pk] + fine <= cap:
            selected.add(deduction.pk)
            used_fines[profile.pk] += fine
    items = list(PayrollRunItem.objects.select_for_update().filter(payroll_run=run).order_by("pk"))
    items_by_id = {row.pk: row for row in items}
    items_by_employee = {row.employee_id: row for row in items}
    payslips = {
        row.employee_id: row for row in Payslip.objects.select_for_update().filter(payroll_run=run, is_active=True)
    }
    changed_items, changed_payslips = {}, {}
    run_delta = ZERO
    counts = {"claimed": 0, "released": 0}
    for deduction in deductions:
        if deduction.status == Status.APPLIED:
            continue
        profile = profiles[deduction.employee_profile_id]
        chargeable = deduction.pk in selected
        held = deduction.payroll_run_id == run.pk
        item = items_by_id.get(deduction.payroll_run_item_id) if held else items_by_employee.get(profile.employee_id)
        if item is None:
            continue
        target = deduction.amount if chargeable else ZERO
        delta = target - deduction.claimed_amount
        if delta:
            item.total_deductions += delta
            item.net_salary -= delta
            changed_items[item.pk] = item
            payslip = payslips.get(profile.user_id)
            if payslip:
                payslip.total_deductions += delta
                payslip.net_salary -= delta
                changed_payslips[payslip.pk] = payslip
            run_delta += delta
        if chargeable:
            if held and not delta and deduction.status == Status.CLAIMED:
                continue
            deduction.payroll_run = run
            deduction.payroll_run_item = item
            deduction.status = Status.CLAIMED
            counts["claimed"] += 1
            event = "penalty_claimed_by_payroll"
        elif held:
            deduction.payroll_run = None
            deduction.payroll_run_item = None
            counts["released"] += 1
            event = "penalty_released_from_payroll"
        else:
            continue
        deduction.claimed_amount = target
        deduction.save(update_fields=["payroll_run", "payroll_run_item", "status", "claimed_amount", "updated_at"])
        audit(
            request,
            event,
            "PenaltyDeduction",
            deduction.pk,
            {
                "penalty_id": deduction.penalty_id,
                "run_id": run.pk,
                "delta": str(delta),
                "amount": str(target),
            },
        )
    if changed_items:
        PayrollRunItem.objects.bulk_update(changed_items.values(), ["total_deductions", "net_salary"])
    if changed_payslips:
        Payslip.objects.bulk_update(changed_payslips.values(), ["total_deductions", "net_salary"])
    if run_delta:
        run.total_net -= run_delta
        run.save(update_fields=["total_net", "updated_at"])
    logger.info(
        "penalty_payroll_claims_reconciled",
        extra={"run_id": run.pk, "company_id": run.company_id, **counts, "net_delta": str(run_delta)},
    )
    return counts


@transaction.atomic
def finalize_penalty_deductions(run, *, request=None):
    counts = sync_penalty_deductions(run, request=request)
    claims = list(
        PenaltyDeduction.objects.select_for_update(of=("self",))
        .select_related("penalty")
        .filter(payroll_run=run, status=Status.CLAIMED)
        .order_by("pk")
    )
    for claim in claims:
        claim.status = Status.APPLIED
        claim.save(update_fields=["status", "updated_at"])
        penalty = claim.penalty
        penalty.status = PenaltyRecord.Status.APPLIED
        penalty.save(update_fields=["status", "updated_at"])
        audit(
            request,
            "penalty_applied_to_payroll",
            "PenaltyDeduction",
            claim.pk,
            {
                "penalty_id": penalty.pk,
                "run_id": run.pk,
                "amount": str(claim.claimed_amount),
            },
        )
    counts["applied"] = len(claims)
    logger.info(
        "penalty_payroll_finalized", extra={"run_id": run.pk, "company_id": run.company_id, "applied": len(claims)}
    )
    return counts
