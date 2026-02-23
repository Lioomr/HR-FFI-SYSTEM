from .email_service import EmailService, send_example_transactional_email
from .whatsapp_service import BirdWhatsAppService, WhatsAppService, WHATSAPP_TEMPLATE_REGISTRY, get_template_info
from .notification_service import NotificationService
from .bird_email_service import (
    BirdEmailService,
    send_leave_request_submitted_email,
    send_leave_approved_email,
    send_leave_rejected_email,
    send_document_expiry_reminder_email,
    send_announcement_notification_email,
    send_user_invite_email,
    example_email_usage,
)

__all__ = [
    "EmailService",
    "send_example_transactional_email",
    "WhatsAppService",
    "BirdWhatsAppService",
    "WHATSAPP_TEMPLATE_REGISTRY",
    "get_template_info",
    "NotificationService",
    "BirdEmailService",
    "send_leave_request_submitted_email",
    "send_leave_approved_email",
    "send_leave_rejected_email",
    "send_document_expiry_reminder_email",
    "send_announcement_notification_email",
    "send_user_invite_email",
    "example_email_usage",
]
