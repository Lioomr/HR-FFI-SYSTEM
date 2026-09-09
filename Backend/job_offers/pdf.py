from io import BytesIO

from django.core.exceptions import ObjectDoesNotExist
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from core.pdf import font_pair, shape_ar
from core.pdf_forms import FormAssets, load_form_assets, log_signature_diagnostics, render_mapped_form
from core.pdf_signers import signer_signatures

from .models import JobOffer

FIELD_MAP_FILENAME = "job_offer_blank_field_map.json"
TEMPLATE_FILENAME = "job_offer_blank.pdf"
TEMPLATE_ALIASES = ["job-offer-template.pdf", "job_offer.pdf"]
FORM_KEY = "job_offer"

#: Without these the map cannot be describing the approved job offer form.
REQUIRED_FIELD_KEYS = frozenset(
    {
        "reference_no",
        "offer_date",
        "applicant_name",
        "nationality",
        "id_no",
        "position",
        "classification",
        "department",
        "work_location",
        "basic_salary",
        "housing_allowance",
        "transportation_allowance",
        "other_allowance",
        "total_paid_salary",
        "vacation_days",
        "tickets",
        "contract_status",
        "contract_type",
        "medical_insurance",
        "contract_duration",
        "hr_name",
        "hr_position",
        "applicant_decision",
        "rejection_reason",
        "applicant_name_acceptance",
        "applicant_decision_date",
    }
)


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
        "rejection_reason": offer.rejection_reason if offer.status == JobOffer.Status.REJECTED else "",
        "applicant_name_acceptance": (
            offer.candidate_full_name if offer.status in {JobOffer.Status.ACCEPTED, JobOffer.Status.REJECTED} else ""
        ),
        "applicant_decision": _decision_checkbox(offer),
        "applicant_decision_date": decision_date.date().isoformat() if decision_date else "",
    }


def _decision_checkbox(offer: JobOffer) -> str | None:
    """Return the map's own checkbox key for the candidate's recorded answer."""

    if offer.status == JobOffer.Status.ACCEPTED:
        return "agree"
    if offer.status == JobOffer.Status.REJECTED:
        return "reject"
    return None


def build_job_offer_signers(offer: JobOffer) -> dict[str, object]:
    """Return ``{map_field: recorded signer}`` for the offer's signature boxes.

    The applicant signs by accepting the offer, so their box is filled only once
    ``accepted_at`` is recorded and only from the employee profile linked to the
    offer. A candidate with no profile yet has no stored signature and the box
    stays blank rather than being filled with a stand-in.
    """

    try:
        hr_signer = offer.hr_signer_user
    except ObjectDoesNotExist:
        # An offer drafted without an HR signer has nobody to sign for it.
        hr_signer = None
    try:
        applicant = offer.employee_profile if offer.accepted_at else None
    except ObjectDoesNotExist:
        applicant = None
    return {
        "hr_signature_image": hr_signer,
        "applicant_signature": applicant,
    }


def _load_field_map() -> dict:
    assets = _load_form_assets()
    return assets.fields if assets else {}


def _load_form_assets() -> FormAssets | None:
    return load_form_assets(
        TEMPLATE_FILENAME,
        FIELD_MAP_FILENAME,
        aliases=TEMPLATE_ALIASES,
        required_keys=REQUIRED_FIELD_KEYS,
    )


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
    """Render the mapped offer, falling back only when its paired asset is absent."""

    assets = _load_form_assets()
    if assets is None:
        return _fallback_pdf(offer)
    signatures = signer_signatures(build_job_offer_signers(offer))
    try:
        pdf_bytes, diagnostics = render_mapped_form(assets, _field_values(offer), signatures=signatures)
    except ValueError:
        return _fallback_pdf(offer)
    log_signature_diagnostics(FORM_KEY, offer.id, diagnostics)
    return pdf_bytes
