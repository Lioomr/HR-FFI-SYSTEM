from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework import serializers

from core.permissions import get_role

User = get_user_model()

ROLE_CHOICES = ("SystemAdmin", "HRManager", "Manager", "Employee", "CEO", "CFO")


class UserListSerializer(serializers.ModelSerializer):
    linked_employee_id = serializers.SerializerMethodField()
    linked_employee_name = serializers.SerializerMethodField()
    role = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "full_name",
            "email",
            "is_active",
            "role",
            "is_staff",
            "is_superuser",
            "linked_employee_id",
            "linked_employee_name",
        ]

    def get_role(self, obj):
        g = obj.groups.first()
        return g.name if g else "Employee"

    def get_linked_employee_id(self, obj):
        if hasattr(obj, "employee_profile"):
            return obj.employee_profile.id
        return None

    def get_linked_employee_name(self, obj):
        if hasattr(obj, "employee_profile"):
            return obj.employee_profile.full_name
        return None


class CreateUserSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=255)
    email = serializers.EmailField()
    role = serializers.ChoiceField(choices=ROLE_CHOICES)
    is_active = serializers.BooleanField(default=True)

    def validate_email(self, value):
        normalized = value.strip().lower()
        if User.objects.filter(email__iexact=normalized).exists():
            raise serializers.ValidationError("Email already exists.")
        return normalized

    def validate_role(self, value):
        request = self.context.get("request")
        if value == "SystemAdmin":
            if not request or not request.user.is_authenticated or get_role(request.user) != "SystemAdmin":
                raise serializers.ValidationError("Only SystemAdmin can assign SystemAdmin role.")
        return value

    def create(self, validated_data):
        role = validated_data.pop("role")
        is_active = validated_data.pop("is_active", True)

        # Create user with unusable password; invite/reset will set it.
        user = User.objects.create(
            email=validated_data["email"],
            full_name=validated_data.get("full_name", ""),
            is_active=is_active,
        )
        user.set_unusable_password()
        user.save()

        group, _ = Group.objects.get_or_create(name=role)
        user.groups.clear()
        user.groups.add(group)
        return user


class UpdateStatusSerializer(serializers.Serializer):
    is_active = serializers.BooleanField()


class UpdateRoleSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=ROLE_CHOICES)

    def validate_role(self, value):
        request = self.context.get("request")
        if value == "SystemAdmin":
            if not request or not request.user.is_authenticated or get_role(request.user) != "SystemAdmin":
                raise serializers.ValidationError("Only SystemAdmin can assign SystemAdmin role.")
        return value


class ResetPasswordSerializer(serializers.Serializer):
    mode = serializers.ChoiceField(choices=("temporary_password", "reset_link"))
