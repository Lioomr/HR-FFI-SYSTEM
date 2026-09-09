"""Annual entitlements disbursement PDF for ``AnnualLeavePaymentRequest``.

Layout comes from ``annual_entitlements_disbursement_blank_field_map.json``
deployed beside the template.  This module maps the settlement record onto the
map's field names and names the actor allowed to sign each box.

The form carries four signature panels - applicant, financial management, HR
department, and accounts officer.  Only two of them correspond to a stage the
settlement workflow records (the employee who filed it, and the HR reviewer), so
the finance and accounts panels stay blank rather than borrowing another
signer's identity.
"""

from __future__ import annotations

from typing import Any, Callable

from django.utils import timezone

from core.pdf_forms import FormAssets, load_form_assets, log_signature_diagnostics, render_mapped_form
from core.pdf_signers import display_name, signer_signatures

FIELD_MAP_FILENAME = "annual_entitlements_disbursement_blank_field_map.json"
TEMPLATE_FILENAME = "annual_entitlements_disbursement_blank.pdf"
FORM_KEY = "annual_entitlements_disbursement"

REQUIRED_FIELD_KEYS = frozenset(
    {
        "reference_no",
        "request_date",
        "filed_date",
        "purpose",
        "employee_name",
        "employee_id",
        "department",
        "applicant_name",
        "applicant_signature_image",
        "applicant_signature_date",
        "financial_management_signature_image",
        "financial_management_signature_date",
        "hr_department_signature_image",
        "hr_department_signature_date",
        "accounts_officer_signature_image",
        "accounts_officer_signature_date",
    }
)

#: The declaration paragraph inside ``letter_body`` is pre-printed on the
#: approved template in both languages, so the renderer must leave that box
#: alone. The settlement's day counts and amounts have no field of their own on
#: this form and are deliberately not placed anywhere the map does not declare.
PRE_PRINTED_FIELDS = frozenset({"letter_body"})

#: Professional labels for the form; raw enum values never reach the page.
RESOLUTION_LABELS = {
    "pay": "Disbursement of Annual Entitlements",
    "carry_forward": "Carry Forward of Annual Entitlements",
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


def build_annual_entitlements_signers(instance: Any) -> dict[str, Any]:
    """Return ``{map_field: recorded_actor}`` for the four signature panels."""

    return {
        "applicant_signature_image": getattr(instance, "employee", None),
        "hr_department_signature_image": (
            getattr(instance, "hr_reviewed_by", None) if getattr(instance, "hr_reviewed_at", None) else None
        ),
        # No workflow stage records a finance or accounts actor on this request,
        # so these panels are reported missing instead of being filled by proxy.
        "financial_management_signature_image": None,
        "accounts_officer_signature_image": None,
    }


def build_annual_entitlements_values(instance: Any) -> dict[str, Any]:
    profile = getattr(instance, "employee_profile", None)
    employee = getattr(instance, "employee", None)
    applicant = display_name(user=employee, profile=profile)
    submitted_at = getattr(instance, "submitted_at", None)
    return {
        "reference_no": f"AED-{getattr(instance, 'id', 0):05d}" if getattr(instance, "id", None) else "",
        "request_date": _format_date(submitted_at),
        "filed_date": _format_date(submitted_at),
        "purpose": RESOLUTION_LABELS.get(str(getattr(instance, "resolution", "")), "Annual Entitlements"),
        "employee_name": applicant,
        "employee_id": str(getattr(profile, "employee_id", "") or ""),
        "department": str(
            getattr(profile, "department_name_en", "")
            or getattr(profile, "department", "")
            or getattr(profile, "department_name_ar", "")
            or ""
        ),
        "applicant_name": applicant,
        "applicant_signature_date": _format_date(submitted_at),
        "hr_department_signature_date": _format_date(getattr(instance, "hr_reviewed_at", None)),
        # Left blank: the workflow records no actor for these two panels.
        "financial_management_signature_date": "",
        "accounts_officer_signature_date": "",
    }


def load_annual_entitlements_form_assets() -> FormAssets | None:
    return load_form_assets(TEMPLATE_FILENAME, FIELD_MAP_FILENAME, required_keys=REQUIRED_FIELD_KEYS)


def build_annual_entitlements_pdf(instance: Any, fallback: Callable[[Any], bytes] | None = None) -> bytes:
    """Render the mapped form, falling back only when its paired asset is absent."""

    assets = load_annual_entitlements_form_assets()
    if assets is None:
        if fallback:
            return fallback(instance)
        raise FileNotFoundError(f"{TEMPLATE_FILENAME} and {FIELD_MAP_FILENAME} could not be resolved together")
    signatures = signer_signatures(build_annual_entitlements_signers(instance))
    pdf_bytes, diagnostics = render_mapped_form(
        assets, build_annual_entitlements_values(instance), signatures=signatures
    )
    log_signature_diagnostics(FORM_KEY, getattr(instance, "id", None), diagnostics)
    return pdf_bytes
