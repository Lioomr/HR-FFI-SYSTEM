from __future__ import annotations

import logging
from typing import Iterable

from .messaging_providers import is_e164, mask_phone, normalize_phone_number
from .pending_approval_email import _build_action_url
from .whatsapp_service import WhatsAppService

logger = logging.getLogger(__name__)


def get_user_whatsapp_number(user) -> str:
    profile = getattr(user, "employee_profile", None)
    phone = normalize_phone_number(getattr(profile, "mobile", "") if profile else "")
    return phone if is_e164(phone) else ""


def get_profile_whatsapp_number(profile) -> str:
    phone = normalize_phone_number(getattr(profile, "mobile", "") if profile else "")
    return phone if is_e164(phone) else ""


def send_pending_approval_whatsapp(
    *,
    user,
    request_type: str,
    request_id: int | str,
    requester_name: str,
    status_label: str,
    details: Iterable[str] | None = None,
    action_path: str | None = None,
) -> dict:
    phone_number = get_user_whatsapp_number(user)
    if not phone_number:
        return {"success": False, "skipped": True, "error": "No valid WhatsApp phone number."}

    result = WhatsAppService().send_template_message(
        phone_number=phone_number,
        template_name="pending_approval",
        template_variables={
            "approver_name": getattr(user, "full_name", "") or getattr(user, "email", "") or "there",
            "request_type": request_type,
            "request_id": request_id,
            "requester_name": requester_name,
            "status_label": status_label,
            "details": [str(item) for item in (details or [])],
            "action_url": _build_action_url(action_path) or "",
        },
    )
    if not result.get("success"):
        logger.warning(
            "pending_approval_whatsapp_failed",
            extra={
                "request_type": request_type,
                "request_id": str(request_id),
                "recipient": mask_phone(phone_number),
                "error": (result.get("error") or "")[:300],
            },
        )
    return result


def send_user_invite_whatsapp(
    *,
    phone_number: str,
    role: str,
    invite_link: str,
    expires_in_hours: int,
    inviter_name: str | None = None,
) -> dict:
    normalized_phone = normalize_phone_number(phone_number)
    if not is_e164(normalized_phone):
        return {"success": False, "skipped": True, "error": "No valid WhatsApp phone number."}

    result = WhatsAppService().send_template_message(
        phone_number=normalized_phone,
        template_name="employee_invitation",
        template_variables={
            "role": role,
            "invite_link": invite_link,
            "expires_in_hours": expires_in_hours,
            "inviter_name": inviter_name or "",
        },
    )
    if not result.get("success"):
        logger.warning(
            "employee_invitation_whatsapp_failed",
            extra={
                "role": role,
                "recipient": mask_phone(normalized_phone),
                "error": (result.get("error") or "")[:300],
            },
        )
    return result


def notify_profile_request_status_whatsapp(
    *,
    profile,
    request_type: str,
    request_id: int | str,
    status_label: str,
    details: Iterable[str] | None = None,
    action_path: str | None = None,
    reason: str | None = None,
) -> dict:
    from in_app_notifications.integrations import notify_request_status

    dispatched = notify_request_status(
        profile=profile,
        request_type=request_type,
        request_id=request_id,
        status_label=status_label,
        details=details,
        action_path=action_path,
        reason=reason,
    )
    whatsapp = dispatched.get("whatsapp") if isinstance(dispatched, dict) else None
    email = dispatched.get("email") if isinstance(dispatched, dict) else None
    selected = whatsapp if whatsapp and whatsapp.get("status") == "sent" else email or whatsapp
    if not selected:
        return {"success": False, "skipped": True, "error": "No valid notification recipient."}
    return {
        "success": selected.get("status") == "sent",
        "skipped": selected.get("status") == "skipped",
        "provider": selected.get("provider"),
        "message_id": selected.get("provider_message_id"),
        "error": selected.get("error"),
        "dispatch": dispatched,
    }
