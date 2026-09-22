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


class AttendanceSettingsSerializer(serializers.Serializer):
    geofence_enabled = serializers.BooleanField(required=False)
    work_day_start_time = serializers.TimeField(required=False)
    default_shift_end_time = serializers.TimeField(required=False)
    late_grace_minutes = serializers.IntegerField(required=False, min_value=0, max_value=240)
    grace_window_minutes = serializers.IntegerField(required=False, min_value=0, max_value=240)
    post_grace_tolerance_minutes = serializers.IntegerField(required=False, min_value=0, max_value=240)
    approved_late_permission_limit_per_month = serializers.IntegerField(required=False, min_value=0, max_value=31)
    during_shift_permission_max_minutes = serializers.IntegerField(required=False, min_value=1, max_value=1440)
    permission_request_advance_limit_days = serializers.IntegerField(required=False, min_value=0, max_value=365)
    absence_detection_enabled = serializers.BooleanField(required=False)

    def validate(self, attrs):
        legacy_value = attrs.get("late_grace_minutes")
        canonical_value = attrs.get("grace_window_minutes")
        if legacy_value is not None and canonical_value is not None and legacy_value != canonical_value:
            raise serializers.ValidationError(
                {"grace_window_minutes": "Must match late_grace_minutes when both fields are supplied."}
            )
        grace_value = canonical_value if canonical_value is not None else legacy_value
        if grace_value is not None:
            # The wire contract accepts the legacy alias, but internal policy
            # always stores/uses the canonical grace_window_minutes value.
            attrs["grace_window_minutes"] = grace_value
            attrs["late_grace_minutes"] = grace_value
        return attrs


def _attendance_snapshot(settings_obj: SystemSettings):
    return {
        "geofence_attendance_enabled": settings_obj.geofence_attendance_enabled,
        "work_day_start_time": settings_obj.work_day_start_time.isoformat(),
        "default_shift_end_time": settings_obj.default_shift_end_time.isoformat(),
        "late_grace_minutes": settings_obj.late_grace_minutes,
        "grace_window_minutes": settings_obj.grace_window_minutes,
        "post_grace_tolerance_minutes": settings_obj.post_grace_tolerance_minutes,
        "approved_late_permission_limit_per_month": settings_obj.approved_late_permission_limit_per_month,
        "during_shift_permission_max_minutes": settings_obj.during_shift_permission_max_minutes,
        "permission_request_advance_limit_days": settings_obj.permission_request_advance_limit_days,
        "absence_detection_enabled": settings_obj.absence_detection_enabled,
    }


def _apply_attendance_settings(settings_obj: SystemSettings, attendance: dict):
    field_map = {
        "geofence_enabled": "geofence_attendance_enabled",
        "work_day_start_time": "work_day_start_time",
        "default_shift_end_time": "default_shift_end_time",
        "post_grace_tolerance_minutes": "post_grace_tolerance_minutes",
        "approved_late_permission_limit_per_month": "approved_late_permission_limit_per_month",
        "during_shift_permission_max_minutes": "during_shift_permission_max_minutes",
        "permission_request_advance_limit_days": "permission_request_advance_limit_days",
        "absence_detection_enabled": "absence_detection_enabled",
    }
    for payload_field, model_field in field_map.items():
        if payload_field in attendance:
            setattr(settings_obj, model_field, attendance[payload_field])
    if "grace_window_minutes" in attendance:
        settings_obj.grace_window_minutes = attendance["grace_window_minutes"]
        settings_obj.late_grace_minutes = attendance["grace_window_minutes"]


class AttendanceSettingsUpdateSerializer(serializers.Serializer):
    """Attendance-only payload used by HR Manager and System Admin."""

    attendance = AttendanceSettingsSerializer()

    def validate(self, attrs):
        unknown = set(self.initial_data.keys()) - {"attendance"}
        if unknown:
            raise serializers.ValidationError({key: ["Unknown field."] for key in sorted(unknown)})
        if not attrs["attendance"]:
            raise serializers.ValidationError({"attendance": "At least one attendance setting is required."})
        return attrs

    def save(self):
        settings_obj = SystemSettings.get_solo()
        before = _attendance_snapshot(settings_obj)
        _apply_attendance_settings(settings_obj, self.validated_data["attendance"])
        settings_obj.save()
        after = _attendance_snapshot(settings_obj)
        changed = {key: {"from": before[key], "to": after[key]} for key in before if before[key] != after[key]}
        return settings_obj, changed


