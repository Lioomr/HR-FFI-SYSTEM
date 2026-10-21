"""The sole transactional writer for payroll money and source reservations."""

from dataclasses import asdict
from datetime import date
from decimal import Decimal
from fractions import Fraction

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from attendance.biotime_policy import attendance_enforced_from
from attendance.models import AttendanceLateViolation, AttendanceRecord
from attendance.schedule import get_work_schedule, is_rest_day_for_everyone, is_working_day
from audit.models import AuditLog
from audit.utils import audit
from core.executives import is_executive_profile
from employees.models import EmployeeProfile
from leaves.models import LeaveRequest
from loans.models import LoanRequest
from organization.models import OrganizationNode
from penalties.models import PenaltyDeduction, PenaltyRecord
from rents.models import Rent

from .calculator import (
    SALARY_COMPONENTS,
    CarryInput,
    EmployeeInput,
    PayrollInputError,
    PenaltyInput,
    RentAssignmentInput,
    allocate_rent,
    calculate_employee,
    calculate_run,
    date_set,
    period_dates,
)
from .configuration import PayrollDomainError
from .models import (
    AccommodationAssignment,
    AttendancePayrollDeduction,
    PayrollAdjustment,
    PayrollCarryForward,
    PayrollCarryForwardCollection,
    PayrollLine,
    PayrollRentAllocation,
    PayrollRun,
    PayrollRunItem,
    PayrollSettings,
    Payslip,
)

ZERO = Decimal(0)


