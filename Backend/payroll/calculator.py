"""Pure payroll policy. Inputs are snapshots; no ORM, audit, auth or notifications."""

import calendar
from dataclasses import dataclass, replace
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal, localcontext
from fractions import Fraction

ZERO = Decimal("0")
SALARY_COMPONENTS = {
    "basic_salary": "BASIC_SALARY",
    "accommodation_allowance": "ACCOMMODATION_ALLOWANCE",
    "transportation_allowance": "TRANSPORTATION_ALLOWANCE",
    "telephone_allowance": "TELEPHONE_ALLOWANCE",
    "petrol_allowance": "PETROL_ALLOWANCE",
    "other_allowance": "OTHER_ALLOWANCE",
}
BASE_TYPES = ("BASIC", "BASIC_HOUSING", "BASIC_HOUSING_TRANSPORT", "GROSS", "FIXED_AMOUNT")
ZERO_REASONS = ("full_leave", "full_absence", "unpaid_leave", "not_joined", "suspended", "other")


class PayrollInputError(ValueError):
    def __init__(self, code, field_name="", **params):
        super().__init__(code)
        self.code, self.field, self.params = code, field_name, params


def decimal(value, field_name="", *, places=None):
    if isinstance(value, (float, bool)) or not isinstance(value, (Decimal, str, int)):
        raise PayrollInputError("invalid_decimal", field_name)
    try:
        result = Decimal(value)
    except Exception as exc:
        raise PayrollInputError("invalid_decimal", field_name) from exc
    if not result.is_finite() or result < 0 or (isinstance(value, str) and "e" in value.lower()):
        raise PayrollInputError("invalid_decimal", field_name)
    if places is not None and result.as_tuple().exponent < -places:
        raise PayrollInputError("invalid_decimal", field_name)
    return result


def money(value):
    if abs(value) > Decimal("9999999999999999.99"):
        raise PayrollInputError("amount_out_of_range")
    result = value.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    if abs(result) > Decimal("9999999999999999.99"):
        raise PayrollInputError("amount_out_of_range")
    return result


def validate_legacy_projections(*values):
    if any(abs(value) > Decimal("9999999999.99") for value in values):
        raise PayrollInputError("amount_out_of_range")


def default_settings():
    return {
        "day_basis": 30,
        "rounding": "ROUND_HALF_UP",
        "provision_proration": "FULL_MONTH",
        "require_manual_absence_confirmation": False,
        "normal_overtime_limit_period": "PAYROLL_WINDOW",
        **{
            name + "_base": {"type": base, "fixed_amount": None}
            for name, base in (
                ("absence", "GROSS"),
                ("gosi", "BASIC_HOUSING"),
                ("leave", "BASIC"),
                ("eos", "BASIC"),
                ("overtime", "BASIC"),
            )
        },
        "foreign_gosi_rate": "0.020000",
        "saudi_gosi_rate": "0.097500",
        "annual_medical_invoice": None,
        "no_medical_insurance": False,
        "monthly_foreign_id_cost": "862.50",
        "annual_air_ticket": "1500.00",
        "overtime_default_is_assumption": True,
    }


@dataclass(frozen=True)
class PenaltyInput:
    source_key: str
    fine: Decimal = ZERO
    wage: Decimal = ZERO
    wage_dates: frozenset = frozenset()
    source_kind: str = "penalty"
    source_id: int | None = None


@dataclass(frozen=True)
class CarryInput:
    source_key: str
    type: str
    amount: Decimal
    source_id: int | None = None
    source_year: int | None = None
    source_month: int | None = None


