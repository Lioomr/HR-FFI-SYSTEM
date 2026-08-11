from datetime import date, datetime, timedelta

from django.contrib.auth import get_user_model
from django.db.models import Q
from django.utils import timezone

from audit.utils import audit
from core.services.bird_email_service import send_document_expiry_reminder_email
from core.services.whatsapp_service import WhatsAppService
from employees.models import EmployeeProfile
from in_app_notifications.dispatcher import dispatch_notification_channels
from in_app_notifications.models import Notification

User = get_user_model()
WORK_LICENSE_NOTIFICATION_DAYS = 10


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


def notify_document_expiry_in_app(
    profile: EmployeeProfile,
    documents: list[dict],
    *,
    whatsapp_enabled: bool = True,
    email_enabled: bool = True,
) -> list:
    dispatches = []
    for document in documents:
        expiry_date = str(document.get("expiry_date") or "")
        document_type = document.get("document_type") or document.get("doc_type")
        dispatch = dispatch_notification_channels(
            recipient=getattr(profile, "user", None),
            company=profile.company,
            event_key="document.expiring",
            title="Document expiry reminder",
            message=f"{document.get('label') or document_type or 'Document'} expires on {expiry_date}.",
            category=Notification.Category.DOCUMENT,
            action_url="/employee/profile",
            related_object=profile,
            metadata={
                "document_type": document_type,
                "expiry_date": expiry_date,
                "days_left": document.get("days_left"),
            },
            deduplication_key=f"document.expiring:{profile.id}:{document_type}:{expiry_date}",
            whatsapp_template="document_expiry_reminder",
            whatsapp_variables={
                "employee_name": profile.full_name or profile.employee_id or "Employee",
                "document_type": document.get("label") or document_type or "Document",
                "expiry_date": _format_expiry_date(document.get("expiry_date")),
            },
            email_template=send_document_expiry_reminder_email,
            email_context={
                "employee_name": profile.full_name or profile.employee_id,
                "document_type": document.get("label") or document_type or "Document",
                "expiry_date": document.get("expiry_date"),
                "days_remaining": document.get("days_left"),
            },
            whatsapp_enabled=whatsapp_enabled,
            email_enabled=email_enabled,
        )
        dispatches.append(dispatch)
    return dispatches


def _hr_recipients_for_company(company_id):
    company_filter = Q(employee_profile__company_id=company_id) | Q(
        organization_access_entries__organization_id=company_id
    )
    return User.objects.filter(is_active=True, groups__name="HRManager").filter(company_filter).distinct()


def notify_expiring_work_licenses(*, today=None) -> dict:
    """Queue one WhatsApp reminder per HR recipient and work-license expiry date."""
    today = today or timezone.localdate()
    cutoff_date = today + timedelta(days=WORK_LICENSE_NOTIFICATION_DAYS)
    profiles = EmployeeProfile.objects.filter(
        is_archived=False,
        work_license_expiry__range=(today, cutoff_date),
    ).select_related("company")

    queued = 0
    duplicates = 0
    for profile in profiles:
        expiry_date = profile.work_license_expiry.isoformat()
        deduplication_key = f"document.expiring:{profile.id}:WORK_LICENSE:{expiry_date}"
        for recipient in _hr_recipients_for_company(profile.company_id):
            dispatch = dispatch_notification_channels(
                recipient=recipient,
                company=profile.company,
                event_key="document.expiring",
                title="Work license expiry reminder",
                message=f"{profile.full_name or profile.employee_id}'s work license expires on {expiry_date}.",
                category=Notification.Category.DOCUMENT,
                action_url="/hr/employees/expiries",
                related_object=profile,
                metadata={
                    "employee_profile_id": profile.id,
                    "employee_id": profile.employee_id,
                    "employee_name": profile.full_name,
                    "document_type": "WORK_LICENSE",
                    "expiry_date": expiry_date,
                    "days_left": (profile.work_license_expiry - today).days,
                },
                deduplication_key=deduplication_key,
                whatsapp_template="document_expiry_reminder",
                whatsapp_variables={
                    "employee_name": profile.full_name or profile.employee_id or "Employee",
                    "document_type": "Work License",
                    "expiry_date": _format_expiry_date(profile.work_license_expiry),
                },
                whatsapp_enabled=True,
                email_enabled=False,
                redeliver_existing=False,
            )
            if not dispatch.get("created"):
                duplicates += 1
                continue
            queued += 1
            audit(
                None,
                action="employee_work_license_expiry_whatsapp_queued",
                entity="EmployeeProfile",
                entity_id=profile.id,
                metadata={
                    "recipient_user_id": recipient.id,
                    "document_type": "WORK_LICENSE",
                    "expiry_date": expiry_date,
                    "days_left": (profile.work_license_expiry - today).days,
                },
            )

    return {"queued": queued, "duplicates": duplicates, "employees": profiles.count()}


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
