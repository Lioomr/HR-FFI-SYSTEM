from __future__ import annotations

import logging
import re
from random import SystemRandom

from celery import shared_task
from django.conf import settings
from django.core.management import call_command
from django.db import transaction
from django.utils.module_loading import import_string

from .models import Notification, NotificationDelivery

logger = logging.getLogger(__name__)
_SECURE_RANDOM = SystemRandom()

_SECRET_RE = re.compile(r"(?i)(authorization|api[-_ ]?key|access[-_ ]?key)\s*[:=]\s*\S+")
_BEARER_RE = re.compile(r"(?i)bearer\s+\S+")
_PHONE_RE = re.compile(r"(?<!\d)\+?\d{10,15}(?!\d)")
_PERMANENT_FAILURE_MARKERS = (
    "not configured",
    "unknown template",
    "missing template variables",
    "must be in e.164",
    "invalid e.164",
    "recipient email is required",
)


def _safe_error(value) -> str:
    error = str(value or "").replace("\r", " ").replace("\n", " ")
    error = _BEARER_RE.sub("Bearer [redacted]", error)
    error = _SECRET_RE.sub(r"\1: [redacted]", error)
    error = _PHONE_RE.sub("[redacted-phone]", error)
    return error[:500]


def _max_retries() -> int:
    return max(0, int(getattr(settings, "NOTIFICATION_DELIVERY_MAX_RETRIES", 3)))


def _retry_countdown(retry_number: int) -> float:
    base = max(1, int(getattr(settings, "NOTIFICATION_DELIVERY_RETRY_BACKOFF_SECONDS", 2)))
    exponential = base * (2**retry_number)
    return exponential + _SECURE_RANDOM.uniform(0, base)


def _is_retryable(result: dict) -> bool:
    if result.get("skipped"):
        return False
    error = str(result.get("error") or "").lower()
    if any(marker in error for marker in _PERMANENT_FAILURE_MARKERS):
        return False
    status_code = result.get("status_code")
    if status_code in (408, 425, 429):
        return True
    if isinstance(status_code, int) and status_code >= 500:
        return True
    return status_code in (None, 0)


def _finish(delivery, *, status, provider, result, increment=True):
    delivery.status = status
    delivery.provider = str(result.get("provider") or provider)[:80]
    delivery.provider_message_id = str(result.get("message_id") or "")[:255]
    delivery.error_message = _safe_error(result.get("error"))
    if increment:
        delivery.attempt_count += 1
    delivery.save(
        update_fields=[
            "status",
            "provider",
            "provider_message_id",
            "error_message",
            "attempt_count",
            "updated_at",
        ]
    )


def _queue_email_fallback(notification_id: int, email_payload: dict, email_enabled: bool) -> None:
    try:
        deliver_email_notification.delay(notification_id, email_payload, email_enabled)
        logger.info("notification_email_fallback_queued", extra={"notification_id": notification_id})
    except Exception:
        logger.exception("notification_email_queue_failed", extra={"notification_id": notification_id})


