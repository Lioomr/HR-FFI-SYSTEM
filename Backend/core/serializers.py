from django.contrib.auth import get_user_model
from rest_framework import serializers

from core.permissions import get_role
from employees.models import EmployeeProfile
from organization.models import OrganizationNode, OrganizationScope, OrganizationScopeMembership

from .models import (
    CrossCompanyManagerAssignment,
    DelegationRule,
    RequestObligation,
    UserPreference,
    default_delegation_capabilities,
)

User = get_user_model()


def delegation_rule_user_queryset():
    return User.objects.filter(
        is_active=True,
        employee_profile__employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        employee_profile__is_archived=False,
        employee_profile__company__is_active=True,
    )


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
    revoked_by = DelegationUserSerializer(read_only=True)
    scope_id = serializers.PrimaryKeyRelatedField(
        source="scope", queryset=OrganizationScope.objects.filter(is_active=True), required=False, allow_null=True, write_only=True
    )
    scope = serializers.SerializerMethodField(read_only=True)
    capabilities = serializers.ListField(
        child=serializers.ChoiceField(choices=DelegationRule.Capability.values), allow_empty=False, required=False
    )
    capability_flags = serializers.SerializerMethodField()

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
            "scope",
            "scope_id",
            "capabilities",
            "capability_flags",
            "reason",
            "is_active",
            "revoked_at",
            "revoked_by",
            "created_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_by", "revoked_at", "revoked_by", "created_at", "updated_at"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request and get_role(request.user) not in {"HRManager", "SystemAdmin"}:
            from organization.services import get_active_company_for_request

            company = get_active_company_for_request(request)
            scoped_users = delegation_rule_user_queryset().filter(employee_profile__company=company)
            self.fields["from_user_id"].queryset = scoped_users
            self.fields["to_user_id"].queryset = scoped_users

    def get_scope(self, obj):
        if not obj.scope_id:
            return None
        return {
            "id": obj.scope_id,
            "code": obj.scope.code,
            "name": obj.scope.name,
            "company_ids": list(obj.scope.memberships.values_list("company_id", flat=True)),
        }

    def get_capability_flags(self, obj):
        capabilities = set(obj.capabilities or [])
        return {capability: capability in capabilities for capability in DelegationRule.Capability.values}

    def validate(self, attrs):
        attrs = super().validate(attrs)
        instance = getattr(self, "instance", None)
        from_user = attrs.get("from_user") or getattr(instance, "from_user", None)
        to_user = attrs.get("to_user") or getattr(instance, "to_user", None)
        start_at = attrs.get("start_at") or getattr(instance, "start_at", None)
        end_at = attrs.get("end_at") if "end_at" in attrs else getattr(instance, "end_at", None)
        is_active = attrs.get("is_active") if "is_active" in attrs else getattr(instance, "is_active", True)
        scope = attrs.get("scope") if "scope" in attrs else getattr(instance, "scope", None)
        if "capabilities" in attrs:
            capabilities = attrs["capabilities"]
        elif instance is not None:
            capabilities = getattr(instance, "capabilities", [])
        else:
            capabilities = default_delegation_capabilities()
        request = self.context.get("request")

        if from_user and to_user and from_user.id == to_user.id:
            raise serializers.ValidationError({"to_user_id": "Delegation target must be a different user."})
        from_company_id = getattr(getattr(from_user, "employee_profile", None), "company_id", None)
        to_company_id = getattr(getattr(to_user, "employee_profile", None), "company_id", None)
        if not from_company_id or not to_company_id:
            raise serializers.ValidationError("Delegation users must have active company-owned employee profiles.")
        if not capabilities:
            raise serializers.ValidationError({"capabilities": "Delegation grants require explicit capabilities."})
        cross_company = from_company_id != to_company_id
        if cross_company:
            if not request or get_role(request.user) not in {"HRManager", "SystemAdmin"}:
                raise serializers.ValidationError("Only an authorized HRManager or SystemAdmin can create cross-company grants.")
            if scope is None or end_at is None:
                raise serializers.ValidationError({"scope_id": "Cross-company delegation requires an approved scope and end time."})
        if scope:
            member_ids = set(scope.memberships.values_list("company_id", flat=True))
            if from_company_id not in member_ids or to_company_id not in member_ids:
                raise serializers.ValidationError({"scope_id": "The approved scope must include both users' companies."})
        elif "employees.read" in capabilities:
            raise serializers.ValidationError({"scope_id": "Employee-read delegation requires an approved organization scope."})
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


