from dataclasses import dataclass
from datetime import date
from io import BytesIO
from typing import Any

from django.utils import timezone
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from core.pdf import font_pair, shape_ar
from core.pdf_forms import FormAssets, load_form_assets, log_signature_diagnostics, render_mapped_form
from core.pdf_signers import signer_signatures
from employees.models import EmployeeProfile

FIELD_MAP_FILENAME = "starting_work_acknowledgment_blank_field_map.json"
TEMPLATE_FILENAME = "starting_work_acknowledgment_blank.pdf"
TEMPLATE_ALIASES = ["starting-work-acknowledgment-template.pdf", "starting_work_acknowledgment.pdf"]
FORM_KEY = "starting_work_acknowledgment"

#: Without these the map cannot be describing the approved acknowledgment form.
REQUIRED_FIELD_KEYS = frozenset(
    {
        "reference_no",
        "document_date",
        "addressed_to",
        "employee_name",
        "employee_no",
        "job_title",
        "id_no",
        "department",
        "direct_superior",
        "direct_superior_signature",
        "work_start_status",
        "start_department",
        "start_day",
        "start_month",
        "start_year",
        "general_manager_name",
        "general_manager_date",
        "general_manager_signature_image",
        "details_approver_name",
        "details_approver_date",
        "details_approver_signature_image",
        "not_started_reason",
        "not_started_name",
        "not_started_signature",
        "not_started_date",
    }
)


@dataclass(frozen=True)
class StartingWorkAcknowledgmentData:
    """Form inputs. The ``*_user`` fields are the recorded workflow actors whose
    stored signature (when they have one) may be placed in the mapped box."""

    reference_no: str = ""
    document_date: date | None = None
    addressed_to: str = "Human Resources Department"
    direct_superior: str = ""
    direct_superior_user: Any = None
    work_start_status: str = "started"
    start_department: str = ""
    start_date: date | None = None
    general_manager_name: str = ""
    general_manager_date: date | None = None
    general_manager_user: Any = None
    details_approver_name: str = ""
    details_approver_date: date | None = None
    details_approver_user: Any = None
    not_started_reason: str = ""
    not_started_name: str = ""
    not_started_user: Any = None
    not_started_date: date | None = None


def _date_text(value: date | None) -> str:
    return value.isoformat() if value else ""


def _profile_name(profile: EmployeeProfile) -> str:
    return profile.full_name_en or profile.full_name or profile.full_name_ar or ""


def _direct_superior_name(profile: EmployeeProfile) -> str:
    if profile.manager_profile_id:
        manager = profile.manager_profile
        return manager.full_name_en or manager.full_name or manager.full_name_ar or manager.employee_id
    if profile.manager_id:
        manager = profile.manager
        return getattr(manager, "full_name", "") or getattr(manager, "email", "")
    return ""


def starting_work_field_values(profile: EmployeeProfile, data: StartingWorkAcknowledgmentData) -> dict[str, str]:
    document_date = data.document_date or timezone.localdate()
    status = data.work_start_status.lower().strip()
    if status not in {"started", "not_started"}:
        raise ValueError("work_start_status must be 'started' or 'not_started'.")

    start_date = data.start_date or profile.hire_date
    started = status == "started"
    not_started = status == "not_started"
    reference_no = data.reference_no or f"SWA-{profile.employee_id}-{document_date:%Y%m%d}"
    return {
        "reference_no": reference_no,
        "work_start_status": status,
        "document_date": _date_text(document_date),
        "addressed_to": data.addressed_to,
        "employee_name": _profile_name(profile),
        "employee_no": profile.employee_id,
        "job_title": profile.job_title_en or profile.job_title or profile.job_title_ar or "",
        "id_no": profile.national_id or profile.passport_no or "",
        "department": profile.department_name_en or profile.department or profile.department_name_ar or "",
        "direct_superior": data.direct_superior or _direct_superior_name(profile),
        "start_department": (data.start_department or profile.department_name_en or profile.department or "")
        if started
        else "",
        "start_day": f"{start_date.day:02d}" if started and start_date else "",
        "start_month": f"{start_date.month:02d}" if started and start_date else "",
        "start_year": str(start_date.year) if started and start_date else "",
        "general_manager_name": data.general_manager_name,
        "general_manager_date": _date_text(data.general_manager_date),
        "details_approver_name": data.details_approver_name,
        "details_approver_date": _date_text(data.details_approver_date),
        "not_started_reason": data.not_started_reason if not_started else "",
        "not_started_name": data.not_started_name if not_started else "",
        "not_started_date": _date_text(data.not_started_date) if not_started else "",
    }


def build_starting_work_signers(data: StartingWorkAcknowledgmentData) -> dict[str, Any]:
    """Return ``{map_field: recorded_actor}`` for the acknowledgment's signatures.

    Only the "not started" branch signs the bottom block, so the other slot is
    left empty for that state and vice versa.
    """

    not_started = data.work_start_status.lower().strip() == "not_started"
    return {
        "direct_superior_signature": data.direct_superior_user,
        "general_manager_signature_image": data.general_manager_user,
        "details_approver_signature_image": data.details_approver_user,
        "not_started_signature": data.not_started_user if not_started else None,
    }


def load_starting_work_form_assets() -> FormAssets | None:
    return load_form_assets(
        TEMPLATE_FILENAME,
        FIELD_MAP_FILENAME,
        aliases=TEMPLATE_ALIASES,
        required_keys=REQUIRED_FIELD_KEYS,
    )


def _fallback_pdf(profile: EmployeeProfile, data: StartingWorkAcknowledgmentData) -> bytes:
    output = BytesIO()
    _, height = A4
    pdf = canvas.Canvas(output, pagesize=A4)
    regular, bold = font_pair()
    values = starting_work_field_values(profile, data)
    pdf.setFont(bold, 12)
    pdf.drawString(42, height - 46, f"Starting Work Acknowledgment {values['reference_no']}")
    y = height - 74
    fallback_keys = [
        "employee_name",
        "employee_no",
        "job_title",
        "department",
        "direct_superior",
        "details_approver_name",
        "details_approver_date",
    ]
    if data.work_start_status.lower().strip() == "not_started":
        fallback_keys.extend(["not_started_reason", "not_started_name", "not_started_date"])
    for key in fallback_keys:
        pdf.setFont(bold, 8)
        pdf.drawString(42, y, f"{key.replace('_', ' ').title()}:")
        pdf.setFont(regular, 8)
        pdf.drawString(160, y, shape_ar(values[key])[:85])
        y -= 17
    pdf.save()
    return output.getvalue()


def build_starting_work_acknowledgment_pdf(
    profile: EmployeeProfile,
    data: StartingWorkAcknowledgmentData | None = None,
) -> bytes:
    """Render the mapped acknowledgment, falling back when its pair is absent."""

    data = data or StartingWorkAcknowledgmentData(start_date=profile.hire_date)
    values = starting_work_field_values(profile, data)
    assets = load_starting_work_form_assets()
    if assets is None:
        return _fallback_pdf(profile, data)
    signatures = signer_signatures(build_starting_work_signers(data))
    try:
        pdf_bytes, diagnostics = render_mapped_form(assets, values, signatures=signatures)
    except ValueError:
        return _fallback_pdf(profile, data)
    log_signature_diagnostics(FORM_KEY, values["reference_no"], diagnostics)
    return pdf_bytes