@shared_task(bind=True, acks_late=True, reject_on_worker_lost=True, max_retries=3)
def deliver_whatsapp_notification(
    self,
    notification_id: int,
    whatsapp_template: str = "",
    whatsapp_variables: dict | None = None,
    whatsapp_document: dict | None = None,
    email_payload: dict | None = None,
    whatsapp_enabled: bool = True,
    email_enabled: bool = True,
):
    """Deliver WhatsApp once per Celery retry number and queue fallback only at a terminal outcome."""
    delivery = None
    retryable = False
    fallback = False
    error = ""
    try:
        with transaction.atomic():
            notification = Notification.objects.select_related("recipient").select_for_update().get(pk=notification_id)
            delivery = NotificationDelivery.objects.select_for_update().get(
                notification=notification,
                channel=NotificationDelivery.Channel.WHATSAPP,
            )
            if delivery.status == NotificationDelivery.Status.SENT:
                return {"status": delivery.status, "attempt_count": delivery.attempt_count}
            if delivery.status in {NotificationDelivery.Status.FAILED, NotificationDelivery.Status.SKIPPED}:
                return {"status": delivery.status, "attempt_count": delivery.attempt_count}
            elif delivery.attempt_count > self.request.retries:
                return {"status": delivery.status, "attempt_count": delivery.attempt_count, "duplicate": True}
            elif not whatsapp_enabled:
                _finish(
                    delivery,
                    status=NotificationDelivery.Status.SKIPPED,
                    provider="evolution_whatsapp",
                    result={"error": "WhatsApp delivery is disabled."},
                )
                fallback = True
            else:
                from .dispatcher import _send_whatsapp
                from .i18n import localized_notification_field

                try:
                    result = _send_whatsapp(
                        recipient=notification.recipient,
                        title=notification.title,
                        message=notification.message,
                        title_ar=localized_notification_field(notification, "title", "ar"),
                        message_ar=localized_notification_field(notification, "message", "ar"),
                        action_url=notification.action_url,
                        template=whatsapp_template,
                        variables=whatsapp_variables or {},
                        timeout=int(getattr(settings, "NOTIFICATION_DELIVERY_TIMEOUT_SECONDS", 10)),
                        document=whatsapp_document or {},
                    )
                except Exception as exc:
                    logger.exception(
                        "notification_whatsapp_delivery_exception", extra={"notification_id": notification.id}
                    )
                    result = {"success": False, "provider": "evolution_whatsapp", "error": str(exc)}

                if result.get("success"):
                    _finish(
                        delivery,
                        status=NotificationDelivery.Status.SENT,
                        provider="evolution_whatsapp",
                        result=result,
                    )
                elif result.get("skipped"):
                    _finish(
                        delivery,
                        status=NotificationDelivery.Status.SKIPPED,
                        provider="evolution_whatsapp",
                        result=result,
                    )
                    fallback = True
                    logger.warning(
                        "notification_whatsapp_invalid_recipient",
                        extra={"notification_id": notification.id, "error": delivery.error_message},
                    )
                else:
                    exhausted = self.request.retries >= _max_retries()
                    retryable = _is_retryable(result) and not exhausted
                    _finish(
                        delivery,
                        status=(
                            NotificationDelivery.Status.PENDING if retryable else NotificationDelivery.Status.FAILED
                        ),
                        provider="evolution_whatsapp",
                        result=result,
                    )
                    error = delivery.error_message
                    fallback = not retryable
                    if not retryable:
                        logger.warning(
                            "notification_whatsapp_delivery_failed_terminal",
                            extra={
                                "notification_id": notification.id,
                                "attempt_count": delivery.attempt_count,
                                "retry_exhausted": exhausted,
                                "error": error,
                            },
                        )
    except (Notification.DoesNotExist, NotificationDelivery.DoesNotExist):
        logger.warning("notification_whatsapp_delivery_missing", extra={"notification_id": notification_id})
        return {"status": "missing"}
    except Exception as exc:
        logger.exception("notification_whatsapp_task_failed", extra={"notification_id": notification_id})
        error = _safe_error(exc)
        retryable = self.request.retries < _max_retries()

    if fallback:
        _queue_email_fallback(notification_id, email_payload or {}, email_enabled)
    if retryable:
        raise self.retry(
            exc=RuntimeError(error or "Temporary WhatsApp delivery failure."),
            countdown=_retry_countdown(self.request.retries),
            max_retries=_max_retries(),
        )
    if delivery is None:
        return {"status": "failed", "error": error}
    return {"status": delivery.status, "attempt_count": delivery.attempt_count}


@shared_task(bind=True, acks_late=True, reject_on_worker_lost=True, max_retries=3)
def deliver_email_notification(
    self,
    notification_id: int,
    email_payload: dict | None = None,
    email_enabled: bool = True,
    allow_after_whatsapp_success: bool = False,
):
    delivery = None
    retryable = False
    error = ""
    try:
        with transaction.atomic():
            notification = Notification.objects.select_related("recipient").select_for_update().get(pk=notification_id)
            whatsapp = NotificationDelivery.objects.select_for_update().get(
                notification=notification,
                channel=NotificationDelivery.Channel.WHATSAPP,
            )
            if not allow_after_whatsapp_success and whatsapp.status not in {
                NotificationDelivery.Status.FAILED,
                NotificationDelivery.Status.SKIPPED,
            }:
                return {"status": "blocked", "whatsapp_status": whatsapp.status}
            delivery, _ = NotificationDelivery.objects.get_or_create(
                notification=notification,
                channel=NotificationDelivery.Channel.EMAIL,
                defaults={"recipient": notification.recipient, "status": NotificationDelivery.Status.PENDING},
            )
            delivery = NotificationDelivery.objects.select_for_update().get(pk=delivery.pk)
            if delivery.status in {
                NotificationDelivery.Status.SENT,
                NotificationDelivery.Status.FAILED,
                NotificationDelivery.Status.SKIPPED,
            }:
                return {"status": delivery.status, "attempt_count": delivery.attempt_count}
            if delivery.attempt_count > self.request.retries:
                return {"status": delivery.status, "attempt_count": delivery.attempt_count, "duplicate": True}
            if not email_enabled:
                _finish(
                    delivery,
                    status=NotificationDelivery.Status.SKIPPED,
                    provider="bird",
                    result={"error": "Email fallback is disabled."},
                )
            else:
                from .dispatcher import _send_email

                payload = email_payload or {}
                template = payload.get("template") or ""
                if payload.get("template_kind") == "callable" and template:
                    template = import_string(template)
                try:
                    result = _send_email(
                        recipient=notification.recipient,
                        title=notification.title,
                        message=notification.message,
                        action_url=notification.action_url,
                        template=template,
                        context=payload.get("context") or {},
                        timeout=int(getattr(settings, "NOTIFICATION_DELIVERY_TIMEOUT_SECONDS", 10)),
                    )
                except Exception as exc:
                    logger.exception(
                        "notification_email_delivery_exception", extra={"notification_id": notification.id}
                    )
                    result = {"success": False, "provider": "bird", "error": str(exc)}

                if result.get("success"):
                    _finish(delivery, status=NotificationDelivery.Status.SENT, provider="bird", result=result)
                elif result.get("skipped"):
                    _finish(delivery, status=NotificationDelivery.Status.SKIPPED, provider="bird", result=result)
                    logger.warning(
                        "notification_email_invalid_recipient",
                        extra={"notification_id": notification.id, "error": delivery.error_message},
                    )
                else:
                    exhausted = self.request.retries >= _max_retries()
                    retryable = _is_retryable(result) and not exhausted
                    _finish(
                        delivery,
                        status=(
                            NotificationDelivery.Status.PENDING if retryable else NotificationDelivery.Status.FAILED
                        ),
                        provider="bird",
                        result=result,
                    )
                    error = delivery.error_message
                    if not retryable:
                        logger.warning(
                            "notification_email_delivery_failed_terminal",
                            extra={
                                "notification_id": notification.id,
                                "attempt_count": delivery.attempt_count,
                                "retry_exhausted": exhausted,
                                "error": error,
                            },
                        )
    except (Notification.DoesNotExist, NotificationDelivery.DoesNotExist):
        logger.warning("notification_email_delivery_missing", extra={"notification_id": notification_id})
        return {"status": "missing"}
    except Exception as exc:
        logger.exception("notification_email_task_failed", extra={"notification_id": notification_id})
        error = _safe_error(exc)
        retryable = self.request.retries < _max_retries()

    if retryable:
        raise self.retry(
            exc=RuntimeError(error or "Temporary email delivery failure."),
            countdown=_retry_countdown(self.request.retries),
            max_retries=_max_retries(),
        )
    if delivery is None:
        return {"status": "failed", "error": error}
    return {"status": delivery.status, "attempt_count": delivery.attempt_count}


