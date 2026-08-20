from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from rest_framework import serializers

from accounts.password_policy import validate_password_against_policy
from core.permissions import get_role
from core.services.messaging_providers import is_e164, normalize_phone_number

from .models import Invite

User = get_user_model()

ALLOWED_ROLES = {"SystemAdmin", "HRManager", "Employee", "CEO", "CFO"}
UNSUPPORTED_ACCEPT_ROLES = {"Manager"}
UNSUPPORTED_MANAGER_INVITE_MESSAGE = "Manager role invites are no longer supported. Ask HR to resend as Employee."


class InviteCreateSerializer(serializers.Serializer):
    email = serializers.EmailField(required=False, allow_blank=True, allow_null=True)
    phone_number = serializers.CharField(required=False, allow_blank=True, max_length=32)
    channel = serializers.ChoiceField(choices=Invite.Channel.choices, required=False, default=Invite.Channel.EMAIL)
    role = serializers.CharField()
    expires_in_hours = serializers.IntegerField(min_value=1, required=False)

    def validate_role(self, value: str) -> str:
        if value not in ALLOWED_ROLES:
            raise serializers.ValidationError("Invalid role.")
        return value

    def validate(self, attrs):
        request = self.context.get("request")
        requester = getattr(request, "user", None)
        requested_role = attrs.get("role")
        channel = attrs.get("channel") or Invite.Channel.EMAIL
        email = (attrs.get("email") or "").strip().lower()
        phone_number = normalize_phone_number(attrs.get("phone_number"))

        if requested_role == "SystemAdmin" and get_role(requester) != "SystemAdmin":
            raise serializers.ValidationError({"role": ["Only SystemAdmin can assign SystemAdmin role."]})

        errors = {}
        if channel == Invite.Channel.EMAIL and not email:
            errors["email"] = ["This field is required for email invites."]
        if channel == Invite.Channel.WHATSAPP:
            if not phone_number:
                errors["phone_number"] = ["This field is required for WhatsApp invites."]
            elif not is_e164(phone_number):
                errors["phone_number"] = ["Phone number must be in E.164 format."]

        if errors:
            raise serializers.ValidationError(errors)

        attrs["channel"] = channel
        attrs["email"] = email or None
        attrs["phone_number"] = phone_number or None
        return attrs

    def validate_email(self, value: str | None) -> str:
        if value is None:
            return ""
        normalized = value.strip().lower()
        if not normalized:
            return ""
        # Recommended behavior from spec: prevent or warn if already registered.
        # For Phase 1: hard-block to keep it clean.
        if User.objects.filter(email__iexact=normalized).exists():
            raise serializers.ValidationError("Email is already registered.")
        return normalized


class InviteSerializer(serializers.ModelSerializer):
    email_delivery = serializers.SerializerMethodField()
    whatsapp_delivery = serializers.SerializerMethodField()
    last_delivery = serializers.SerializerMethodField()

    DELIVERY_STATUS_LABELS = {
        Invite.DeliveryStatus.UNKNOWN: "Pending",
        Invite.DeliveryStatus.QUEUED: "Queued",
        Invite.DeliveryStatus.SENT: "Submitted",
        Invite.DeliveryStatus.DELIVERED: "Delivered",
        Invite.DeliveryStatus.READ: "Read",
        Invite.DeliveryStatus.FAILED: "Failed",
    }

    class Meta:
        model = Invite
        fields = [
            "id",
            "email",
            "phone_number",
            "channel",
            "role",
            "status",
            "sent_at",
            "expires_at",
            "resend_count",
            "last_resent_at",
            "email_delivery",
            "whatsapp_delivery",
            "last_delivery",
        ]

    def get_email_delivery(self, obj: Invite) -> dict | None:
        return self._delivery_for_channel(obj, Invite.Channel.EMAIL)

    def get_whatsapp_delivery(self, obj: Invite) -> dict | None:
        return self._delivery_for_channel(obj, Invite.Channel.WHATSAPP)

    def get_last_delivery(self, obj: Invite) -> dict | None:
        if not obj.last_delivery_channel:
            return None
        return self._delivery_payload(obj)

    def _delivery_for_channel(self, obj: Invite, channel: str) -> dict | None:
        if obj.last_delivery_channel != channel:
            return None
        return self._delivery_payload(obj)

    def _delivery_payload(self, obj: Invite) -> dict:
        attempted_at = obj.last_delivery_at.isoformat() if obj.last_delivery_at else None
        delivery_status = obj.delivery_status or Invite.DeliveryStatus.UNKNOWN
        is_actual_sent = delivery_status in {
            Invite.DeliveryStatus.SENT,
            Invite.DeliveryStatus.DELIVERED,
            Invite.DeliveryStatus.READ,
        }
        return {
            "channel": obj.last_delivery_channel,
            "channel_label": self._channel_label(obj.last_delivery_channel),
            "sent": obj.last_delivery_sent,
            "provider_submitted": obj.provider_submitted,
            "provider_label": self._provider_label(obj.last_delivery_channel),
            "provider": obj.last_delivery_provider or None,
            "provider_status": obj.provider_status or None,
            "delivery_status": delivery_status,
            "delivery_status_label": self._delivery_status_label(delivery_status),
            "delivery_summary": self._delivery_summary(obj.last_delivery_channel, delivery_status),
            "status_code": obj.last_delivery_status_code,
            "message_id": obj.last_delivery_message_id or None,
            "external_message_id": obj.external_message_id or obj.last_delivery_message_id or None,
            "error": obj.last_delivery_error or None,
            "attempted_at": attempted_at,
            "submitted_at": attempted_at if obj.provider_submitted else None,
            "sent_at": attempted_at if is_actual_sent else None,
        }

    def _channel_label(self, channel: str) -> str:
        if channel == Invite.Channel.WHATSAPP:
            return "WhatsApp"
        if channel == Invite.Channel.EMAIL:
            return "Email"
        return "Delivery"

    def _provider_label(self, channel: str) -> str:
        if channel == Invite.Channel.WHATSAPP:
            return "WhatsApp delivery service"
        if channel == Invite.Channel.EMAIL:
            return "Email delivery service"
        return "Delivery service"

    def _delivery_status_label(self, delivery_status: str) -> str:
        return self.DELIVERY_STATUS_LABELS.get(delivery_status, "Pending")

    def _delivery_summary(self, channel: str, delivery_status: str) -> str:
        channel_label = self._channel_label(channel)
        status_label = self._delivery_status_label(delivery_status)
        if delivery_status == Invite.DeliveryStatus.FAILED:
            return f"{channel_label} delivery failed"
        if delivery_status == Invite.DeliveryStatus.QUEUED:
            return f"{channel_label} delivery queued"
        if delivery_status == Invite.DeliveryStatus.SENT:
            return f"{channel_label} invite submitted"
        if delivery_status in {Invite.DeliveryStatus.DELIVERED, Invite.DeliveryStatus.READ}:
            return f"{channel_label} invite {status_label.lower()}"
        return f"{channel_label} delivery pending"