class SettingsResponseSerializer(serializers.Serializer):
    password_policy = PasswordPolicySerializer()
    session = SessionSerializer()
    invites = InvitesSerializer()
    security = SecuritySerializer()
    attendance = AttendanceSettingsSerializer()
    updated_at = serializers.DateTimeField()


class SettingsUpdateSerializer(serializers.Serializer):
    password_policy = PasswordPolicySerializer()
    session = SessionSerializer()
    invites = InvitesSerializer()
    security = SecuritySerializer()
    attendance = AttendanceSettingsSerializer(required=False)

    def validate(self, attrs):
        # Reject unknown top-level fields
        allowed = {"password_policy", "session", "invites", "security", "attendance"}
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
            "geofence_attendance_enabled": settings_obj.geofence_attendance_enabled,
            "work_day_start_time": settings_obj.work_day_start_time.isoformat(),
            "default_shift_end_time": settings_obj.default_shift_end_time.isoformat(),
            "late_grace_minutes": settings_obj.late_grace_minutes,
            "grace_window_minutes": settings_obj.grace_window_minutes,
                "post_grace_tolerance_minutes": settings_obj.post_grace_tolerance_minutes,
            "approved_late_permission_limit_per_month": settings_obj.approved_late_permission_limit_per_month,
            "during_shift_permission_max_minutes": settings_obj.during_shift_permission_max_minutes,
            "permission_request_advance_limit_days": settings_obj.permission_request_advance_limit_days,
            "absence_detection_enabled": settings_obj.absence_detection_enabled,
            }

        pp = self.validated_data["password_policy"]
        se = self.validated_data["session"]
        inv = self.validated_data["invites"]
        sec = self.validated_data["security"]
        attendance = self.validated_data.get("attendance")

        settings_obj.password_min_length = pp["min_length"]
        settings_obj.password_require_upper = pp["require_upper"]
        settings_obj.password_require_lower = pp["require_lower"]
        settings_obj.password_require_number = pp["require_number"]
        settings_obj.password_require_special = pp["require_special"]

        settings_obj.session_timeout_minutes = se["timeout_minutes"]
        settings_obj.default_invite_expiry_hours = inv["default_expiry_hours"]
        settings_obj.max_login_attempts = sec["max_login_attempts"]
        if attendance is not None:
            _apply_attendance_settings(settings_obj, attendance)

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
            "geofence_attendance_enabled": settings_obj.geofence_attendance_enabled,
            "work_day_start_time": settings_obj.work_day_start_time.isoformat(),
            "default_shift_end_time": settings_obj.default_shift_end_time.isoformat(),
            "late_grace_minutes": settings_obj.late_grace_minutes,
            "grace_window_minutes": settings_obj.grace_window_minutes,
                "post_grace_tolerance_minutes": settings_obj.post_grace_tolerance_minutes,
            "approved_late_permission_limit_per_month": settings_obj.approved_late_permission_limit_per_month,
            "during_shift_permission_max_minutes": settings_obj.during_shift_permission_max_minutes,
            "permission_request_advance_limit_days": settings_obj.permission_request_advance_limit_days,
            "absence_detection_enabled": settings_obj.absence_detection_enabled,
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
        "attendance": {
            "geofence_enabled": settings_obj.geofence_attendance_enabled,
            "work_day_start_time": settings_obj.work_day_start_time.strftime("%H:%M"),
            "default_shift_end_time": settings_obj.default_shift_end_time.strftime("%H:%M"),
            "late_grace_minutes": settings_obj.late_grace_minutes,
            "grace_window_minutes": settings_obj.grace_window_minutes,
                "post_grace_tolerance_minutes": settings_obj.post_grace_tolerance_minutes,
            "approved_late_permission_limit_per_month": settings_obj.approved_late_permission_limit_per_month,
            "during_shift_permission_max_minutes": settings_obj.during_shift_permission_max_minutes,
            "permission_request_advance_limit_days": settings_obj.permission_request_advance_limit_days,
            "absence_detection_enabled": settings_obj.absence_detection_enabled,
            },
        "updated_at": settings_obj.updated_at,
    }