@dataclass(frozen=True)
class EmployeeInput:
    employee_profile_id: int
    year: int
    month: int
    salary: dict
    calendar_days: int | None = None
    period_start: date | None = None
    period_end: date | None = None
    period_basis: str | None = None
    hire_date: date | None = None
    archive_date: date | None = None
    is_archived: bool = False
    employment_status: str = "ACTIVE"
    is_saudi: bool = False
    deduct_gosi_from_employee: bool = False
    profile_total_salary: Decimal | None = None
    absent_dates: frozenset = frozenset()
    unpaid_leave_dates: frozenset = frozenset()
    paid_leave_dates: frozenset = frozenset()
    due_work_dates: frozenset | None = None
    prior_wage_dates: frozenset = frozenset()
    prior_wage_amount: Decimal = ZERO
    wage_evidence_complete: bool = True
    attendance_source_available: bool = False
    mapping_start_date: date | None = None
    uncovered_dates: frozenset = frozenset()
    absence_days_override: Decimal | None = None
    absence_override_reason: str = ""
    allowed_overtime: int | None = None
    overtime_normal_hours: Decimal = ZERO
    weekly_rest_work_days: Decimal = ZERO
    official_holiday_work_days: Decimal = ZERO
    override_overtime_eligibility: bool = False
    overtime_override_reason: str = ""
    bonus: Decimal = ZERO
    incentive: Decimal = ZERO
    other_addition: Decimal = ZERO
    other_deduction: Decimal = ZERO
    penalties: tuple = ()
    loan_amount: Decimal = ZERO
    loan_id: int | None = None
    carries: tuple = ()
    included_employee_count: int = 1
    accommodation_status: str = "unknown"
    accommodation_raw: Fraction | None = None
    zero_salary_reason: str | None = None
    zero_salary_reason_detail: str = ""
    suspended_pay_decision: str | None = None
    executive_exempt: bool = False
    accommodation_assignment_present: bool = False


def period_dates(
    year,
    month,
    calendar_days=None,
    *,
    period_start=None,
    period_end=None,
    period_basis=None,
):
    if period_start is not None or period_end is not None:
        if not isinstance(period_start, date) or not isinstance(period_end, date):
            raise PayrollInputError("invalid_date_range", "period_end")
        days = (period_end - period_start).days + 1
        if (
            not 1900 <= period_start.year <= 2100
            or not 1900 <= period_end.year <= 2100
            or (year, month) != (period_end.year, period_end.month)
            or days < 1
            or (days > 30 and period_basis != "LEGACY_FULL_MONTH")
        ):
            raise PayrollInputError("invalid_date_range", "period_end", max_days=30)
        return period_start, period_end
    if not 1900 <= year <= 2100 or not 1 <= month <= 12:
        raise PayrollInputError("invalid_period")
    month_days = calendar.monthrange(year, month)[1]
    if calendar_days is None:
        return date(year, month, 1), date(year, month, month_days)
    if isinstance(calendar_days, bool) or not isinstance(calendar_days, int):
        raise PayrollInputError("invalid_calendar_days", "calendar_days")
    if not 1 <= calendar_days <= min(30, month_days):
        raise PayrollInputError("invalid_calendar_days", "calendar_days")
    first, last = date(year, month, 1), date(year, month, calendar_days)
    return first, last


def date_set(first, last):
    return frozenset(first + timedelta(days=n) for n in range(max(0, (last - first).days + 1)))


def fifth_anniversary(hired):
    year = hired.year + 5
    return date(year, hired.month, min(hired.day, calendar.monthrange(year, hired.month)[1]))


def calculate_employee(employee: EmployeeInput, settings_snapshot: dict):
    with localcontext() as context:
        context.prec = 60
        return _calculate_employee(employee, settings_snapshot)


def _is_included(e, first, last, issue):
    """Decide payroll membership for the period, reporting data conflicts through ``issue``."""
    included = True
    if e.hire_date and e.hire_date > last:
        included = False
    elif e.is_archived and not e.archive_date:
        included = False
        issue("archived_without_date", "error")
    elif e.archive_date and e.archive_date < first:
        included = False
    elif e.employment_status == "PREHIRE":
        included = False
        if e.hire_date and e.hire_date <= last:
            issue("prehire_status_conflict", "error")
    elif e.employment_status == "TERMINATED" and not e.archive_date:
        included = False
        issue("terminated_without_end_date", "error")
    elif e.employment_status not in ("ACTIVE", "SUSPENDED", "TERMINATED", "PREHIRE"):
        raise PayrollInputError("invalid_choice", "employment_status")
    return included


def _make_base_resolver(settings, salary, monthly_gross):
    def base(name):
        selector = settings[name + "_base"]
        kind = selector["type"]
        if kind not in BASE_TYPES:
            raise PayrollInputError("invalid_choice", name + "_base")
        if kind == "FIXED_AMOUNT":
            if selector.get("fixed_amount") is None:
                raise PayrollInputError("invalid_decimal", name + "_base.fixed_amount")
            return decimal(selector["fixed_amount"], places=2)
        if selector.get("fixed_amount") is not None:
            raise PayrollInputError("invalid_choice", name + "_base.fixed_amount")
        return {
            "BASIC": salary["basic_salary"],
            "BASIC_HOUSING": salary["basic_salary"] + salary["accommodation_allowance"],
            "BASIC_HOUSING_TRANSPORT": salary["basic_salary"]
            + salary["accommodation_allowance"]
            + salary["transportation_allowance"],
            "GROSS": monthly_gross,
        }[kind]

    return base