@shared_task
def cleanup_expired_notifications(days: int = 90):
    call_command("cleanup_notifications", days=max(1, int(days)))


# related_object_type -> (English, Arabic) plural label for the digest line.
_DIGEST_LABELS = {
    "contract_ratings.contractrating": ("contract ratings", "تقييمات العقود"),
    "employees.contractdecision": ("contract decisions", "قرارات العقود"),
    "leave_request": ("leave requests", "طلبات الإجازة"),
    "loan_request": ("loan requests", "طلبات القروض"),
    "employee_archive": ("employee archive requests", "طلبات أرشفة الموظفين"),
    "profile_change_request": ("profile change requests", "طلبات تعديل البيانات"),
    "permission_request": ("permission requests", "طلبات الاستئذان"),
    "exit_permission": ("permission requests", "طلبات الاستئذان"),
    "late_permission": ("permission requests", "طلبات الاستئذان"),
    "during_shift_permission": ("permission requests", "طلبات الاستئذان"),
}
_DIGEST_OTHER = ("other items", "عناصر أخرى")


@shared_task
def send_executive_digest():
    """Send each executive ONE WhatsApp/email summarising what their policy held back."""
    from collections import OrderedDict

    from django.contrib.auth import get_user_model
    from django.utils import timezone

    from .dispatcher import dispatch_notification_channels
    from .executive_policy import DIGEST_EVENT_KEY, HELD_DIGESTED, HELD_FOR_DIGEST
    from .i18n import notification_text, pair

    held = NotificationDelivery.objects.filter(
        channel=NotificationDelivery.Channel.WHATSAPP,
        status=NotificationDelivery.Status.SKIPPED,
        error_message=HELD_FOR_DIGEST,
    )
    users = get_user_model().objects.filter(is_active=True, id__in=held.values("recipient_id")).distinct()
    today = timezone.localdate().isoformat()
    sent = 0
    for user in users:
        # Items the executive already opened need no summary line.
        items = (
            Notification.objects.filter(
                recipient=user,
                read_at__isnull=True,
                deliveries__in=held.filter(recipient=user),
            )
            .order_by()  # the model's default ordering would defeat distinct()
            .values_list("related_object_type", "related_object_id")
            .distinct()
        )
        counts: OrderedDict[tuple[str, str], int] = OrderedDict()
        for object_type, _object_id in items:
            label = _DIGEST_LABELS.get(object_type, _DIGEST_OTHER)
            counts[label] = counts.get(label, 0) + 1
        if counts:
            summary = pair(
                ", ".join(f"{n} {en}" for (en, _ar), n in counts.items()),
                "، ".join(f"{n} {ar}" for (_en, ar), n in counts.items()),
            )
            is_ceo = user.groups.filter(name="CEO").exists()
            try:
                result = dispatch_notification_channels(
                    recipient=user,
                    event_key=DIGEST_EVENT_KEY,
                    **notification_text("executive.digest", count=sum(counts.values()), summary=summary),
                    category=Notification.Category.SYSTEM,
                    action_url="/ceo/" if is_ceo else "/employee/",
                    deduplication_key=f"{DIGEST_EVENT_KEY}:{user.id}:{today}",
                )
            except Exception:
                logger.exception("executive_digest_failed", extra={"recipient_id": user.id})
                continue
            if result.get("notification") is None:
                continue
            sent += 1
        held.filter(recipient=user).update(error_message=HELD_DIGESTED)
    return {"recipients": sent}
