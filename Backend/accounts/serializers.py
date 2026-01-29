from django.contrib.auth import authenticate
from rest_framework import serializers

from .security import get_client_ip, is_locked_out, record_login_failure, clear_login_failures
from audit.utils import audit

class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField()

    def validate(self, attrs):
        request = self.context.get("request")
        email = (attrs.get("email") or "").strip().lower()
        ip_address = get_client_ip(request) if request else ""

        if is_locked_out(email, ip_address):
            if request:
                audit(
                    request,
                    action="login_failure",
                    entity="auth",
                    metadata={"email": email, "reason": "locked"},
                )
            raise serializers.ValidationError({"non_field_errors": ["Invalid credentials"]})

        user = authenticate(username=email, password=attrs["password"])
        if not user or not user.is_active:
            record_login_failure(email, ip_address)
            if request:
                audit(
                    request,
                    action="login_failure",
                    entity="auth",
                    metadata={"email": email, "reason": "invalid_credentials"},
                )
            raise serializers.ValidationError({"non_field_errors": ["Invalid credentials"]})

        clear_login_failures(email, ip_address)
        attrs["user"] = user
        return attrs

class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField()
    new_password = serializers.CharField(min_length=8)
