from django.contrib.auth import authenticate, get_user_model
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed

from audit.utils import audit

from .password_policy import validate_password_against_policy
from .security import clear_login_failures, get_client_ip, get_lockout_remaining_seconds, is_locked_out, record_login_failure

User = get_user_model()


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField()

    def validate(self, attrs):
        request = self.context.get("request")
        raw_email = (attrs.get("email") or "").strip()
        email = raw_email.lower()
        ip_address = get_client_ip(request) if request else ""

        if is_locked_out(email, ip_address):
            remaining_seconds = get_lockout_remaining_seconds(email, ip_address)
            remaining_minutes = max(1, (remaining_seconds + 59) // 60)
            if request:
                audit(
                    request,
                    action="login_failure",
                    entity="auth",
                    metadata={"email": email, "reason": "locked"},
                )
            raise AuthenticationFailed(
                f"Too many failed login attempts. Try again in about {remaining_minutes} minute(s)."
            )

        # Resolve canonical stored email case first, then authenticate.
        # Django auth lookup for USERNAME_FIELD is case-sensitive by default.
        existing_user = User.objects.filter(email__iexact=raw_email).only("email").first()
        email_for_auth = existing_user.email if existing_user else email
        user = authenticate(username=email_for_auth, password=attrs["password"])
        if not user or not user.is_active:
            record_login_failure(email, ip_address)
            if request:
                audit(
                    request,
                    action="login_failure",
                    entity="auth",
                    metadata={"email": email, "reason": "invalid_credentials"},
                )
            raise AuthenticationFailed("Invalid credentials")

        clear_login_failures(email, ip_address)
        attrs["user"] = user
        return attrs


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField()
    new_password = serializers.CharField()

    def validate_new_password(self, value):
        try:
            validate_password_against_policy(value)
        except serializers.ValidationError:
            raise
        except Exception as exc:
            raise serializers.ValidationError(list(getattr(exc, "messages", [str(exc)])))
        return value
