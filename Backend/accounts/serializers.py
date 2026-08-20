from django.contrib.auth import authenticate, get_user_model
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.tokens import RefreshToken

from audit.utils import audit
from core.services.messaging_providers import normalize_phone_number
from employees.models import EmployeeProfile

from .security import (
    clear_login_failures,
    get_client_ip,
    is_locked_out,
    record_login_failure,
)

User = get_user_model()

INVALID_CREDENTIALS_MESSAGE = "Unable to authenticate with the provided credentials."
INVALID_TOKEN_MESSAGE = "Token is invalid or expired."
AMBIGUOUS_PHONE_MESSAGE = "Phone number matches more than one account. Use full international format including country code."


def _phone_digits(value: str) -> str:
    return "".join(ch for ch in value if ch.isdigit())


def _phone_login_candidates(identifier: str) -> list[str]:
    digits = _phone_digits(identifier)
    if not digits:
        return []

    candidates = []
    normalized = normalize_phone_number(identifier)
    if normalized:
        candidates.append(normalized)

    if digits.startswith(("966", "20")):
        candidates.append(f"+{digits}")
    else:
        local_digits = digits[1:] if digits.startswith("0") else digits
        if local_digits:
            candidates.extend([f"+966{local_digits}", f"+20{local_digits}"])

    seen = set()
    return [candidate for candidate in candidates if candidate and not (candidate in seen or seen.add(candidate))]


def _resolve_user_by_phone(identifier: str):
    candidates = _phone_login_candidates(identifier)
    if not candidates:
        return None

    stored_candidates = candidates + [candidate.lstrip("+") for candidate in candidates]
    profiles = (
        EmployeeProfile.objects.select_related("user")
        .filter(mobile__in=stored_candidates, user__isnull=False)
        .order_by("user_id")
    )

    users_by_id = {}
    for profile in profiles:
        users_by_id[profile.user_id] = profile.user

    if len(users_by_id) > 1:
        raise serializers.ValidationError({"identifier": [AMBIGUOUS_PHONE_MESSAGE]})
    return next(iter(users_by_id.values()), None)


class LoginSerializer(serializers.Serializer):
    email = serializers.CharField(required=False, allow_blank=True)
    identifier = serializers.CharField(required=False, allow_blank=True)
    password = serializers.CharField()

    def validate(self, attrs):
        request = self.context.get("request")
        raw_identifier = (attrs.get("identifier") or attrs.get("email") or "").strip()
        if not raw_identifier:
            raise serializers.ValidationError({"identifier": ["Email or phone number is required."]})

        identifier_key = raw_identifier.lower()
        ip_address = get_client_ip(request) if request else ""

        if is_locked_out(identifier_key, ip_address):
            if request:
                audit(
                    request,
                    action="login_failure",
                    entity="auth",
                    metadata={"identifier": identifier_key, "reason": "locked"},
                )
            raise AuthenticationFailed(INVALID_CREDENTIALS_MESSAGE)

        if "@" in raw_identifier:
            # Resolve canonical stored email case first, then authenticate.
            # Django auth lookup for USERNAME_FIELD is case-sensitive by default.
            existing_user = User.objects.filter(email__iexact=raw_identifier).only("email").first()
            email_for_auth = existing_user.email if existing_user else identifier_key
        else:
            existing_user = _resolve_user_by_phone(raw_identifier)
            email_for_auth = existing_user.email if existing_user else identifier_key

        user = authenticate(username=email_for_auth, password=attrs["password"])
        if not user or not user.is_active:
            record_login_failure(identifier_key, ip_address)
            if request:
                audit(
                    request,
                    action="login_failure",
                    entity="auth",
                    metadata={"identifier": identifier_key, "reason": "invalid_credentials"},
                )
            raise AuthenticationFailed(INVALID_CREDENTIALS_MESSAGE)

        clear_login_failures(identifier_key, ip_address)
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
            user = User.objects.only("is_active", "auth_token_version").get(**{api_settings.USER_ID_FIELD: user_id})
            token_version = refresh.get("token_version")
            if type(token_version) is not int or not user.is_active or token_version != user.auth_token_version:
                raise InvalidToken(INVALID_TOKEN_MESSAGE)

            data = super().validate(attrs)
        except (KeyError, TypeError, ValueError, User.DoesNotExist, TokenError):
            raise InvalidToken(INVALID_TOKEN_MESSAGE) from None

        data["token"] = data["access"]
        return data
