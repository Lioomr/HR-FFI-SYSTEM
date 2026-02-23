from django.conf import settings

from .services.email_service import EmailService

# Import WhatsApp service functions for public API
from .whatsapp_service import send_whatsapp_notification, get_template_info


def send_email_notification(recipient_email: str, subject: str, text_body: str, html_body: str | None = None) -> dict:
    service = EmailService()
    result = service.send_html_email(
        to_email=recipient_email,
        subject=subject,
        html_content=html_body or text_body,
        fallback_text=text_body,
        from_email=settings.DEFAULT_FROM_EMAIL,
    )
    if result.get("success"):
        return {"sent": True, "provider": "bird"}
    return {"sent": False, "provider": "bird", "reason": result.get("error") or "Unknown Bird error"}