def _overtime_hours(e, issue):
    """Return (normal_hours, payable_hours, excess) and report overtime policy issues."""
    normal_hours = decimal(e.overtime_normal_hours, "overtime_normal_hours", places=2)
    limit = e.allowed_overtime
    if limit is not None and (isinstance(limit, bool) or not isinstance(limit, int) or limit < 0):
        raise PayrollInputError("invalid_quantity", "allowed_overtime")
    excess = ZERO if e.executive_exempt or limit is None else max(ZERO, normal_hours - limit)
    valid_override = e.override_overtime_eligibility and bool(e.overtime_override_reason.strip())
    if e.override_overtime_eligibility and not valid_override:
        issue("reason_required", "error", field="overtime_override_reason")
    payable_hours = (
        normal_hours if e.executive_exempt or valid_override or limit is None else min(normal_hours, Decimal(limit))
    )
    if excess:
        issue(
            "overtime_over_allowed",
            allowed_hours=limit,
            entered_hours=str(normal_hours),
            over_allowed_hours=str(excess),
            unpaid_hours=str(normal_hours - payable_hours),
            overridden=bool(valid_override),
        )
    elif not e.executive_exempt and limit is None and normal_hours:
        issue("overtime_limit_not_set")
    return normal_hours, payable_hours, excess


def _accommodation_cost(e, issue):
    """Return (status, raw monthly cost or None) and report unknown accommodation."""
    if e.accommodation_status not in ("assigned", "none", "unknown"):
        raise PayrollInputError("invalid_choice", "accommodation_status")
    accommodation_status = e.accommodation_status
    if e.executive_exempt and not e.accommodation_assignment_present and accommodation_status == "unknown":
        accommodation_status = "none"
    accommodation = None
    if accommodation_status == "none":
        accommodation = ZERO
    elif accommodation_status == "assigned":
        if not isinstance(e.accommodation_raw, Fraction) or e.accommodation_raw < 0:
            raise PayrollInputError("rent_reconciliation_failed", "accommodation_raw")
        accommodation = Decimal(e.accommodation_raw.numerator) / Decimal(e.accommodation_raw.denominator)
    else:
        issue("accommodation_unknown")
    return accommodation_status, accommodation


def _medical_monthly_cost(e, settings, issue):
    invoice = settings["annual_medical_invoice"]
    medical = ZERO if settings["no_medical_insurance"] else None
    if not settings["no_medical_insurance"] and invoice is not None:
        if e.included_employee_count < 1:
            raise PayrollInputError("payroll_reconciliation_failed", "included_employee_count")
        medical = decimal(invoice, places=2) / 12 / e.included_employee_count
    elif medical is None:
        issue("medical_invoice_missing", scope="run")
    return medical


def _report_attendance_gaps(e, settings, manual_confirmed, issue):
    if not e.executive_exempt and not e.attendance_source_available:
        issue("attendance_source_unavailable", uncovered_dates=sorted(d.isoformat() for d in e.uncovered_dates))
        if settings["require_manual_absence_confirmation"] and not manual_confirmed:
            issue("attendance_source_unavailable", "error", manual_confirmation_required=True)
    if e.due_work_dates is None:
        issue("attendance_calendar_missing", "error")


def _is_high_tier(e):
    return bool(e.hire_date) and (e.year, e.month) > (
        fifth_anniversary(e.hire_date).year,
        fifth_anniversary(e.hire_date).month,
    )


def _assumptions(e, settings):
    assumptions = ["payroll.assumption.overtime_calendar_month"]
    if settings["overtime_default_is_assumption"]:
        assumptions.append("payroll.assumption.overtime_basic")
    if not e.hire_date:
        assumptions.append("payroll.assumption.missing_hire_date")
    return assumptions


def _line_source_kind(category, kind):
    source_kind = {
        "SALARY": "employee_salary",
        "ADDITION": "manual_adjustment",
        "PROVISION": "company_settings",
    }.get(category, "company_settings")
    return {
        "ABSENCE": "attendance_absence",
        "LOAN": "loan",
        "OTHER_DEDUCTION": "manual_adjustment",
        "ACCOMMODATION_COST": "rent_allocation",
    }.get(kind, source_kind)


