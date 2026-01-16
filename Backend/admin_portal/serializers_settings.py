from rest_framework import serializers
from .models import SystemSettings


class PasswordPolicySerializer(serializers.Serializer):
    min_length = serializers.IntegerField(min_value=6, max_value=128)
    require_upper = serializers.BooleanField()
    require_lower = serializers.BooleanField()
    require_number = serializers.BooleanField()
    require_special = serializers.BooleanField()


class SessionSerializer(serializers.Serializer):
    timeout_minutes = serializers.IntegerField(min_value=5, max_value=1440)


class InvitesSerializer(serializers.Serializer):
    default_expiry_hours = serializers.IntegerField(min_value=1, max_value=720)


class SecuritySerializer(serializers.Serializer):
    max_login_attempts = serializers.IntegerField(min_value=1, max_value=50)


class SettingsResponseSerializer(serializers.Serializer):
    password_policy = PasswordPolicySerializer()
    session = SessionSerializer()
    invites = InvitesSerializer()
    security = SecuritySerializer()
    updated_at = serializers.DateTimeField()


class SettingsUpdateSerializer(serializers.Serializer):
    password_policy = PasswordPolicySerializer()
    session = SessionSerializer()
    invites = InvitesSerializer()
    security = SecuritySerializer()

    def validate(self, attrs):
        # Reject unknown top-level fields
        allowed = {"password_policy", "session", "invites", "security"}
        unknown = set(self.initial_data.keys()) - allowed
        if unknown:
            raise serializers.ValidationError({k: ["Unknown field."] for k in sorted(unknown)})
        return attrs

    def save(self):
        settings_obj = SystemSettings.get_solo()
        before = {
            "password_min_length": settings_obj.password_min_length,
            "password_require_upper": settings_obj.password_require_upper,
            "password_require_lower": settings_obj.password_require_lower,
            "password_require_number": settings_obj.password_require_number,
            "password_require_special": settings_obj.password_require_special,
            "session_timeout_minutes": settings_obj.session_timeout_minutes,
            "max_login_attempts": settings_obj.max_login_attempts,
            "default_invite_expiry_hours": settings_obj.default_invite_expiry_hours,
        }

        pp = self.validated_data["password_policy"]
        se = self.validated_data["session"]
        inv = self.validated_data["invites"]
        sec = self.validated_data["security"]

        settings_obj.password_min_length = pp["min_length"]
        settings_obj.password_require_upper = pp["require_upper"]
        settings_obj.password_require_lower = pp["require_lower"]
        settings_obj.password_require_number = pp["require_number"]
        settings_obj.password_require_special = pp["require_special"]

        settings_obj.session_timeout_minutes = se["timeout_minutes"]
        settings_obj.default_invite_expiry_hours = inv["default_expiry_hours"]
        settings_obj.max_login_attempts = sec["max_login_attempts"]

        settings_obj.save()

        after = {
            "password_min_length": settings_obj.password_min_length,
            "password_require_upper": settings_obj.password_require_upper,
            "password_require_lower": settings_obj.password_require_lower,
            "password_require_number": settings_obj.password_require_number,
            "password_require_special": settings_obj.password_require_special,
            "session_timeout_minutes": settings_obj.session_timeout_minutes,
            "max_login_attempts": settings_obj.max_login_attempts,
            "default_invite_expiry_hours": settings_obj.default_invite_expiry_hours,
        }

        changed = {k: {"from": before[k], "to": after[k]} for k in before.keys() if before[k] != after[k]}
        return settings_obj, changed


def to_settings_response(settings_obj: SystemSettings):
    return {
        "password_policy": {
            "min_length": settings_obj.password_min_length,
            "require_upper": settings_obj.password_require_upper,
            "require_lower": settings_obj.password_require_lower,
            "require_number": settings_obj.password_require_number,
            "require_special": settings_obj.password_require_special,
        },
        "session": {
            "timeout_minutes": settings_obj.session_timeout_minutes,
        },
        "invites": {
            "default_expiry_hours": settings_obj.default_invite_expiry_hours,
        },
        "security": {
            "max_login_attempts": settings_obj.max_login_attempts,
        },
        "updated_at": settings_obj.updated_at,
    }
