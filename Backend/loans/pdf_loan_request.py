"""Mapped renderer for the loan request PDF.

The blank form and its field map travel together.  Values are deliberately
rendered only through the map so a template revision cannot silently move a
value into a different labelled field.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from django.utils import timezone

from core.pdf_forms import FormAssets, load_form_assets, log_signature_diagnostics, render_mapped_form
from core.pdf_signers import signer_signatures

FIELD_MAP_FILENAME = "loan_request_blank_field_map.json"
TEMPLATE_FILENAME = "loan_request_blank.pdf"
TEMPLATE_ALIASES = ["loan-request-template.pdf"]
FORM_KEY = "loan_request"

#: Approval stage -> (recorded actor attribute, decision timestamp attribute).
#: The five columns on the form mirror the loan workflow exactly.
SIGNATURE_STAGES = (
    ("manager", "manager_decision_by", "manager_decision_at"),
    ("hr", "finance_decision_by", "finance_decision_at"),
    ("cfo", "cfo_decision_by", "cfo_decision_at"),
    ("ceo", "ceo_decision_by", "ceo_decision_at"),
    ("disbursement", "disbursed_by", "disbursed_at"),
)

REQUIRED_FIELD_KEYS = frozenset(
    {
        "reference_no",
        "request_date",
        "filed_date",
        "employee_name",
        "employee_number",
        "department",
        "job_title",
        "mobile_number",
        "basic_salary",
        "loan_type",
        "requested_amount",
        "installment_months",
        "monthly_deduction",
        "deduction_start_date",
        "payroll_reference",
        "previous_loan_status",
        "previous_loan_type",
        "previous_loan_value",
        "previous_loan_end_date",
        "reason_details",
        "manager_approval_name",
        "manager_approval_decision",
        "manager_approval_date",
        "manager_signature",
        "hr_approval_name",
        "hr_approval_decision",
        "hr_approval_date",
        "hr_signature",
        "cfo_approval_name",
        "cfo_approval_decision",
        "cfo_approval_date",
        "cfo_signature",
        "ceo_approval_name",
        "ceo_approval_decision",
        "ceo_approval_date",
        "ceo_signature",
        "disbursement_name",
        "disbursement_status",
        "disbursement_date",
        "disbursement_signature",
    }
)


def load_loan_form_assets(template_path: str | Path | None = None) -> FormAssets | None:
    """Resolve the template and the map deployed beside it.

    Keeping the files colocated prevents a deployed override PDF from being
    filled with coordinates intended for the bundled PDF.
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


def load_loan_field_map(template_path: str | Path | None = None) -> dict[str, dict[str, Any]]:
    """Return the colocated field map, or an empty map when the pair is broken."""

    assets = load_loan_form_assets(template_path)
    return assets.fields if assets else {}


def _blank(value: object) -> str:
    text = str(value or "").strip()
    return "" if text in {"-", "None"} else text


def _display_user(user: Any) -> str:
    return _blank(getattr(user, "full_name", "") or getattr(user, "email", ""))


def _format_date(value: Any) -> str:
    if not value:
        return ""
    try:
        if hasattr(value, "hour"):
            value = timezone.localtime(value)
        return value.strftime("%Y-%m-%d")
    except (AttributeError, TypeError, ValueError):
        return str(value)


def _format_money(value: Any) -> str:
    if value is None or value == "":
        return ""
    try:
        return f"{value:,.2f}"
    except (TypeError, ValueError):
        return str(value)


def _user_profile(user: Any) -> Any:
    try:
        return user.employee_profile if user else None
    except Exception:
        return None


def _approval_decision(
    instance: Any, stage: str, decided_at: Any, pending_status: str, recommendation: Any = None
) -> str:
    if decided_at:
        if recommendation == "reject":
            return "Rejected"
        if getattr(instance, "status", "") == "rejected" and _latest_decision_stage(instance) == stage:
            return "Rejected"
        return "Disbursed" if stage == "Disbursement" else "Approved"
    return "Pending" if getattr(instance, "status", "") == pending_status else ""