class InviteAcceptSerializer(serializers.Serializer):
    token = serializers.CharField()
    email = serializers.EmailField(required=False, allow_blank=True)
    phone_number = serializers.CharField(required=False, allow_blank=True, max_length=32)
    full_name = serializers.CharField(max_length=255, required=False, allow_blank=True)
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        token = attrs.get("token", "").strip()
        try:
            invite = Invite.objects.select_for_update().get(token=token)
        except Invite.DoesNotExist:
            raise serializers.ValidationError({"token": "Invalid invitation token."})

        # Normalize expired state first.
        invite.refresh_expired_status_if_needed()

        if invite.status == Invite.Status.ACCEPTED:
            raise serializers.ValidationError({"token": "Invitation already accepted."})
        if invite.status == Invite.Status.REVOKED:
            raise serializers.ValidationError({"token": "Invitation has been revoked."})
        if invite.status == Invite.Status.EXPIRED or invite.expires_at <= timezone.now():
            raise serializers.ValidationError({"token": "Invitation has expired."})
        if invite.role in UNSUPPORTED_ACCEPT_ROLES:
            raise serializers.ValidationError({"role": UNSUPPORTED_MANAGER_INVITE_MESSAGE})

        invite_email = (invite.email or "").strip().lower()
        submitted_email = (attrs.get("email") or "").strip().lower()
        if invite_email:
            if submitted_email and submitted_email != invite_email:
                raise serializers.ValidationError({"email": "Email must match the invitation email."})
            attrs["email"] = invite_email
        else:
            if not submitted_email:
                raise serializers.ValidationError({"email": "Email is required for this invitation."})
            if User.objects.filter(email__iexact=submitted_email).exists():
                raise serializers.ValidationError({"email": "Email is already registered."})
            attrs["email"] = submitted_email

        submitted_phone = normalize_phone_number(attrs.get("phone_number"))
        if submitted_phone and not is_e164(submitted_phone):
            raise serializers.ValidationError({"phone_number": "Phone number must be in E.164 format."})
        attrs["phone_number"] = submitted_phone or invite.phone_number or ""
        attrs["submitted_phone_number"] = submitted_phone

        attrs["invite"] = invite
        return attrs

    def validate_password(self, value):
        try:
            validate_password_against_policy(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages))
        return value


class WhatsAppProviderTestSerializer(serializers.Serializer):
    phone_number = serializers.CharField(max_length=32)

    def validate_phone_number(self, value: str) -> str:
        phone_number = normalize_phone_number(value)
        if not phone_number:
            raise serializers.ValidationError("phone_number is required.")
        if not is_e164(phone_number):
            raise serializers.ValidationError("Phone number must be in E.164 format.")
        return phone_number
