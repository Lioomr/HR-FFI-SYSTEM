from datetime import date, datetime

from employees.models import EmployeeProfile
from core.whatsapp_service import BirdWhatsAppTemplateService


def _normalize_phone_for_bird(raw_mobile: str | None) -> str:
    mobile = (raw_mobile or "").strip()
    if not mobile:
        return ""
    # Keep only digits and a leading plus if provided.
    cleaned = "".join(ch for ch in mobile if ch.isdigit() or ch == "+")
    if not cleaned:
        return ""
    if cleaned.startswith("+"):
        return cleaned
    # Bird requires E.164; assume missing '+' only.
    return f"+{cleaned}"


def _format_expiry_date(value) -> str:
    if isinstance(value, date):
        return value.strftime("%d-%m-%Y")
    text = str(value or "").strip()
    if not text:
        return ""
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, fmt).strftime("%d-%m-%Y")
        except ValueError:
            continue
    return text


def send_document_expiry_whatsapp(profile: EmployeeProfile, documents: list[dict], language: str = "en") -> dict:
    if not profile.mobile:
        return {"sent": False, "provider": "bird_whatsapp", "reason": "No mobile number on employee profile."}

    if not documents:
        return {"sent": False, "provider": "bird_whatsapp", "reason": "No expiring documents payload supplied."}

    service = BirdWhatsAppTemplateService()
    employee_name = profile.full_name or profile.employee_id or "Employee"
    phone_number = _normalize_phone_for_bird(profile.mobile)
    if not phone_number:
        return {"sent": False, "provider": "bird_whatsapp", "reason": "Invalid employee mobile number."}
    results = []

    for document in documents:
        result = service.send_template(
            phone_number=phone_number,
            template_key=None,
            language=language,
            variables={
                "employee_name": employee_name,
                "document_type": document.get("label") or document.get("doc_type") or "Document",
                "expiry_date": _format_expiry_date(document.get("expiry_date")),
            },
            context={
                "event": "document_expiry_reminder",
                "employee_profile_id": profile.id,
                "document_type": document.get("doc_type"),
            },
        )
        results.append(result)

    sent_count = sum(1 for r in results if r.get("sent"))
    if sent_count == len(results):
        return {"sent": True, "provider": "bird_whatsapp", "count": sent_count}

    return {
        "sent": sent_count > 0,
        "provider": "bird_whatsapp",
        "count": sent_count,
        "total": len(results),
        "results": results,
    }
