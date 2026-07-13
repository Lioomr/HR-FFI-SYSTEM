import re

from rest_framework import serializers

from accounts.permissions import get_role

from .models import Notification, NotificationDelivery

_AUTHORIZATION_PATTERN = re.compile(r"(?i)(authorization\s*:\s*(?:bearer|accesskey)\s+)\S+")
_CREDENTIAL_PATTERN = re.compile(r"(?i)(\b(?:access[_ -]?key|api[_ -]?key)\b\s*[:=]\s*)\S+")
_PHONE_PATTERN = re.compile(r"(?<!\d)\+\d{7,15}(?!\d)")


class NotificationDeliverySerializer(serializers.ModelSerializer):
    error = serializers.SerializerMethodField()

    class Meta:
        model = NotificationDelivery
        fields = [
            "channel",
            "status",
            "provider",
            "provider_message_id",
            "error",
            "attempt_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_error(self, obj):
        if not obj.error_message:
            return None
        first_line = str(obj.error_message).splitlines()[0][:300]
        redacted = _AUTHORIZATION_PATTERN.sub(lambda match: f"{match.group(1)}[redacted]", first_line)
        redacted = _CREDENTIAL_PATTERN.sub(lambda match: f"{match.group(1)}[redacted]", redacted)
        return _PHONE_PATTERN.sub("[redacted-phone]", redacted)


class NotificationSerializer(serializers.ModelSerializer):
    is_read = serializers.BooleanField(read_only=True)
    deliveries = serializers.SerializerMethodField()

    def get_deliveries(self, obj):
        deliveries = [item for item in obj.deliveries.all() if item.recipient_id == obj.recipient_id]
        channel_order = {
            NotificationDelivery.Channel.WHATSAPP: 0,
            NotificationDelivery.Channel.EMAIL: 1,
        }
        deliveries.sort(key=lambda item: (channel_order.get(item.channel, 99), item.created_at, item.id))
        if not hasattr(self, "_can_view_delivery_technical_details"):
            request = self.context.get("request")
            viewer = request.user if request is not None else obj.recipient
            self._can_view_delivery_technical_details = get_role(viewer) in {"SystemAdmin", "HRManager"}
        if not self._can_view_delivery_technical_details:
            return [{"channel": item.channel, "status": item.status} for item in deliveries]
        return NotificationDeliverySerializer(deliveries, many=True).data

    class Meta:
        model = Notification
        fields = [
            "id",
            "title",
            "message",
            "event_key",
            "category",
            "action_url",
            "related_object_type",
            "related_object_id",
            "metadata",
            "deduplication_key",
            "is_read",
            "read_at",
            "created_at",
            "deliveries",
        ]
        read_only_fields = fields
