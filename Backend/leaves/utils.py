import calendar
from collections import defaultdict
from datetime import date, timedelta
from decimal import ROUND_FLOOR, ROUND_HALF_UP, Decimal

from django.db.models import Q, Sum
from django.utils import timezone

from employees.models import EmployeeProfile

from .models import AnnualLeavePaymentRequest, LeaveBalanceAdjustment, LeaveRequest, LeaveType

ANNUAL_ACCRUAL_DAYS_PER_PERIOD = Decimal("1.75")
ANNUAL_MINIMUM_PERIODS = 6
PENDING_RESERVATION_STATUSES = {
    LeaveRequest.RequestStatus.SUBMITTED,
    LeaveRequest.RequestStatus.PENDING_DELEGATE,
    LeaveRequest.RequestStatus.PENDING_MANAGER,
    LeaveRequest.RequestStatus.PENDING_HR,
    LeaveRequest.RequestStatus.PENDING_CEO,
    LeaveRequest.RequestStatus.PENDING_HR_COMPLETION,
}
ANNUAL_LEAVE_SETTLEMENT_EXISTS_REASON = "An annual leave settlement already exists for this contract year."
ACTIVE_ANNUAL_LEAVE_SETTLEMENT_STATUSES = {
    AnnualLeavePaymentRequest.Status.PENDING_HR,
    AnnualLeavePaymentRequest.Status.PENDING_CEO,
    AnnualLeavePaymentRequest.Status.APPROVED,
    AnnualLeavePaymentRequest.Status.CARRIED_FORWARD,
}

SICK_MAX_DAYS_PER_YEAR = 120
SICK_FULL_PAY_DAYS = 30
SICK_HALF_PAY_DAYS = 60
SICK_UNPAID_DAYS = 30

EMERGENCY_MAX_DAYS_PER_YEAR = 10
UNPAID_MAX_DAYS_PER_YEAR = 60

MARRIAGE_MAX_DAYS = 5
DEATH_MAX_DAYS = 5
BIRTH_MAX_DAYS = 3
MATERNITY_EXTENSION_MAX_DAYS = 30

POLICY_LEAVE_TYPE_DEFINITIONS = [
    {
        "code": "ANNUAL",
        "name": "Annual Leave",
        "is_paid": True,
        "requires_attachment": False,
        "annual_quota": 0,
    },
    {
        "code": "SICK",
        "name": "Sick Leave",
        "is_paid": True,
        "requires_attachment": True,
        "annual_quota": SICK_MAX_DAYS_PER_YEAR,
    },
    {
        "code": "EMERGENCY",
        "name": "Emergency Leave",
        "is_paid": True,
        "requires_attachment": True,
        "annual_quota": EMERGENCY_MAX_DAYS_PER_YEAR,
    },
    {
        "code": "UNPAID",
        "name": "Unpaid Leave",
        "is_paid": False,
        "requires_attachment": False,
        "annual_quota": UNPAID_MAX_DAYS_PER_YEAR,
    },
    {
        "code": "MARRIAGE",
        "name": "Marriage Leave",
        "is_paid": True,
        "requires_attachment": False,
        "annual_quota": MARRIAGE_MAX_DAYS,
    },
    {
        "code": "DEATH",
        "name": "Death of Relative Leave",
        "is_paid": True,
        "requires_attachment": False,
        "annual_quota": DEATH_MAX_DAYS,
    },
    {
        "code": "BIRTH",
        "name": "Birth Leave",
        "is_paid": True,
        "requires_attachment": False,
        "annual_quota": BIRTH_MAX_DAYS,
    },
    {
        "code": "MATERNITY",
        "name": "Maternity Leave",
        "is_paid": True,
        "requires_attachment": False,
        "annual_quota": 0,
    },
]


def ensure_policy_leave_types():
    """
    Ensure baseline leave types required by policy exist.
    This keeps balance/eligibility logic reliable even if DB seed was skipped.
    """
    for definition in POLICY_LEAVE_TYPE_DEFINITIONS:
        # Legacy databases can contain multiple global rows for the same code.
        # Existence is sufficient here; company-scoped records are seeded by
        # ensure_policy_leave_types_for_company().
        if LeaveType.objects.filter(code=definition["code"], company__isnull=True).exists():
            continue
        LeaveType.objects.create(
            code=definition["code"],
            name=definition["name"],
            is_paid=definition["is_paid"],
            requires_attachment=definition["requires_attachment"],
            is_active=True,
            annual_quota=definition["annual_quota"],
        )


def ensure_policy_leave_types_for_company(company=None):
    """
    Ensure baseline leave types required by policy exist for one company context.
    Falls back to legacy global leave types when no company is known.
    """
    for definition in POLICY_LEAVE_TYPE_DEFINITIONS:
        lookup = {"code": definition["code"]}
        defaults = {
            "name": definition["name"],
            "is_paid": definition["is_paid"],
            "requires_attachment": definition["requires_attachment"],
            "is_active": True,
            "annual_quota": definition["annual_quota"],
        }
        if company is not None:
            lookup["company"] = company
            defaults["company"] = company
        LeaveType.objects.get_or_create(**lookup, defaults=defaults)


def resolve_employee_profile(employee_subject):
    if isinstance(employee_subject, EmployeeProfile):
        return employee_subject
    if not employee_subject:
        return None
    try:
        return employee_subject.employee_profile
    except (AttributeError, EmployeeProfile.DoesNotExist):
        return None


def leave_request_employee_filter(employee_subject):
    profile = resolve_employee_profile(employee_subject)
    request_filter = None

    if isinstance(employee_subject, EmployeeProfile):
        if profile and profile.user_id:
            request_filter = LeaveRequest.objects.filter(employee=profile.user) | LeaveRequest.objects.filter(
                employee_profile=profile
            )
        elif profile:
            request_filter = LeaveRequest.objects.filter(employee_profile=profile)
    elif employee_subject:
        request_filter = LeaveRequest.objects.filter(employee=employee_subject)
        if profile:
            request_filter = request_filter | LeaveRequest.objects.filter(employee_profile=profile)

    if request_filter is not None and profile and profile.company_id:
        request_filter = request_filter.filter(company_id=profile.company_id)
    return request_filter


def _normalized_leave_code(leave_type: LeaveType) -> str:
    if leave_type.code:
        return leave_type.code.strip().upper()
    return leave_type.name.strip().upper().replace(" ", "_")


def _get_balance_leave_types(profile: EmployeeProfile | None):
    queryset = LeaveType.objects.filter(is_active=True)
    company_id = getattr(profile, "company_id", None)

    if not company_id:
        return []

    return list(queryset.filter(company_id=company_id).order_by("id"))


def _is_annual(code: str) -> bool:
    return code in {"ANNUAL", "ANNUAL_LEAVE"}


def _is_sick(code: str) -> bool:
    return code in {"SICK", "SICK_LEAVE"}


def _is_emergency(code: str) -> bool:
    return code in {"EMERGENCY", "EMERGENCY_LEAVE"}