def _latest_decision_stage(instance: Any) -> str | None:
    stages = (
        ("Manager", getattr(instance, "manager_decision_at", None)),
        ("HR", getattr(instance, "finance_decision_at", None)),
        ("CFO", getattr(instance, "cfo_decision_at", None)),
        ("CEO", getattr(instance, "ceo_decision_at", None)),
        ("Disbursement", getattr(instance, "disbursed_at", None)),
    )
    dated = [(stage, date) for stage, date in stages if date]
    return max(dated, key=lambda pair: pair[1])[0] if dated else None


def _monthly_deduction(instance: Any) -> str:
    months = getattr(instance, "installment_months", None)
    if not months:
        return _format_money(getattr(instance, "requested_amount", None))
    try:
        return _format_money(getattr(instance, "requested_amount", 0) / months)
    except (ArithmeticError, TypeError, ValueError):
        return ""


def _target_deduction(instance: Any) -> str:
    year = getattr(instance, "target_deduction_year", None)
    month = getattr(instance, "target_deduction_month", None)
    return f"{year}-{month:02d}" if year and month else ""


LOAN_TYPE_LABELS = {"open": "Open Loan", "installment": "Installment Loan"}


def _previous_loan(instance: Any) -> Any:
    """Return the employee's most recent earlier loan, or ``None``.

    The form prints the previous loan so an approver can see the employee's
    standing commitment. Only real rows are used; nothing is inferred when the
    employee has no earlier request.
    """

    employee_id = getattr(instance, "employee_id", None)
    current_id = getattr(instance, "id", None)
    if not employee_id:
        return None
    try:
        from .models import LoanRequest

        queryset = LoanRequest.objects.filter(
            employee_id=employee_id,
            is_active=True,
            status__in=[
                LoanRequest.RequestStatus.APPROVED,
                LoanRequest.RequestStatus.PENDING_DISBURSEMENT,
                LoanRequest.RequestStatus.DEDUCTED,
            ],
        )
        if current_id:
            queryset = queryset.exclude(pk=current_id)
        return queryset.order_by("-created_at", "-id").first()
    except Exception:
        # A detached instance (or an unavailable database) simply has no history.
        return None


def _previous_loan_end(previous: Any) -> str:
    """Last deduction month of a previous loan, from its own schedule."""

    if getattr(previous, "deducted_at", None):
        return _format_date(previous.deducted_at)
    year = getattr(previous, "target_deduction_year", None) or getattr(previous, "approved_year", None)
    month = getattr(previous, "target_deduction_month", None) or getattr(previous, "approved_month", None)
    if not year or not month:
        return ""
    months = (getattr(previous, "installment_months", None) or 1) - 1
    total = (month - 1) + months
    return f"{year + total // 12}-{total % 12 + 1:02d}"


