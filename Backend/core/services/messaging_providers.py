import logging
import re
import time
from typing import Any

import requests
from django.conf import settings

logger = logging.getLogger(__name__)


E164_PATTERN = re.compile(r"^\+[1-9]\d{7,14}$")


def normalize_phone_number(raw_phone: str | None) -> str:
    phone = (raw_phone or "").strip()
    if not phone:
        return ""
    cleaned = "".join(ch for ch in phone if ch.isdigit() or ch == "+")
    if not cleaned:
        return ""
    if cleaned.startswith("+"):
        return cleaned
    return f"+{cleaned}"


def is_e164(phone_number: str | None) -> bool:
    return bool(E164_PATTERN.fullmatch(phone_number or ""))


def mask_phone(phone_number: str | None) -> str:
    phone = phone_number or ""
    if len(phone) <= 6:
        return "***"
    return f"{phone[:3]}***{phone[-3:]}"


def render_template_message(template_name: str, template_variables: dict[str, Any]) -> str:
    from .whatsapp_template_library import render_configured_template_message

    return render_configured_template_message(template_name, template_variables)


def _log_delivery(
    *,
    provider: str,
    event: str,
    phone_number: str,
    success: bool,
    message_id: str | None,
    latency_ms: int,
    status_code: int | None = None,
    error: str | None = None,
) -> None:
    log_fn = logger.info if success else logger.warning
    log_fn(
        "messaging_provider_delivery",
        extra={
            "provider": provider,
            "event": event,
            "recipient": mask_phone(phone_number),
            "success": success,
            "message_id": message_id,
            "latency_ms": latency_ms,
            "status_code": status_code,
            "error": (error or "")[:300],
        },
    )