def _provision_terms(e, settings, salary_days):
    """Return (proration mode, provision factor, GOSI rate) after validating settings."""
    mode = settings["provision_proration"]
    if mode not in ("FULL_MONTH", "PRORATED_BY_DAYS"):
        raise PayrollInputError("invalid_choice", "provision_proration")
    provision_factor = Decimal(salary_days) / 30 if mode == "PRORATED_BY_DAYS" else Decimal(1)
    rate = decimal(settings["saudi_gosi_rate" if e.is_saudi else "foreign_gosi_rate"], places=6)
    if rate > 1:
        raise PayrollInputError("invalid_decimal", "gosi_rate")
    return mode, provision_factor, rate


def _carried_totals(e):
    carry = list(e.carries)
    if any(c.type not in ("ABSENCE", "GOSI_EMPLOYEE") for c in carry):
        raise PayrollInputError("invalid_choice", "carry.type")
    carried_absence = sum((money(decimal(c.amount, places=2)) for c in carry if c.type == "ABSENCE"), ZERO)
    carried_gosi = sum((money(decimal(c.amount, places=2)) for c in carry if c.type == "GOSI_EMPLOYEE"), ZERO)
    return carry, carried_absence, carried_gosi


def _raw_provisions(e, settings, base, medical, high_tier, rate):
    return {
        "MEDICAL": medical,
        "ID_COST": ZERO if e.is_saudi else decimal(settings["monthly_foreign_id_cost"], places=2),
        "AIR_TICKET": decimal(settings["annual_air_ticket"], places=2) / 12,
        "LEAVE_PROVISION": base("leave") / 30 * (Decimal("2.50") if high_tier else Decimal("1.75")),
        "EOS_PROVISION": base("eos") / (12 if high_tier else 24),
        "GOSI_COMPANY": ZERO if e.deduct_gosi_from_employee else base("gosi") * rate,
    }


def _select_penalty_claims(e, cap, prior_budget, issue):
    """Split penalty claims into affordable ``selected`` and ``pending`` (claim, posted) pairs."""
    selected = []
    pending = []
    fine_used = Fraction(0)
    seen_keys = set()
    for claim in e.penalties:
        if e.executive_exempt and claim.source_kind == "attendance_penalty":
            continue
        if claim.source_key in seen_keys:
            raise PayrollInputError("payroll_reconciliation_failed", "penalty.source_key")
        seen_keys.add(claim.source_key)
        fine, wage = decimal(claim.fine, places=2), decimal(claim.wage, places=2)
        posted = money(fine) + money(wage)
        if wage and (not claim.wage_dates or not e.wage_evidence_complete):
            issue("penalty_wage_evidence_missing", "error", source_id=claim.source_id)
            pending.append((claim, posted))
            continue
        if Fraction(fine) + fine_used > cap:
            issue("penalty_pending_fine_cap", source_id=claim.source_id, amount=str(posted))
            pending.append((claim, posted))
            continue
        proposed = selected + [claim]
        cost = sum((money(decimal(c.fine)) + money(decimal(c.wage)) for c in proposed), ZERO)
        if cost > prior_budget(proposed):
            issue("claim_unaffordable", source_kind=claim.source_kind, source_id=claim.source_id, amount=str(posted))
            pending.append((claim, posted))
            continue
        selected.append(claim)
        fine_used += Fraction(fine)
    return selected, pending


def _collect_penalty_claims(selected, pending, cap, collect, collection):
    for claim in selected:
        fine_type = "ATTENDANCE_PENALTY" if claim.source_kind == "attendance_penalty" else "PENALTY_FINE"
        metadata = {
            "source_kind": claim.source_kind,
            "source_id": claim.source_id,
            "exact_fine_amount": str(claim.fine),
            "exact_amount": str(decimal(claim.fine) + decimal(claim.wage)),
            "rounded_amount": str(money(decimal(claim.fine)) + money(decimal(claim.wage))),
            "fine_cap": exact_share(cap),
            "rounding_delta": str(money(decimal(claim.fine)) - decimal(claim.fine)),
        }
        collect(fine_type, claim.fine, claim.source_key + ":fine", whole=True, **metadata)
        if claim.wage:
            collect(
                "PENALTY_WAGE_WITHHOLDING",
                claim.wage,
                claim.source_key + ":wage",
                whole=True,
                source_kind=claim.source_kind,
                source_id=claim.source_id,
            )
    for claim, posted in pending:
        # Pending whole claims are collection evidence, not zero-valued applied claims.
        collection.append(
            {
                "type": "ATTENDANCE_PENALTY" if claim.source_kind == "attendance_penalty" else "PENALTY_FINE",
                "source_key": claim.source_key,
                "requested": posted,
                "collected": ZERO,
                "uncollected": posted,
                "carried_in": False,
                "manual_reentry_required": False,
                "source_kind": claim.source_kind,
                "source_id": claim.source_id,
            }
        )


