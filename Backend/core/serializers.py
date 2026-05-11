from django.contrib.auth import get_user_model
from django.db.models import Q
from rest_framework import serializers

from employees.models import EmployeeProfile

from .models import DelegationRule, RequestObligation, UserPreference


User = get_user_model()


def delegation_rule_user_queryset():
    return User.objects.filter(
        is_active=True,
        employee_profile__employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
    ).filter(Q(employee_profile__company__is_active=True) | Q(employee_profile__company__isnull=True))


class DelegationUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "full_name"]


class DelegationRuleSerializer(serializers.ModelSerializer):
    from_user = DelegationUserSerializer(read_only=True)
    to_user = DelegationUserSerializer(read_only=True)
    from_user_id = serializers.PrimaryKeyRelatedField(
        source="from_user", queryset=delegation_rule_user_queryset(), write_only=True
    )
    to_user_id = serializers.PrimaryKeyRelatedField(
        source="to_user", queryset=delegation_rule_user_queryset(), write_only=True
    )
    created_by = DelegationUserSerializer(read_only=True)

    class Meta:
        model = DelegationRule
        fields = [
            "id",
            "from_user",
            "to_user",
            "from_user_id",
            "to_user_id",
            "start_at",
            "end_at",
            "reason",
            "is_active",
            "created_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_by", "created_at", "updated_at"]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        instance = getattr(self, "instance", None)
        from_user = attrs.get("from_user") or getattr(instance, "from_user", None)
        to_user = attrs.get("to_user") or getattr(instance, "to_user", None)
        start_at = attrs.get("start_at") or getattr(instance, "start_at", None)
        end_at = attrs.get("end_at") if "end_at" in attrs else getattr(instance, "end_at", None)
        is_active = attrs.get("is_active") if "is_active" in attrs else getattr(instance, "is_active", True)

        if from_user and to_user and from_user.id == to_user.id:
            raise serializers.ValidationError({"to_user_id": "Delegation target must be a different user."})
        if end_at and start_at and end_at <= start_at:
            raise serializers.ValidationError({"end_at": "End time must be after start time."})
        if from_user and to_user and start_at:
            duplicate_qs = DelegationRule.objects.filter(
                from_user=from_user,
                to_user=to_user,
                start_at=start_at,
                end_at=end_at,
                is_active=is_active,
            )
            if instance is not None:
                duplicate_qs = duplicate_qs.exclude(pk=instance.pk)
            if duplicate_qs.exists():
                raise serializers.ValidationError("An identical delegation rule already exists.")
        return attrs


class RequestObligationSerializer(serializers.ModelSerializer):
    type_display = serializers.CharField(source="get_type_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    severity_display = serializers.CharField(source="get_severity_display", read_only=True)
    target = serializers.SerializerMethodField()
    waived_by_name = serializers.CharField(source="waived_by.full_name", read_only=True)
    resolved_by_name = serializers.CharField(source="resolved_by.full_name", read_only=True)

    class Meta:
        model = RequestObligation
        fields = [
            "id",
            "type",
            "type_display",
            "status",
            "status_display",
            "severity",
            "severity_display",
            "title",
            "description",
            "metadata",
            "target",
            "resolved_at",
            "resolved_by",
            "resolved_by_name",
            "resolution_note",
            "waived_at",
            "waived_by",
            "waived_by_name",
            "waiver_reason",
            "created_at",
            "updated_at",
        ]

    def get_target(self, obj):
        target = obj.target
        if target is None:
            return None
        if hasattr(target, "asset_code"):
            return {
                "id": target.id,
                "entity": target.__class__.__name__,
                "label": target.asset_code,
                "name": target.name_en or target.name_ar or target.asset_code,
            }
        return {"id": target.pk, "entity": target.__class__.__name__, "label": str(target)}


class UserPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserPreference
        fields = ["id", "scope", "key", "value", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_scope(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("Scope is required.")
        return value

    def validate_key(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("Key is required.")
        return value

    def validate_value(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Value must be an object.")
        return value
