"""Leave request PDF: values and signers for the approved leave form.

Layout lives entirely in ``leave_request_blank_field_map.json`` next to the
template; this module only decides *what* each mapped box should say and *who*
signed each stage.  Rendering is delegated to :mod:`core.pdf_forms`.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from django.utils import timezone

from core.pdf_forms import (
    FormAssets,
    SignatureAsset,
    load_form_assets,
    log_signature_diagnostics,
    render_mapped_form,
)
from core.pdf_signers import signer_signatures
from core.views_templates import resolve_template_path

from .utils import calculate_leave_balance, get_leave_days

FIELD_MAP_FILENAME = "leave_request_blank_field_map.json"
TEMPLATE_FILENAME = "leave_request_blank.pdf"
TEMPLATE_ALIASES = ["leave-request-template.pdf"]
FORM_KEY = "leave_request"

#: A map missing any of these cannot describe this form, so the caller falls
#: back rather than filling a template with coordinates meant for another one.
REQUIRED_FIELD_KEYS = frozenset(
    {
        "reference_no",
        "request_date",
        "employee_name",
        "employee_id",
        "department",
        "job_title",
        "line_manager",
        "work_location",
        "contact_no",
        "email",
        "leave_type",
        "leave_balance_days",
        "start_date",
        "end_date",
        "total_days_requested",
        "will_travel",
        "reason",
        "address_during_leave",
        "contact_no_during_leave",
        "substitute_employee_id",
        "substitute_employee_name",
        "substitute_department",
        "substitute_notes",
        "destination",
        "travel_date",
        "return_date",
        "ticket_required",
        "employee_signature_image",
        "employee_signature_date",
        "line_manager_signature_image",
        "line_manager_signature_date",
        "department_head_signature_image",
        "department_head_signature_date",
        "hr_signature_image",
        "hr_signature_date",
    }
)

LEAVE_TYPE_ARABIC = {
    "ANNUAL": "إجازة سنوية",
    "ANNUAL_LEAVE": "إجازة سنوية",
    "SICK": "إجازة مرضية",
    "SICK_LEAVE": "إجازة مرضية",
    "EMERGENCY": "إجازة طارئة",
    "EMERGENCY_LEAVE": "إجازة طارئة",
    "UNPAID": "إجازة بدون راتب",
    "UNPAID_LEAVE": "إجازة بدون راتب",
    "MARRIAGE": "إجازة زواج",
    "DEATH": "إجازة وفاة",
    "BIRTH": "إجازة مولود",
    "MATERNITY": "إجازة أمومة",
}


def _format_date(value: Any) -> str:
    if not value:
        return ""
    try:
        if hasattr(value, "hour"):
            value = timezone.localtime(value)
        return value.strftime("%Y-%m-%d")
    except (AttributeError, TypeError, ValueError):
        return str(value)


def _format_number(value: Any) -> str:
    if value in (None, ""):
        return ""
    try:
        number = float(value)
        return str(int(number)) if number.is_integer() else f"{number:.2f}".rstrip("0").rstrip(".")
    except (TypeError, ValueError):
        return str(value)


def _profile_for(instance) -> Any:
    profile = getattr(instance, "employee_profile", None)
    if profile:
        return profile
    employee = getattr(instance, "employee", None)
    try:
        return employee.employee_profile if employee else None
    except Exception:
        return None


def _user_profile(user) -> Any:
    try:
        return user.employee_profile if user else None
    except Exception:
        return None


def _display_name(user=None, profile=None) -> str:
    profile = profile or _user_profile(user)
    if profile:
        value = (
            getattr(profile, "full_name_en", "")
            or getattr(profile, "full_name", "")
            or getattr(profile, "full_name_ar", "")
        )
        if value:
            return str(value)
    return str(getattr(user, "full_name", "") or getattr(user, "email", "") or "")


def _manager_user_and_profile(profile) -> tuple[Any, Any]:
    if not profile:
        return None, None
    manager_profile = getattr(profile, "manager_profile", None)
    if manager_profile:
        return getattr(manager_profile, "user", None), manager_profile
    manager_user = getattr(profile, "manager", None)
    return manager_user, _user_profile(manager_user)


def _leave_balance(instance, profile) -> str:
    employee = getattr(instance, "employee", None)
    if not employee or not profile:
        return ""
    try:
        balances = calculate_leave_balance(employee, instance.start_date.year, profile=profile)
    except Exception:
        return ""
    for balance in balances:
        if balance.get("leave_type_id") == getattr(instance, "leave_type_id", None):
            return _format_number(balance.get("remaining_days"))
    return ""


def _leave_type_value(leave_type) -> str:
    name = str(getattr(leave_type, "name", "") or "")
    code = str(getattr(leave_type, "code", "") or name).strip().upper().replace(" ", "_")
    arabic = LEAVE_TYPE_ARABIC.get(code, "")
    if arabic and arabic not in name:
        return f"{name} / {arabic}"
    return name


def build_leave_request_signers(instance) -> dict[str, Any]:
    """Return ``{map_field: recorded_actor}`` for every signature box.

    Each approver comes from the decision the workflow actually stored for that
    stage.  A stage nobody has completed maps to ``None`` so the box stays blank
    and the renderer reports it as missing - the downloading user is never
    substituted in as a signer.
    """

    hr_user = (
        getattr(instance, "hr_completed_by", None)
        or getattr(instance, "decided_by", None)
        or getattr(instance, "entered_by", None)
    )
    hr_signed = bool(getattr(instance, "hr_completed_at", None) or getattr(instance, "decided_at", None))
    return {
        "employee_signature_image": getattr(instance, "employee", None),
        "line_manager_signature_image": (
            getattr(instance, "manager_decision_by", None) if getattr(instance, "manager_decision_at", None) else None
        ),
        "department_head_signature_image": (
            getattr(instance, "ceo_decision_by", None) if getattr(instance, "ceo_decision_at", None) else None
        ),
        "hr_signature_image": hr_user if hr_signed else None,
    }


def build_leave_request_values(instance) -> dict[str, Any]:
    profile = _profile_for(instance)
    employee = getattr(instance, "employee", None)
    manager_user, manager_profile = _manager_user_and_profile(profile)
    delegated_user = getattr(instance, "delegated_to", None)
    delegated_profile = _user_profile(delegated_user)
    company = getattr(profile, "company", None) or getattr(instance, "company", None)
    task_group = getattr(profile, "task_group_ref", None) if profile else None

    hr_date = getattr(instance, "hr_completed_at", None) or getattr(instance, "decided_at", None)
    destination = str(
        getattr(instance, "airplane_ticket_address", "") or getattr(instance, "other_leave_description", "") or ""
    )
    ticket_required = bool(
        getattr(instance, "airplane_ticket_payer", "") or getattr(instance, "airplane_ticket_address", "")
    )
    address_parts = [
        str(value) for value in (getattr(instance, "full_address", ""), getattr(instance, "po_box", "")) if value
    ]
    profile_mobile = str(getattr(profile, "mobile", "") or "")
    department = str(
        getattr(profile, "department_name_en", "")
        or getattr(profile, "department", "")
        or getattr(profile, "department_name_ar", "")
        or ""
    )
    delegated_department = str(
        getattr(delegated_profile, "department_name_en", "")
        or getattr(delegated_profile, "department", "")
        or getattr(delegated_profile, "department_name_ar", "")
        or ""
    )
    request_date = getattr(instance, "created_at", None)

    return {
        "reference_no": f"LR-{instance.id:05d}" if getattr(instance, "id", None) else "",
        "request_date": _format_date(request_date),
        "filed_date": _format_date(getattr(instance, "filed_at", None) or request_date),
        "employee_name": _display_name(employee, profile),
        "employee_id": str(getattr(profile, "employee_number", "") or getattr(profile, "employee_id", "") or ""),
        "department": department,
        "job_title": str(
            getattr(profile, "job_title_en", "")
            or getattr(profile, "job_title", "")
            or getattr(profile, "job_title_ar", "")
            or ""
        ),
        "line_manager": _display_name(manager_user, manager_profile),
        "work_location": str(getattr(task_group, "name", "") or getattr(company, "name", "") or ""),
        "contact_no": profile_mobile,
        "email": str(getattr(employee, "email", "") or ""),
        "leave_type": _leave_type_value(getattr(instance, "leave_type", None)),
        "leave_balance_days": _leave_balance(instance, profile),
        "end_date": _format_date(getattr(instance, "end_date", None)),
        "start_date": _format_date(getattr(instance, "start_date", None)),
        "total_days_requested": _format_number(
            get_leave_days(getattr(instance, "start_date", None), getattr(instance, "end_date", None))
        ),
        "will_travel": ticket_required,
        "reason": str(getattr(instance, "reason", "") or ""),
        "address_during_leave": " | ".join(address_parts),
        "contact_no_during_leave": profile_mobile,
        "substitute_employee_id": str(
            getattr(delegated_profile, "employee_number", "") or getattr(delegated_profile, "employee_id", "") or ""
        ),
        "substitute_employee_name": _display_name(delegated_user, delegated_profile),
        "substitute_department": delegated_department,
        "substitute_notes": str(getattr(instance, "delegation_note", "") or ""),
        "destination": destination,
        "travel_date": _format_date(getattr(instance, "start_date", None)),
        "return_date": _format_date(getattr(instance, "date_of_rejoin", None) or getattr(instance, "end_date", None)),
        "ticket_required": ticket_required,
        # Signature dates carry the workflow timestamp for their stage; the
        # image itself is supplied separately from the recorded actor.
        "employee_signature_date": _format_date(request_date),
        "line_manager_signature_date": _format_date(getattr(instance, "manager_decision_at", None)),
        "department_head_signature_date": _format_date(getattr(instance, "ceo_decision_at", None)),
        "hr_signature_date": _format_date(hr_date),
    }


def load_leave_form_assets(template_path: str | Path | None = None) -> FormAssets | None:
    """Resolve the template and the map deployed beside it.

    ``template_path`` lets a caller render a specific template file while still
    validating against the deployed map; the map itself is never taken from a
    client-supplied location.
    """

    assets = load_form_assets(
        TEMPLATE_FILENAME,
        FIELD_MAP_FILENAME,
        aliases=TEMPLATE_ALIASES,
        required_keys=REQUIRED_FIELD_KEYS,
    )
    if assets is None or template_path is None:
        return assets
    return FormAssets(template_path=str(template_path), fields=assets.fields, meta=assets.meta)


def load_field_map() -> dict[str, dict]:
    """Return the leave field map, or ``{}`` when the paired asset is absent."""

    assets = load_leave_form_assets()
    return assets.fields if assets else {}


def render_leave_request_pdf(
    template_path: str | Path,
    values: dict[str, Any],
    signatures: dict[str, SignatureAsset | None] | None = None,
) -> bytes:
    assets = load_leave_form_assets(template_path)
    if assets is None:
        raise FileNotFoundError(f"{FIELD_MAP_FILENAME} is not deployed beside {TEMPLATE_FILENAME}")
    pdf_bytes, diagnostics = render_mapped_form(assets, values, signatures=signatures)
    log_signature_diagnostics(FORM_KEY, values.get("reference_no", ""), diagnostics)
    return pdf_bytes


def build_leave_request_pdf(instance, fallback: Callable[[Any], bytes] | None = None) -> bytes:
    """Render the mapped leave form, falling back only when its pair is absent."""

    assets = load_leave_form_assets()
    if assets is None:
        if fallback:
            return fallback(instance)
        raise FileNotFoundError(f"{TEMPLATE_FILENAME} and {FIELD_MAP_FILENAME} could not be resolved together")
    signatures = signer_signatures(build_leave_request_signers(instance))
    pdf_bytes, diagnostics = render_mapped_form(assets, build_leave_request_values(instance), signatures=signatures)
    log_signature_diagnostics(FORM_KEY, getattr(instance, "id", None), diagnostics)
    return pdf_bytes


def resolve_leave_template_path() -> str:
    """Template location only, for callers that do not render."""

    return resolve_template_path(TEMPLATE_FILENAME, aliases=TEMPLATE_ALIASES)