def frozen(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Fraction):
        return {"numerator": str(value.numerator), "denominator": value.denominator}
    if isinstance(value, dict):
        return {k: frozen(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        values = sorted(value) if isinstance(value, (set, frozenset)) else value
        return [frozen(v) for v in values]
    return value


def event(request, action, entity, entity_id, original, new, reason, **metadata):
    audit(
        request,
        action,
        entity=entity,
        entity_id=entity_id,
        metadata=frozen(
            {
                "original_value": original,
                "new_value": new,
                "reason": reason,
                **metadata,
            }
        ),
    )
    return AuditLog.objects.filter(action=action, entity=entity, entity_id=str(entity_id)).latest("id")


def guard(run, expected_revision=None):
    if run.status != "DRAFT":
        raise PayrollDomainError("run_not_draft")
    if expected_revision is not None and expected_revision != run.revision:
        raise PayrollDomainError(
            "stale_revision", status_code=409, expected_revision=expected_revision, current_revision=run.revision
        )
    if run.settings_snapshot.get("legacy_unknown"):
        raise PayrollDomainError("legacy_link_unresolved")


def lock_run(run):
    OrganizationNode.objects.select_for_update().get(pk=run.company_id)
    return PayrollRun.objects.select_for_update().get(pk=run.pk)


def due(year, month, prefix="intended_"):
    return Q(**{prefix + "year__lt": year}) | Q(**{prefix + "year": year, prefix + "month__lte": month})


def run_period(run):
    return period_dates(
        run.year,
        run.month,
        run.calendar_days,
        period_start=run.period_start,
        period_end=run.period_end,
        period_basis=run.period_basis,
    )


def wage_dates(record):
    evidence = record.evidence or {}
    values = evidence.get("wage_absence_dates", evidence.get("absence_dates"))
    if values is None and record.source_kind != "absence":
        values = [record.occurred_on.isoformat()]
    try:
        return frozenset(date.fromisoformat(v) for v in (values or []))
    except (TypeError, ValueError):
        return frozenset()


def inputs(profile, run, old_item, penalties, loan, carries, accommodation, snapshot, *, executive_exempt=False):
    first, last = run_period(run)
    archive = timezone.localtime(profile.archived_at).date() if profile.archived_at else None
    employed = date_set(max(first, profile.hire_date or first), min(last, archive or last))
    mapped, starts = attendance_enforced_from(profile)
    uncovered = employed if not mapped else frozenset(d for d in employed if starts and d < starts)
    absent = frozenset(
        AttendanceRecord.objects.filter(
            employee_profile=profile,
            employee_profile__company_id=run.company_id,
            date__range=(first, last),
            status="ABSENT",
        ).values_list("date", flat=True)
    )
    paid, unpaid = set(), set()
    match = Q(employee_profile=profile)
    if profile.user_id:
        match |= Q(employee_profile__isnull=True, employee_id=profile.user_id)
    for leave in LeaveRequest.objects.select_related("leave_type").filter(
        match,
        company_id=run.company_id,
        status="approved",
        is_active=True,
        start_date__lte=last,
        end_date__gte=first,
    ):
        (paid if leave.leave_type.is_paid else unpaid).update(
            date_set(max(first, leave.start_date), min(last, leave.end_date))
        )
    get_work_schedule()
    working = frozenset(d for d in employed if not is_rest_day_for_everyone(d) and is_working_day(profile, d))
    old = old_item.input_snapshot if old_item else {}
    overrides = old.get("overrides", {})
    salary = {name: getattr(profile, name) or ZERO for name in SALARY_COMPONENTS}
    salary.update({k: Decimal(v) for k, v in overrides.get("salary_components", {}).items()})
    absent &= employed
    paid &= employed
    unpaid &= employed
    prior_dates, prior_amount, wage_evidence_complete = set(), ZERO, True
    for claim in (
        PenaltyDeduction.objects.select_related("penalty")
        .filter(
            company_id=run.company_id,
            employee_profile=profile,
            status="applied",
            penalty__extra_wage_amount__gt=0,
        )
        .exclude(payroll_run=run)
    ):
        dates = wage_dates(claim.penalty)
        if not dates and first <= claim.penalty.occurred_on <= last:
            wage_evidence_complete = False
        overlap = dates & employed
        if overlap:
            prior_dates.update(overlap)
            prior_amount += claim.penalty.extra_wage_amount * Decimal(len(overlap)) / len(dates)
    values = {
        k: Decimal(overrides[k])
        for k in (
            "overtime_normal_hours",
            "weekly_rest_work_days",
            "official_holiday_work_days",
            "bonus",
            "incentive",
            "other_addition",
            "other_deduction",
        )
        if k in overrides
    }
    if overrides.get("absence_days_override") is not None:
        values["absence_days_override"] = Decimal(overrides["absence_days_override"])
    values.update(
        {
            k: overrides[k]
            for k in (
                "zero_salary_reason",
                "zero_salary_reason_detail",
                "suspended_pay_decision",
                "override_overtime_eligibility",
            )
            if k in overrides
        }
    )
    return EmployeeInput(
        profile.pk,
        run.year,
        run.month,
        salary,
        calendar_days=run.calendar_days,
        period_start=first,
        period_end=last,
        period_basis=run.period_basis,
        hire_date=profile.hire_date,
        archive_date=archive,
        is_archived=profile.is_archived,
        employment_status=profile.employment_status,
        is_saudi=profile.is_saudi,
        deduct_gosi_from_employee=profile.deduct_gosi_from_employee,
        profile_total_salary=profile.total_salary,
        absent_dates=absent,
        unpaid_leave_dates=frozenset(unpaid),
        paid_leave_dates=frozenset(paid),
        due_work_dates=working,
        prior_wage_dates=frozenset(prior_dates),
        prior_wage_amount=prior_amount.quantize(Decimal("0.01")),
        wage_evidence_complete=wage_evidence_complete,
        attendance_source_available=bool(mapped and not uncovered),
        mapping_start_date=starts,
        uncovered_dates=uncovered,
        allowed_overtime=profile.allowed_overtime,
        absence_override_reason=old.get("absence_override_reason", ""),
        overtime_override_reason=old.get("overtime_override_reason", ""),
        penalties=tuple(penalties),
        loan_id=loan.pk if loan else None,
        loan_amount=(loan.approved_amount or loan.requested_amount) if loan else ZERO,
        carries=tuple(carries),
        accommodation_status=accommodation[0],
        accommodation_raw=accommodation[1],
        accommodation_assignment_present=accommodation[2],
        executive_exempt=executive_exempt,
        **values,
    )


def claim_state(row):
    return {
        "status": row.status,
        "payroll_run_id": row.payroll_run_id,
        "payroll_run_item_id": row.payroll_run_item_id,
        "claimed_amount": row.claimed_amount,
        "claimed_exact_amount": row.claimed_exact_amount,
    }


def reserve_claims(run, rows, collected, items, request, reason, attendance=False):
    counts = {"claimed": 0, "adjusted": 0, "released": 0}
    for row in rows:
        if row.status in ("applied", "manual_review"):
            continue
        held = row.payroll_run_id == run.pk
        target = collected.get(("attendance_penalty" if attendance else "penalty", row.pk), ZERO)
        if not held and not target:
            continue
        original = claim_state(row)
        if target:
            row.payroll_run, row.payroll_run_item = run, items[row.employee_profile_id]
            row.status = "claimed"
            row.claimed_exact_amount = row.amount
            row.claimed_amount = target
            key = "adjusted" if held else "claimed"
        else:
            row.payroll_run = row.payroll_run_item = None
            row.claimed_amount = row.claimed_exact_amount = ZERO
            if attendance:
                row.status = "pending" if row.amount > 0 and row.violation.lifecycle == "active" else "void"
            elif row.status == "claimed":
                row.status = "approved" if row.penalty.status == "issued" else "void"
            key = "released"
        new = claim_state(row)
        if original == new:
            continue
        row.save(
            update_fields=[
                "status",
                "payroll_run",
                "payroll_run_item",
                "claimed_amount",
                "claimed_exact_amount",
                "updated_at",
            ]
        )
        counts[key] += 1
        name = {"claimed": "claimed_by_payroll", "adjusted": "claim_adjusted", "released": "released_from_payroll"}[key]
        if not attendance and key == "adjusted":
            name = "claimed_by_payroll"
        event(
            request,
            ("attendance_penalty_" if attendance else "penalty_") + name,
            row.__class__.__name__,
            row.pk,
            original,
            new,
            reason,
            company_id=run.company_id,
            payroll_run_id=run.pk,
            exact_amount=str(row.claimed_exact_amount),
            rounded_amount=str(target),
        )
    return counts


def restore_loan(loan, run, request, reason):
    from loans.services import restore_payroll_deduction

    original = {
        "status": loan.status,
        "deduction_payroll_run_id": loan.deduction_payroll_run_id,
        "deducted_amount": loan.deducted_amount,
    }
    restore_payroll_deduction(loan, run=run, actor=getattr(request, "user", None), reason=reason)
    event(
        request,
        "payroll_loan_restored",
        "LoanRequest",
        loan.pk,
        original,
        {"status": loan.status, "deduction_payroll_run_id": None, "deducted_amount": None},
        reason,
        company_id=run.company_id,
        run_id=run.pk,
    )


def _resolve_settings_snapshot(run, refresh_settings):
    if run.settings_snapshot and not refresh_settings:
        return
    config = PayrollSettings.objects.select_for_update().filter(company_id=run.company_id).first()
    run.settings_snapshot = (config or PayrollSettings(company_id=run.company_id)).snapshot()
    if config is None:
        run.settings_snapshot["settings_revision"] = 0


def _lock_penalty_rows(run):
    """Lock source rows in a fixed order and return (attendance_rows, penalty_rows)."""
    held = Q(payroll_run=run)
    period_end = run_period(run)[1]
    attendance_query = AttendancePayrollDeduction.objects.filter(company_id=run.company_id).filter(
        held
        | (
            Q(status="pending", payroll_run__isnull=True)
            & due(run.year, run.month)
            & Q(violation__date__lte=period_end)
        )
    )
    penalty_query = PenaltyDeduction.objects.filter(company_id=run.company_id).filter(
        held
        | (
            Q(status="approved", payroll_run__isnull=True)
            & due(run.year, run.month)
            & Q(penalty__occurred_on__lte=period_end)
        )
    )
    list(
        AttendanceLateViolation.objects.select_for_update()
        .filter(pk__in=attendance_query.values("violation_id"))
        .order_by("pk")
    )
    list(PenaltyRecord.objects.select_for_update().filter(pk__in=penalty_query.values("penalty_id")).order_by("pk"))
    arows = list(attendance_query.select_for_update(of=("self",)).select_related("violation").order_by("pk"))
    prows = list(penalty_query.select_for_update(of=("self",)).select_related("penalty").order_by("pk"))
    return arows, prows


def _penalty_candidates(run, arows, prows, executive_flags):
    candidates = []
    _, period_end = run_period(run)
    for row in arows:
        if executive_flags.get(row.employee_profile_id, False):
            continue
        if row.amount > 0 and (
            (row.status in ("pending", "claimed") and row.violation.lifecycle == "active")
            or (row.status == "applied" and row.payroll_run_id == run.pk)
        ):
            candidates.append(
                (
                    row,
                    PenaltyInput(
                        f"attendance_penalty:{row.pk}", row.amount, source_kind="attendance_penalty", source_id=row.pk
                    ),
                )
            )
    for row in prows:
        if row.amount > 0 and (
            (
                row.status in ("approved", "claimed")
                and row.penalty.status == "issued"
                and (row.penalty.resolution or {}).get("decision") != "manual_review"
            )
            or (row.status == "applied" and row.payroll_run_id == run.pk)
        ):
            all_wage_dates = wage_dates(row.penalty)
            # A PenaltyDeduction is an indivisible claim. If its wage evidence
            # extends past this run's cutoff, keep the whole claim pending so a
            # later replacement/full window can collect it without losing the
            # excluded remainder. Empty dates make the calculator report the
            # existing wage-evidence blocker without snapshotting future dates.
            window_wage_dates = (
                frozenset() if any(day > period_end for day in all_wage_dates) else all_wage_dates
            )
            candidates.append(
                (
                    row,
                    PenaltyInput(
                        f"penalty:{row.pk}",
                        row.penalty.amount,
                        row.penalty.extra_wage_amount,
                        window_wage_dates,
                        "penalty",
                        row.pk,
                    ),
                )
            )
    candidates.sort(
        key=lambda pair: (pair[0].payroll_run_id != run.pk, pair[0].created_at, pair[1].source_kind, pair[0].pk)
    )
    return candidates


def _lock_loans(run):
    return list(
        LoanRequest.objects.select_for_update()
        .filter(company_id=run.company_id, is_active=True)
        .filter(
            Q(deduction_payroll_run=run)
            | (
                Q(status="approved", deduction_payroll_run__isnull=True)
                & (
                    due(run.year, run.month, "target_deduction_")
                    | Q(target_deduction_year__isnull=True, target_deduction_month__isnull=True)
                )
            )
        )
        .order_by("target_deduction_year", "target_deduction_month", "created_at", "pk")
    )


def _lock_carry_state(run):
    """Lock pending carry-forward balances and other runs' open reservations."""
    balances = list(
        PayrollCarryForward.objects.select_for_update()
        .filter(
            company_id=run.company_id,
            status="PENDING",
            remaining_amount__gt=0,
            origin_run__status__in=("COMPLETED", "PAID"),
        )
        .filter(due(run.year, run.month, "source_"))
        .exclude(origin_run=run)
        .order_by("source_year", "source_month", "pk")
    )
    reservations = list(
        PayrollCarryForwardCollection.objects.select_for_update()
        .filter(company_id=run.company_id, state="CLAIMED")
        .exclude(run=run)
    )
    return balances, reservations


def _lock_assignments(run):
    first, last = run_period(run)
    return list(
        AccommodationAssignment.objects.select_for_update()
        .select_related("employee_profile")
        .filter(
            company_id=run.company_id,
            is_active=True,
            start_date__lte=last,
            end_date__gte=first,
        )
        .order_by("pk")
    )


def _included_profile_ids(run, profiles):
    # Eligibility determines only payroll allocation membership, never the rent denominator.
    return {
        p.pk
        for p in profiles
        if calculate_employee(
            EmployeeInput(
                p.pk,
                run.year,
                run.month,
                {},
                calendar_days=run.calendar_days,
                period_start=run.period_start,
                period_end=run.period_end,
                period_basis=run.period_basis,
                hire_date=p.hire_date,
                is_archived=p.is_archived,
                archive_date=timezone.localtime(p.archived_at).date() if p.archived_at else None,
                employment_status=p.employment_status,
            ),
            run.settings_snapshot,
        )["included"]
    }


def _allocate_rents(run, assignments, included_ids):
    """Return (reports by rent id, raw rent share by profile id, validation issues)."""
    by_rent, reports, extra_issues = {}, {}, []
    for rent in Rent.objects.select_for_update().filter(company_id=run.company_id).order_by("pk"):
        resident_assignments = [a for a in assignments if a.rent_id == rent.pk]
        if rent.annual_rent_value is None:
            for assignment in resident_assignments:
                extra_issues.append(
                    {
                        "code": "rent_value_missing",
                        "severity": "error",
                        "employee_profile_id": assignment.employee_profile_id,
                        "message_key": "payroll.validation.rent_value_missing",
                        "params": {"rent_id": rent.pk},
                    }
                )
            continue
        rent_inputs = []
        for a in resident_assignments:
            end = a.end_date
            if a.employee_profile.archived_at:
                end = min(end, timezone.localtime(a.employee_profile.archived_at).date())
            if end >= a.start_date:
                rent_inputs.append(RentAssignmentInput(a.employee_profile_id, a.start_date, end))
        report = allocate_rent(
            run.year,
            run.month,
            rent.annual_rent_value,
            rent_inputs,
            included_ids,
            run.calendar_days,
            period_start=run.period_start,
            period_end=run.period_end,
            period_basis=run.period_basis,
        )
        reports[rent.pk] = report
        for resident in report["residents"]:
            raw = resident["raw_share"]
            by_rent[resident["employee_profile_id"]] = (
                by_rent.get(resident["employee_profile_id"], Fraction(0))
                + Fraction(raw["numerator"]) / raw["denominator"]
            )
    return reports, by_rent, extra_issues


def _accommodation_by_profile(run, profiles, assignments, reports, by_rent):
    accommodation = {}
    first, last = run_period(run)
    for profile in profiles:
        days = date_set(
            max(first, profile.hire_date or first),
            min(last, timezone.localtime(profile.archived_at).date() if profile.archived_at else last),
        )
        relevant = [a for a in assignments if a.employee_profile_id == profile.pk]
        complete = all(
            any(
                a.start_date <= d <= a.end_date
                and a.status != "unknown"
                and (a.status == "none" or a.rent_id in reports)
                for a in relevant
            )
            for d in days
        )
        assigned = any(a.status == "assigned" for a in relevant)
        accommodation[profile.pk] = (
            ("assigned", by_rent.get(profile.pk, Fraction(0)))
            if complete and assigned
            else ("none", Fraction(0))
            if complete and relevant
            else ("unknown", None)
        ) + (bool(relevant),)
    return accommodation


def _load_existing_items(run, profiles, input_snapshots):
    """Lock current items, link legacy ones to profiles and attach supplied input snapshots."""
    existing = list(PayrollRunItem.objects.select_for_update().filter(payroll_run=run).order_by("pk"))
    old_items = {item.employee_profile_id: item for item in existing if item.employee_profile_id}
    for item in existing:
        if item.employee_profile_id is None:
            matches = [p for p in profiles if p.employee_id == item.employee_id]
            if len(matches) != 1 or sum(i.employee_id == item.employee_id for i in existing) != 1:
                raise PayrollDomainError("legacy_link_unresolved")
            item.employee_profile = matches[0]
            item.company_id = run.company_id
            item.save(update_fields=["employee_profile", "company"])
            old_items[matches[0].pk] = item
    for item in existing:
        if input_snapshots and item.pk in input_snapshots:
            item.input_snapshot = input_snapshots[item.pk]
    return existing, old_items


def _build_employee_inputs(
    run, profiles, loans, balances, reservations, candidates, accommodation, executive_flags, old_items
):
    employee_inputs, chosen_loans = [], {}
    for profile in profiles:
        loan = next(
            (
                r
                for r in loans
                if profile.user_id and r.employee_id == profile.user_id and r.deduction_payroll_run_id == run.pk
            ),
            None,
        )
        loan = loan or next(
            (r for r in loans if profile.user_id and r.employee_id == profile.user_id and r.status == "approved"), None
        )
        chosen_loans[profile.pk] = loan
        carries = []
        for balance in balances:
            if balance.employee_profile_id == profile.pk:
                available = balance.remaining_amount - sum(
                    (r.amount for r in reservations if r.carry_id == balance.pk), ZERO
                )
                if available > 0:
                    carries.append(
                        CarryInput(
                            f"carry:{balance.pk}",
                            balance.type,
                            available,
                            balance.pk,
                            balance.source_year,
                            balance.source_month,
                        )
                    )
        employee_inputs.append(
            inputs(
                profile,
                run,
                old_items.get(profile.pk),
                [c for row, c in candidates if row.employee_profile_id == profile.pk],
                loan,
                carries,
                accommodation[profile.pk],
                run.settings_snapshot,
                executive_exempt=executive_flags[profile.pk],
            )
        )
    return employee_inputs, chosen_loans


def _source_change_type(previous_source, source):
    if any(previous_source.get(k) != source[k] for k in ("paid_leave_dates", "unpaid_leave_dates")):
        return "LEAVE_INPUT_CHANGE"
    if any(
        previous_source.get(k) != source[k]
        for k in ("hire_date", "archive_date", "is_archived", "employment_status", "executive_exempt")
    ):
        return "EMPLOYMENT_INPUT_CHANGE"
    return "MANUAL_ADJUSTMENT"


def _write_item(run, item, profile, value, employee_input, snapshot):
    item.is_active, item.employee_name, item.employee_id = True, profile.full_name, profile.employee_id
    item.department, item.position = profile.department or "", profile.job_title or ""
    item.company_id, item.input_snapshot = run.company_id, snapshot
    for name in (
        "gross_salary",
        "total_additions",
        "total_deductions",
        "net_salary",
        "total_provisions",
        "total_company_cost",
        "cost_incomplete",
    ):
        setattr(item, name, value[name])
    amounts = {line["type"]: line["amount"] for line in value["lines"] if line["category"] == "SALARY"}
    item.basic_salary = amounts["BASIC_SALARY"]
    item.total_allowances = value["gross_salary"] - item.basic_salary
    item.zero_salary_reason = employee_input.zero_salary_reason
    item.zero_salary_reason_detail = employee_input.zero_salary_reason_detail or None
    item.suspended_pay_decision = employee_input.suspended_pay_decision
    item.accommodation_status = value.get("accommodation_status", employee_input.accommodation_status)
    item.save()
    return amounts


def _audit_source_change(run, item, snapshot, source, previous_snapshot, original, request, reason, advance_revision):
    log = event(
        request,
        "payroll_input_refreshed",
        "PayrollRunItem",
        item.pk,
        original,
        {"input": snapshot, "net_salary": item.net_salary},
        reason,
        company_id=run.company_id,
        run_id=run.pk,
    )
    PayrollAdjustment.objects.create(
        company_id=run.company_id,
        audit_log=log,
        run=run,
        item=item,
        type=_source_change_type(previous_snapshot["source"], source),
        changed_fields=[k for k in source if previous_snapshot["source"].get(k) != source[k]],
        original_value=frozen(original),
        new_value=frozen({"input": snapshot}),
        reason=reason,
        actor=getattr(request, "user", None),
        input_revision=run.revision + int(advance_revision),
    )


def _sync_lines(run, item, value):
    keys = set()
    for row in value["lines"]:
        keys.add(row["source_key"])
        PayrollLine.objects.update_or_create(
            item=item,
            source_key=row["source_key"],
            defaults={
                "company_id": run.company_id,
                "category": row["category"],
                "type": row["type"],
                "amount": row["amount"],
                "quantity": row.get("quantity"),
                "source_kind": row["source_kind"],
                "source_id": str(row["source_id"]) if row.get("source_id") is not None else None,
                "source_year": row.get("source_year") or run.year,
                "source_month": row.get("source_month") or run.month,
                "requested_amount": row.get("requested_amount"),
                "collected_amount": row.get("collected_amount"),
                "uncollected_amount": row.get("uncollected_amount"),
                "carried_in": row.get("carried_in", False),
                "calculation_snapshot": frozen(row),
            },
        )
    PayrollLine.objects.filter(item=item).exclude(source_key__in=keys).delete()


def _sync_payslip(run, profile, item, amounts):
    slip = Payslip.objects.filter(payroll_run_item=item).first()
    if slip is None and profile.user_id:
        old_slips = list(Payslip.objects.filter(payroll_run=run, employee_id=profile.user_id))
        if len(old_slips) > 1:
            raise PayrollDomainError("legacy_link_unresolved")
        slip = old_slips[0] if old_slips else None
    slip = slip or Payslip(payroll_run=run, year=run.year, month=run.month)
    slip.employee_id, slip.employee_profile, slip.payroll_run_item = profile.user_id, profile, item
    slip.company_id, slip.status, slip.is_active, slip.calculation_version = run.company_id, "DRAFT", True, "1"
    for name, kind in SALARY_COMPONENTS.items():
        setattr(slip, name, amounts[kind])
    slip.total_salary, slip.total_additions = item.gross_salary, item.total_additions
    slip.total_deductions, slip.net_salary = item.total_deductions, item.net_salary
    slip.save()


def _apply_loan_collection(run, loan, value, request, reason):
    loan_collection = next(c for c in value["collection"] if c["type"] == "LOAN")
    if loan and loan_collection["collected"] > 0 and loan.deduction_payroll_run_id != run.pk:
        from loans.services import apply_payroll_deduction

        loan.payroll_pre_deduction_snapshot = {"status": loan.status}
        loan.save(update_fields=["payroll_pre_deduction_snapshot"])
        apply_payroll_deduction(loan, run=run)
        event(
            request,
            "loan_deducted_in_payroll",
            "LoanRequest",
            loan.pk,
            {"status": "approved"},
            {"status": "deducted", "deducted_amount": loan.deducted_amount},
            reason,
            payroll_run_id=run.pk,
            exact_amount=loan.deducted_amount,
            rounded_amount=loan_collection["collected"],
        )
    elif loan and loan.deduction_payroll_run_id == run.pk and not loan_collection["collected"]:
        restore_loan(loan, run, request, reason)


def _persist_results(
    run,
    result,
    profiles,
    employee_inputs,
    old_items,
    chosen_loans,
    request,
    reason,
    audit_source_changes,
    advance_revision,
):
    """Write one item, its lines and payslip per calculated employee; return (items, collected, changed count)."""
    profile_map = {p.pk: p for p in profiles}
    input_map = {e.employee_profile_id: e for e in employee_inputs}
    active_items, collected, changed_items = {}, {}, 0
    for value in result["items"]:
        profile = profile_map[value["employee_profile_id"]]
        item = old_items.get(profile.pk) or PayrollRunItem(
            payroll_run=run, employee_profile=profile, company_id=run.company_id
        )
        previous_snapshot = item.input_snapshot
        original = {"input": previous_snapshot, "net_salary": item.net_salary}
        source = frozen(asdict(input_map[profile.pk]))
        source["has_user_account"] = bool(profile.user_id)
        snapshot = {
            "schema_version": 1,
            "source": source,
            "result": frozen(value),
            "overrides": previous_snapshot.get("overrides", {}),
            "absence_override_reason": previous_snapshot.get("absence_override_reason", ""),
            "overtime_override_reason": previous_snapshot.get("overtime_override_reason", ""),
        }
        if previous_snapshot != snapshot:
            changed_items += 1
        amounts = _write_item(run, item, profile, value, input_map[profile.pk], snapshot)
        active_items[profile.pk] = item
        if audit_source_changes and previous_snapshot.get("source") and previous_snapshot["source"] != source:
            _audit_source_change(
                run, item, snapshot, source, previous_snapshot, original, request, reason, advance_revision
            )
        _sync_lines(run, item, value)
        _sync_payslip(run, profile, item, amounts)
        for c in value["collection"]:
            if c["source_kind"] in ("penalty", "attendance_penalty"):
                key = (c["source_kind"], c["source_id"])
                collected[key] = collected.get(key, ZERO) + c["collected"]
        _apply_loan_collection(run, chosen_loans[profile.pk], value, request, reason)
    return active_items, collected, changed_items


def _deactivate_missing_items(run, existing, active_items, result, request, reason, advance_revision):
    for item in existing:
        if item.employee_profile_id not in active_items:
            if item.is_active:
                original = frozen({"input": item.input_snapshot, "is_active": True})
                item.input_snapshot = {
                    **item.input_snapshot,
                    "excluded": frozen(
                        next(
                            (r for r in result["excluded"] if r["employee_profile_id"] == item.employee_profile_id), {}
                        )
                    ),
                }
                new = frozen({"input": item.input_snapshot, "is_active": False})
                log = event(
                    request,
                    "payroll_input_refreshed",
                    "PayrollRunItem",
                    item.pk,
                    original,
                    new,
                    reason,
                    company_id=run.company_id,
                    run_id=run.pk,
                )
                PayrollAdjustment.objects.create(
                    company_id=run.company_id,
                    run=run,
                    item=item,
                    audit_log=log,
                    type="EMPLOYMENT_INPUT_CHANGE",
                    changed_fields=["employment_status", "is_active"],
                    original_value=original,
                    new_value=new,
                    reason=reason,
                    actor=getattr(request, "user", None),
                    input_revision=run.revision + int(advance_revision),
                )
            item.is_active = False
            item.save(update_fields=["is_active", "input_snapshot"])
            Payslip.objects.filter(payroll_run_item=item).update(is_active=False)


def _persist_rent_allocations(run, reports, profile_map):
    for rent_id, report in reports.items():
        for resident in report["residents"]:
            resident_profile = profile_map.get(resident["employee_profile_id"])
            resident["employee_id"] = resident_profile.employee_id if resident_profile else ""
            resident["employee_name"] = resident_profile.full_name if resident_profile else ""
        rent_name = Rent.objects.get(pk=rent_id).property_name_en or Rent.objects.get(pk=rent_id).property_name_ar
        for slot in report["slots"]:
            slot["rent_name"] = rent_name
        PayrollRentAllocation.objects.update_or_create(
            run=run,
            rent_id=rent_id,
            defaults={
                "company_id": run.company_id,
                "annual_rent": Rent.objects.get(pk=rent_id).annual_rent_value,
                "slot_inputs": frozen(report["slots"]),
                "resident_allocations": frozen(report["residents"]),
                **{
                    key: report[key]
                    for key in ("monthly_rent", "vacant_unallocated_raw", "not_in_payroll_raw", "rounding_difference")
                },
            },
        )
    PayrollRentAllocation.objects.filter(run=run).exclude(rent_id__in=reports).delete()


def _save_run_totals(run, result, advance_revision):
    for key, value in result["totals"].items():
        setattr(run, {"net_salary": "total_net", "gross_salary": "total_gross"}.get(key, key), value)
    run.total_employees, run.cost_incomplete = result["total_employees"], result["cost_incomplete"]
    run.legacy_calculation, run.calculator_version, run.calculated_at = False, "1", timezone.now()
    run.revision += int(advance_revision)
    run.validation_snapshot = frozen(
        {"issues": result["issues"], "excluded": result["excluded"], "employees_checked": result["total_employees"]}
    )
    run.save()


def _audit_settings_refresh(run, original_run, request, reason):
    log = event(
        request,
        "payroll_settings_refreshed",
        "PayrollRun",
        run.pk,
        original_run["settings_snapshot"],
        run.settings_snapshot,
        reason,
        company_id=run.company_id,
    )
    PayrollAdjustment.objects.create(
        company_id=run.company_id,
        run=run,
        audit_log=log,
        type="SETTINGS_REFRESH",
        changed_fields=["settings_snapshot"],
        original_value=frozen(original_run["settings_snapshot"]),
        new_value=frozen(run.settings_snapshot),
        reason=reason,
        actor=getattr(request, "user", None),
        input_revision=run.revision,
    )


@transaction.atomic
def recalculate(
    run,
    *,
    request=None,
    reason="Payroll source synchronization",
    expected_revision=None,
    refresh_settings=False,
    advance_revision=False,
    audit_source_changes=True,
    input_snapshots=None,
):
    run = lock_run(run)
    guard(run, expected_revision)
    original_run = {"revision": run.revision, "total_net": run.total_net, "settings_snapshot": run.settings_snapshot}
    _resolve_settings_snapshot(run, refresh_settings)
    profiles = list(
        EmployeeProfile.objects.select_for_update(of=("self",))
        .select_related("user", "position_ref")
        .filter(company_id=run.company_id)
        .order_by("pk")
    )
    executive_flags = {profile.pk: is_executive_profile(profile) for profile in profiles}
    arows, prows = _lock_penalty_rows(run)
    candidates = _penalty_candidates(run, arows, prows, executive_flags)
    loans = _lock_loans(run)
    balances, reservations = _lock_carry_state(run)
    assignments = _lock_assignments(run)
    included_ids = _included_profile_ids(run, profiles)
    reports, by_rent, extra_issues = _allocate_rents(run, assignments, included_ids)
    accommodation = _accommodation_by_profile(run, profiles, assignments, reports, by_rent)
    existing, old_items = _load_existing_items(run, profiles, input_snapshots)
    employee_inputs, chosen_loans = _build_employee_inputs(
        run, profiles, loans, balances, reservations, candidates, accommodation, executive_flags, old_items
    )
    try:
        result = calculate_run(employee_inputs, run.settings_snapshot)
    except PayrollInputError as exc:
        raise PayrollDomainError(exc.code, field=exc.field or None, **exc.params) from exc
    result["issues"].extend(extra_issues)
    active_items, collected, changed_items = _persist_results(
        run,
        result,
        profiles,
        employee_inputs,
        old_items,
        chosen_loans,
        request,
        reason,
        audit_source_changes,
        advance_revision,
    )
    _deactivate_missing_items(run, existing, active_items, result, request, reason, advance_revision)
    for loan in loans:
        if loan.deduction_payroll_run_id == run.pk and not any(chosen_loans.get(k) == loan for k in active_items):
            restore_loan(loan, run, request, reason)
    counts = {
        "attendance": reserve_claims(run, arows, collected, active_items, request, reason, True),
        "penalty": reserve_claims(run, prows, collected, active_items, request, reason),
    }
    reserve_carry(run, result["items"], active_items, request, reason)
    _persist_rent_allocations(run, reports, {p.pk: p for p in profiles})
    _save_run_totals(run, result, advance_revision)
    if refresh_settings and original_run["settings_snapshot"] != run.settings_snapshot:
        _audit_settings_refresh(run, original_run, request, reason)
    if advance_revision:
        event(
            request,
            "payroll_run_recalculated",
            "PayrollRun",
            run.pk,
            original_run,
            {"revision": run.revision, "total_net": run.total_net, "settings_snapshot": run.settings_snapshot},
            reason,
            company_id=run.company_id,
        )
    return {"run": run, "changed_items": changed_items, "counts": counts}


def reserve_carry(run, results, items, request, reason):
    desired = {
        c["source_id"]: (c["collected"], items[r["employee_profile_id"]])
        for r in results
        for c in r["collection"]
        if c["source_kind"] == "carry_forward" and c["collected"] > 0
    }
    old = {r.carry_id: r for r in PayrollCarryForwardCollection.objects.select_for_update().filter(run=run)}
    for carry_id in set(desired) | set(old):
        amount, item = desired.get(carry_id, (ZERO, old[carry_id].item if carry_id in old else None))
        row = old.get(carry_id)
        state = "CLAIMED" if amount else "RELEASED"
        if row and row.amount == amount and row.state == state:
            continue
        log = event(
            request,
            "payroll_carry_reserved" if amount else "payroll_carry_released",
            "PayrollCarryForward",
            carry_id,
            {"amount": row.amount, "state": row.state} if row else None,
            {"amount": amount, "state": state},
            reason,
            company_id=run.company_id,
            run_id=run.pk,
        )
        PayrollCarryForwardCollection.objects.update_or_create(
            carry_id=carry_id,
            run=run,
            defaults={
                "company_id": run.company_id,
                "item": item,
                "amount": amount,
                "state": state,
                "audit_log": log,
            },
        )


@transaction.atomic
def apply_claims(run, request=None, *, attendance=True, penalty=True):
    counts = {}
    if attendance:
        rows = list(AttendancePayrollDeduction.objects.select_for_update().filter(payroll_run=run, status="claimed"))
        for row in rows:
            row.status = "applied"
            row.save(update_fields=["status", "updated_at"])
            AttendanceLateViolation.objects.filter(pk=row.violation_id).update(lifecycle="applied")
            event(
                request,
                "attendance_penalty_applied_to_payroll",
                "AttendancePayrollDeduction",
                row.pk,
                {"status": "claimed"},
                {"status": "applied", "amount": row.claimed_amount},
                "Payroll finalized",
                payroll_run_id=run.pk,
            )
        counts["attendance"] = len(rows)
    if penalty:
        from penalties.notifications import queue_penalty_notification

        rows = list(
            PenaltyDeduction.objects.select_for_update()
            .select_related("penalty")
            .filter(payroll_run=run, status="claimed")
        )
        for row in rows:
            row.status = "applied"
            row.save(update_fields=["status", "updated_at"])
            row.penalty.status = "applied"
            row.penalty.save(update_fields=["status", "updated_at"])
            queue_penalty_notification(row.penalty, "payroll_applied", hr=True)
            event(
                request,
                "penalty_applied_to_payroll",
                "PenaltyDeduction",
                row.pk,
                {"status": "claimed"},
                {"status": "applied", "amount": row.claimed_amount},
                "Payroll finalized",
                run_id=run.pk,
            )
        counts["penalty"] = len(rows)
    return counts


def apply_carry(run, request, reason):
    for row in (
        PayrollCarryForwardCollection.objects.select_for_update()
        .select_related("carry")
        .filter(run=run, state="CLAIMED")
    ):
        carry = PayrollCarryForward.objects.select_for_update().get(pk=row.carry_id)
        if row.amount > carry.remaining_amount:
            raise PayrollDomainError("payroll_reconciliation_failed")
        old = carry.remaining_amount
        carry.remaining_amount -= row.amount
        carry.status = "SETTLED" if carry.remaining_amount == 0 else "PENDING"
        carry.save()
        log = event(
            request,
            "payroll_carry_applied",
            "PayrollCarryForward",
            carry.pk,
            {"remaining_amount": old},
            {"remaining_amount": carry.remaining_amount},
            reason,
            company_id=run.company_id,
            run_id=run.pk,
        )
        row.state, row.audit_log = "APPLIED", log
        row.save()
    for item in run.items.filter(is_active=True):
        for c in item.input_snapshot.get("result", {}).get("collection", []):
            if c["type"] not in ("ABSENCE", "GOSI_EMPLOYEE") or c["carried_in"] or Decimal(c["uncollected"]) <= 0:
                continue
            balance, created = PayrollCarryForward.objects.get_or_create(
                company=run.company,
                employee_profile=item.employee_profile,
                origin_run=run,
                source_key=c["source_key"],
                type=c["type"],
                defaults={
                    "original_authorized_amount": Decimal(c["uncollected"]),
                    "remaining_amount": Decimal(c["uncollected"]),
                    "source_year": run.year,
                    "source_month": run.month,
                },
            )
            if created:
                event(
                    request,
                    "payroll_carry_applied",
                    "PayrollCarryForward",
                    balance.pk,
                    None,
                    {"remaining_amount": balance.remaining_amount},
                    reason,
                    company_id=run.company_id,
                    run_id=run.pk,
                )


@transaction.atomic
def cancel(run, *, request, reason, expected_revision):
    run = lock_run(run)
    counts = {
        "restored_loans": 0,
        "released_attendance_claims": 0,
        "released_penalty_claims": 0,
        "released_carry_collections": 0,
        "inactive_payslips": 0,
    }
    if run.status == "CANCELLED":
        return run, counts
    if run.status != "DRAFT":
        raise PayrollDomainError("run_not_draft")
    if expected_revision != run.revision:
        raise PayrollDomainError(
            "stale_revision", status_code=409, expected_revision=expected_revision, current_revision=run.revision
        )
    list(EmployeeProfile.objects.select_for_update().filter(company_id=run.company_id).order_by("pk"))
    attendance_rows = AttendancePayrollDeduction.objects.filter(
        company_id=run.company_id, payroll_run=run, status="claimed"
    )
    penalty_rows = PenaltyDeduction.objects.filter(company_id=run.company_id, payroll_run=run, status="claimed")
    list(
        AttendanceLateViolation.objects.select_for_update()
        .filter(pk__in=attendance_rows.values("violation_id"))
        .order_by("pk")
    )
    list(PenaltyRecord.objects.select_for_update().filter(pk__in=penalty_rows.values("penalty_id")).order_by("pk"))
    for loan in LoanRequest.objects.select_for_update().filter(company_id=run.company_id, deduction_payroll_run=run):
        restore_loan(loan, run, request, reason)
        counts["restored_loans"] += 1
    for model, attendance, key in (
        (AttendancePayrollDeduction, True, "released_attendance_claims"),
        (PenaltyDeduction, False, "released_penalty_claims"),
    ):
        rows = list(
            model.objects.select_for_update().filter(company_id=run.company_id, payroll_run=run, status="claimed")
        )
        counts[key] = reserve_claims(run, rows, {}, {}, request, reason, attendance)["released"]
    for row in PayrollCarryForwardCollection.objects.select_for_update().filter(run=run, state="CLAIMED"):
        log = event(
            request,
            "payroll_carry_released",
            "PayrollCarryForward",
            row.carry_id,
            {"amount": row.amount, "state": row.state},
            {"amount": row.amount, "state": "RELEASED"},
            reason,
            company_id=run.company_id,
            run_id=run.pk,
        )
        row.state, row.audit_log = "RELEASED", log
        row.save()
        counts["released_carry_collections"] += 1
    counts["inactive_payslips"] = run.payslips.filter(is_active=True).update(is_active=False, status="CANCELLED")
    run.status, run.cancelled_at, run.cancelled_by, run.cancel_reason = (
        "CANCELLED",
        timezone.now(),
        request.user,
        reason,
    )
    run.revision += 1
    run.save()
    event(
        request,
        "payroll_cancelled",
        "PayrollRun",
        run.pk,
        {"status": "DRAFT"},
        {"status": "CANCELLED"},
        reason,
        company_id=run.company_id,
        **counts,
    )
    return run, counts
