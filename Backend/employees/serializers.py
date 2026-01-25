from rest_framework import serializers
from django.contrib.auth import get_user_model

from core.permissions import get_role
from hr_reference.models import Department, Position, TaskGroup, Sponsor
from .models import EmployeeProfile

User = get_user_model()


class UserMinimalSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "email", "full_name", "role", "is_active"]

    def get_role(self, obj):
        return get_role(obj)


class EmployeeProfileReadSerializer(serializers.ModelSerializer):
    user_id = serializers.SerializerMethodField()
    email = serializers.SerializerMethodField()
    manager_id = serializers.SerializerMethodField()
    manager_name = serializers.SerializerMethodField()
    department = serializers.SerializerMethodField()
    position = serializers.SerializerMethodField()
    task_group = serializers.SerializerMethodField()
    sponsor = serializers.SerializerMethodField()
    passport = serializers.CharField(source="passport_no", read_only=True)

    department_id = serializers.PrimaryKeyRelatedField(
        source="department_ref", read_only=True
    )
    position_id = serializers.PrimaryKeyRelatedField(
        source="position_ref", read_only=True
    )
    task_group_id = serializers.PrimaryKeyRelatedField(
        source="task_group_ref", read_only=True
    )
    sponsor_id = serializers.PrimaryKeyRelatedField(
        source="sponsor_ref", read_only=True
    )

    class Meta:
        model = EmployeeProfile
        fields = [
            "id",
            "employee_id",
            "user_id",
            "full_name",
            "email",
            "mobile",
            "passport",
            "passport_no",
            "passport_expiry",
            "nationality",
            "national_id",
            "id_expiry",
            "date_of_birth",
            "employee_number",
            "department",
            "department_id",
            "position",
            "position_id",
            "task_group",
            "task_group_id",
            "sponsor",
            "sponsor_id",
            "job_title",
            "job_offer",
            "hire_date",
            "contract_date",
            "contract_expiry",
            "allowed_overtime",
            "health_card",
            "health_card_expiry",
            "basic_salary",
            "transportation_allowance",
            "accommodation_allowance",
            "telephone_allowance",
            "petrol_allowance",
            "other_allowance",
            "total_salary",
            "employment_status",
            "manager_id",
            "manager_name",
            "created_at",
            "updated_at",
        ]

    def get_user_id(self, obj):
        return obj.user.id if obj.user else None

    def get_email(self, obj):
        return obj.user.email if obj.user else ""

    def get_manager_id(self, obj):
        return obj.manager.id if obj.manager else None

    def get_manager_name(self, obj):
        if obj.manager:
            return obj.manager.full_name or obj.manager.email
        return None

    def _display_name(self, ref_obj, fallback):
        if ref_obj:
            return ref_obj.name or ref_obj.code
        return fallback or ""

    def get_department(self, obj):
        return self._display_name(obj.department_ref, obj.department)

    def get_position(self, obj):
        return self._display_name(obj.position_ref, obj.job_title)

    def get_task_group(self, obj):
        return self._display_name(obj.task_group_ref, "")

    def get_sponsor(self, obj):
        return self._display_name(obj.sponsor_ref, "")


class EmployeeProfileWriteSerializer(serializers.ModelSerializer):
    department_id = serializers.PrimaryKeyRelatedField(
        queryset=Department.objects.all(),
        source="department_ref",
        required=True,
    )
    position_id = serializers.PrimaryKeyRelatedField(
        queryset=Position.objects.all(),
        source="position_ref",
        required=True,
    )
    task_group_id = serializers.PrimaryKeyRelatedField(
        queryset=TaskGroup.objects.all(),
        source="task_group_ref",
        required=False,
        allow_null=True,
    )
    sponsor_id = serializers.PrimaryKeyRelatedField(
        queryset=Sponsor.objects.all(),
        source="sponsor_ref",
        required=False,
        allow_null=True,
    )
    join_date = serializers.DateField(source="hire_date", required=True)

    class Meta:
        model = EmployeeProfile
        fields = [
            "id",
            "employee_id",
            "full_name",
            "employee_number",
            "nationality",
            "passport_no",
            "passport_expiry",
            "national_id",
            "id_expiry",
            "date_of_birth",
            "mobile",
            "department_id",
            "position_id",
            "task_group_id",
            "sponsor_id",
            "job_offer",
            "join_date",
            "contract_date",
            "contract_expiry",
            "allowed_overtime",
            "health_card",
            "health_card_expiry",
            "basic_salary",
            "transportation_allowance",
            "accommodation_allowance",
            "telephone_allowance",
            "petrol_allowance",
            "other_allowance",
            "total_salary",
        ]
        read_only_fields = ["id", "employee_id"]

    def validate_full_name(self, value):
        if not value.strip():
            raise serializers.ValidationError("Full name is required.")
        return value
