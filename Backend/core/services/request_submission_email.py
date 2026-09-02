from __future__ import annotations

import logging
from typing import Iterable

from django.conf import settings
from django.template.loader import render_to_string

from .bird_email_service import _resolve_logo_source
from .email_service import EmailService

logger = logging.getLogger(__name__)


def _build_action_url(action_path: str | None) -> str | None:
    if not action_path:
        return None
    base = (getattr(settings, "FRONTEND_URL", "") or "").rstrip("/")
    path = action_path if action_path.startswith("/") else f"/{action_path}"
    if not base:
        return None
    return f"{base}{path}"


def _send_request_submission_email_provider(
    *,
    to_email: str | None,
    employee_name: str,
    request_type: str,
    request_id: int | str,
    status_label: str,
    details: Iterable[str] | None = None,
    action_path: str | None = None,
) -> dict:
    if not to_email:
        return {"success": False, "error": "Recipient email is missing."}

    action_url = _build_action_url(action_path)
    subject = f"{request_type} submitted - #{request_id}"

    message = f"Your {request_type} request (#{request_id}) has been submitted and is now {status_label}."
    message_ar = f"تم تقديم طلب {request_type} (رقم {request_id}) بنجاح وهو الآن في حالة: {status_label}."
    context = {
        "logo_url": _resolve_logo_source(),
        "contact_email": getattr(settings, "EMAIL_CONTACT_EMAIL", "hr@fficontracting.com"),
        "contact_name": getattr(settings, "EMAIL_CONTACT_NAME", "") or "",
        "contact_phone": getattr(settings, "EMAIL_CONTACT_PHONE", "") or "",
        "title": f"{request_type} submitted successfully",
        "title_ar": f"تم تقديم طلب {request_type} بنجاح",
        "employee_name": employee_name,
        "message": message,
        "message_ar": message_ar,
        "preheader": message,
        "preheader_ar": message_ar,
        "rows": [
            {"label": "Request ID", "label_ar": "رقم الطلب", "value": f"#{request_id}"},
            {"label": "Status", "label_ar": "الحالة", "value": status_label},
            *(
                {"label": "Detail", "label_ar": "تفصيل", "value": str(item)}
                for item in (details or [])
            ),
        ],
        "details_title": f"{request_type} details",
        "details_title_ar": "تفاصيل الطلب",
        "status_label": "Submitted",
        "status_label_ar": "تم التقديم",
        "status_color": "#1d4ed8",
        "action_url": action_url,
        "action_text": "View Request",
        "action_text_ar": "عرض الطلب",
    }

    html = render_to_string("emails/generic_notification.html", context)
    details_list = [str(item) for item in (details or [])]
    details_text = "\n".join(f"- {item}" for item in details_list) if details_list else "-"

    text = f"{request_type} submitted successfully.\nRequest ID: {request_id}\nStatus: {status_label}\n{details_text}\n"

    service = EmailService()
    try:
        result = service.send_html_email(
            to_email=to_email,
            subject=subject,
            html_content=html,
            fallback_text=text,
        )
        if result.get("success"):
            logger.info(
                "request_submission_email_sent",
                extra={
                    "to_email": to_email,
                    "request_type": request_type,
                    "request_id": str(request_id),
                    "message_id": result.get("message_id"),
                    "status_code": result.get("status_code"),
                },
            )
        else:
            logger.error(
                "request_submission_email_failed",
                extra={
                    "to_email": to_email,
                    "request_type": request_type,
                    "request_id": str(request_id),
                    "status_code": result.get("status_code"),
                    "error": result.get("error"),
                },
            )
        return result
    except Exception as exc:
        logger.exception("request_submission_email_failed", extra={"to_email": to_email, "request_type": request_type})
        return {"success": False, "error": str(exc)}


def send_request_submission_email(
    *,
    to_email: str | None,
    employee_name: str,
    request_type: str,
    request_id: int | str,
    status_label: str,
    details: Iterable[str] | None = None,
    action_path: str | None = None,
) -> dict:
    from in_app_notifications.integrations import notify_request_submitted_by_email

    dispatched = notify_request_submitted_by_email(
        to_email=to_email,
        request_type=request_type,
        request_id=request_id,
        status_label=status_label,
        details=details,
        action_path=action_path,
        email_template=_send_request_submission_email_provider,
        email_context={
            "employee_name": employee_name,
            "request_type": request_type,
            "request_id": request_id,
            "status_label": status_label,
            "details": details,
            "action_path": action_path,
        },
    )
    for channel in ("whatsapp", "email"):
        delivery = dispatched.get(channel) if isinstance(dispatched, dict) else None
        if delivery and delivery.get("status") == "sent":
            return {
                "success": True,
                "provider": delivery.get("provider"),
                "message_id": delivery.get("provider_message_id"),
                "dispatch": dispatched,
            }
    return {"success": False, "provider": "notification_dispatcher", "dispatch": dispatched}
