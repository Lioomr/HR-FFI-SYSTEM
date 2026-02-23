import logging
from typing import Any

import requests
from django.conf import settings

logger = logging.getLogger(__name__)


class EmailService:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        email_channel_id: str | None = None,
        workspace_id: str | None = None,
        base_url: str | None = None,
        timeout_seconds: int | None = None,
        default_sender: str | None = None,
    ) -> None:
        self.api_key = api_key or getattr(settings, "BIRD_API_KEY", "") or getattr(settings, "BIRD_ACCESS_KEY", "")
        self.channel_id = email_channel_id or getattr(settings, "BIRD_EMAIL_CHANNEL_ID", "") or getattr(settings, "BIRD_CHANNEL_ID", "")
        self.workspace_id = workspace_id or getattr(settings, "BIRD_WORKSPACE_ID", "")
        self.base_url = (base_url or getattr(settings, "BIRD_API_BASE_URL", "https://api.bird.com/workspaces")).rstrip("/")
        self.timeout_seconds = timeout_seconds or int(getattr(settings, "NOTIFICATION_HTTP_TIMEOUT_SECONDS", 10))
        self.default_sender = default_sender or getattr(settings, "DEFAULT_FROM_EMAIL", "no-reply@fficontracting.com")

    def is_configured(self) -> bool:
        return bool(self.api_key and self.channel_id and self.workspace_id)

    def _endpoint(self) -> str:
        return f"{self.base_url}/{self.workspace_id}/channels/{self.channel_id}/messages"

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"AccessKey {self.api_key}",
            "Content-Type": "application/json",
        }

    def send_html_email(
        self,
        *,
        to_email: str,
        subject: str,
        html_content: str,
        fallback_text: str = "",
        from_email: str | None = None,
    ) -> dict[str, Any]:
        if not self.is_configured():
            reason = "Bird email is not configured. Required: BIRD_API_KEY, BIRD_EMAIL_CHANNEL_ID, BIRD_WORKSPACE_ID."
            logger.error("bird_email_not_configured")
            return {"success": False, "provider": "bird", "status_code": None, "message_id": None, "error": reason}

        if not to_email:
            return {
                "success": False,
                "provider": "bird",
                "status_code": None,
                "message_id": None,
                "error": "Recipient email is required.",
            }

        sender_value = from_email or self.default_sender
        payload = {
            "receiver": {
                "contacts": [
                    {
                        "identifierKey": "emailaddress",
                        "identifierValue": to_email,
                    }
                ]
            },
            "body": {
                "type": "html",
                "html": {
                    "text": fallback_text or "This email contains HTML content.",
                    "html": html_content,
                    "metadata": {
                        "subject": subject,
                        "emailFrom": {
                            "username": sender_value.split("@", 1)[0],
                        },
                    },
                },
            },
            "meta": {"email": {"subject": subject}},
        }

        try:
            response = requests.post(
                self._endpoint(),
                headers=self._headers(),
                json=payload,
                timeout=self.timeout_seconds,
            )
        except requests.RequestException as exc:
            logger.exception("bird_email_request_failed", extra={"to_email": to_email})
            return {"success": False, "provider": "bird", "status_code": None, "message_id": None, "error": str(exc)}

        response_data: dict[str, Any] = {}
        if response.text:
            try:
                response_data = response.json()
            except ValueError:
                response_data = {"raw": response.text[:1000]}

        logger.info("bird_email_response", extra={"status_code": response.status_code, "to_email": to_email})

        if 200 <= response.status_code < 300:
            message_id = (
                response_data.get("id")
                or response_data.get("messageId")
                or response_data.get("message_id")
                or None
            )
            return {"success": True, "provider": "bird", "status_code": response.status_code, "message_id": message_id, "error": None}

        error_message = response_data.get("message") or response_data.get("error") or response.text[:500]
        logger.error(
            "bird_email_api_error",
            extra={"status_code": response.status_code, "to_email": to_email, "error": error_message},
        )
        return {
            "success": False,
            "provider": "bird",
            "status_code": response.status_code,
            "message_id": None,
            "error": error_message or f"Bird API returned status {response.status_code}",
        }


def send_example_transactional_email(recipient_email: str) -> dict[str, Any]:
    service = EmailService()
    return service.send_html_email(
        to_email=recipient_email,
        subject="Welcome to FFI Contracting",
        html_content="<h1>Welcome</h1><p>Your account is now active.</p>",
        fallback_text="Welcome! Your account is now active.",
    )
