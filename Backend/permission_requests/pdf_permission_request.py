"""Mapped renderer for the bilingual exit permission request PDF.

The blank form and ``exit_permission_request_blank_field_map.json`` are one
deployable pair; coordinates live only in that map. The form has exactly two
approval panels - Direct Manager and HR Department - and no CEO section, so this
module never produces a CEO value or signature.
"""

from __future__ import annotations

from typing import Any

from django.utils import timezone

from core.pdf_forms import FormAssets, load_form_assets, log_signature_diagnostics, render_mapped_form
from core.pdf_signers import display_name, signer_signatures

from .labels import EXIT_TYPE_LABELS, STATUS_LABELS, profile_department, profile_employee_number, profile_job_title

TEMPLATE_FILENAME = "exit_permission_request_blank.pdf"
FIELD_MAP_FILENAME = "exit_permission_request_blank_field_map.json"
FORM_KEY = "permission_request"

REQUIRED_FIELD_KEYS = frozenset(
    {
        "reference_no",
        "request_date",
        "employee_name",
        "employee_id",
        "department",
        "job_title",
        "direct_manager",
        "exit_date",
        "from_time",
        "to_time",
        "exit_type",
        "justification",
        "employee_signature_image",
        "employee_signature_date",
        "manager_decision",
        "manager_name",
        "manager_signature_image",
        "manager_signature_date",
        "hr_notes",
        "hr_name",
        "hr_signature_image",
        "hr_signature_date",
    }
)

#: Approval stage -> (recorded actor attribute, decision timestamp attribute).
SIGNATURE_STAGES = (
    ("manager", "manager_decision_by", "manager_decision_at"),
    ("hr", "hr_decision_by", "hr_decision_at"),
)


def load_permission_form_assets() -> FormAssets | None:
    """Resolve the template and the map deployed beside it, or ``None`` when the pair is broken."""

    return load_form_assets(TEMPLATE_FILENAME, FIELD_MAP_FILENAME, required_keys=REQUIRED_FIELD_KEYS)


def _format_date(value: Any) -> str:
    if not value:
        return ""
    if hasattr(value, "hour"):
        value = timezone.localtime(value)
    return value.strftime("%Y-%m-%d")


def _format_time(value: Any) -> str:
    return value.strftime("%H:%M") if value else ""


def _decided_actor(instance: Any, actor_attr: str, at_attr: str) -> Any:
    return getattr(instance, actor_attr, None) if getattr(instance, at_attr, None) else None


def _direct_manager_name(instance: Any) -> str:
    """The manager who decided; before a decision, the currently valid direct manager."""

    decided_by = _decided_actor(instance, "manager_decision_by", "manager_decision_at")
    if decided_by is not None:
        return display_name(user=decided_by)
    try:
        from employees.services.manager_relationships import get_valid_direct_manager_profile

        manager_profile = get_valid_direct_manager_profile(getattr(instance, "employee_profile", None))
    except Exception:
        # A detached instance simply has no resolvable manager.
        manager_profile = None
    return display_name(profile=manager_profile) if manager_profile is not None else ""


def build_permission_request_values(instance: Any) -> dict[str, Any]:
    """Values for every mapped text and checkbox field; an undecided stage stays blank."""

    profile = getattr(instance, "employee_profile", None)
    employee = getattr(instance, "employee", None)
    manager = _decided_actor(instance, "manager_decision_by", "manager_decision_at")
    hr = _decided_actor(instance, "hr_decision_by", "hr_decision_at")
    manager_decided = bool(getattr(instance, "manager_decision_at", None))
    hr_decided = bool(getattr(instance, "hr_decision_at", None))
    request_date = getattr(instance, "request_date", None)
    return {
        "reference_no": getattr(instance, "reference_no", "") or "",
        "request_date": _format_date(request_date),
        "employee_name": display_name(user=employee, profile=profile),
        "employee_id": profile_employee_number(profile),
        "department": profile_department(profile),
        "job_title": profile_job_title(profile),
        "direct_manager": _direct_manager_name(instance),
        "exit_date": _format_date(request_date),
        "from_time": _format_time(getattr(instance, "from_time", None)),
        "to_time": _format_time(getattr(instance, "to_time", None)),
        "exit_type": getattr(instance, "exit_type", None) or None,
        "justification": getattr(instance, "reason", "") or "",
        "employee_signature_date": _format_date(getattr(instance, "created_at", None)),
        # A decision box is ticked only for a stage that was actually decided.
        "manager_decision": (getattr(instance, "manager_decision", None) or None) if manager_decided else None,
        "manager_name": display_name(user=manager) if manager is not None else "",
        "manager_signature_date": _format_date(getattr(instance, "manager_decision_at", None)),
        "hr_notes": (getattr(instance, "hr_decision_note", "") or "") if hr_decided else "",
        "hr_name": display_name(user=hr) if hr is not None else "",
        # Dated by the HR decision itself; this workflow has no later completion step.
        "hr_signature_date": _format_date(getattr(instance, "hr_decision_at", None)),
    }