def _is_unpaid(code: str) -> bool:
    return code in {"UNPAID", "UNPAID_LEAVE", "EXCEPTIONAL", "EXCEPTIONAL_LEAVE"}


def _is_marriage(code: str) -> bool:
    return code in {"MARRIAGE", "MARRIAGE_LEAVE"}


def _is_death(code: str) -> bool:
    return code in {"DEATH", "DEATH_OF_RELATIVE", "BEREAVEMENT", "BEREAVEMENT_LEAVE"}


def _is_birth(code: str) -> bool:
    return code in {"BIRTH", "BIRTH_OF_CHILD", "PATERNITY", "PATERNITY_LEAVE"}


def _is_maternity(code: str) -> bool:
    return code in {"MATERNITY", "MATERNITY_LEAVE"}


def _official_holidays_for_year(year: int):
    """
    Fixed-date holidays are covered directly.
    Eid dates vary yearly (Hijri); configure externally when available.
    """
    return {
        date(year, 2, 22),  # Founding Day
        date(year, 9, 23),  # National Day
    }


def get_leave_days(start_date, end_date):
    """
    Calculate leave days between start and end (inclusive),
    excluding official holidays.
    """
    if start_date > end_date:
        return 0
    total = (end_date - start_date).days + 1

    holiday_count = 0
    curr = start_date
    while curr <= end_date:
        if curr in _official_holidays_for_year(curr.year):
            holiday_count += 1
        curr += timedelta(days=1)

    return max(0, total - holiday_count)


def calculate_overlap_days(req_start, req_end, year):
    """
    Calculate days of a request that fall within a specific year.
    """
    year_start = date(year, 1, 1)
    year_end = date(year, 12, 31)

    # Intersection
    actual_start = max(req_start, year_start)
    actual_end = min(req_end, year_end)

    return get_leave_days(actual_start, actual_end)


def get_service_days(profile: EmployeeProfile, on_date: date):
    if not profile.hire_date:
        return 0
    if on_date < profile.hire_date:
        return 0
    return (on_date - profile.hire_date).days + 1


def get_service_years(profile: EmployeeProfile, on_date: date):
    return get_service_days(profile, on_date) / 365.0


def get_contract_start_date(profile: EmployeeProfile | None):
    if not profile:
        return None
    return profile.contract_date or profile.hire_date


def _anniversary_for_year(start_date: date, year: int) -> date:
    try:
        return start_date.replace(year=year)
    except ValueError:
        # Employees hired on 29 February use 28 February in non-leap years.
        return start_date.replace(year=year, day=28)


def get_contract_year_cycle(profile: EmployeeProfile, reference_date: date | None = None):
    """Return the contract-year start/end surrounding ``reference_date``."""
    start_date = get_contract_start_date(profile)
    reference_date = reference_date or date.today()
    if not start_date:
        return None, None

    if reference_date < start_date:
        return start_date, _anniversary_for_year(start_date, start_date.year + 1) - timedelta(days=1)

    anniversary = _anniversary_for_year(start_date, reference_date.year)
    if anniversary > reference_date:
        cycle_start = _anniversary_for_year(start_date, reference_date.year - 1)
    else:
        cycle_start = anniversary
    next_anniversary = _anniversary_for_year(start_date, cycle_start.year + 1)
    return cycle_start, next_anniversary - timedelta(days=1)


def _calendar_month_anniversary(
    contract_start: date, cycle_start: date, months_ahead: int
) -> date:
    """
    Return the calendar-month anniversary ``months_ahead`` months after
    ``cycle_start`` using the original ``contract_start`` day.

    The anniversary is always derived from the original contract start day
    (capped to the last day of the target month), not by repeatedly adding
    a month to the previous adjusted date.
    """
    original_day = contract_start.day
    month_index = cycle_start.month - 1 + months_ahead
    year = cycle_start.year + month_index // 12
    month = month_index % 12 + 1
    last_day = calendar.monthrange(year, month)[1]
    day = min(original_day, last_day)
    return date(year, month, day)


def get_completed_calendar_months(
    cycle_start: date,
    as_of: date | None = None,
    *,
    contract_start: date | None = None,
    cycle_end: date | None = None,
) -> int:
    """
    Count completed calendar months between ``cycle_start`` and ``as_of``.

    Each anniversary is calculated from the original ``contract_start`` day
    (capped to month length, including February leap-year handling). On the
    day before an anniversary the month does not accrue; on the anniversary
    date it does. Result is capped at 12 per contract year.

    Contract cycles are defined as inclusive ``[cycle_start, cycle_end]``
    where ``cycle_end`` is one day before the next annual anniversary. To
    ensure 12 months (21 days) are reachable within the cycle, the final
    day ``cycle_end`` is treated as completion of month 12 even though the
    12th calendar anniversary falls on ``cycle_end + 1`` (the first day of
    the next cycle). This keeps the 21-day annual cap and final-five-days
    settlement window consistent.
    """
    if not cycle_start or not as_of or as_of <= cycle_start:
        return 0
    original = contract_start or cycle_start
    completed = 0
    for n in range(1, 13):
        anniversary = _calendar_month_anniversary(original, cycle_start, n)
        if anniversary <= as_of:
            completed += 1
        else:
            break
    # Inclusive cycle boundary fix: cycle_end is next anniversary -1, so the
    # 12th anniversary lies one day after the cycle. Treat cycle_end itself
    # as completion of month 12 so the contract year can accrue 21 days.
    if completed == 11 and cycle_end is not None and as_of == cycle_end:
        # Verify the 12th anniversary is exactly the next day, to avoid
        # incorrectly bumping in edge cases where cycle_end is passed
        # explicitly but does not correspond to this cycle.
        try:
            twelfth = _calendar_month_anniversary(original, cycle_start, 12)
            if twelfth == cycle_end + timedelta(days=1):
                completed = 12
        except Exception:
            completed = 12
    elif completed == 11 and cycle_end is None and contract_start is not None:
        # Auto-derive cycle_end when not supplied but contract_start is known.
        try:
            derived_end = _anniversary_for_year(original, cycle_start.year + 1) - timedelta(days=1)
            if as_of == derived_end:
                twelfth = _calendar_month_anniversary(original, cycle_start, 12)
                if twelfth == derived_end + timedelta(days=1):
                    completed = 12
        except Exception:
            pass
    return min(12, completed)


def get_completed_annual_periods(cycle_start: date, as_of: date | None = None) -> int:
    """Deprecated alias — use ``get_completed_calendar_months``."""
    return get_completed_calendar_months(cycle_start, as_of)


def get_annual_accrual_details(profile: EmployeeProfile, as_of: date | None = None):
    cycle_start, cycle_end = get_contract_year_cycle(profile, as_of or date.today())
    if not cycle_start:
        return {
            "cycle_start": None,
            "cycle_end": None,
            "completed_periods": 0,
            "accrued_days": Decimal("0.00"),
        }
    effective_date = min(as_of or date.today(), cycle_end)
    contract_start = get_contract_start_date(profile)
    periods = get_completed_calendar_months(
        cycle_start, effective_date, contract_start=contract_start, cycle_end=cycle_end
    )
    return {
        "cycle_start": cycle_start,
        "cycle_end": cycle_end,
        "completed_periods": periods,
        "accrued_days": (ANNUAL_ACCRUAL_DAYS_PER_PERIOD * periods).quantize(Decimal("0.01")),
    }


