import logging

import requests
from celery import shared_task
from django.conf import settings

from core.notifications import send_email_notification

logger = logging.getLogger(__name__)


@shared_task(name="core.tasks.ping_healthchecks")
def ping_healthchecks() -> bool:
    """Ping an optional external monitor from the Celery Beat schedule."""
    ping_url = (getattr(settings, "HEALTHCHECKS_PING_URL", "") or "").strip()
    if not ping_url:
        return False

    try:
        response = requests.get(
            ping_url,
            timeout=max(1, int(getattr(settings, "HEALTHCHECKS_PING_TIMEOUT_SECONDS", 10))),
        )
        response.raise_for_status()
    except requests.RequestException:
        logger.warning("healthchecks_ping_failed")
        return False
    return True


@shared_task(name="core.tasks.send_error_report_email")
def send_error_report_email(subject: str, text_body: str, html_body: str) -> bool:
    """Deliver a frontend crash report to the admin mailbox out of the request cycle."""
    recipient = (getattr(settings, "ADMIN_ERROR_REPORT_EMAIL", "") or "").strip()
    if not recipient:
        logger.error("error_report_email_recipient_not_configured")
        return False

    result = send_email_notification(
        recipient_email=recipient,
        subject=subject,
        text_body=text_body,
        html_body=html_body,
    )
    if not result.get("sent"):
        logger.error("error_report_email_failed", extra={"reason": result.get("reason")})
        return False
    return True
