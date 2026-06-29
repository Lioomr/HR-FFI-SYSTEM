from datetime import date, datetime

from core.services.whatsapp_service import WhatsAppService
from employees.models import EmployeeProfile


def _normalize_phone(raw_mobile: str | None) -> str:
    mobile = (raw_mobile or "").strip()
    if not mobile:
        return ""
    # Keep only digits and a leading plus if provided.
    cleaned = "".join(ch for ch in mobile if ch.isdigit() or ch == "+")
    if not cleaned:
        return ""
    if cleaned.startswith("+"):
        return cleaned
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


def _delivery_failure(reason: str) -> dict:
    return {
        "sent": False,
        "success": False,
        "provider": "evolution_whatsapp",
        "status_code": None,
        "message_id": None,
        "error": reason,
        "reason": reason,
    }


def _delivery_from_provider_result(result: dict) -> dict:
    error = result.get("error")
    sent = bool(result.get("success"))
    return {
        "sent": sent,
        "success": sent,
        "provider": result.get("provider", "evolution_whatsapp"),
        "status_code": result.get("status_code"),
        "message_id": result.get("message_id"),
        "error": error,
        "reason": error,
        "template_key": "document_expiry_reminder",
    }


def send_document_expiry_whatsapp(profile: EmployeeProfile, documents: list[dict], language: str = "en") -> dict:
    if not profile.mobile:
        return _delivery_failure("No mobile number on employee profile.")

    if not documents:
        return _delivery_failure("No expiring documents payload supplied.")

    service = WhatsAppService()
    employee_name = profile.full_name or profile.employee_id or "Employee"
    phone_number = _normalize_phone(profile.mobile)
    if not phone_number:
        return _delivery_failure("Invalid employee mobile number.")
    results = []

    for document in documents:
        result = service.send_template_message(
            phone_number=phone_number,
            template_name="document_expiry_reminder",
            language=language,
            template_variables={
                "employee_name": employee_name,
                "document_type": document.get("label") or document.get("doc_type") or "Document",
                "expiry_date": _format_expiry_date(document.get("expiry_date")),
            },
        )
        results.append(_delivery_from_provider_result(result))

    sent_count = sum(1 for r in results if r.get("sent"))
    if len(results) == 1:
        return {
            **results[0],
            "count": sent_count,
            "total": 1,
            "results": results,
        }

    if sent_count == len(results):
        return {
            "sent": True,
            "success": True,
            "provider": "evolution_whatsapp",
            "count": sent_count,
            "total": len(results),
            "results": results,
        }

    return {
        "sent": sent_count > 0,
        "success": sent_count > 0,
        "provider": "evolution_whatsapp",
        "count": sent_count,
        "total": len(results),
        "results": results,
    }
