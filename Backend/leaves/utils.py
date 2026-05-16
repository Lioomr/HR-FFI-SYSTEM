from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Sum

from employees.models import EmployeeProfile

from .models import LeaveBalanceAdjustment, LeaveRequest, LeaveType

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
ANNUAL_ACCRUAL_DAYS_PER_MONTH = 1.75
ANNUAL_ACCRUAL_MAX_DAYS = 21.0

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
    Ensure baseline leave types required by policy exist for legacy
    non-company-scoped records only.
    This avoids colliding with company-scoped leave types that reuse the
    same codes across multiple organizations.
    """
    for definition in POLICY_LEAVE_TYPE_DEFINITIONS:
        LeaveType.objects.get_or_create(
            company=None,
            code=definition["code"],
            defaults={
                "name": definition["name"],
                "is_paid": definition["is_paid"],
                "requires_attachment": definition["requires_attachment"],
                "is_active": True,
                "annual_quota": definition["annual_quota"],
            },
        )


def resolve_employee_company(employee_subject=None, profile=None, leave_type: LeaveType | None = None):
    if leave_type and leave_type.company_id:
        return leave_type.company

    profile = profile or resolve_employee_profile(employee_subject)
    if profile and profile.company_id:
        return profile.company

    return None


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


def get_balance_leave_types(company=None):
    if company is not None:
        ensure_policy_leave_types_for_company(company)
        return LeaveType.objects.filter(is_active=True, company=company)

    ensure_policy_leave_types()
    return LeaveType.objects.filter(is_active=True, company__isnull=True)


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

    return request_filter


def _normalized_leave_code(leave_type: LeaveType) -> str:
    if leave_type.code:
        return leave_type.code.strip().upper()
    return leave_type.name.strip().upper().replace(" ", "_")


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


def get_annual_entitlement(profile: EmployeeProfile, year: int):
    """
    Annual entitlement:
    - <1 year service: proportional up to 21
    - >=1 and <5 years: 21
    - >=5 years: 30
    """
    year_start = date(year, 1, 1)
    year_end = date(year, 12, 31)

    if not profile.hire_date:
        return 0.0

    if profile.hire_date > year_end:
        return 0.0

    service_at_year_end = get_service_years(profile, year_end)
    if service_at_year_end >= 5:
        base = 30.0
    else:
        base = 21.0

    # First service year: proportional entitlement.
    first_service_year = profile.hire_date.year
    if year == first_service_year and service_at_year_end < 1:
        employed_days = (year_end - max(year_start, profile.hire_date)).days + 1
        return round(base * (employed_days / 365.0), 2)

    return base


def get_annual_accrued_days(profile: EmployeeProfile | None, year: int, as_of: date | None = None):
    """
    Annual leave accrues monthly: 1.75 days per started month, capped at 21 days.
    """
    as_of = as_of or date.today()

    if year > as_of.year:
        return 0.0

    end_month = 12 if year < as_of.year else as_of.month
    start_month = 1

    if profile and profile.hire_date:
        if profile.hire_date.year > year:
            return 0.0
        if profile.hire_date.year == year:
            start_month = profile.hire_date.month

    counted_months = max(0, end_month - start_month + 1)
    accrued = counted_months * ANNUAL_ACCRUAL_DAYS_PER_MONTH
    return round(min(accrued, ANNUAL_ACCRUAL_MAX_DAYS), 2)


def get_used_days_for_type(user, leave_type: LeaveType, year: int):
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
        used += calculate_overlap_days(req.start_date, req.end_date, year)
    return float(used)


def get_adjustments_for_type(user, leave_type: LeaveType, year: int):
    profile = resolve_employee_profile(user)
    adjustments = LeaveBalanceAdjustment.objects.none()
    if profile:
        if profile.user_id:
            adjustments = LeaveBalanceAdjustment.objects.filter(employee=profile.user) | LeaveBalanceAdjustment.objects.filter(
                employee_profile=profile
            )
        else:
            adjustments = LeaveBalanceAdjustment.objects.filter(employee_profile=profile)
    elif user:
        adjustments = LeaveBalanceAdjustment.objects.filter(employee=user)
    else:
        return 0.0

    adjs = adjustments.filter(leave_type=leave_type, created_at__year=year).aggregate(
        Sum("adjustment_days")
    )["adjustment_days__sum"] or Decimal("0")
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
    company=None,
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

        if employee_subject is not None and year is not None:
            balances = calculate_leave_balance(employee_subject, year, company=company or leave_type.company)
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
    company = resolve_employee_company(user, profile=profile, leave_type=leave_type)

    # Annual leave eligibility: can start after 6 months.
    if _is_annual(code):
        if profile.hire_date and start < (profile.hire_date + timedelta(days=182)):
            return "Annual leave can be used only after completing 6 months of service."

        # Only enforce remaining balance when profile + hire date are available.
        if profile.hire_date:
            balances = calculate_leave_balance(user, year, profile=profile, company=company)
            annual_balance = next((b for b in balances if b["leave_code"] == code), None)
            unpaid_balance = _find_balance_by_code(balances, "UNPAID", "UNPAID_LEAVE")
            annual_remaining = annual_balance["remaining_days"] if annual_balance else 0
            unpaid_remaining = unpaid_balance["remaining_days"] if unpaid_balance else 0
            if requested_days > annual_remaining + unpaid_remaining:
                return (
                    "Annual leave exceeds available balance "
                    f"(annual: {annual_remaining:.2f} days, unpaid fallback: {unpaid_remaining:.2f} days)."
                )

    if _is_emergency(code):
        balances = calculate_leave_balance(user, year, profile=profile, company=company)
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
        if used + requested_days > SICK_MAX_DAYS_PER_YEAR:
            return f"Sick leave exceeds annual maximum. Remaining: {max(0, SICK_MAX_DAYS_PER_YEAR - used):.0f} days."

    if _is_unpaid(code):
        used = get_used_days_for_type(user, leave_type, year)
        if used + requested_days > UNPAID_MAX_DAYS_PER_YEAR:
            return (
                f"Unpaid leave exceeds annual maximum. Remaining: "
                f"{max(0, UNPAID_MAX_DAYS_PER_YEAR - used):.0f} days."
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


def calculate_leave_balance(user, year, profile=None, company=None, as_of: date | None = None):
    """
    Calculate balances for all leave types for a user in a given year.
    Returns a list of dicts.
    """
    # 1. Try to get hire date for recursion base case
    if not profile:
        profile = resolve_employee_profile(user)
    employee_subject = profile or user
    company = company or resolve_employee_company(user, profile=profile)

    if profile:
        hire_year = profile.hire_date.year if profile.hire_date else year
    else:
        hire_year = year

    if year < hire_year:
        return []  # No balances before hire

    leave_types = get_balance_leave_types(company)
    balances = []

    for lt in leave_types:
        code = _normalized_leave_code(lt)
        used = get_used_days_for_type(employee_subject, lt, year)

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
                prev_balances = calculate_leave_balance(
                    employee_subject,
                    prev_year,
                    profile=profile,
                    company=company,
                    as_of=as_of,
                )

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
            quota = get_annual_accrued_days(profile, year, as_of=as_of)
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

        # Emergency leave is deducted from annual leave.
        if _is_emergency(code):
            annual_type = next(
                (t for t in leave_types if _is_annual(_normalized_leave_code(t))),
                None,
            )
            if annual_type:
                annual_total = get_annual_accrued_days(profile, year, as_of=as_of) + get_adjustments_for_type(
                    employee_subject, annual_type, year
                )
                annual_used = get_used_days_for_type(employee_subject, annual_type, year)
                emergency_used = used
                annual_remaining_after_annual = max(0.0, annual_total - annual_used)
                quota = min(
                    float(EMERGENCY_MAX_DAYS_PER_YEAR), max(0.0, annual_remaining_after_annual - emergency_used)
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

        remaining = opening + quota + adjustments - used
        remaining = max(0.0, remaining)

        balances.append(
            {
                "leave_type_id": lt.id,
                "leave_type": lt.name,
                "leave_code": code,
                "available_annual_year_days": get_annual_accrued_days(profile, year, as_of=as_of)
                if _is_annual(code)
                else 0.0,
                "total_days": float(opening + quota + adjustments),
                "used_days": float(used),
                "remaining_days": float(remaining),
                "adjustments": adjustments,  # Useful for UI
            }
        )

    annual_balance = _find_balance_by_code(balances, "ANNUAL", "ANNUAL_LEAVE")
    unpaid_balance = _find_balance_by_code(balances, "UNPAID", "UNPAID_LEAVE")

    if annual_balance and unpaid_balance:
        annual_overflow = max(0.0, float(annual_balance["used_days"]) - float(annual_balance["total_days"]))
        unpaid_balance["used_days"] = float(unpaid_balance["used_days"]) + annual_overflow
        unpaid_balance["remaining_days"] = max(0.0, float(unpaid_balance["total_days"]) - float(unpaid_balance["used_days"]))

    return balances
