import logging
import re
from dataclasses import dataclass
from typing import Any

from django.conf import settings

from .messaging_providers import EvolutionWhatsAppProvider, render_template_message

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class WhatsAppTemplateSpec:
    template_name: str
    variable_order: tuple[str, ...]


WHATSAPP_TEMPLATE_REGISTRY: dict[str, WhatsAppTemplateSpec] = {
    "document_expiry_reminder": WhatsAppTemplateSpec(
        template_name="document_expiry_reminder",
        variable_order=("employee_name", "document_type", "expiry_date"),
    ),
    "new_announcement_notification": WhatsAppTemplateSpec(
        template_name="new_announcement_notification",
        variable_order=("employee_name", "announcement_title"),
    ),
    "leave_request_rejected": WhatsAppTemplateSpec(
        template_name="leave_request_rejected",
        variable_order=("employee_name", "leave_type", "start_date", "end_date", "rejection_reason"),
    ),
    "hr_leave_notifications_manager": WhatsAppTemplateSpec(
        template_name="hr_leave_notifications_manager",
        variable_order=("manager_name", "employee_name", "leave_type", "start_date", "end_date", "total_days"),
    ),
    "leave_request_approved": WhatsAppTemplateSpec(
        template_name="leave_request_approved",
        variable_order=("employee_name", "leave_type", "start_date", "end_date", "total_days"),
    ),
    "leave_delegation_assigned": WhatsAppTemplateSpec(
        template_name="leave_delegation_assigned",
        variable_order=("delegate_name", "employee_name", "leave_type", "start_date", "end_date", "total_days"),
    ),
    # Compatibility aliases for existing code paths
    "document_expiry_reminder_v1": WhatsAppTemplateSpec(
        template_name="document_expiry_reminder",
        variable_order=("employee_name", "document_type", "expiry_date"),
    ),
    "leave_request_rejected_v1": WhatsAppTemplateSpec(
        template_name="leave_request_rejected",
        variable_order=("employee_name", "leave_type", "start_date", "end_date", "rejection_reason"),
    ),
    "leave_request_submitted_v1": WhatsAppTemplateSpec(
        template_name="hr_leave_notifications_manager",
        variable_order=("manager_name", "employee_name", "leave_type", "start_date", "end_date", "total_days"),
    ),
    "leave_request_approved_v1": WhatsAppTemplateSpec(
        template_name="leave_request_approved",
        variable_order=("employee_name", "leave_type", "start_date", "end_date", "total_days"),
    ),
    "leave_delegation_assigned_v1": WhatsAppTemplateSpec(
        template_name="leave_delegation_assigned",
        variable_order=("delegate_name", "employee_name", "leave_type", "start_date", "end_date", "total_days"),
    ),
    "meeting_notification_v1": WhatsAppTemplateSpec(
        template_name="meeting_notification",
        variable_order=(
            "employee_name",
            "meeting_title",
            "meeting_date",
            "meeting_time",
            "organizer_name",
            "google_meet_url",
            "microsoft_teams_url",
            "zoom_url",
        ),
    ),
    "request_status_update": WhatsAppTemplateSpec(
        template_name="request_status_update",
        variable_order=("employee_name", "request_type", "request_id", "status_label", "reason", "details", "action_url"),
    ),
    "employee_invitation": WhatsAppTemplateSpec(
        template_name="employee_invitation",
        variable_order=("role", "invite_link", "expires_in_hours", "inviter_name"),
    ),
    "whatsapp_provider_test": WhatsAppTemplateSpec(
        template_name="whatsapp_provider_test",
        variable_order=("provider_name",),
    ),
}