class EvolutionWhatsAppProvider:
    provider = "evolution_whatsapp"

    def __init__(
        self,
        *,
        api_base_url: str | None = None,
        api_key: str | None = None,
        instance_name: str | None = None,
        timeout_seconds: int | None = None,
    ) -> None:
        self.api_base_url = (api_base_url or getattr(settings, "EVOLUTION_API_BASE_URL", "")).rstrip("/")
        self.api_key = api_key if api_key is not None else getattr(settings, "EVOLUTION_API_KEY", "")
        self.instance_name = (
            instance_name if instance_name is not None else getattr(settings, "EVOLUTION_INSTANCE_NAME", "")
        )
        self.timeout_seconds = timeout_seconds or int(getattr(settings, "NOTIFICATION_HTTP_TIMEOUT_SECONDS", 10))

    def is_configured(self) -> bool:
        return bool(self.api_base_url and self.api_key and self.instance_name)

    def send_text(
        self,
        *,
        phone_number: str,
        text: str,
        event: str = "",
    ) -> dict[str, Any]:
        normalized_phone = normalize_phone_number(phone_number)
        started_at = time.monotonic()

        if not self.is_configured():
            return self._result(
                phone_number=normalized_phone,
                event=event,
                success=False,
                status_code=0,
                error="Evolution WhatsApp provider is not configured.",
                started_at=started_at,
            )

        if not is_e164(normalized_phone):
            return self._result(
                phone_number=normalized_phone,
                event=event,
                success=False,
                status_code=0,
                error="Phone number must be in E.164 format.",
                started_at=started_at,
            )

        endpoint = f"{self.api_base_url}/message/sendText/{self.instance_name}"
        payload = {"number": normalized_phone.lstrip("+"), "text": text}
        headers = {"apikey": self.api_key, "Content-Type": "application/json"}

        try:
            response = requests.post(endpoint, headers=headers, json=payload, timeout=self.timeout_seconds)
        except requests.RequestException as exc:
            return self._result(
                phone_number=normalized_phone,
                event=event,
                success=False,
                status_code=0,
                error=str(exc),
                started_at=started_at,
            )

        response_data = _safe_json(response)
        message_id = _extract_message_id(response_data)
        provider_status = _extract_message_status(response_data)
        if 200 <= response.status_code < 300:
            return self._result(
                phone_number=normalized_phone,
                event=event,
                success=True,
                status_code=response.status_code,
                message_id=message_id,
                provider_status=provider_status,
                started_at=started_at,
            )

        error = _extract_error(response_data, response.text)
        return self._result(
            phone_number=normalized_phone,
            event=event,
            success=False,
            status_code=response.status_code,
            error=error,
            started_at=started_at,
        )

    def send_document(
        self,
        *,
        phone_number: str,
        document_url: str = "",
        document_base64: str = "",
        file_name: str,
        caption: str = "",
        event: str = "",
    ) -> dict[str, Any]:
        normalized_phone = normalize_phone_number(phone_number)
        started_at = time.monotonic()

        if not self.is_configured():
            return self._result(
                phone_number=normalized_phone,
                event=event,
                success=False,
                status_code=0,
                error="Evolution WhatsApp provider is not configured.",
                started_at=started_at,
            )

        if not is_e164(normalized_phone):
            return self._result(
                phone_number=normalized_phone,
                event=event,
                success=False,
                status_code=0,
                error="Phone number must be in E.164 format.",
                started_at=started_at,
            )

        media = str(document_base64 or document_url or "").strip()
        if not media:
            return self._result(
                phone_number=normalized_phone,
                event=event,
                success=False,
                status_code=0,
                error="Document URL or Base64 content is required.",
                started_at=started_at,
            )

        endpoint = f"{self.api_base_url}/message/sendMedia/{self.instance_name}"
        # Evolution uploads the file to WhatsApp before replying; PDFs routinely outlast the text timeout.
        timeout = max(self.timeout_seconds, int(getattr(settings, "WHATSAPP_DOCUMENT_TIMEOUT_SECONDS", 60)))
        payload = {
            "number": normalized_phone.lstrip("+"),
            "mediatype": "document",
            "mimetype": "application/pdf",
            "caption": caption,
            "media": media,
            "fileName": file_name or "announcement.pdf",
        }
        headers = {"apikey": self.api_key, "Content-Type": "application/json"}

        try:
            response = requests.post(endpoint, headers=headers, json=payload, timeout=timeout)
        except requests.RequestException as exc:
            return self._result(
                phone_number=normalized_phone,
                event=event,
                success=False,
                status_code=0,
                error=str(exc),
                started_at=started_at,
            )

        response_data = _safe_json(response)
        message_id = _extract_message_id(response_data)
        provider_status = _extract_message_status(response_data)
        if 200 <= response.status_code < 300:
            return self._result(
                phone_number=normalized_phone,
                event=event,
                success=True,
                status_code=response.status_code,
                message_id=message_id,
                provider_status=provider_status,
                started_at=started_at,
            )

        error = _extract_error(response_data, response.text)
        return self._result(
            phone_number=normalized_phone,
            event=event,
            success=False,
            status_code=response.status_code,
            error=error,
            started_at=started_at,
        )

    def _result(
        self,
        *,
        phone_number: str,
        event: str,
        success: bool,
        status_code: int | None,
        started_at: float,
        message_id: str | None = None,
        provider_status: str | None = None,
        error: str | None = None,
    ) -> dict[str, Any]:
        latency_ms = int((time.monotonic() - started_at) * 1000)
        _log_delivery(
            provider=self.provider,
            event=event,
            phone_number=phone_number,
            success=success,
            message_id=message_id,
            latency_ms=latency_ms,
            status_code=status_code,
            error=error,
        )
        return {
            "success": success,
            "provider": self.provider,
            "status_code": status_code if status_code else None,
            "message_id": message_id,
            "provider_status": provider_status,
            "error": error,
        }


