from typing import Any

from .email_service import EmailService
from .whatsapp_service import WhatsAppService


class NotificationService:
    def __init__(
        self,
        *,
        email_service: EmailService | None = None,
        whatsapp_service: WhatsAppService | None = None,
    ) -> None:
        self.email_service = email_service or EmailService()
        self.whatsapp_service = whatsapp_service or WhatsAppService()

    def send(self, *, type: str, **kwargs: Any) -> dict[str, Any]:
        if type == "email":
            return self.email_service.send_html_email(
                to_email=kwargs["to_email"],
                subject=kwargs["subject"],
                html_content=kwargs["html_content"],
                fallback_text=kwargs.get("fallback_text", ""),
                from_email=kwargs.get("from_email"),
            )
        if type == "whatsapp":
            return self.whatsapp_service.send_template_message(
                phone_number=kwargs["phone_number"],
                template_name=kwargs["template_name"],
                template_variables=kwargs["template_variables"],
                language=kwargs.get("language", "en"),
            )
        return {
            "success": False,
            "provider": "bird",
            "status_code": None,
            "message_id": None,
            "error": f"Unsupported notification type: {type}",
        }