def _annual_requests_for_period(employee_subject, cycle_start: date, cycle_end: date, statuses):
    requests = leave_request_employee_filter(employee_subject)
    if requests is None:
        return []
    return requests.filter(
        is_active=True,
        status__in=statuses,
        start_date__lte=cycle_end,
        end_date__gte=cycle_start,
    )


def get_period_days_for_leave_type(
    employee_subject,
    leave_type: LeaveType,
    period_start: date,
    period_end: date,
    *,
    statuses=None,
    as_of: date | None = None,
):
    statuses = statuses or {LeaveRequest.RequestStatus.APPROVED}
    total = 0
    for req in _annual_requests_for_period(employee_subject, period_start, period_end, statuses).filter(
        leave_type=leave_type
    ):
        request_start = max(req.start_date, period_start)
        request_end = min(req.end_date, period_end, as_of) if as_of else min(req.end_date, period_end)
        if request_start <= request_end:
            total += get_leave_days(request_start, request_end)
    return total


def get_annual_used_days_for_cycle(employee_subject, cycle_start: date, cycle_end: date, *, as_of=None):
    profile = resolve_employee_profile(employee_subject)
    leave_types = _get_balance_leave_types(profile)
    annual_type = next((item for item in leave_types if _is_annual(_normalized_leave_code(item))), None)
    emergency_type = next((item for item in leave_types if _is_emergency(_normalized_leave_code(item))), None)
    used = (
        get_period_days_for_leave_type(
            employee_subject,
            annual_type,
            cycle_start,
            cycle_end,
            as_of=as_of,
        )
        if annual_type
        else 0
    )
    if emergency_type:
        used += get_period_days_for_leave_type(
            employee_subject,
            emergency_type,
            cycle_start,
            cycle_end,
            as_of=as_of,
        )
    return used


def get_pending_days_for_type(employee_subject, leave_type: LeaveType, year: int, as_of: date | None = None):
    year_start = date(year, 1, 1)
    year_end = date(year, 12, 31)
    requests = leave_request_employee_filter(employee_subject)
    if requests is None:
        return 0.0
    total = 0
    for req in requests.filter(
        leave_type=leave_type,
        is_active=True,
        status__in=PENDING_RESERVATION_STATUSES,
        start_date__lte=year_end,
        end_date__gte=year_start,
    ):
        request_end = min(req.end_date, as_of) if as_of else req.end_date
        if req.start_date <= request_end:
            total += calculate_overlap_days(req.start_date, request_end, year)
    return float(total)


def get_annual_pending_days_for_cycle(employee_subject, cycle_start: date, cycle_end: date, *, as_of=None):
    profile = resolve_employee_profile(employee_subject)
    leave_types = _get_balance_leave_types(profile)
    pending = 0
    for leave_type in leave_types:
        if _is_annual(_normalized_leave_code(leave_type)) or _is_emergency(_normalized_leave_code(leave_type)):
            pending += get_period_days_for_leave_type(
                employee_subject,
                leave_type,
                cycle_start,
                cycle_end,
                statuses=PENDING_RESERVATION_STATUSES,
                as_of=as_of,
            )
    return pending


def has_pending_annual_leave(employee_subject, *, company=None) -> bool:
    """Return whether the employee has a blocking pending Annual Leave request."""
    profile = resolve_employee_profile(employee_subject)
    requests = leave_request_employee_filter(profile or employee_subject)
    if requests is None:
        return False

    if company is None:
        company = getattr(profile, "company", None)
    if company is None:
        return False

    return (
        requests.filter(
            is_active=True,
            company=company,
            status__in=PENDING_RESERVATION_STATUSES,
        )
        .filter(Q(leave_type__code__in=["ANNUAL", "ANNUAL_LEAVE"]) | Q(leave_type__name__iexact="Annual Leave"))
        .exists()
    )


def has_active_annual_leave_settlement(profile: EmployeeProfile | None, cycle_start, *, company=None) -> bool:
    """Return whether the employee already has a blocking settlement for this company contract cycle."""
    if profile is None or cycle_start is None:
        return False

    company_id = getattr(company, "id", company) or profile.company_id
    if company_id is None:
        return False

    return AnnualLeavePaymentRequest.objects.filter(
        employee_profile=profile,
        company_id=company_id,
        cycle_start=cycle_start,
        status__in=ACTIVE_ANNUAL_LEAVE_SETTLEMENT_STATUSES,
    ).exists()


def build_annual_leave_eligibility(profile: EmployeeProfile | None, *, active_company=None, as_of=None):
    """Build the server-owned eligibility/preview payload for Annual Leave payment."""
    zero = Decimal("0.00")
    today = as_of or timezone.localdate()
    base = {
        "can_request": False,
        "window_open": False,
        "cycle_start": None,
        "cycle_end": None,
        "eligible_unused_days": zero,
        "fractional_days": zero,
        "salary_at_year_end": zero,
        "estimated_payment_amount": zero,
        "has_pending_annual_leave": False,
        "reason": "",
    }

    if profile is None:
        base["reason"] = "Employee profile is required."
        return base
    if active_company is None or profile.company_id != active_company.id:
        base["reason"] = "Employee does not belong to the active company."
        return base

    details = get_annual_accrual_details(profile, today)
    cycle_start = details["cycle_start"]
    cycle_end = details["cycle_end"]
    base.update({"cycle_start": cycle_start, "cycle_end": cycle_end})
    if cycle_start is None:
        base["reason"] = "Employee contract date is required for Annual Leave payment."
        return base

    is_terminated = profile.employment_status == EmployeeProfile.EmploymentStatus.TERMINATED
    window_open = is_terminated or cycle_end - timedelta(days=4) <= today <= cycle_end
    pending = has_pending_annual_leave(profile, company=active_company)
    base["window_open"] = window_open
    base["has_pending_annual_leave"] = pending

    termination_date = profile.archived_at.date() if is_terminated and profile.archived_at else None
    snapshot = build_annual_leave_payment_snapshot(
        profile,
        as_of=termination_date or today,
        termination_date=termination_date,
    )
    if snapshot:
        base.update(
            {
                "eligible_unused_days": snapshot["eligible_unused_days"],
                "fractional_days": snapshot["fractional_days"],
                "salary_at_year_end": snapshot["salary_at_year_end"],
                "estimated_payment_amount": snapshot["payment_amount"],
            }
        )

    if has_active_annual_leave_settlement(profile, cycle_start, company=active_company):
        base["reason"] = ANNUAL_LEAVE_SETTLEMENT_EXISTS_REASON
        return base

    reasons = []
    contract_start = get_contract_start_date(profile)
    if not is_terminated and get_completed_calendar_months(
        cycle_start, today, contract_start=contract_start, cycle_end=cycle_end
    ) < ANNUAL_MINIMUM_PERIODS:
        reasons.append("Annual Leave payment is available after completing 6 months of service.")
    if not window_open:
        reasons.append("The Annual Leave payment window opens only during the final 5 days of the contract year.")
    if pending:
        reasons.append("Annual Leave payment cannot be requested while Annual Leave requests are pending.")
    if base["eligible_unused_days"] <= 0:
        reasons.append("There are no eligible whole Annual Leave days available for payment.")
    base["can_request"] = not reasons
    base["reason"] = " ".join(reasons)
    return base