class TextBeeSmsProvider:
    provider = "textbee_sms"

    def __init__(
        self,
        *,
        api_base_url: str | None = None,
        api_key: str | None = None,
        device_id: str | None = None,
        timeout_seconds: int | None = None,
    ) -> None:
        self.api_base_url = (
            api_base_url or getattr(settings, "TEXTBEE_API_BASE_URL", "https://api.textbee.dev")
        ).rstrip("/")
        self.api_key = api_key if api_key is not None else getattr(settings, "TEXTBEE_API_KEY", "")
        self.device_id = device_id if device_id is not None else getattr(settings, "TEXTBEE_DEVICE_ID", "")
        self.timeout_seconds = timeout_seconds or int(getattr(settings, "NOTIFICATION_HTTP_TIMEOUT_SECONDS", 10))

    def is_configured(self) -> bool:
        return bool(self.api_base_url and self.api_key and self.device_id)

    def send_sms(self, *, phone_number: str, message: str, event: str = "") -> dict[str, Any]:
        normalized_phone = normalize_phone_number(phone_number)
        started_at = time.monotonic()

        if not self.is_configured():
            return self._result(
                phone_number=normalized_phone,
                event=event,
                success=False,
                status_code=0,
                error="TextBee SMS provider is not configured.",
                started_at=started_at,
            )

        if not is_e164(normalized_phone):
            return self._result(
                phone_number=normalized_phone,
                event=event,
                success=False,
                status_code=0,
                error="Phone number must be in E.164 format.",
                started_at=started_at,
            )

        endpoint = f"{self.api_base_url}/api/v1/gateway/devices/{self.device_id}/send-sms"
        payload = {"recipients": [normalized_phone], "message": message}
        headers = {"x-api-key": self.api_key, "Content-Type": "application/json"}

        try:
            response = requests.post(endpoint, headers=headers, json=payload, timeout=self.timeout_seconds)
        except requests.RequestException as exc:
            return self._result(
                phone_number=normalized_phone,
                event=event,
                success=False,
                status_code=0,
                error=str(exc),
                started_at=started_at,
            )

        response_data = _safe_json(response)
        message_id = _extract_message_id(response_data)
        if 200 <= response.status_code < 300:
            return self._result(
                phone_number=normalized_phone,
                event=event,
                success=True,
                status_code=response.status_code,
                message_id=message_id,
                started_at=started_at,
            )

        error = _extract_error(response_data, response.text)
        return self._result(
            phone_number=normalized_phone,
            event=event,
            success=False,
            status_code=response.status_code,
            error=error,
            started_at=started_at,
        )

    def _result(
        self,
        *,
        phone_number: str,
        event: str,
        success: bool,
        status_code: int | None,
        started_at: float,
        message_id: str | None = None,
        error: str | None = None,
    ) -> dict[str, Any]:
        latency_ms = int((time.monotonic() - started_at) * 1000)
        _log_delivery(
            provider=self.provider,
            event=event,
            phone_number=phone_number,
            success=success,
            message_id=message_id,
            latency_ms=latency_ms,
            status_code=status_code,
            error=error,
        )
        return {
            "success": success,
            "sent": success,
            "provider": self.provider,
            "status_code": status_code if status_code else None,
            "message_id": message_id,
            "error": error,
            "reason": error,
        }


def _safe_json(response: requests.Response) -> dict[str, Any]:
    try:
        data = response.json()
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {"data": data}


def _extract_message_id(data: dict[str, Any]) -> str | None:
    for key in ("id", "messageId", "message_id"):
        value = data.get(key)
        if value:
            return str(value)
    nested_key = data.get("key")
    if isinstance(nested_key, dict) and nested_key.get("id"):
        return str(nested_key["id"])
    return None


def _extract_message_status(data: dict[str, Any]) -> str | None:
    for key in ("provider_status", "messageStatus", "message_status", "deliveryStatus", "delivery_status", "status"):
        value = data.get(key)
        if value not in (None, ""):
            return str(value)
    for key in ("message", "data", "response"):
        nested = data.get(key)
        if isinstance(nested, dict):
            value = _extract_message_status(nested)
            if value:
                return value
    return None


def _extract_error(data: dict[str, Any], fallback_text: str) -> str:
    for key in ("message", "error", "detail"):
        value = data.get(key)
        if value:
            return str(value)[:500]
    response = data.get("response")
    if isinstance(response, dict) and response.get("message"):
        return str(response["message"])[:500]
    return (fallback_text or "Provider request failed.")[:500]
