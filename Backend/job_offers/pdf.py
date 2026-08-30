from io import BytesIO

from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from core.pdf import font_pair, shape_ar
from core.views_templates import resolve_template_path

from .document_pdf import draw_checkbox, draw_mapped_value, load_document_field_map
from .models import JobOffer


def _money(value) -> str:
    return f"{value:,.2f}"


def _field_values(offer: JobOffer) -> dict[str, str]:
    decision_date = offer.accepted_at or offer.rejected_at
    return {
        "reference_no": offer.reference_number,
        "offer_date": offer.offer_date.isoformat(),
        "applicant_name": offer.candidate_full_name,
        "nationality": offer.nationality,
        "id_no": offer.id_passport_iqama_number,
        "position": offer.position_title,
        "classification": offer.classification,
        "department": offer.department,
        "work_location": offer.location,
        "basic_salary": _money(offer.basic_salary),
        "housing_allowance": _money(offer.housing_allowance),
        "transportation_allowance": _money(offer.transportation_allowance),
        "other_allowance": _money(offer.other_allowance),
        "other_salary_item": "",
        "total_paid_salary": _money(offer.total_salary_package),
        "vacation_days": offer.vacation,
        "tickets": offer.tickets,
        "contract_status": offer.contract_status,
        "contract_type": offer.contract_type,
        "medical_insurance": offer.medical_insurance,
        "contract_duration": offer.contract_duration,
        "hr_name": offer.hr_signer_name,
        "hr_position": offer.hr_signer_title,
        "hr_signature": "",
        "rejection_reason": offer.rejection_reason if offer.status == JobOffer.Status.REJECTED else "",
        "applicant_name_acceptance": (
            offer.candidate_full_name if offer.status in {JobOffer.Status.ACCEPTED, JobOffer.Status.REJECTED} else ""
        ),
        "applicant_signature": "",
        "applicant_decision_date": decision_date.date().isoformat() if decision_date else "",
    }


def _load_field_map() -> dict:
    return load_document_field_map("job_offer", "job_offer_blank_field_map.json")


def _draw_offer_overlay_from_map(pdf: canvas.Canvas, offer: JobOffer, field_map: dict) -> None:
    regular, _ = font_pair()
    for key, value in _field_values(offer).items():
        field = field_map.get(key)
        if not field or "x" not in field:
            continue
        draw_mapped_value(pdf, field, value, font=regular)

    decision = field_map.get("applicant_decision", {}).get("checkboxes", {})
    checkbox = None
    if offer.status == JobOffer.Status.ACCEPTED:
        checkbox = decision.get("agree")
    elif offer.status == JobOffer.Status.REJECTED:
        checkbox = decision.get("reject")
    draw_checkbox(pdf, checkbox, font=regular)


def _fallback_rows(offer: JobOffer) -> list[tuple[str, str]]:
    return [
        ("Candidate", offer.candidate_full_name),
        ("Position", offer.position_title),
        ("Department", offer.department),
        ("Location", offer.location),
        ("Classification", offer.classification),
        ("Basic salary", _money(offer.basic_salary)),
        ("Housing allowance", _money(offer.housing_allowance)),
        ("Transportation allowance", _money(offer.transportation_allowance)),
        ("Other allowance", _money(offer.other_allowance)),
        ("Total package", _money(offer.total_salary_package)),
        ("Vacation", offer.vacation),
        ("Tickets", offer.tickets),
        ("Contract status", offer.contract_status),
        ("Contract type", offer.contract_type),
        ("Contract duration", offer.contract_duration),
        ("Medical insurance", offer.medical_insurance),
        ("HR signer", offer.hr_signer_name),
        ("HR title", offer.hr_signer_title),
        ("Offer date", offer.offer_date.isoformat()),
        ("Expiry date", offer.expiry_date.isoformat()),
        ("Rejection reason", offer.rejection_reason if offer.status == JobOffer.Status.REJECTED else ""),
        ("Status", offer.get_status_display()),
    ]


def _draw_fallback(pdf: canvas.Canvas, offer: JobOffer, *, height: float) -> None:
    regular, bold = font_pair()
    pdf.setFont(bold, 12)
    pdf.drawString(42, height - 46, f"Job Offer {offer.reference_number}")
    y = height - 72
    for label, value in _fallback_rows(offer):
        if not value:
            continue
        pdf.setFont(bold, 8)
        pdf.drawString(42, y, f"{label}:")
        pdf.setFont(regular, 8)
        pdf.drawString(150, y, shape_ar(str(value))[:120])
        y -= 16
        if y < 64:
            break


def _fallback_pdf(offer: JobOffer) -> bytes:
    output = BytesIO()
    _, height = A4
    pdf = canvas.Canvas(output, pagesize=A4)
    _draw_fallback(pdf, offer, height=height)
    pdf.save()
    return output.getvalue()


def build_job_offer_pdf(offer: JobOffer) -> bytes:
    template_path = resolve_template_path("job_offer_blank.pdf", aliases=["job-offer-template.pdf", "job_offer.pdf"])
    field_map = _load_field_map()
    if not template_path or not field_map:
        return _fallback_pdf(offer)

    template = PdfReader(template_path)
    if not template.pages:
        return _fallback_pdf(offer)
    writer = PdfWriter()
    writer.add_page(template.pages[0])
    page = writer.pages[0]
    width = float(page.mediabox.width)
    height = float(page.mediabox.height)
    overlay = BytesIO()
    pdf = canvas.Canvas(overlay, pagesize=(width, height))
    _draw_offer_overlay_from_map(pdf, offer, field_map)
    pdf.save()
    overlay.seek(0)
    # Start from the original page, then layer the data onto it. Constructing a
    # writer with clone_from can lose the template's artwork for this form,
    # leaving only the values visible in some PDF viewers.
    page.merge_page(PdfReader(overlay).pages[0])

    output = BytesIO()
    writer.write(output)
    return output.getvalue()
