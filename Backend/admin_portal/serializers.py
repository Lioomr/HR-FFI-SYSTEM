from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework import serializers

from core.permissions import get_role
from organization.models import OrganizationNode, UserOrganizationAccess
from organization.services import (
    get_default_organization_for_user,
    get_user_accessible_organizations,
    serialize_organizations,
    user_has_all_company_access,
)

User = get_user_model()

ROLE_CHOICES = ("SystemAdmin", "HRManager", "Manager", "Employee", "CEO", "CFO")


def sync_user_organization_access(user, organization_ids: list[int]) -> None:
    selected_ids = set(
        OrganizationNode.objects.filter(id__in=organization_ids, is_active=True).values_list("id", flat=True)
    )

    UserOrganizationAccess.objects.filter(user=user).exclude(organization_id__in=selected_ids).delete()
    existing_ids = set(
        UserOrganizationAccess.objects.filter(user=user, organization_id__in=selected_ids).values_list(
            "organization_id", flat=True
        )
    )
    UserOrganizationAccess.objects.bulk_create(
        [
            UserOrganizationAccess(user=user, organization_id=organization_id)
            for organization_id in selected_ids
            if organization_id not in existing_ids
        ],
        ignore_conflicts=True,
    )


class UserListSerializer(serializers.ModelSerializer):
    linked_employee_id = serializers.SerializerMethodField()
    linked_employee_name = serializers.SerializerMethodField()
    role = serializers.SerializerMethodField()
    accessible_organizations = serializers.SerializerMethodField()
    default_organization_id = serializers.SerializerMethodField()
    has_all_company_access = serializers.SerializerMethodField()

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
            "accessible_organizations",
            "default_organization_id",
            "has_all_company_access",
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

    def get_accessible_organizations(self, obj):
        return serialize_organizations(get_user_accessible_organizations(obj))

    def get_default_organization_id(self, obj):
        default_org = get_default_organization_for_user(obj)
        return default_org.id if default_org else None

    def get_has_all_company_access(self, obj):
        return user_has_all_company_access(obj)


class CreateUserSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=255)
    email = serializers.EmailField()
    role = serializers.ChoiceField(choices=ROLE_CHOICES)
    is_active = serializers.BooleanField(default=True)
    organization_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=True,
    )

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

    def validate_organization_ids(self, value):
        if not value:
            return []

        existing_ids = set(OrganizationNode.objects.filter(id__in=value, is_active=True).values_list("id", flat=True))
        invalid_ids = sorted({organization_id for organization_id in value if organization_id not in existing_ids})
        if invalid_ids:
            raise serializers.ValidationError("One or more selected organizations are invalid.")
        return list(dict.fromkeys(value))

    def create(self, validated_data):
        role = validated_data.pop("role")
        is_active = validated_data.pop("is_active", True)
        organization_ids = validated_data.pop("organization_ids", [])

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
        if role == "HRManager":
            sync_user_organization_access(user, organization_ids)
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


class UpdateUserOrganizationsSerializer(serializers.Serializer):
    organization_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=True,
        allow_empty=True,
    )

    def validate_organization_ids(self, value):
        existing_ids = set(OrganizationNode.objects.filter(id__in=value, is_active=True).values_list("id", flat=True))
        invalid_ids = sorted({organization_id for organization_id in value if organization_id not in existing_ids})
        if invalid_ids:
            raise serializers.ValidationError("One or more selected organizations are invalid.")
        return list(dict.fromkeys(value))


class ResetPasswordSerializer(serializers.Serializer):
    mode = serializers.ChoiceField(choices=("temporary_password", "reset_link"))
