import logging
import re
from dataclasses import dataclass
from typing import Any

import requests
from django.conf import settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class WhatsAppTemplateSpec:
    template_name: str
    project_id: str
    version_id: str
    variable_order: tuple[str, ...]


WHATSAPP_TEMPLATE_REGISTRY: dict[str, WhatsAppTemplateSpec] = {
    "document_expiry_reminder": WhatsAppTemplateSpec(
        template_name="document_expiry_reminder",
        project_id="dc5139d0-1052-4d82-b0fb-2a6d0d13e397",
        version_id="45100b4c-75d5-410e-b584-7ef9f49a10d5",
        variable_order=("employee_name", "document_type", "expiry_date"),
    ),
    "new_announcement_notification": WhatsAppTemplateSpec(
        template_name="new_announcement_notification",
        project_id="5f32f00b-6e5e-4094-a1df-77a506903bcd",
        version_id="73906bd0-f6e6-4050-b41e-b83d78e2a860",
        variable_order=("employee_name", "announcement_title"),
    ),
    "leave_request_rejected": WhatsAppTemplateSpec(
        template_name="leave_request_rejected",
        project_id="38b28293-da7f-43bd-96d2-8e7e6603a483",
        version_id="939f13ba-ee41-47ff-b561-5b1cb91e41c6",
        variable_order=("employee_name", "leave_type", "start_date", "end_date", "rejection_reason"),
    ),
    "hr_leave_notifications_manager": WhatsAppTemplateSpec(
        template_name="hr_leave_notifications_manager",
        project_id="67dba63d-d502-45df-b43c-c8038cdd39bc",
        version_id="007d520f-9800-4f68-a559-009207fc2775",
        variable_order=("manager_name", "employee_name", "leave_type", "start_date", "end_date", "total_days"),
    ),
    "leave_request_approved": WhatsAppTemplateSpec(
        template_name="leave_request_approved",
        project_id="0f759a10-da4a-4ca3-b448-7c7611725b3e",
        version_id="63a457b4-719f-4e52-8bc5-d6a020aa64d6",
        variable_order=("employee_name", "leave_type", "start_date", "end_date", "total_days"),
    ),
    # Compatibility aliases for existing code paths
    "document_expiry_reminder_v1": WhatsAppTemplateSpec(
        template_name="document_expiry_reminder",
        project_id="dc5139d0-1052-4d82-b0fb-2a6d0d13e397",
        version_id="45100b4c-75d5-410e-b584-7ef9f49a10d5",
        variable_order=("employee_name", "document_type", "expiry_date"),
    ),
    "leave_request_rejected_v1": WhatsAppTemplateSpec(
        template_name="leave_request_rejected",
        project_id="38b28293-da7f-43bd-96d2-8e7e6603a483",
        version_id="939f13ba-ee41-47ff-b561-5b1cb91e41c6",
        variable_order=("employee_name", "leave_type", "start_date", "end_date", "rejection_reason"),
    ),
    "leave_request_submitted_v1": WhatsAppTemplateSpec(
        template_name="hr_leave_notifications_manager",
        project_id="67dba63d-d502-45df-b43c-c8038cdd39bc",
        version_id="007d520f-9800-4f68-a559-009207fc2775",
        variable_order=("manager_name", "employee_name", "leave_type", "start_date", "end_date", "total_days"),
    ),
    "leave_request_approved_v1": WhatsAppTemplateSpec(
        template_name="leave_request_approved",
        project_id="0f759a10-da4a-4ca3-b448-7c7611725b3e",
        version_id="63a457b4-719f-4e52-8bc5-d6a020aa64d6",
        variable_order=("employee_name", "leave_type", "start_date", "end_date", "total_days"),
    ),
}