def build_permission_request_signers(instance: Any) -> dict[str, Any]:
    """Return ``{map_field: recorded_signer}``.

    The requester signs by submitting. An approval panel is signed only by the
    actor the request recorded for that stage - never by whoever downloads the
    PDF - and an undecided stage maps to ``None`` so its box stays blank.
    """

    signers = {
        "employee_signature_image": getattr(instance, "employee_profile", None) or getattr(instance, "employee", None)
    }
    for stage, actor_attr, at_attr in SIGNATURE_STAGES:
        signers[f"{stage}_signature_image"] = _decided_actor(instance, actor_attr, at_attr)
    return signers


def build_permission_request_pdf_fallback(instance: Any) -> bytes:
    """Generic request document, used only when the template/map pair cannot be resolved."""

    from core.pdf import ApprovalStage, DetailRow, EmployeeBlock, ExtraSection, RequestDocument, render_request_pdf

    values = build_permission_request_values(instance)
    status_en = STATUS_LABELS.get(getattr(instance, "status", ""), (str(getattr(instance, "status", "")),))[0]
    exit_type = getattr(instance, "exit_type", "")
    exit_en, exit_ar = EXIT_TYPE_LABELS.get(exit_type, (str(exit_type), str(exit_type)))

    def stage(title_en, title_ar, name, date, note=""):
        return ApprovalStage(stage_en=title_en, stage_ar=title_ar, actor=name or "-", at=date or "-", note=note or "-")

    document = RequestDocument(
        title_en="Exit Permission Request",
        title_ar="طلب استئذان أثناء الدوام الرسمي",
        reference_no=values["reference_no"] or "-",
        employee=EmployeeBlock(
            name=values["employee_name"] or "-",
            employee_number=values["employee_id"] or "-",
            department=values["department"] or "-",
            job_title=values["job_title"] or "-",
        ),
        details=[
            DetailRow("Exit Date", "تاريخ الاستئذان", values["exit_date"] or "-"),
            DetailRow("From", "من الساعة", values["from_time"] or "-"),
            DetailRow("To", "إلى الساعة", values["to_time"] or "-"),
            DetailRow("Duration", "المدة", f"{getattr(instance, 'duration_minutes', '')} min"),
            DetailRow("Exit Type", "نوع الاستئذان", f"{exit_en} / {exit_ar}"),
            DetailRow("Current Status", "الحالة الحالية", status_en),
        ],
        approvals=[
            stage(
                "Direct Manager",
                "المدير المباشر",
                values["manager_name"],
                values["manager_signature_date"],
                getattr(instance, "manager_decision_note", ""),
            ),
            stage(
                "HR Department",
                "إدارة الموارد البشرية",
                values["hr_name"],
                values["hr_signature_date"],
                values["hr_notes"],
            ),
        ],
        extra=[ExtraSection(title_en="Justification", title_ar="المبررات", body=values["justification"] or "-")],
        status_label=status_en,
    )
    return render_request_pdf(document)


def build_permission_request_pdf(instance: Any) -> bytes:
    """Build the mapped form, falling back only when its paired asset is absent."""

    assets = load_permission_form_assets()
    if assets is None:
        return build_permission_request_pdf_fallback(instance)
    signatures = signer_signatures(build_permission_request_signers(instance))
    try:
        pdf_bytes, diagnostics = render_mapped_form(
            assets, build_permission_request_values(instance), signatures=signatures
        )
    except ValueError:
        # A template that carries no pages cannot be overlaid safely.
        return build_permission_request_pdf_fallback(instance)
    log_signature_diagnostics(FORM_KEY, getattr(instance, "id", None), diagnostics)
    return pdf_bytes
