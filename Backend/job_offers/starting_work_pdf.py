from dataclasses import dataclass
from datetime import date
from io import BytesIO

from django.utils import timezone
from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from core.pdf import font_pair, shape_ar
from core.views_templates import resolve_template_path
from employees.models import EmployeeProfile

from .document_pdf import draw_checkbox, draw_mapped_value, load_document_field_map


@dataclass(frozen=True)
class StartingWorkAcknowledgmentData:
    reference_no: str = ""
    document_date: date | None = None
    addressed_to: str = "Human Resources Department"
    direct_superior: str = ""
    direct_superior_signature: str = ""
    work_start_status: str = "started"
    start_department: str = ""
    start_date: date | None = None
    general_manager_name: str = ""
    general_manager_date: date | None = None
    general_manager_signature: str = ""
    details_approver_name: str = ""
    details_approver_date: date | None = None
    details_approver_signature: str = ""
    not_started_reason: str = ""
    not_started_name: str = ""
    not_started_signature: str = ""
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
        "document_date": _date_text(document_date),
        "addressed_to": data.addressed_to,
        "employee_name": _profile_name(profile),
        "employee_no": profile.employee_id,
        "job_title": profile.job_title_en or profile.job_title or profile.job_title_ar or "",
        "id_no": profile.national_id or profile.passport_no or "",
        "department": profile.department_name_en or profile.department or profile.department_name_ar or "",
        "direct_superior": data.direct_superior or _direct_superior_name(profile),
        "direct_superior_signature": data.direct_superior_signature,
        "start_department": (data.start_department or profile.department_name_en or profile.department or "")
        if started
        else "",
        "start_day": f"{start_date.day:02d}" if started and start_date else "",
        "start_month": f"{start_date.month:02d}" if started and start_date else "",
        "start_year": str(start_date.year) if started and start_date else "",
        "general_manager_name": data.general_manager_name,
        "general_manager_date": _date_text(data.general_manager_date),
        "general_manager_signature": data.general_manager_signature,
        "details_approver_name": data.details_approver_name,
        "details_approver_date": _date_text(data.details_approver_date),
        "details_approver_signature": data.details_approver_signature,
        "not_started_reason": data.not_started_reason if not_started else "",
        "not_started_name": data.not_started_name if not_started else "",
        "not_started_signature": data.not_started_signature if not_started else "",
        "not_started_date": _date_text(data.not_started_date) if not_started else "",
    }


def _draw_overlay(
    pdf: canvas.Canvas,
    profile: EmployeeProfile,
    data: StartingWorkAcknowledgmentData,
    field_map: dict,
) -> None:
    regular, _ = font_pair()
    for key, value in starting_work_field_values(profile, data).items():
        field = field_map.get(key)
        if field and "x" in field:
            draw_mapped_value(pdf, field, value, font=regular)

    checkboxes = field_map.get("work_start_status", {}).get("checkboxes", {})
    draw_checkbox(pdf, checkboxes.get(data.work_start_status.lower().strip()), font=regular)


def _fallback_pdf(profile: EmployeeProfile, data: StartingWorkAcknowledgmentData) -> bytes:
    output = BytesIO()
    _, height = A4
    pdf = canvas.Canvas(output, pagesize=A4)
    regular, bold = font_pair()
    values = starting_work_field_values(profile, data)
    pdf.setFont(bold, 12)
    pdf.drawString(42, height - 46, f"Starting Work Acknowledgment {values['reference_no']}")
    y = height - 74
    for key in ("employee_name", "employee_no", "job_title", "department", "direct_superior"):
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
    data = data or StartingWorkAcknowledgmentData(start_date=profile.hire_date)
    template_path = resolve_template_path(
        "starting_work_acknowledgment_blank.pdf",
        aliases=["starting-work-acknowledgment-template.pdf", "starting_work_acknowledgment.pdf"],
    )
    field_map = load_document_field_map(
        "starting_work_acknowledgment", "starting_work_acknowledgment_blank_field_map.json"
    )
    if not template_path or not field_map:
        return _fallback_pdf(profile, data)

    writer = PdfWriter(clone_from=template_path)
    if not writer.pages:
        return _fallback_pdf(profile, data)
    page = writer.pages[0]
    width = float(page.mediabox.width)
    height = float(page.mediabox.height)
    overlay = BytesIO()
    pdf = canvas.Canvas(overlay, pagesize=(width, height))
    _draw_overlay(pdf, profile, data, field_map)
    pdf.save()
    overlay.seek(0)
    page.merge_page(PdfReader(overlay).pages[0])

    output = BytesIO()
    writer.write(output)
    return output.getvalue()