def build_loan_request_values(instance: Any) -> dict[str, str]:
    """Build values for every mapped field; unavailable domain data stays blank."""

    profile = getattr(instance, "employee_profile", None)
    employee = getattr(instance, "employee", None)
    loan_type = getattr(instance, "loan_type", "")
    loan_type_label = LOAN_TYPE_LABELS.get(str(loan_type), str(loan_type))
    previous = _previous_loan(instance)
    payroll_run_id = getattr(instance, "deduction_payroll_run_id", None)
    payroll_reference = f"Payroll #{payroll_run_id}" if payroll_run_id else ""
    if not payroll_reference and getattr(instance, "approved_year", None) and getattr(instance, "approved_month", None):
        payroll_reference = f"{instance.approved_year}-{instance.approved_month:02d}"

    stage_specs = (
        (
            "manager",
            "Manager",
            "manager_decision_by",
            "manager_decision_at",
            "pending_manager",
            "manager_recommendation",
        ),
        ("hr", "HR", "finance_decision_by", "finance_decision_at", "pending_hr", "hr_recommendation"),
        ("cfo", "CFO", "cfo_decision_by", "cfo_decision_at", "pending_cfo", None),
        ("ceo", "CEO", "ceo_decision_by", "ceo_decision_at", "pending_ceo", None),
        ("disbursement", "Disbursement", "disbursed_by", "disbursed_at", "pending_disbursement", None),
    )
    values: dict[str, str] = {
        "reference_no": f"LN-{getattr(instance, 'id', 0):05d}" if getattr(instance, "id", None) else "",
        "request_date": _format_date(getattr(instance, "created_at", None)),
        "filed_date": _format_date(getattr(instance, "filed_at", None) or getattr(instance, "created_at", None)),
        "employee_name": _blank(
            getattr(profile, "full_name_en", "")
            or getattr(profile, "full_name", "")
            or getattr(profile, "full_name_ar", "")
            or getattr(employee, "full_name", "")
            or getattr(employee, "email", "")
        ),
        "employee_number": _blank(getattr(profile, "employee_number", "") or getattr(profile, "employee_id", "")),
        "department": _blank(
            getattr(profile, "department_name_en", "")
            or getattr(profile, "department", "")
            or getattr(profile, "department_name_ar", "")
        ),
        "job_title": _blank(
            getattr(profile, "job_title_en", "")
            or getattr(profile, "job_title", "")
            or getattr(profile, "job_title_ar", "")
        ),
        "mobile_number": _blank(getattr(profile, "mobile", "")),
        "basic_salary": _format_money(getattr(profile, "basic_salary", None)),
        "loan_type": loan_type_label,
        "requested_amount": _format_money(getattr(instance, "requested_amount", None)),
        "installment_months": str(getattr(instance, "installment_months", "") or ""),
        "deduction_start_date": _target_deduction(instance),
        "payroll_reference": payroll_reference,
        "previous_loan_status": (str(previous.get_status_display()) if previous is not None else ""),
        "previous_loan_type": (
            LOAN_TYPE_LABELS.get(str(previous.loan_type), str(previous.loan_type)) if previous is not None else ""
        ),
        "previous_loan_value": (
            _format_money(previous.approved_amount or previous.requested_amount) if previous is not None else ""
        ),
        "previous_loan_end_date": _previous_loan_end(previous),
        "reason_details": _blank(getattr(instance, "reason", "")),
        "monthly_deduction": _monthly_deduction(instance),
    }
    for prefix, stage, actor_attr, date_attr, pending_status, recommendation_attr in stage_specs:
        actor = getattr(instance, actor_attr, None)
        decided_at = getattr(instance, date_attr, None)
        recommendation = getattr(instance, recommendation_attr, None) if recommendation_attr else None
        decision = _approval_decision(instance, stage, decided_at, pending_status, recommendation)
        values[f"{prefix}_approval_name" if prefix != "disbursement" else "disbursement_name"] = (
            _display_user(actor) if decided_at else ""
        )
        decision_key = f"{prefix}_approval_decision" if prefix != "disbursement" else "disbursement_status"
        date_key = f"{prefix}_approval_date" if prefix != "disbursement" else "disbursement_date"
        signature_key = f"{prefix}_signature" if prefix != "disbursement" else "disbursement_signature"
        values[decision_key] = decision
        values[date_key] = _format_date(decided_at)
        # A typed audit acknowledgement is not a scanned signature, but it stays in its own row.
        values[signature_key] = _display_user(actor) if decided_at else ""
    return values


def build_loan_request_signers(instance: Any) -> dict[str, Any]:
    """Return ``{map_field: recorded_actor}`` for the five approval columns.

    Only a stage the workflow actually completed contributes a signer; an
    outstanding stage maps to ``None`` so the box stays blank and the renderer
    records the gap.
    """

    return {
        f"{stage}_signature_image": (
            getattr(instance, actor_attr, None) if getattr(instance, date_attr, None) else None
        )
        for stage, actor_attr, date_attr in SIGNATURE_STAGES
    }


def build_loan_request_pdf(instance: Any, fallback: Callable[[Any], bytes]) -> bytes:
    """Build the mapped form, falling back only when its paired asset is absent."""

    assets = load_loan_form_assets()
    if assets is None:
        return fallback(instance)
    signatures = signer_signatures(build_loan_request_signers(instance))
    try:
        pdf_bytes, diagnostics = render_mapped_form(assets, build_loan_request_values(instance), signatures=signatures)
    except ValueError:
        # A template that carries no pages cannot be overlaid safely.
        return fallback(instance)
    log_signature_diagnostics(FORM_KEY, getattr(instance, "id", None), diagnostics)
    return pdf_bytes