class BirdWhatsAppService:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        workspace_id: str | None = None,
        whatsapp_channel_id: str | None = None,
        base_url: str | None = None,
        timeout_seconds: int | None = None,
    ) -> None:
        self.api_key = api_key or getattr(settings, "BIRD_API_KEY", "") or getattr(settings, "BIRD_WHATSAPP_API_KEY", "")
        self.workspace_id = workspace_id or getattr(settings, "BIRD_WORKSPACE_ID", "")
        self.channel_id = whatsapp_channel_id or getattr(settings, "BIRD_WHATSAPP_CHANNEL_ID", "")
        self.base_url = (base_url or getattr(settings, "BIRD_API_BASE_URL", "https://api.bird.com/workspaces")).rstrip("/")
        self.timeout_seconds = timeout_seconds or int(getattr(settings, "NOTIFICATION_HTTP_TIMEOUT_SECONDS", 10))

    def is_configured(self) -> bool:
        return bool(self.api_key and self.workspace_id and self.channel_id)

    def _endpoint(self) -> str:
        return f"{self.base_url}/{self.workspace_id}/channels/{self.channel_id}/messages"

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"AccessKey {self.api_key}",
            "Content-Type": "application/json",
        }

    @staticmethod
    def _is_e164(phone_number: str) -> bool:
        return bool(re.fullmatch(r"^\+[1-9]\d{7,14}$", phone_number or ""))

    def send_template_message(
        self,
        phone_number: str,
        project_id: str,
        version_id: str,
        locale: str,
        parameters: dict,
    ) -> dict[str, Any]:
        if not self.is_configured():
            return {"success": False, "message_id": None, "status_code": 0, "error": "Bird WhatsApp service is not configured."}

        if not self._is_e164(phone_number):
            return {
                "success": False,
                "message_id": None,
                "status_code": 0,
                "error": "Phone number must be in E.164 format (e.g., +201013530963).",
            }

        if not project_id or not version_id:
            return {"success": False, "message_id": None, "status_code": 0, "error": "project_id and version_id are required."}

        if not isinstance(parameters, dict):
            return {"success": False, "message_id": None, "status_code": 0, "error": "parameters must be a dictionary."}

        payload = {
            "receiver": {
                "contacts": [
                    {
                        "identifierValue": phone_number,
                        "identifierKey": "phonenumber",
                    }
                ]
            },
            "template": {
                "projectId": project_id,
                "version": version_id,
                "locale": locale or "en",
                "parameters": [
                    {"type": "string", "key": key, "value": str(value or "")}
                    for key, value in parameters.items()
                ],
            },
        }

        try:
            response = requests.post(
                self._endpoint(),
                headers=self._headers(),
                json=payload,
                timeout=self.timeout_seconds,
            )
        except requests.RequestException as exc:
            logger.exception("bird_whatsapp_request_failed")
            return {"success": False, "message_id": None, "status_code": 0, "error": str(exc)}

        try:
            response_data = response.json()
        except ValueError:
            response_data = {"raw": (response.text or "")[:1000]}

        logger.info("bird_whatsapp_response", extra={"status_code": response.status_code})

        if 200 <= response.status_code < 300:
            message_id = response_data.get("id") or response_data.get("messageId") or response_data.get("message_id")
            return {"success": True, "message_id": message_id, "status_code": response.status_code, "error": None}

        error = response_data.get("message") or response_data.get("error") or (response.text or "")[:500]
        logger.error("bird_whatsapp_api_error", extra={"status_code": response.status_code, "error": error})
        return {"success": False, "message_id": None, "status_code": response.status_code, "error": error}

    def send_named_template(
        self,
        *,
        phone_number: str,
        template_name: str,
        locale: str = "en",
        template_variables: dict[str, Any],
    ) -> dict[str, Any]:
        resolved_template = resolve_template_key(template_name=template_name, template_variables=template_variables)
        spec = WHATSAPP_TEMPLATE_REGISTRY.get(resolved_template or "")
        if not spec:
            return {"success": False, "message_id": None, "status_code": 0, "error": f"Unknown template: {template_name}"}

        missing = [name for name in spec.variable_order if name not in template_variables]
        if missing:
            return {
                "success": False,
                "message_id": None,
                "status_code": 0,
                "error": f"Missing template variables: {', '.join(missing)}",
            }

        ordered_parameters = {key: template_variables[key] for key in spec.variable_order}
        return BirdWhatsAppService.send_template_message(
            self,
            phone_number=phone_number,
            project_id=spec.project_id,
            version_id=spec.version_id,
            locale=locale,
            parameters=ordered_parameters,
        )


class WhatsAppService(BirdWhatsAppService):
    def send_template_message(
        self,
        *,
        phone_number: str,
        template_name: str,
        template_variables: dict[str, Any],
        language: str = "en",
    ) -> dict[str, Any]:
        result = self.send_named_template(
            phone_number=phone_number,
            template_name=template_name,
            locale=language,
            template_variables=template_variables,
        )
        return {
            "success": result["success"],
            "provider": "bird_whatsapp",
            "status_code": result["status_code"] if result["status_code"] else None,
            "message_id": result["message_id"],
            "error": result["error"],
        }


def get_template_info(template_name: str) -> dict[str, Any]:
    spec = WHATSAPP_TEMPLATE_REGISTRY.get(template_name)
    if not spec:
        return {"error": f"Template '{template_name}' not found"}
    return {
        "template_name": spec.template_name,
        "project_id": spec.project_id,
        "version_id": spec.version_id,
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
        "announcement_created": "new_announcement_notification",
        "new_announcement_notification": "new_announcement_notification",
    }
    return event_map.get(event_norm)


def _resolve_from_variables(template_variables: dict[str, Any]) -> str | None:
    keys = set(template_variables.keys())
    preferred_order = [
        "document_expiry_reminder",
        "new_announcement_notification",
        "leave_request_rejected",
        "leave_request_approved",
        "leave_request_submitted_v1",
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
