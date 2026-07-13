from __future__ import annotations

import logging
from collections.abc import Iterable

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.core.exceptions import ObjectDoesNotExist
from django.db import IntegrityError, transaction
from django.db.models import Prefetch

from .models import Notification, NotificationDelivery
from .serializers import NotificationSerializer

logger = logging.getLogger(__name__)


def _recipient_company(recipient, company=None):
    if company is not None:
        return company
    try:
        profile = recipient.employee_profile
    except (AttributeError, ObjectDoesNotExist):
        profile = None
    return getattr(profile, "company", None) if profile else None


def notification_group_name(user_id: int) -> str:
    return f"notifications.user.{user_id}"


def unread_count_for(*, recipient, company=None) -> int:
    queryset = Notification.objects.filter(recipient=recipient, read_at__isnull=True)
    if company is not None:
        queryset = queryset.filter(company=company)
    return queryset.count()


def with_delivery_details(queryset):
    return queryset.select_related("recipient").prefetch_related(
        Prefetch(
            "deliveries",
            queryset=NotificationDelivery.objects.only(
                "id",
                "notification_id",
                "recipient_id",
                "channel",
                "status",
                "provider",
                "provider_message_id",
                "error_message",
                "attempt_count",
                "created_at",
                "updated_at",
            ),
        )
    )


def _broadcast_created(notification_id: int) -> None:
    try:
        notification = with_delivery_details(Notification.objects.select_related("recipient", "company")).get(
            pk=notification_id
        )
        layer = get_channel_layer()
        if layer is None:
            return
        async_to_sync(layer.group_send)(
            notification_group_name(notification.recipient_id),
            {
                "type": "notification.created",
                "notification": NotificationSerializer(notification).data,
                "unread_count": unread_count_for(recipient=notification.recipient, company=notification.company),
            },
        )
    except Exception:
        logger.exception("notification_websocket_delivery_failed", extra={"notification_id": notification_id})


def create_notification(
    *,
    recipient,
    event_key: str,
    title: str,
    message: str = "",
    category: str = Notification.Category.SYSTEM,
    action_url: str = "",
    related_object=None,
    related_object_type: str = "",
    related_object_id: int | str | None = None,
    metadata: dict | None = None,
    deduplication_key: str = "",
    company=None,
    company_id: int | None = None,
    broadcast: bool = True,
) -> tuple[Notification | None, bool]:
    if recipient is None or not getattr(recipient, "pk", None) or not getattr(recipient, "is_active", True):
        return None, False

    if related_object is not None:
        related_object_type = related_object_type or related_object._meta.label_lower
        related_object_id = related_object_id if related_object_id is not None else related_object.pk
        company = company or getattr(related_object, "company", None)

    resolved_company = _recipient_company(recipient, company)
    values = {
        "company_id": getattr(resolved_company, "pk", None) or company_id,
        "event_key": str(event_key)[:120],
        "title": str(title)[:255],
        "message": str(message),
        "category": category,
        "action_url": str(action_url or "")[:500],
        "related_object_type": str(related_object_type or "")[:100],
        "related_object_id": str(related_object_id or "")[:100],
        "metadata": metadata or {},
        "deduplication_key": str(deduplication_key or "")[:255],
    }

    try:
        with transaction.atomic():
            if values["deduplication_key"]:
                notification, created = Notification.objects.get_or_create(
                    recipient=recipient,
                    deduplication_key=values["deduplication_key"],
                    defaults=values,
                )
            else:
                notification = Notification.objects.create(recipient=recipient, **values)
                created = True
            if created and broadcast:
                transaction.on_commit(lambda notification_id=notification.id: _broadcast_created(notification_id))
            return notification, created
    except IntegrityError:
        if values["deduplication_key"]:
            return Notification.objects.filter(
                recipient=recipient, deduplication_key=values["deduplication_key"]
            ).first(), False
        raise


def create_notifications(*, recipients: Iterable, **kwargs) -> list[Notification]:
    created_notifications = []
    seen = set()
    for recipient in recipients:
        recipient_id = getattr(recipient, "pk", None)
        if not recipient_id or recipient_id in seen:
            continue
        seen.add(recipient_id)
        notification, created = create_notification(recipient=recipient, **kwargs)
        if notification is not None and created:
            created_notifications.append(notification)
    return created_notifications