def _calculate_employee(e, settings_snapshot):
    settings = {**default_settings(), **settings_snapshot}
    issues = []

    def issue(code, severity="warning", **params):
        issues.append(
            {
                "code": code,
                "severity": severity,
                "employee_profile_id": e.employee_profile_id,
                "message_key": "payroll.validation." + code,
                "params": params,
            }
        )

    first, last = period_dates(
        e.year,
        e.month,
        e.calendar_days,
        period_start=e.period_start,
        period_end=e.period_end,
        period_basis=e.period_basis,
    )
    if not _is_included(e, first, last, issue):
        return {"included": False, "employee_profile_id": e.employee_profile_id, "issues": issues}
    if not e.hire_date:
        issue("missing_hire_date", "error")
    if e.employment_status == "SUSPENDED" and e.suspended_pay_decision not in ("FULL_PAY", "ZERO_PAY"):
        issue("suspended_pay_decision_required", "error")
    employed_first = max(first, e.hire_date or first)
    employed_last = min(last, e.archive_date or last)
    employed = date_set(employed_first, employed_last)
    salary_days = (
        30
        if (
            e.period_basis == "LEGACY_FULL_MONTH"
            or (e.period_basis is None and e.period_start is None and e.calendar_days is None)
        )
        and employed_first == first
        and employed_last == last
        else min(30, len(employed))
    )
    salary = {key: decimal(e.salary.get(key, ZERO), key, places=2) for key in SALARY_COMPONENTS}
    monthly_gross = sum(salary.values(), ZERO)
    if e.profile_total_salary is not None and decimal(e.profile_total_salary) != monthly_gross:
        issue("salary_total_mismatch")

    base = _make_base_resolver(settings, salary, monthly_gross)
    lines = []

    def line(category, kind, raw, source_key=None, **metadata):
        source_kind = _line_source_kind(category, kind)
        entry = {
            "category": category,
            "type": kind,
            "source_key": source_key or kind.lower(),
            "amount": None if raw is None else money(raw),
            "raw_amount": raw,
            "source_kind": source_kind,
            **metadata,
        }
        lines.append(entry)
        return entry

    zero_suspended = e.employment_status == "SUSPENDED" and e.suspended_pay_decision == "ZERO_PAY"
    for key, kind in SALARY_COMPONENTS.items():
        line("SALARY", kind, ZERO if zero_suspended else salary[key] * salary_days / 30)
    gross = sum(entry["amount"] for entry in lines)
    validate_legacy_projections(
        gross,
        *(entry["amount"] for entry in lines),
        sum(entry["amount"] for entry in lines if entry["type"] != "BASIC_SALARY"),
    )
    if zero_suspended and e.zero_salary_reason != "suspended":
        issue("zero_salary_reason_required", "error")
    normal_hours, payable_hours, excess = _overtime_hours(e, issue)
    overtime_base = base("overtime")
    line("ADDITION", "OVERTIME_NORMAL", overtime_base / 30 / 8 * Decimal("1.5") * payable_hours, quantity=payable_hours)
    line(
        "ADDITION",
        "WEEKLY_REST_WORK",
        overtime_base / 30 * Decimal("1.5") * decimal(e.weekly_rest_work_days, places=2),
        quantity=e.weekly_rest_work_days,
    )
    line(
        "ADDITION",
        "OFFICIAL_HOLIDAY_WORK",
        overtime_base / 30 * 2 * decimal(e.official_holiday_work_days, places=2),
        quantity=e.official_holiday_work_days,
    )
    for kind, value in (("BONUS", e.bonus), ("INCENTIVE", e.incentive), ("OTHER_ADDITION", e.other_addition)):
        line("ADDITION", kind, decimal(value, places=2))
    additions = sum(entry["amount"] for entry in lines if entry["category"] == "ADDITION")
    paid = e.paid_leave_dates & employed
    attendance_absent = frozenset() if e.executive_exempt else e.absent_dates
    absent_before_overlap = ((attendance_absent | e.unpaid_leave_dates) & employed) - paid
    manual_confirmed = e.absence_days_override is not None and bool(e.absence_override_reason.strip())
    manual_days = decimal(e.absence_days_override, places=2) if e.absence_days_override is not None else None
    if e.absence_days_override is not None and not manual_confirmed:
        issue("reason_required", "error", field="absence_override_reason")
    _report_attendance_gaps(e, settings, manual_confirmed, issue)
    due = (e.due_work_dates or frozenset()) & employed
    full_absence = bool(due) and due <= absent_before_overlap and not (due & paid)
    # Uncovered dates or a count alone cannot establish the full-month shortcut.
    full_absence = full_absence and (e.attendance_source_available or e.executive_exempt)
    if manual_confirmed and manual_days != len(absent_before_overlap):
        # An HR total replaces the observed count, so conflicting dates cannot prove full absence.
        full_absence = False
    if not e.wage_evidence_complete or (e.prior_wage_amount and not e.prior_wage_dates):
        issue("penalty_wage_evidence_missing", "error")
    absence_base = base("absence")
    absence_cap = min(absence_base, gross)
    prior_dates = e.prior_wage_dates & employed
    prior_wage = decimal(e.prior_wage_amount, places=2)

    def absence_raw(selected):
        wage_dates = prior_dates | frozenset(d for c in selected for d in c.wage_dates)
        prior_offset = prior_wage if prior_dates & absent_before_overlap else ZERO
        offset = prior_offset + sum(
            (decimal(c.wage, places=2) for c in selected if c.wage_dates & absent_before_overlap), ZERO
        )
        if full_absence:
            return max(ZERO, absence_cap - offset), Decimal(len(absent_before_overlap - wage_dates))
        days = Decimal(len(absent_before_overlap - wage_dates))
        if manual_confirmed:
            # Manual total includes leave/absence, never re-adds observed days.
            eligible_total = min(manual_days, Decimal(len(employed - paid)))
            days = max(ZERO, eligible_total - Decimal(len((wage_dates & employed) - paid)))
        raw = absence_base / 30 * days
        return min(raw, absence_cap), days

    mode, provision_factor, rate = _provision_terms(e, settings, salary_days)
    gosi = money(base("gosi") * rate * provision_factor)
    carry, carried_absence, carried_gosi = _carried_totals(e)

    def prior_budget(selected):
        raw, _ = absence_raw(selected)
        # Carried balances retain priority, but do not expand current absence authorization.
        absence_collected = min(gross + additions, carried_absence + money(raw))
        gosi_collected = min(
            gross + additions - absence_collected, carried_gosi + (gosi if e.deduct_gosi_from_employee else ZERO)
        )
        return gross + additions - absence_collected - gosi_collected

    cap = Fraction(gross) * 5 / 30
    selected, pending = _select_penalty_claims(e, cap, prior_budget, issue)
    absence_value, absent_days = absence_raw(selected)
    if absence_base / 30 * absent_days > absence_cap:
        issue("absence_capped", amount=str(money(absence_base / 30 * absent_days - absence_cap)))
    selected_wage_dates = frozenset(d for claim in selected for d in claim.wage_dates)
    if (
        prior_dates & absent_before_overlap
        or selected_wage_dates & absent_before_overlap
        or (manual_confirmed and (prior_dates | selected_wage_dates) & (employed - paid))
    ):
        issue("penalty_absence_overlap")
    budget = gross + additions
    collection = []

    def collect(kind, requested, source_key=None, *, whole=False, manual=False, **metadata):
        nonlocal budget
        requested = money(decimal(requested))
        amount = requested if budget >= requested else (ZERO if whole else budget)
        budget -= amount
        unpaid = requested - amount
        entry = line(
            "DEDUCTION",
            kind,
            amount,
            source_key,
            requested_amount=requested,
            collected_amount=amount,
            uncollected_amount=unpaid,
            **metadata,
        )
        collection.append(
            {
                "type": kind,
                "source_key": entry["source_key"],
                "requested": requested,
                "collected": amount,
                "uncollected": unpaid,
                "carried_in": metadata.get("carried_in", False),
                "manual_reentry_required": bool(manual and unpaid),
                "source_kind": entry["source_kind"],
                "source_id": metadata.get("source_id"),
            }
        )
        if unpaid:
            issue(
                "uncollected_deduction",
                amount=str(unpaid),
                source_key=entry["source_key"],
                manual_reentry_required=bool(manual),
            )
        return entry

    for kind, current in (("ABSENCE", absence_value), ("GOSI_EMPLOYEE", gosi if e.deduct_gosi_from_employee else ZERO)):
        for c in carry:
            if c.type == kind:
                collect(
                    kind,
                    c.amount,
                    c.source_key,
                    carried_in=True,
                    source_kind="carry_forward",
                    source_id=c.source_id,
                    source_year=c.source_year,
                    source_month=c.source_month,
                )
        collect(kind, current, quantity=absent_days if kind == "ABSENCE" else None)
    _collect_penalty_claims(selected, pending, cap, collect, collection)
    loan = collect("LOAN", e.loan_amount, whole=True, source_id=e.loan_id, source_kind="loan")
    if loan["uncollected_amount"]:
        issue("claim_unaffordable", source_kind="loan", source_id=e.loan_id, amount=str(loan["uncollected_amount"]))
    collect("OTHER_DEDUCTION", e.other_deduction, manual=True)
    if any(c["uncollected"] for c in collection):
        issue("deductions_capped")
    deductions = sum(entry["amount"] for entry in lines if entry["category"] == "DEDUCTION")
    net = gross + additions - deductions
    validate_legacy_projections(deductions, net)
    if net == 0 and e.zero_salary_reason not in ZERO_REASONS:
        issue("zero_salary_reason_required", "error")
    if e.zero_salary_reason == "other" and not e.zero_salary_reason_detail.strip():
        issue("zero_salary_detail_required", "error")
    high_tier = _is_high_tier(e)
    medical = _medical_monthly_cost(e, settings, issue)
    raw_provisions = _raw_provisions(e, settings, base, medical, high_tier, rate)
    for kind, raw in raw_provisions.items():
        line("PROVISION", kind, None if raw is None else raw * provision_factor)
    accommodation_status, accommodation = _accommodation_cost(e, issue)
    accommodation_line = line("PROVISION", "ACCOMMODATION_COST", accommodation)
    if accommodation_status == "assigned":
        accommodation_line["amount"] = money(round_share(e.accommodation_raw))
        accommodation_line["raw_share"] = exact_share(e.accommodation_raw)
    provisions = sum(
        (entry["amount"] for entry in lines if entry["category"] == "PROVISION" and entry["amount"] is not None), ZERO
    )
    company_cost = money(net + provisions)
    assumptions = _assumptions(e, settings)
    return {
        "included": True,
        "employee_profile_id": e.employee_profile_id,
        "salary_days": salary_days,
        "employed_calendar_days": len(employed),
        "employed_dates": employed,
        "full_monthly_gross": monthly_gross,
        "gross_salary": gross,
        "total_additions": additions,
        "total_deductions": deductions,
        "net_salary": net,
        "total_provisions": provisions,
        "total_company_cost": company_cost,
        "cost_incomplete": medical is None or accommodation is None,
        "accommodation_status": accommodation_status,
        "lines": lines,
        "collection": collection,
        "issues": issues,
        "assumptions": assumptions,
        "provision_proration": mode,
        "absence": {
            "effective_days": absent_days,
            "full_month_absence": full_absence,
            "raw_amount": absence_value,
            "source_available": e.attendance_source_available,
            "manual_confirmed": manual_confirmed,
        },
        "overtime": {
            "normal_hours": normal_hours,
            "payable_normal_hours": payable_hours,
            "over_allowed_hours": excess,
            "unpaid_normal_hours": normal_hours - payable_hours,
            "limit_period": "PAYROLL_WINDOW",
        },
        "five_year_anniversary": fifth_anniversary(e.hire_date) if e.hire_date else None,
    }


