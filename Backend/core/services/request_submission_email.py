from __future__ import annotations

import logging
from typing import Iterable

from django.conf import settings

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

    details_html = ""
    details_text = ""
    if details:
        safe_items = [str(item) for item in details if str(item).strip()]
        if safe_items:
            details_html = "<ul>" + "".join(f"<li>{item}</li>" for item in safe_items) + "</ul>"
            details_text = "\n".join(f"- {item}" for item in safe_items)

    action_url = _build_action_url(action_path)
    button_html = ""
    if action_url:
        button_html = (
            f'<p><a href="{action_url}" style="display:inline-block;padding:10px 14px;'
            'background:#f97316;color:#fff;text-decoration:none;border-radius:8px;">View Request</a></p>'
        )

    subject = f"{request_type} submitted - #{request_id}"
    html = (
        f"<h2>{request_type} submitted successfully</h2>"
        f"<p>Dear {employee_name},</p>"
        f"<p>Your request has been submitted and is now in <strong>{status_label}</strong>.</p>"
        f"<p><strong>Request ID:</strong> {request_id}</p>"
        f"{details_html}"
        f"{button_html}"
        "<p>If you did not submit this request, please contact HR immediately.</p>"
    )
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
