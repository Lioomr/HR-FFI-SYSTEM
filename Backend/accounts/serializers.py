from django.contrib.auth import authenticate, get_user_model
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.tokens import RefreshToken

from audit.utils import audit

from .security import (
    clear_login_failures,
    get_client_ip,
    is_locked_out,
    record_login_failure,
)

User = get_user_model()

INVALID_CREDENTIALS_MESSAGE = "Unable to authenticate with the provided credentials."
INVALID_TOKEN_MESSAGE = "Token is invalid or expired."


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField()

    def validate(self, attrs):
        request = self.context.get("request")
        raw_email = (attrs.get("email") or "").strip()
        email = raw_email.lower()
        ip_address = get_client_ip(request) if request else ""

        if is_locked_out(email, ip_address):
            if request:
                audit(
                    request,
                    action="login_failure",
                    entity="auth",
                    metadata={"email": email, "reason": "locked"},
                )
            raise AuthenticationFailed(INVALID_CREDENTIALS_MESSAGE)

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
            raise AuthenticationFailed(INVALID_CREDENTIALS_MESSAGE)

        clear_login_failures(email, ip_address)
        attrs["user"] = user
        return attrs


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField()
    new_password = serializers.CharField()


class VersionedTokenRefreshSerializer(TokenRefreshSerializer):
    token_class = RefreshToken

    def validate(self, attrs):
        try:
            refresh = self.token_class(attrs["refresh"])
            user_id = refresh.get(api_settings.USER_ID_CLAIM)
            user = User.objects.only("is_active", "auth_token_version").get(
                **{api_settings.USER_ID_FIELD: user_id}
            )
            token_version = refresh.get("token_version")
            if (
                type(token_version) is not int
                or not user.is_active
                or token_version != user.auth_token_version
            ):
                raise InvalidToken(INVALID_TOKEN_MESSAGE)

            data = super().validate(attrs)
        except (KeyError, TypeError, ValueError, User.DoesNotExist, TokenError):
            raise InvalidToken(INVALID_TOKEN_MESSAGE) from None

        data["token"] = data["access"]
        return data
