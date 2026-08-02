from django.conf import settings

from .services.email_service import EmailService
from .services.messaging_providers import TextBeeSmsProvider

# Import WhatsApp service functions for public API


def send_email_notification(
    recipient_email: str,
    subject: str,
    text_body: str,
    html_body: str | None = None,
    attachments: list[dict] | None = None,
) -> dict:
    service = EmailService()
    result = service.send_html_email(
        to_email=recipient_email,
        subject=subject,
        html_content=html_body or text_body,
        fallback_text=text_body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        attachments=attachments,
    )
    if result.get("success"):
        return {"sent": True, "provider": "bird"}
    return {"sent": False, "provider": "bird", "reason": result.get("error") or "Unknown Bird error"}


def send_sms_notification(
    phone_number: str,
    message: str,
    *,
    event: str = "sms_notification",
) -> dict:
    provider = getattr(settings, "MESSAGING_SMS_PROVIDER", "textbee").strip().lower()
    if provider == "textbee":
        return TextBeeSmsProvider().send_sms(phone_number=phone_number, message=message, event=event)

    return {
        "sent": False,
        "success": False,
        "provider": "sms",
        "reason": f"Unsupported SMS provider: {provider}",
        "error": f"Unsupported SMS provider: {provider}",
    }