def get_annual_salary_at_year_end(profile: EmployeeProfile):
    salary = profile.total_salary or profile.basic_salary or Decimal("0.00")
    return Decimal(salary).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def get_prior_annual_carry_forward_days(profile: EmployeeProfile, cycle_start: date):
    previous = (
        AnnualLeavePaymentRequest.objects.filter(
            employee_profile=profile,
            cycle_end__lt=cycle_start,
        )
        .order_by("-cycle_end", "-id")
        .first()
    )
    if not previous or previous.status == AnnualLeavePaymentRequest.Status.APPROVED:
        return Decimal("0.00")
    if previous.status == AnnualLeavePaymentRequest.Status.CARRIED_FORWARD:
        return previous.carry_forward_days
    # A rejected or still-pending payment must not erase the employee's balance.
    return previous.eligible_unused_days


def build_annual_leave_payment_snapshot(
    profile: EmployeeProfile, *, as_of: date | None = None, termination_date: date | None = None
):
    effective_date = termination_date or as_of or date.today()
    details = get_annual_accrual_details(profile, effective_date)
    cycle_start = details["cycle_start"]
    cycle_end = details["cycle_end"]
    if not cycle_start:
        return None
    effective_cycle_end = min(cycle_end, effective_date)
    opening = get_prior_annual_carry_forward_days(profile, cycle_start)
    accrued = (opening + details["accrued_days"]).quantize(Decimal("0.01"))
    used = Decimal(str(get_annual_used_days_for_cycle(profile, cycle_start, effective_cycle_end, as_of=effective_date)))
    eligible_unused = max(Decimal("0.00"), accrued - used)
    eligible_whole_days = eligible_unused.quantize(Decimal("1"), rounding=ROUND_FLOOR)
    salary = get_annual_salary_at_year_end(profile)
    amount = (eligible_whole_days * salary / Decimal("30")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return {
        "cycle_start": cycle_start,
        "cycle_end": cycle_end,
        "accrued_days": accrued,
        "used_days": used,
        "eligible_unused_days": eligible_whole_days,
        "fractional_days": (eligible_unused - eligible_whole_days).quantize(Decimal("0.01")),
        "salary_at_year_end": salary,
        "payment_amount": amount,
        "termination_date": termination_date,
    }


def get_annual_entitlement(profile: EmployeeProfile, year: int):
    """
    Annual entitlement per company policy:

    - 1.75 days per completed calendar month in the contract year.
    - Maximum 21 days per contract year (12 months × 1.75).
    - No five-year or 30-day entitlement exists under current policy.

    This helper is retained only for backward-compatible quota fallback where
    ``LeaveType.annual_quota`` is zero. Actual balance accrual is computed via
    ``get_annual_accrual_details()`` using calendar-month logic and remains
    the authoritative source.
    """
    if not profile or not get_contract_start_date(profile):
        return 0.0
    return 21.0


def get_annual_accrued_days(profile: EmployeeProfile, year: int, as_of: date | None = None) -> float:
    """Return 1.75 days for each completed calendar month in the contract cycle (max 21)."""
    if not profile or not get_contract_start_date(profile):
        return 0.0
    effective_date = as_of or date(year, 12, 31)
    details = get_annual_accrual_details(profile, effective_date)
    return float(details["accrued_days"])


def get_used_days_for_type(user, leave_type: LeaveType, year: int, as_of: date | None = None):
    year_start = date(year, 1, 1)
    year_end = date(year, 12, 31)
    requests = leave_request_employee_filter(user)
    if requests is None:
        return 0.0
    requests = requests.filter(
        leave_type=leave_type,
        status=LeaveRequest.RequestStatus.APPROVED,
        start_date__lte=year_end,
        end_date__gte=year_start,
    )
    used = 0
    for req in requests:
        request_end = min(req.end_date, as_of) if as_of else req.end_date
        if request_end >= req.start_date:
            used += calculate_overlap_days(req.start_date, request_end, year)
    return float(used)


def get_adjustments_for_type(user, leave_type: LeaveType, year: int):
    profile = resolve_employee_profile(user)
    adjustments = LeaveBalanceAdjustment.objects.none()
    if profile:
        if profile.user_id:
            adjustments = LeaveBalanceAdjustment.objects.filter(
                employee=profile.user
            ) | LeaveBalanceAdjustment.objects.filter(employee_profile=profile)
        else:
            adjustments = LeaveBalanceAdjustment.objects.filter(employee_profile=profile)
    elif user:
        adjustments = LeaveBalanceAdjustment.objects.filter(employee=user)
    else:
        return 0.0

    if profile and profile.company_id:
        adjustments = adjustments.filter(
            company_id=profile.company_id,
            leave_type__company_id=profile.company_id,
        )

    adjs = adjustments.filter(leave_type=leave_type, created_at__year=year).aggregate(Sum("adjustment_days"))[
        "adjustment_days__sum"
    ] or Decimal("0")
    return float(adjs)


def _find_balance_by_code(balances, *codes: str):
    normalized_codes = {code.strip().upper().replace(" ", "_") for code in codes}
    return next((balance for balance in balances if balance.get("leave_code") in normalized_codes), None)


def get_payment_breakdown(
    leave_type: LeaveType,
    used_days_before: float,
    requested_days: int,
    employee_subject=None,
    year: int | None = None,
    balances=None,
):
    """
    Returns payment segments for the request:
    [{days, pay_percent, label}]
    """
    code = _normalized_leave_code(leave_type)
    segments = []

    if _is_annual(code):
        paid_remaining = float(requested_days)
        unpaid_remaining_before_request = 0.0

        if balances is None and employee_subject is not None and year is not None:
            balances = calculate_leave_balance(employee_subject, year)
        if balances is not None:
            annual_balance = _find_balance_by_code(balances, "ANNUAL", "ANNUAL_LEAVE")
            unpaid_balance = _find_balance_by_code(balances, "UNPAID", "UNPAID_LEAVE")

            annual_total = float(annual_balance["total_days"]) if annual_balance else 0.0
            annual_used_current = float(annual_balance["used_days"]) if annual_balance else float(used_days_before)
            paid_remaining = max(0.0, annual_total - float(used_days_before))

            annual_overflow_before = max(0.0, float(used_days_before) - annual_total)
            annual_overflow_current = max(0.0, annual_used_current - annual_total)
            overflow_already_applied = max(0.0, annual_overflow_current - annual_overflow_before)

            unpaid_remaining_before_request = (
                float(unpaid_balance["remaining_days"]) if unpaid_balance else 0.0
            ) + overflow_already_applied

        remaining = requested_days

        if paid_remaining > 0 and remaining > 0:
            chunk = min(float(remaining), float(paid_remaining))
            segments.append({"days": chunk, "pay_percent": 100, "label": "Annual leave paid"})
            remaining -= chunk

        if unpaid_remaining_before_request > 0 and remaining > 0:
            chunk = min(float(remaining), float(unpaid_remaining_before_request))
            segments.append({"days": chunk, "pay_percent": 0, "label": "Annual leave unpaid fallback"})
            remaining -= chunk

        if segments:
            return segments

    if _is_sick(code):
        remaining = requested_days
        cursor = int(used_days_before)

        full_remaining = max(0, SICK_FULL_PAY_DAYS - cursor)
        if full_remaining > 0 and remaining > 0:
            chunk = min(remaining, full_remaining)
            segments.append({"days": chunk, "pay_percent": 100, "label": "Sick leave full pay"})
            remaining -= chunk
            cursor += chunk

        half_remaining = max(0, SICK_FULL_PAY_DAYS + SICK_HALF_PAY_DAYS - cursor)
        if half_remaining > 0 and remaining > 0:
            chunk = min(remaining, half_remaining)
            segments.append({"days": chunk, "pay_percent": 50, "label": "Sick leave half pay"})
            remaining -= chunk
            cursor += chunk

        unpaid_remaining = max(0, SICK_MAX_DAYS_PER_YEAR - cursor)
        if unpaid_remaining > 0 and remaining > 0:
            chunk = min(remaining, unpaid_remaining)
            segments.append({"days": chunk, "pay_percent": 0, "label": "Sick leave unpaid"})
            remaining -= chunk

        return segments

    if _is_unpaid(code):
        return [{"days": requested_days, "pay_percent": 0, "label": "Unpaid leave"}]

    if _is_maternity(code):
        return [{"days": requested_days, "pay_percent": 70, "label": "Maternity leave"}]

    # Default paid leave.
    return [{"days": requested_days, "pay_percent": 100, "label": "Paid leave"}]


def _batch_request_matches_profile(row, profile):
    return row["employee_profile_id"] == profile.id or (
        profile.user_id is not None and row["employee_id"] == profile.user_id
    )


def _batch_period_days(rows, leave_type_id, period_start, period_end, statuses, *, active_only=False, as_of=None):
    total = 0
    for row in rows:
        if row["leave_type_id"] != leave_type_id or row["status"] not in statuses:
            continue
        if active_only and not row["is_active"]:
            continue
        if row["start_date"] > period_end or row["end_date"] < period_start:
            continue
        request_start = max(row["start_date"], period_start)
        request_end = min(row["end_date"], period_end)
        if as_of is not None:
            request_end = min(request_end, as_of)
        if request_start <= request_end:
            total += get_leave_days(request_start, request_end)
    return total


def _batch_calendar_days(rows, leave_type_id, year, statuses, *, active_only=False, as_of=None):
    return _batch_period_days(
        rows,
        leave_type_id,
        date(year, 1, 1),
        date(year, 12, 31),
        statuses,
        active_only=active_only,
        as_of=as_of,
    )


def _batch_prior_annual_carry_forward(payment_rows, profile_id, cycle_start):
    previous = [
        row
        for row in payment_rows
        if row["employee_profile_id"] == profile_id and row["cycle_end"] < cycle_start
    ]
    if not previous:
        return Decimal("0.00")
    previous.sort(key=lambda row: (row["cycle_end"], row["id"]), reverse=True)
    previous = previous[0]
    if previous["status"] == AnnualLeavePaymentRequest.Status.APPROVED:
        return Decimal("0.00")
    if previous["status"] == AnnualLeavePaymentRequest.Status.CARRIED_FORWARD:
        return previous["carry_forward_days"]
    return previous["eligible_unused_days"]


def _calculate_leave_balance_from_batch(profile, year, batch, memo, as_of=None):
    key = (profile.id, year, as_of)
    if key in memo:
        return memo[key]

    contract_start = get_contract_start_date(profile)
    hire_year = contract_start.year if contract_start else year
    if year < hire_year:
        memo[key] = []
        return memo[key]

    leave_types = batch["leave_types_by_company"].get(profile.company_id, [])
    balance_date = as_of or (date.today() if year == date.today().year else date(year, 12, 31))
    rows = batch["rows_by_profile"].get(profile.id, [])
    balances = []

    for leave_type in leave_types:
        code = _normalized_leave_code(leave_type)
        annual_cycle_start, annual_cycle_end = get_contract_year_cycle(profile, balance_date)
        if _is_annual(code) and annual_cycle_start:
            used = 0
            annual_type = next(
                (item for item in leave_types if _is_annual(_normalized_leave_code(item))), None
            )
            emergency_type = next(
                (item for item in leave_types if _is_emergency(_normalized_leave_code(item))), None
            )
            if annual_type:
                used += _batch_period_days(
                    rows,
                    annual_type.id,
                    annual_cycle_start,
                    min(annual_cycle_end, balance_date),
                    {LeaveRequest.RequestStatus.APPROVED},
                    active_only=True,
                    as_of=balance_date,
                )
            if emergency_type:
                used += _batch_period_days(
                    rows,
                    emergency_type.id,
                    annual_cycle_start,
                    min(annual_cycle_end, balance_date),
                    {LeaveRequest.RequestStatus.APPROVED},
                    active_only=True,
                    as_of=balance_date,
                )
            pending_days = 0
            for item in leave_types:
                if _is_annual(_normalized_leave_code(item)) or _is_emergency(_normalized_leave_code(item)):
                    pending_days += _batch_period_days(
                        rows,
                        item.id,
                        annual_cycle_start,
                        min(annual_cycle_end, balance_date),
                        PENDING_RESERVATION_STATUSES,
                        active_only=True,
                        as_of=balance_date,
                    )
        else:
            used = _batch_calendar_days(
                rows,
                leave_type.id,
                year,
                {LeaveRequest.RequestStatus.APPROVED},
                as_of=balance_date,
            )
            pending_days = _batch_calendar_days(
                rows,
                leave_type.id,
                year,
                PENDING_RESERVATION_STATUSES,
                active_only=True,
                as_of=balance_date,
            )

        opening = 0.0
        if leave_type.allow_carry_over and year > hire_year:
            previous_balances = _calculate_leave_balance_from_batch(profile, year - 1, batch, memo)
            previous = next(
                (item for item in previous_balances if item["leave_type_id"] == leave_type.id), None
            )
            if previous:
                opening = float(previous["remaining_days"])
                if leave_type.max_carry_over is not None:
                    opening = min(opening, float(leave_type.max_carry_over))

        configured_quota = float(leave_type.annual_quota or 0.0)
        if _is_annual(code):
            quota = configured_quota if configured_quota > 0 else get_annual_entitlement(profile, year)
        elif _is_sick(code):
            quota = configured_quota if configured_quota > 0 else float(SICK_MAX_DAYS_PER_YEAR)
        elif _is_emergency(code):
            quota = configured_quota if configured_quota > 0 else float(EMERGENCY_MAX_DAYS_PER_YEAR)
        elif _is_unpaid(code):
            quota = configured_quota if configured_quota > 0 else float(UNPAID_MAX_DAYS_PER_YEAR)
        elif _is_marriage(code):
            quota = configured_quota if configured_quota > 0 else float(MARRIAGE_MAX_DAYS)
        elif _is_death(code):
            quota = configured_quota if configured_quota > 0 else float(DEATH_MAX_DAYS)
        elif _is_birth(code):
            quota = configured_quota if configured_quota > 0 else float(BIRTH_MAX_DAYS)
        else:
            quota = configured_quota

        adjustments = batch["adjustments"].get((profile.id, leave_type.id, year), 0.0)
        available_annual_year_days = None
        if _is_annual(code):
            available_annual_year_days = float(get_annual_accrual_details(profile, balance_date)["accrued_days"])
            if configured_quota > 0:
                available_annual_year_days = min(available_annual_year_days, configured_quota)

        emergency_available_days = None
        if _is_emergency(code):
            annual_type = next(
                (item for item in leave_types if _is_annual(_normalized_leave_code(item))), None
            )
            annual_details = get_annual_accrual_details(profile, balance_date) if annual_type else {}
            if annual_type and annual_details.get("cycle_start"):
                annual_total = float(annual_details["accrued_days"]) + float(
                    _batch_prior_annual_carry_forward(
                        batch["payment_rows"], profile.id, annual_details["cycle_start"]
                    )
                )
                annual_used_only = _batch_period_days(
                    rows,
                    annual_type.id,
                    annual_details["cycle_start"],
                    min(annual_details["cycle_end"], balance_date),
                    {LeaveRequest.RequestStatus.APPROVED},
                    active_only=True,
                    as_of=balance_date,
                )
                annual_remaining_after_annual = max(0.0, annual_total - annual_used_only)
                emergency_available_days = (
                    min(float(EMERGENCY_MAX_DAYS_PER_YEAR), max(0.0, annual_remaining_after_annual - used))
                    + adjustments
                )

        if _is_marriage(code) and any(
            row["leave_type_id"] == leave_type.id and row["status"] == LeaveRequest.RequestStatus.APPROVED
            for row in rows
        ):
            quota = 0.0

        available_total = opening + quota + adjustments
        if available_annual_year_days is not None:
            prior_carry = float(
                _batch_prior_annual_carry_forward(
                    batch["payment_rows"], profile.id, annual_cycle_start
                )
            ) if annual_cycle_start else 0.0
            available_total = prior_carry + available_annual_year_days + adjustments
        if emergency_available_days is not None:
            available_total = emergency_available_days

        remaining = max(0.0, available_total - used)
        requestable_days = max(
            0.0,
            float(Decimal(str(remaining)).quantize(Decimal("1"), rounding=ROUND_FLOOR)) - pending_days,
        )
        fractional_days = max(
            0.0,
            remaining - float(Decimal(str(remaining)).quantize(Decimal("1"), rounding=ROUND_FLOOR)),
        )
        balances.append(
            {
                "leave_type_id": leave_type.id,
                "leave_type": leave_type.name,
                "leave_code": code,
                "total_days": float(available_total),
                "used_days": float(used),
                "remaining_days": float(remaining),
                "pending_days": float(pending_days),
                "requestable_days": requestable_days,
                "fractional_days": fractional_days,
                "adjustments": adjustments,
                **(
                    {"available_annual_year_days": float(available_annual_year_days)}
                    if available_annual_year_days is not None
                    else {}
                ),
            }
        )

    annual_balance = _find_balance_by_code(balances, "ANNUAL", "ANNUAL_LEAVE")
    unpaid_balance = _find_balance_by_code(balances, "UNPAID", "UNPAID_LEAVE")
    if annual_balance and unpaid_balance:
        annual_overflow = max(0.0, float(annual_balance["used_days"]) - float(annual_balance["total_days"]))
        unpaid_balance["used_days"] = float(unpaid_balance["used_days"]) + annual_overflow
        unpaid_balance["remaining_days"] = max(
            0.0, float(unpaid_balance["total_days"]) - float(unpaid_balance["used_days"])
        )

    memo[key] = balances
    return balances


def get_leave_request_payment_context(instances):
    """Batch payment/balance inputs for a leave list without mutating database state."""
    instances = list(instances)
    profile_by_instance = {}
    profiles = {}
    years = set()
    for instance in instances:
        profile = instance.employee_profile or resolve_employee_profile(instance.employee)
        if profile is None:
            continue
        profile_by_instance[instance.pk] = profile
        profiles[profile.id] = profile
        years.add(instance.start_date.year)

    if not profiles:
        return {}

    minimum_year = min(
        [*years, *[(get_contract_start_date(profile) or date(min(years), 1, 1)).year for profile in profiles.values()]]
    )
    maximum_year = max(years)
    user_ids = [profile.user_id for profile in profiles.values() if profile.user_id]
    profile_ids = list(profiles)
    request_rows = list(
        LeaveRequest.objects.filter(
            Q(employee_id__in=user_ids) | Q(employee_profile_id__in=profile_ids),
            start_date__lte=date(maximum_year, 12, 31),
            end_date__gte=date(minimum_year, 1, 1),
            status__in=set(PENDING_RESERVATION_STATUSES) | {LeaveRequest.RequestStatus.APPROVED},
        ).values(
            "id",
            "employee_id",
            "employee_profile_id",
            "leave_type_id",
            "start_date",
            "end_date",
            "status",
            "is_active",
        )
    )

    rows_by_profile = defaultdict(list)
    for profile in profiles.values():
        rows_by_profile[profile.id] = [row for row in request_rows if _batch_request_matches_profile(row, profile)]

    company_ids = {profile.company_id for profile in profiles.values() if profile.company_id}
    leave_types_by_company = defaultdict(list)
    for leave_type in LeaveType.objects.filter(company_id__in=company_ids, is_active=True).order_by("id"):
        leave_types_by_company[leave_type.company_id].append(leave_type)

    adjustment_rows = LeaveBalanceAdjustment.objects.filter(
        Q(employee_profile_id__in=profile_ids) | Q(employee_id__in=user_ids),
        company_id__in=company_ids,
        leave_type__company_id__in=company_ids,
        created_at__year__gte=minimum_year,
        created_at__year__lte=maximum_year,
    ).values(
        "id",
        "employee_id",
        "employee_profile_id",
        "leave_type_id",
        "adjustment_days",
        "created_at",
        "company_id",
        "leave_type__company_id",
    )
    adjustments = defaultdict(float)
    for row in adjustment_rows:
        for profile in profiles.values():
            if (
                _batch_request_matches_profile(row, profile)
                and row["company_id"] == profile.company_id
                and row["leave_type__company_id"] == profile.company_id
            ):
                adjustments[(profile.id, row["leave_type_id"], row["created_at"].year)] += float(row["adjustment_days"])

    payment_rows = list(
        AnnualLeavePaymentRequest.objects.filter(employee_profile_id__in=profile_ids).values(
            "id", "employee_profile_id", "cycle_end", "status", "carry_forward_days", "eligible_unused_days"
        )
    )
    batch = {
        "rows_by_profile": rows_by_profile,
        "leave_types_by_company": leave_types_by_company,
        "adjustments": adjustments,
        "payment_rows": payment_rows,
    }
    balance_memo = {}
    context = {}
    for instance in instances:
        profile = profile_by_instance.get(instance.pk)
        if profile is None:
            continue
        year = instance.start_date.year
        balances = _calculate_leave_balance_from_batch(profile, year, batch, balance_memo)
        rows = rows_by_profile[profile.id]
        used_total = _batch_calendar_days(
            rows,
            instance.leave_type_id,
            year,
            {LeaveRequest.RequestStatus.APPROVED},
        )
        current_days = get_leave_days(instance.start_date, instance.end_date)
        used_before = max(0.0, used_total - current_days) if instance.status == LeaveRequest.RequestStatus.APPROVED else used_total
        breakdown = get_payment_breakdown(
            instance.leave_type,
            used_before,
            current_days,
            employee_subject=profile,
            year=year,
            balances=balances,
        )
        context[instance.pk] = {"breakdown": breakdown}
    return context


def validate_leave_request_policy(
    user,
    leave_type: LeaveType,
    start: date,
    end: date,
    reason: str = "",
    has_document: bool = False,
):
    if start > end:
        return "End date must be after start date."

    profile = resolve_employee_profile(user)
    if not profile:
        # Backward-compatible fallback for accounts that are not yet linked to employee profiles.
        return None

    year = start.year
    requested_days = get_leave_days(start, end)
    if requested_days <= 0:
        return "Requested leave duration must be at least 1 day."

    code = _normalized_leave_code(leave_type)

    # Annual leave eligibility: can start after 6 months.
    if _is_annual(code):
        contract_start = get_contract_start_date(profile)
        if contract_start and get_completed_calendar_months(
            contract_start, date.today(), contract_start=contract_start
        ) < ANNUAL_MINIMUM_PERIODS:
            return "Annual leave can be used only after completing 6 months of service."

        # Only enforce remaining balance when profile + hire date are available.
        if contract_start:
            balances = calculate_leave_balance(user, year, as_of=date.today())
            annual_balance = next((b for b in balances if b["leave_code"] == code), None)
            annual_remaining = (
                float(Decimal(str(annual_balance["remaining_days"])).quantize(Decimal("1"), rounding=ROUND_FLOOR))
                if annual_balance
                else 0
            )
            cycle_start, cycle_end = get_contract_year_cycle(profile, date.today())
            pending_annual = get_annual_pending_days_for_cycle(user, cycle_start, cycle_end) if cycle_start else 0
            annual_remaining = max(0.0, annual_remaining - pending_annual)
            if requested_days > annual_remaining:
                return (
                    "Annual leave exceeds available balance "
                    f"(annual: {annual_remaining:.2f} days, pending: "
                    f"{pending_annual:.2f} days)."
                )

    if _is_emergency(code):
        balances = calculate_leave_balance(user, year)
        emergency_balance = next((b for b in balances if b["leave_code"] == code), None)
        emergency_remaining = emergency_balance["remaining_days"] if emergency_balance else 0
        if requested_days > emergency_remaining:
            return f"Emergency leave exceeds remaining balance ({emergency_remaining:.2f} days)."

    if _is_sick(code):
        if not has_document:
            return "Sick leave requires a medical report document."
        if requested_days > SICK_MAX_DAYS_PER_YEAR:
            return "Sick leave request exceeds annual maximum of 120 days."
        used = get_used_days_for_type(user, leave_type, year)
        pending = get_pending_days_for_type(user, leave_type, year)
        if used + pending + requested_days > SICK_MAX_DAYS_PER_YEAR:
            return (
                f"Sick leave exceeds annual maximum. Remaining: "
                f"{max(0, SICK_MAX_DAYS_PER_YEAR - used - pending):.0f} days."
            )

    if _is_unpaid(code):
        used = get_used_days_for_type(user, leave_type, year)
        pending = get_pending_days_for_type(user, leave_type, year)
        if used + pending + requested_days > UNPAID_MAX_DAYS_PER_YEAR:
            return (
                f"Unpaid leave exceeds annual maximum. Remaining: "
                f"{max(0, UNPAID_MAX_DAYS_PER_YEAR - used - pending):.0f} days."
            )

    if _is_marriage(code):
        if requested_days > MARRIAGE_MAX_DAYS:
            return "Marriage leave maximum is 5 days."
        already_used_qs = leave_request_employee_filter(user)
        already_used = bool(
            already_used_qs
            and already_used_qs.filter(
                leave_type=leave_type,
                status=LeaveRequest.RequestStatus.APPROVED,
            ).exists()
        )
        if already_used:
            return "Marriage leave is allowed once during service."

    if _is_death(code) and requested_days > DEATH_MAX_DAYS:
        return "Death leave maximum is 5 days."

    if _is_birth(code) and requested_days > BIRTH_MAX_DAYS:
        return "Birth leave maximum is 3 days."

    if _is_maternity(code):
        # Optional unpaid extension should not exceed 30 additional days.
        # We detect extension intent via reason keyword to stay backward-compatible with current schema.
        if "extension" in (reason or "").lower() and requested_days > MATERNITY_EXTENSION_MAX_DAYS:
            return "Maternity extension maximum is 30 days unpaid."

    return None


def calculate_leave_balance(user, year, profile=None, as_of: date | None = None):
    """
    Calculate balances for all leave types for a user in a given year.
    Returns a list of dicts.
    """
    # 1. Try to get hire date for recursion base case
    if not profile:
        profile = resolve_employee_profile(user)
    employee_subject = profile or user

    if profile:
        contract_start = get_contract_start_date(profile)
        hire_year = contract_start.year if contract_start else year
    else:
        hire_year = year

    if year < hire_year:
        return []  # No balances before hire

    if not profile or not profile.company_id:
        return []
    ensure_policy_leave_types_for_company(profile.company)
    leave_types = _get_balance_leave_types(profile)
    balances = []

    balance_date = as_of or (date.today() if year == date.today().year else date(year, 12, 31))

    for lt in leave_types:
        code = _normalized_leave_code(lt)
        annual_cycle_start, annual_cycle_end = (
            get_contract_year_cycle(profile, balance_date) if profile else (None, None)
        )
        if _is_annual(code) and annual_cycle_start:
            used = get_annual_used_days_for_cycle(
                employee_subject,
                annual_cycle_start,
                min(annual_cycle_end, balance_date),
                as_of=balance_date,
            )
            pending_days = get_annual_pending_days_for_cycle(
                employee_subject,
                annual_cycle_start,
                min(annual_cycle_end, balance_date),
                as_of=balance_date,
            )
        else:
            used = get_used_days_for_type(employee_subject, lt, year, as_of=balance_date)
            pending_days = get_pending_days_for_type(employee_subject, lt, year, as_of=balance_date)

        # Opening Balance (Carry-over)
        opening = 0.0
        if lt.allow_carry_over:
            # Check for snapshot first (MVP optimization/persistence)
            # For now, we compute dynamically as per prompt "Snapshots can be recomputed on demand"
            # But creating a snapshot would be good.
            # We strictly follow "compute previous year remaining" if no snapshot.

            # Base case: if year == hire_year, opening is 0 (unless we migrated data, but assume 0)
            if year > hire_year:
                # Recurse for previous year
                prev_year = year - 1
                prev_balances = calculate_leave_balance(employee_subject, prev_year, profile=profile)

                # Extract remaining from previous year's calculation
                # prev_balances is a list of dicts, find the matching leave_type
                prev_remaining = 0.0
                for bal in prev_balances:
                    if bal["leave_type_id"] == lt.id:
                        prev_remaining = float(bal["remaining_days"])
                        break

                # Apply max_carry_over
                if lt.max_carry_over is not None:
                    # Convert Decimal to float for comparison if needed, or stick to one type
                    opening = min(prev_remaining, float(lt.max_carry_over))
                else:
                    opening = prev_remaining

        # Quota
        configured_quota = float(lt.annual_quota or 0.0)
        if _is_annual(code):
            quota = (
                configured_quota
                if configured_quota > 0
                else (get_annual_entitlement(profile, year) if profile else 0.0)
            )
        elif _is_sick(code):
            quota = configured_quota if configured_quota > 0 else float(SICK_MAX_DAYS_PER_YEAR)
        elif _is_emergency(code):
            quota = configured_quota if configured_quota > 0 else float(EMERGENCY_MAX_DAYS_PER_YEAR)
        elif _is_unpaid(code):
            quota = configured_quota if configured_quota > 0 else float(UNPAID_MAX_DAYS_PER_YEAR)
        elif _is_marriage(code):
            quota = configured_quota if configured_quota > 0 else float(MARRIAGE_MAX_DAYS)
        elif _is_death(code):
            quota = configured_quota if configured_quota > 0 else float(DEATH_MAX_DAYS)
        elif _is_birth(code):
            quota = configured_quota if configured_quota > 0 else float(BIRTH_MAX_DAYS)
        else:
            quota = configured_quota

        # Adjustments
        # Sum all adjustments for this employee + leave_type (ignoring year/date? usually adjustments span across or tied to year?)
        # For simplicity, adjustments are time-independent or should strictly apply to current year context?
        # Usually manual adjustments are "add 5 days now".
        # If we use recursion for carry-over, an adjustment in prev_year should affect carry-over.
        # But `calculate_leave_balance` is year-specific.
        # Ideally, Adjustment model should have a `effective_date` or `year` field to scope it.
        # I didn't add `year` or `date` to Adjustment model, just `created_at`.
        # Let's assume adjustments made within the year apply to that year.

        # NOTE: I missed adding `effective_date` to model, defaulting to `created_at` logic.
        # Filter adjustments created in this year? Or valid for this year?
        # Let's use created_at.year == year for now.

        adjustments = get_adjustments_for_type(employee_subject, lt, year)

        available_annual_year_days = None
        if _is_annual(code):
            available_annual_year_days = (
                float(get_annual_accrual_details(profile, balance_date)["accrued_days"]) if profile else 0.0
            )
            if configured_quota > 0:
                available_annual_year_days = min(available_annual_year_days, configured_quota)

        emergency_available_days = None
        # Emergency leave is deducted from annual leave.
        if _is_emergency(code):
            annual_type = next(
                (t for t in leave_types if _is_annual(_normalized_leave_code(t))),
                None,
            )
            if annual_type:
                annual_details = get_annual_accrual_details(profile, balance_date) if profile else {}
                annual_total = (
                    (
                        float(annual_details.get("accrued_days", 0.0))
                        + float(get_prior_annual_carry_forward_days(profile, annual_details["cycle_start"]))
                    )
                    if profile and annual_details.get("cycle_start")
                    else 0.0
                )
                annual_used_only = (
                    get_period_days_for_leave_type(
                        employee_subject,
                        annual_type,
                        annual_details["cycle_start"],
                        min(annual_details["cycle_end"], balance_date),
                        as_of=balance_date,
                    )
                    if profile and annual_details.get("cycle_start")
                    else 0
                )
                emergency_used = used
                annual_remaining_after_annual = max(0.0, annual_total - annual_used_only)
                emergency_available_days = (
                    min(float(EMERGENCY_MAX_DAYS_PER_YEAR), max(0.0, annual_remaining_after_annual - emergency_used))
                    + adjustments
                )

        # Marriage leave is once during service.
        if _is_marriage(code):
            approved_lifetime_qs = leave_request_employee_filter(employee_subject)
            approved_lifetime = bool(
                approved_lifetime_qs
                and approved_lifetime_qs.filter(
                    leave_type=lt,
                    status=LeaveRequest.RequestStatus.APPROVED,
                ).exists()
            )
            if approved_lifetime:
                quota = 0.0

        available_total = opening + quota + adjustments
        if available_annual_year_days is not None:
            prior_carry = (
                float(get_prior_annual_carry_forward_days(profile, annual_cycle_start))
                if profile and annual_cycle_start
                else 0.0
            )
            available_total = prior_carry + available_annual_year_days + adjustments
        if emergency_available_days is not None:
            available_total = emergency_available_days
        remaining = max(0.0, available_total - used)
        requestable_days = max(
            0.0, float(Decimal(str(remaining)).quantize(Decimal("1"), rounding=ROUND_FLOOR)) - pending_days
        )
        fractional_days = max(
            0.0, remaining - float(Decimal(str(remaining)).quantize(Decimal("1"), rounding=ROUND_FLOOR))
        )

        balances.append(
            {
                "leave_type_id": lt.id,
                "leave_type": lt.name,
                "leave_code": code,
                "total_days": float(available_total),
                "used_days": float(used),
                "remaining_days": float(remaining),
                "pending_days": float(pending_days),
                "requestable_days": requestable_days,
                "fractional_days": fractional_days,
                "adjustments": adjustments,  # Useful for UI
                **(
                    {"available_annual_year_days": float(available_annual_year_days)}
                    if available_annual_year_days is not None
                    else {}
                ),
            }
        )

    annual_balance = _find_balance_by_code(balances, "ANNUAL", "ANNUAL_LEAVE")
    unpaid_balance = _find_balance_by_code(balances, "UNPAID", "UNPAID_LEAVE")

    if annual_balance and unpaid_balance:
        annual_overflow = max(0.0, float(annual_balance["used_days"]) - float(annual_balance["total_days"]))
        unpaid_balance["used_days"] = float(unpaid_balance["used_days"]) + annual_overflow
        unpaid_balance["remaining_days"] = max(
            0.0, float(unpaid_balance["total_days"]) - float(unpaid_balance["used_days"])
        )

    return balances
