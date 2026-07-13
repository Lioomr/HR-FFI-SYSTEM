import logging
from typing import Any

import requests
from django.conf import settings
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from core.permissions import IsSystemAdmin
from core.responses import error, success
from core.services import WhatsAppService

logger = logging.getLogger(__name__)


def _evolution_config() -> dict[str, str]:
    return {
        "base_url": (getattr(settings, "EVOLUTION_API_BASE_URL", "") or "").rstrip("/"),
        "api_key": getattr(settings, "EVOLUTION_API_KEY", "") or "",
        "instance_name": getattr(settings, "EVOLUTION_INSTANCE_NAME", "") or "",
    }


def _is_configured(config: dict[str, str]) -> bool:
    return bool(config["base_url"] and config["api_key"] and config["instance_name"])


def _headers(config: dict[str, str]) -> dict[str, str]:
    return {"apikey": config["api_key"], "Content-Type": "application/json"}


def _request(method: str, path: str, *, json: dict[str, Any] | None = None) -> tuple[int, dict[str, Any] | list[Any] | str]:
    config = _evolution_config()
    response = requests.request(
        method,
        f"{config['base_url']}{path}",
        headers=_headers(config),
        json=json,
        timeout=int(getattr(settings, "NOTIFICATION_HTTP_TIMEOUT_SECONDS", 10)),
    )
    try:
        data = response.json()
    except ValueError:
        data = response.text
    return response.status_code, data


def _configured_payload(config: dict[str, str]) -> dict[str, Any]:
    return {
        "configured": _is_configured(config),
        "instance_name": config["instance_name"],
        "base_url_configured": bool(config["base_url"]),
        "api_key_configured": bool(config["api_key"]),
    }


def _extract_connection_state(data: Any) -> str:
    if isinstance(data, list):
        data = data[0] if data else {}
    if not isinstance(data, dict):
        return "unknown"

    for key in ("state", "connectionStatus", "connection_state", "status"):
        value = data.get(key)
        if value:
            return _safe_connection_state(value)

    instance = data.get("instance")
    if isinstance(instance, dict):
        for key in ("state", "connectionStatus", "status"):
            value = instance.get(key)
            if value:
                return _safe_connection_state(value)

    return "unknown"


def _safe_connection_state(value: Any) -> str:
    normalized = str(value).strip().lower()
    return normalized if normalized in {"open", "connected", "connecting", "close", "closed", "disconnected"} else "unknown"


def _extract_qr_code(data: Any) -> str:
    if not isinstance(data, dict):
        return ""

    candidates = [
        data.get("base64"),
        data.get("code"),
        data.get("qrcode"),
        data.get("qr"),
    ]
    qrcode = data.get("qrcode")
    if isinstance(qrcode, dict):
        candidates.extend([qrcode.get("base64"), qrcode.get("code"), qrcode.get("qr")])

    for candidate in candidates:
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return ""


class WhatsAppIntegrationStatusView(APIView):
    permission_classes = [IsAuthenticated, IsSystemAdmin]

    def get(self, request):
        config = _evolution_config()
        payload = _configured_payload(config)
        if not _is_configured(config):
            payload.update({"connection_state": "not_configured", "connected": False})
            return success(payload)

        try:
            status_code, data = _request("GET", f"/instance/connectionState/{config['instance_name']}")
        except requests.RequestException as exc:
            logger.warning("whatsapp_integration_status_failed", exc_info=exc)
            payload.update({"connection_state": "unreachable", "connected": False, "error": "Provider is unreachable."})
            return success(payload)

        connection_state = _extract_connection_state(data)
        payload.update(
            {
                "connection_state": connection_state,
                "connected": connection_state.lower() in {"open", "connected"},
                "provider_status_code": status_code,
            }
        )
        return success(payload)


class WhatsAppIntegrationConnectView(APIView):
    permission_classes = [IsAuthenticated, IsSystemAdmin]

    def post(self, request):
        config = _evolution_config()
        if not _is_configured(config):
            return error("Evolution WhatsApp provider is not configured.", status=422)

        payload = {
            "instanceName": config["instance_name"],
            "integration": "WHATSAPP-BAILEYS",
            "qrcode": True,
        }

        try:
            status_code, data = _request("POST", "/instance/create", json=payload)
            if status_code in {400, 403, 409}:
                status_code, data = _request("GET", f"/instance/connect/{config['instance_name']}")
        except requests.RequestException as exc:
            logger.warning("whatsapp_integration_connect_failed", exc_info=exc)
            return error("Could not connect to WhatsApp provider.", status=502)

        qr_code = _extract_qr_code(data)
        return success(
            {
                "instance_name": config["instance_name"],
                "qr_code": qr_code,
                "provider_status_code": status_code,
                "qr_available": bool(qr_code),
            }
        )


class WhatsAppIntegrationQrView(APIView):
    permission_classes = [IsAuthenticated, IsSystemAdmin]

    def get(self, request):
        config = _evolution_config()
        if not _is_configured(config):
            return error("Evolution WhatsApp provider is not configured.", status=422)

        try:
            status_code, data = _request("GET", f"/instance/connect/{config['instance_name']}")
        except requests.RequestException as exc:
            logger.warning("whatsapp_integration_qr_failed", exc_info=exc)
            return error("Could not fetch WhatsApp QR code.", status=502)

        qr_code = _extract_qr_code(data)
        return success(
            {
                "instance_name": config["instance_name"],
                "qr_code": qr_code,
                "provider_status_code": status_code,
                "qr_available": bool(qr_code),
            }
        )


class WhatsAppIntegrationLogoutView(APIView):
    permission_classes = [IsAuthenticated, IsSystemAdmin]

    def post(self, request):
        config = _evolution_config()
        if not _is_configured(config):
            return error("Evolution WhatsApp provider is not configured.", status=422)

        try:
            status_code, data = _request("DELETE", f"/instance/logout/{config['instance_name']}")
        except requests.RequestException as exc:
            logger.warning("whatsapp_integration_logout_failed", exc_info=exc)
            return error("Could not disconnect WhatsApp device.", status=502)

        logger.info("whatsapp_integration_logout_provider_response", extra={"provider_response": data})
        return success(
            {
                "instance_name": config["instance_name"],
                "provider_status_code": status_code,
                "connected": False,
                "connection_state": "disconnected",
            }
        )


class WhatsAppIntegrationTestView(APIView):
    permission_classes = [IsAuthenticated, IsSystemAdmin]

    def post(self, request):
        phone_number = str(request.data.get("phone_number") or "").strip()
        if not phone_number:
            return error("Validation error", errors={"phone_number": ["phone_number is required."]}, status=422)

        try:
            result = WhatsAppService().send_template_message(
                phone_number=phone_number,
                template_name="whatsapp_provider_test",
                template_variables={"provider_name": "Evolution"},
            )
        except Exception:  # pragma: no cover - external provider guard
            logger.exception("whatsapp_integration_test_unhandled_exception")
            result = {"success": False}

        if not result.get("success"):
            logger.warning("whatsapp_integration_test_failed", extra={"provider_result": result})
        return success(
            {
                "sent": bool(result.get("success")),
                "provider_status_code": result.get("status_code"),
            }
        )
