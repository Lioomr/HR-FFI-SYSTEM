from __future__ import annotations

import json
import logging
from collections.abc import Callable
from html import escape

from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist
from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction

from core.services.email_service import EmailService
from core.services.messaging_providers import EvolutionWhatsAppProvider, is_e164, normalize_phone_number
from core.services.whatsapp_service import WhatsAppService

from .models import Notification, NotificationDelivery
from .services import _broadcast_created, create_notification

logger = logging.getLogger(__name__)


def _channel_preferences(recipient) -> tuple[bool, bool]:
    whatsapp_enabled = bool(getattr(settings, "NOTIFICATION_WHATSAPP_DELIVERY_ENABLED", True))
    email_enabled = bool(getattr(settings, "NOTIFICATION_EMAIL_FALLBACK_ENABLED", True))
    try:
        preference = recipient.preferences.filter(scope="notifications", key="channels").only("value").first()
        value = preference.value if preference and isinstance(preference.value, dict) else {}
        whatsapp_enabled = whatsapp_enabled and value.get("whatsapp_enabled", True) is not False
        email_enabled = email_enabled and value.get("email_enabled", True) is not False
    except Exception:
        logger.exception("notification_channel_preference_lookup_failed", extra={"recipient_id": recipient.id})
    return whatsapp_enabled, email_enabled


def _delivery_payload(delivery: NotificationDelivery | None) -> dict | None:
    if delivery is None:
        return None
    return {
        "id": delivery.id,
        "channel": delivery.channel,
        "status": delivery.status,
        "provider": delivery.provider,
        "provider_message_id": delivery.provider_message_id,
        "error": delivery.error_message,
        "attempt_count": delivery.attempt_count,
    }


def _claim_delivery(notification, channel):
    delivery, created = NotificationDelivery.objects.get_or_create(
        notification=notification,
        channel=channel,
        defaults={"recipient": notification.recipient, "status": NotificationDelivery.Status.PENDING},
    )
    return delivery, created


def _json_safe(value) -> dict:
    return json.loads(json.dumps(value or {}, cls=DjangoJSONEncoder))


def _email_payload(email_template, email_context) -> dict:
    if callable(email_template):
        module = getattr(email_template, "__module__", "")
        qualname = getattr(email_template, "__qualname__", "")
        if not module or not qualname or "<locals>" in qualname or "<lambda>" in qualname:
            raise ValueError("Queued email callbacks must be importable module-level callables.")
        return {
            "template_kind": "callable",
            "template": f"{module}.{qualname}",
            "context": _json_safe(email_context),
        }
    return {
        "template_kind": "template",
        "template": str(email_template or ""),
        "context": _json_safe(email_context),
    }


def _queue_whatsapp(notification_id: int, payload: dict) -> None:
    try:
        from .tasks import deliver_whatsapp_notification

        deliver_whatsapp_notification.delay(notification_id, **payload)
    except Exception:
        logger.exception("notification_whatsapp_queue_failed", extra={"notification_id": notification_id})


def _generic_whatsapp_text(title: str, message: str, action_url: str) -> str:
    action = f"\n{action_url}" if action_url else ""
    return f"إشعار الموارد البشرية\n{title}\n{message}{action}\n\nHR Notification\n{title}\n{message}{action}"


def _send_whatsapp(*, recipient, title, message, action_url, template, variables, timeout):
    try:
        profile = recipient.employee_profile
    except (AttributeError, ObjectDoesNotExist):
        profile = None
    phone = normalize_phone_number(getattr(profile, "mobile", "") if profile else "")
    if not phone or not is_e164(phone):
        return {
            "success": False,
            "skipped": True,
            "provider": "evolution_whatsapp",
            "error": "No valid E.164 WhatsApp number.",
        }
    if template:
        return WhatsAppService(timeout_seconds=timeout).send_template_message(
            phone_number=phone,
            template_name=template,
            template_variables=variables or {},
        )
    return EvolutionWhatsAppProvider(timeout_seconds=timeout).send_text(
        phone_number=phone,
        text=_generic_whatsapp_text(title, message, action_url),
        event="in_app_notification",
    )


