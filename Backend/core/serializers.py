from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import DelegationRule, UserPreference


User = get_user_model()


class DelegationUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "full_name"]


class DelegationRuleSerializer(serializers.ModelSerializer):
    from_user = DelegationUserSerializer(read_only=True)
    to_user = DelegationUserSerializer(read_only=True)
    from_user_id = serializers.PrimaryKeyRelatedField(source="from_user", queryset=User.objects.all(), write_only=True)
    to_user_id = serializers.PrimaryKeyRelatedField(source="to_user", queryset=User.objects.all(), write_only=True)
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