class CrossCompanyManagerAssignmentSerializer(serializers.ModelSerializer):
    employee_id = serializers.PrimaryKeyRelatedField(
        source="employee", queryset=EmployeeProfile.objects.none(), write_only=True
    )
    manager_profile_id = serializers.PrimaryKeyRelatedField(
        source="manager_profile", queryset=EmployeeProfile.objects.none(), write_only=True
    )
    scope_id = serializers.PrimaryKeyRelatedField(
        source="scope", queryset=OrganizationScope.objects.filter(is_active=True), write_only=True
    )
    employee = serializers.SerializerMethodField(read_only=True)
    manager_profile = serializers.SerializerMethodField(read_only=True)
    scope = serializers.SerializerMethodField(read_only=True)
    capabilities = serializers.ListField(
        child=serializers.ChoiceField(choices=CrossCompanyManagerAssignment.Capability.values),
        allow_empty=False,
        required=False,
    )

    class Meta:
        model = CrossCompanyManagerAssignment
        fields = [
            "id", "employee", "employee_id", "manager_profile", "manager_profile_id", "scope", "scope_id",
            "start_at", "end_at", "capabilities", "reason", "is_active", "revoked_at", "revoked_by", "created_by", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "revoked_at", "revoked_by", "created_by", "created_at", "updated_at"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        active_profiles = EmployeeProfile.objects.filter(
            is_archived=False,
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            user__is_active=True,
            company__is_active=True,
        )
        self.fields["employee_id"].queryset = active_profiles
        self.fields["manager_profile_id"].queryset = active_profiles

    @staticmethod
    def _profile_data(profile):
        return {"id": profile.id, "employee_id": profile.employee_id, "full_name": profile.full_name, "company_id": profile.company_id}

    def get_employee(self, obj):
        return self._profile_data(obj.employee)

    def get_manager_profile(self, obj):
        return self._profile_data(obj.manager_profile)

    def get_scope(self, obj):
        return {"id": obj.scope_id, "code": obj.scope.code, "name": obj.scope.name}

    def validate(self, attrs):
        from employees.services.manager_relationships import validate_cross_company_manager_assignment

        instance = getattr(self, "instance", None)
        employee = attrs.get("employee") or getattr(instance, "employee", None)
        manager_profile = attrs.get("manager_profile") or getattr(instance, "manager_profile", None)
        scope = attrs.get("scope") or getattr(instance, "scope", None)
        start_at = attrs.get("start_at") or getattr(instance, "start_at", None)
        end_at = attrs.get("end_at") or getattr(instance, "end_at", None)
        validate_cross_company_manager_assignment(
            employee, manager_profile, scope=scope, start_at=start_at, end_at=end_at, assignment=instance
        )
        return attrs


class OrganizationScopeSerializer(serializers.ModelSerializer):
    company_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), write_only=True, required=False)
    companies = serializers.SerializerMethodField()

    class Meta:
        model = OrganizationScope
        fields = ["id", "code", "name", "is_active", "company_ids", "companies", "created_by", "created_at", "updated_at"]
        read_only_fields = ["id", "created_by", "created_at", "updated_at"]

    def get_companies(self, obj):
        return [
            {"id": membership.company_id, "code": membership.company.code, "name": membership.company.name}
            for membership in obj.memberships.select_related("company").order_by("company__name", "company_id")
        ]

    def validate_company_ids(self, value):
        if not value:
            raise serializers.ValidationError("An organization scope must contain at least one active company.")
        if len(value) != len(set(value)):
            raise serializers.ValidationError("Company IDs must be unique.")
        valid_ids = set(
            OrganizationNode.objects.filter(
                id__in=value, node_type=OrganizationNode.NodeType.COMPANY, is_active=True
            ).values_list("id", flat=True)
        )
        if valid_ids != set(value):
            raise serializers.ValidationError("Scopes can contain active COMPANY nodes only.")
        return value

    def create(self, validated_data):
        company_ids = validated_data.pop("company_ids")
        scope = OrganizationScope.objects.create(**validated_data)
        OrganizationScopeMembership.objects.bulk_create(
            [OrganizationScopeMembership(scope=scope, company_id=company_id) for company_id in company_ids]
        )
        return scope

    def update(self, instance, validated_data):
        company_ids = validated_data.pop("company_ids", None)
        instance = super().update(instance, validated_data)
        if company_ids is not None:
            OrganizationScopeMembership.objects.filter(scope=instance).delete()
            OrganizationScopeMembership.objects.bulk_create(
                [OrganizationScopeMembership(scope=instance, company_id=company_id) for company_id in company_ids]
            )
        return instance


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