def exact_share(value: Fraction):
    with localcontext() as context:
        context.prec = 28
        return {
            "numerator": f"{Decimal(value.numerator):.2f}",
            "denominator": value.denominator,
            "decimal": str(Decimal(value.numerator) / value.denominator),
        }


def round_share(value: Fraction):
    # Exact half-up comparison avoids a rounded Decimal approximation near .5.
    if value < 0:
        return -round_share(-value)
    return Decimal((2 * value.numerator + value.denominator) // (2 * value.denominator))


@dataclass(frozen=True)
class RentAssignmentInput:
    employee_profile_id: int
    start_date: date
    end_date: date


def allocate_rent(
    year,
    month,
    annual_rent,
    assignments,
    payroll_profile_ids,
    calendar_days=None,
    *,
    period_start=None,
    period_end=None,
    period_basis=None,
):
    first, last = period_dates(
        year,
        month,
        calendar_days,
        period_start=period_start,
        period_end=period_end,
        period_basis=period_basis,
    )
    legacy_full_month = period_basis == "LEGACY_FULL_MONTH" or (
        period_basis is None and period_start is None and calendar_days is None
    )
    monthly = Fraction(decimal(annual_rent, places=2)) / 12
    residents = {}
    vacant = Fraction(0)
    slots = []
    for assignment in assignments:
        if assignment.end_date < assignment.start_date:
            raise PayrollInputError("invalid_date_range")
    slot_count = 30 if legacy_full_month else (last - first).days + 1
    for slot in range(1, slot_count + 1):
        day = date(year, month, min(slot, last.day)) if legacy_full_month else first + timedelta(days=slot - 1)
        ids = sorted(a.employee_profile_id for a in assignments if a.start_date <= day <= a.end_date)
        if len(set(ids)) != len(ids):
            raise PayrollInputError("assignment_overlap")
        share = monthly / 30 / len(ids) if ids else Fraction(0)
        if not ids:
            vacant += monthly / 30
        for profile_id in ids:
            residents[profile_id] = residents.get(profile_id, Fraction(0)) + share
        slots.append(
            {
                "slot": slot,
                "calendar_date": day.isoformat(),
                "resident_profile_ids": ids,
                "raw_daily_share": exact_share(share),
            }
        )
    raw = sum(residents.values(), Fraction(0))
    period_rent = monthly if legacy_full_month else monthly * slot_count / 30
    if raw + vacant != period_rent:
        raise PayrollInputError("rent_reconciliation_failed")
    rounded = {profile_id: round_share(share) for profile_id, share in residents.items()}
    return {
        "monthly_rent": exact_share(monthly),
        "residents": [
            {
                "employee_profile_id": profile_id,
                "in_payroll": profile_id in payroll_profile_ids,
                "raw_share": exact_share(share),
                "rounded_share": rounded[profile_id],
            }
            for profile_id, share in sorted(residents.items())
        ],
        "vacant_unallocated_raw": exact_share(vacant),
        "not_in_payroll_raw": exact_share(
            sum((v for k, v in residents.items() if k not in payroll_profile_ids), Fraction(0))
        ),
        "rounding_difference": exact_share(raw - sum((Fraction(v) for v in rounded.values()), Fraction(0))),
        "slots": slots,
        "raw_reconciliation": {"matches": True},
    }


def calculate_run(employees, settings_snapshot):
    employees = tuple(employees)
    results = [calculate_employee(e, settings_snapshot) for e in employees]
    count = sum(r["included"] for r in results)
    results = [
        calculate_employee(replace(e, included_employee_count=count), settings_snapshot) if r["included"] else r
        for e, r in zip(employees, results)
    ]
    included = [r for r in results if r["included"]]
    # Medical is one run-level warning, not one issue per item in the public report.
    issues = []
    run_codes = set()
    for result in results:
        for issue in result["issues"]:
            if issue["params"].get("scope") == "run":
                if issue["code"] in run_codes:
                    continue
                run_codes.add(issue["code"])
                issue = {**issue, "employee_profile_id": None}
            issues.append(issue)
    totals = {
        key: sum((r[key] for r in included), ZERO)
        for key in (
            "gross_salary",
            "total_additions",
            "total_deductions",
            "net_salary",
            "total_provisions",
            "total_company_cost",
        )
    }
    validate_legacy_projections(totals["net_salary"])
    for value in totals.values():
        money(value)
    return {
        "items": included,
        "excluded": [r for r in results if not r["included"]],
        "totals": totals,
        "total_employees": len(included),
        "cost_incomplete": any(r["cost_incomplete"] for r in included),
        "issues": issues,
        "can_finalize": not any(i["severity"] == "error" for i in issues),
    }
