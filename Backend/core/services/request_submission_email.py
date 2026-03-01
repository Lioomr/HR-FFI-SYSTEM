from __future__ import annotations

import logging
from typing import Iterable

from django.conf import settings
from django.template.loader import render_to_string

from .bird_email_service import _load_logo_base64
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
    if not to_email:
        return {"success": False, "error": "Recipient email is missing."}

    action_url = _build_action_url(action_path)
    subject = f"{request_type} submitted - #{request_id}"

    context = {
        "logo_url": _load_logo_base64(),
        "contact_email": getattr(settings, "EMAIL_CONTACT_EMAIL", "hr@fficontracting.com"),
        "title": f"{request_type} submitted successfully",
        "title_ar": f"تم تقديم طلب {request_type} بنجاح",
        "employee_name": employee_name,
        "message": f"Your request has been submitted and is now in {status_label}.",
        "message_ar": f"تم تقديم طلبك بنجاح وهو الآن في حالة {status_label}.",
        "request_type": request_type,
        "request_id": request_id,
        "status_label": status_label,
        "details": details,
        "action_url": action_url,
        "action_text": "View Request",
        "action_text_ar": "عرض الطلب",
    }
    
    html = render_to_string("emails/request_submission_email.html", context)
    details_list = [str(item) for item in (details or [])]
    details_text = "\n".join(f"- {item}" for item in details_list) if details_list else "-"

    text = (
        f"{request_type} submitted successfully.\n"
        f"Request ID: {request_id}\n"
        f"Status: {status_label}\n"
        f"{details_text}\n"
    )

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