class WhatsAppService:
    def __init__(
        self,
        *,
        timeout_seconds: int | None = None,
    ) -> None:
        self.timeout_seconds = timeout_seconds or int(getattr(settings, "NOTIFICATION_HTTP_TIMEOUT_SECONDS", 10))

    def send_template_message(
        self,
        *,
        phone_number: str,
        template_name: str,
        template_variables: dict[str, Any],
        language: str = "en",
    ) -> dict[str, Any]:
        _ = language
        resolved_template = resolve_template_key(template_name=template_name, template_variables=template_variables)
        spec = WHATSAPP_TEMPLATE_REGISTRY.get(resolved_template or "")
        if not spec:
            return {
                "success": False,
                "message_id": None,
                "status_code": 0,
                "error": f"Unknown template: {template_name}",
            }

        missing = [name for name in spec.variable_order if name not in template_variables]
        if missing:
            return {
                "success": False,
                "message_id": None,
                "status_code": 0,
                "error": f"Missing template variables: {', '.join(missing)}",
            }

        result = EvolutionWhatsAppProvider(timeout_seconds=self.timeout_seconds).send_text(
            phone_number=phone_number,
            text=render_template_message(resolved_template, template_variables),
            event=template_name,
        )
        return {
            "success": result["success"],
            "provider": result["provider"],
            "status_code": result["status_code"],
            "message_id": result["message_id"],
            "provider_status": result.get("provider_status"),
            "error": result["error"],
        }


def get_template_info(template_name: str) -> dict[str, Any]:
    spec = WHATSAPP_TEMPLATE_REGISTRY.get(template_name)
    if not spec:
        return {"error": f"Template '{template_name}' not found"}
    return {
        "template_name": spec.template_name,
        "variable_order": list(spec.variable_order),
    }


def resolve_template_key(
    *,
    template_name: str | None = None,
    event: str | None = None,
    template_variables: dict[str, Any] | None = None,
) -> str | None:
    if template_name and template_name in WHATSAPP_TEMPLATE_REGISTRY:
        return template_name

    normalized = _normalize_template_token(template_name) if template_name else ""
    if normalized:
        by_name = _template_key_by_normalized_name(normalized)
        if by_name:
            return by_name

    if event:
        event_key = _resolve_from_event(event)
        if event_key:
            return event_key

    if template_variables:
        matched = _resolve_from_variables(template_variables)
        if matched:
            return matched

    return None


def _normalize_template_token(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")


def _template_key_by_normalized_name(normalized: str) -> str | None:
    for key, spec in WHATSAPP_TEMPLATE_REGISTRY.items():
        if key.endswith("_v1"):
            continue
        key_norm = _normalize_template_token(key)
        name_norm = _normalize_template_token(spec.template_name)
        if normalized in {key_norm, name_norm}:
            return key
    return None


def _resolve_from_event(event: str) -> str | None:
    event_norm = _normalize_template_token(event)
    event_map = {
        "document_expiry_reminder": "document_expiry_reminder",
        "leave_request_submitted": "leave_request_submitted_v1",
        "leave_request_approved": "leave_request_approved",
        "leave_request_rejected": "leave_request_rejected",
        "leave_delegation_assigned": "leave_delegation_assigned",
        "announcement_created": "new_announcement_notification",
        "new_announcement_notification": "new_announcement_notification",
        "meeting_notification": "meeting_notification_v1",
        "request_status_update": "request_status_update",
        "employee_invitation": "employee_invitation",
        "whatsapp_provider_test": "whatsapp_provider_test",
    }
    return event_map.get(event_norm)


def _resolve_from_variables(template_variables: dict[str, Any]) -> str | None:
    keys = set(template_variables.keys())
    preferred_order = [
        "document_expiry_reminder",
        "new_announcement_notification",
        "leave_request_rejected",
        "leave_request_approved",
        "leave_delegation_assigned",
        "meeting_notification_v1",
        "leave_request_submitted_v1",
        "request_status_update",
        "employee_invitation",
        "whatsapp_provider_test",
    ]
    for candidate in preferred_order:
        spec = WHATSAPP_TEMPLATE_REGISTRY.get(candidate)
        if spec and set(spec.variable_order).issubset(keys):
            return candidate
    for key, spec in WHATSAPP_TEMPLATE_REGISTRY.items():
        if key.endswith("_v1"):
            continue
        if set(spec.variable_order).issubset(keys):
            return key
    return None
