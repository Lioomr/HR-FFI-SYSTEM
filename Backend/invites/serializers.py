from django.utils import timezone
from rest_framework import serializers
from .models import Invite
from django.contrib.auth import get_user_model

User = get_user_model()

ALLOWED_ROLES = {"SystemAdmin", "HRManager", "Employee"}


class InviteCreateSerializer(serializers.Serializer):
    email = serializers.EmailField()
    role = serializers.CharField()
    expires_in_hours = serializers.IntegerField(min_value=1)

    def validate_role(self, value: str) -> str:
        if value not in ALLOWED_ROLES:
            raise serializers.ValidationError("Invalid role.")
        return value

    def validate_email(self, value: str) -> str:
        # Recommended behavior from spec: prevent or warn if already registered.
        # For Phase 1: hard-block to keep it clean.
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("Email is already registered.")
        return value


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