def _send_email(*, recipient, title, message, action_url, template, context, timeout):
    email = (getattr(recipient, "email", "") or "").strip()
    if not email:
        return {"success": False, "skipped": True, "provider": "bird", "error": "Recipient email is missing."}
    email_context = dict(context or {})
    if callable(template):
        email_context.setdefault("to_email", email)
        return template(**email_context)
    template_name = str(template or "").strip()
    if template_name:
        from django.template.loader import render_to_string

        email_context.setdefault("recipient", recipient)
        email_context.setdefault("title", title)
        email_context.setdefault("message", message)
        email_context.setdefault("action_url", action_url)
        html = render_to_string(template_name, email_context)
    else:
        action_html = f'<p><a href="{escape(action_url)}">View details</a></p>' if action_url else ""
        html = f"<h2>{escape(title)}</h2><p>{escape(message)}</p>{action_html}"
    return EmailService(timeout_seconds=timeout).send_html_email(
        to_email=email,
        subject=title,
        html_content=html,
        fallback_text=f"{title}\n\n{message}\n{action_url}".strip(),
    )


def dispatch_notification_channels(
    *,
    recipient,
    event_key: str,
    title: str,
    message: str,
    category: str,
    action_url: str | None = None,
    related_object=None,
    related_object_type: str = "",
    related_object_id=None,
    metadata: dict | None = None,
    whatsapp_template: str | None = None,
    whatsapp_variables: dict | None = None,
    email_template: str | Callable | None = None,
    email_context: dict | None = None,
    deduplication_key: str = "",
    company=None,
    company_id: int | None = None,
    whatsapp_enabled: bool | None = None,
    email_enabled: bool | None = None,
    redeliver_existing: bool = True,
    known_new: bool = False,
) -> dict:
    """Persist immediately and enqueue WhatsApp-first external delivery after commit.

    ``known_new`` lets a caller that has already batch-checked recipients against
    a shared ``deduplication_key`` (e.g. a company-wide announcement) skip the
    per-recipient dedup SELECT that create_notification would otherwise run.
    """
    try:
        notification, created = create_notification(
            recipient=recipient,
            event_key=event_key,
            title=title,
            message=message,
            category=category,
            action_url=action_url or "",
            related_object=related_object,
            related_object_type=related_object_type,
            related_object_id=related_object_id,
            metadata=metadata,
            deduplication_key=deduplication_key,
            company=company,
            company_id=company_id,
            broadcast=False,
            known_new=known_new,
        )
        if notification is None:
            return {"notification": None, "created": False, "whatsapp": None, "email": None}

        preferred_whatsapp, preferred_email = _channel_preferences(recipient)
        whatsapp_enabled = preferred_whatsapp if whatsapp_enabled is None else preferred_whatsapp and whatsapp_enabled
        email_enabled = preferred_email if email_enabled is None else preferred_email and email_enabled
        task_payload = {
            "whatsapp_template": str(whatsapp_template or ""),
            "whatsapp_variables": _json_safe(whatsapp_variables),
            "email_payload": _email_payload(email_template, email_context),
            "whatsapp_enabled": bool(whatsapp_enabled),
            "email_enabled": bool(email_enabled),
        }

        with transaction.atomic():
            notification = Notification.objects.select_for_update().get(pk=notification.pk)
            whatsapp_delivery, _ = _claim_delivery(notification, NotificationDelivery.Channel.WHATSAPP)
            email_delivery = NotificationDelivery.objects.filter(
                notification=notification, channel=NotificationDelivery.Channel.EMAIL
            ).first()
            if created:
                transaction.on_commit(lambda notification_id=notification.id: _broadcast_created(notification_id))
            if (created or redeliver_existing) and whatsapp_delivery.status != NotificationDelivery.Status.SENT:
                transaction.on_commit(
                    lambda notification_id=notification.id, payload=task_payload: _queue_whatsapp(
                        notification_id, payload
                    )
                )

        return {
            "notification": notification,
            "created": created,
            "whatsapp": _delivery_payload(whatsapp_delivery),
            "email": _delivery_payload(email_delivery),
        }
    except Exception:
        logger.exception(
            "notification_dispatch_failed",
            extra={"event_key": event_key, "recipient_id": getattr(recipient, "id", None)},
        )
        return {"notification": None, "created": False, "whatsapp": None, "email": None}
