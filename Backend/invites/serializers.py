from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from rest_framework import serializers

from .models import Invite

User = get_user_model()

ALLOWED_ROLES = {"SystemAdmin", "HRManager", "Manager", "Employee", "CEO", "CFO"}


class InviteCreateSerializer(serializers.Serializer):
    email = serializers.EmailField()
    role = serializers.CharField()
    expires_in_hours = serializers.IntegerField(min_value=1, required=False)

    def validate_role(self, value: str) -> str:
        if value not in ALLOWED_ROLES:
            raise serializers.ValidationError("Invalid role.")
        return value

    def validate_email(self, value: str) -> str:
        normalized = value.strip().lower()
        # Recommended behavior from spec: prevent or warn if already registered.
        # For Phase 1: hard-block to keep it clean.
        if User.objects.filter(email__iexact=normalized).exists():
            raise serializers.ValidationError("Email is already registered.")
        return normalized


class InviteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Invite
        fields = [
            "id",
            "email",
            "role",
            "status",
            "sent_at",
            "expires_at",
            "resend_count",
            "last_resent_at",
        ]


class InviteAcceptSerializer(serializers.Serializer):
    token = serializers.CharField()
    full_name = serializers.CharField(max_length=255, required=False, allow_blank=True)
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        token = attrs.get("token", "").strip()
        try:
            invite = Invite.objects.get(token=token)
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

        attrs["invite"] = invite
        return attrs

    def validate_password(self, value):
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages))
        return value
