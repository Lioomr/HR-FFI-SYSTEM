from rest_framework import serializers
from django.contrib.auth import get_user_model

from core.permissions import get_role
from hr_reference.models import Department, Position, TaskGroup, Sponsor
from .models import EmployeeProfile
from .models import EmployeeImport

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
    manager_profile_id = serializers.SerializerMethodField()
    manager_profile_name = serializers.SerializerMethodField()
    department = serializers.SerializerMethodField()
    position = serializers.SerializerMethodField()
    task_group = serializers.SerializerMethodField()
    sponsor = serializers.SerializerMethodField()
    passport = serializers.CharField(source="passport_no", read_only=True)

    department_id = serializers.PrimaryKeyRelatedField(source="department_ref", read_only=True)
    position_id = serializers.PrimaryKeyRelatedField(source="position_ref", read_only=True)
    task_group_id = serializers.PrimaryKeyRelatedField(source="task_group_ref", read_only=True)
    sponsor_id = serializers.PrimaryKeyRelatedField(source="sponsor_ref", read_only=True)

    class Meta:
        model = EmployeeProfile
        fields = [
            "id",
            "employee_id",
            "user_id",
            "full_name",
            "full_name_en",
            "full_name_ar",
            "email",
            "mobile",
            "passport",
            "passport_no",
            "passport_expiry",
            "passport_expiry_raw",
            "nationality",
            "nationality_en",
            "nationality_ar",
            "is_saudi",
            "national_id",
            "id_expiry",
            "id_expiry_raw",
            "date_of_birth",
            "date_of_birth_raw",
            "employee_number",
            "department",
            "department_name_en",
            "department_name_ar",
            "department_id",
            "position",
            "job_title_en",
            "job_title_ar",
            "position_id",
            "task_group",
            "task_group_id",
            "sponsor",
            "sponsor_id",
            "job_title",
            "job_offer",
            "hire_date",
            "hire_date_raw",
            "contract_date",
            "contract_date_raw",
            "contract_expiry",
            "contract_expiry_raw",
            "allowed_overtime",
            "health_card",
            "health_card_expiry",
            "health_card_expiry_raw",
            "basic_salary",
            "transportation_allowance",
            "accommodation_allowance",
            "telephone_allowance",
            "petrol_allowance",
            "other_allowance",
            "total_salary",
            "data_source",
            "employment_status",
            "manager_id",
            "manager_name",
            "manager_profile_id",
            "manager_profile_name",
            "created_at",
            "updated_at",
        ]

    def get_user_id(self, obj):
        return obj.user.id if obj.user else None

    def get_email(self, obj):
        return obj.user.email if obj.user else ""

    def get_manager_id(self, obj):
        if obj.manager_profile and obj.manager_profile.user:
            return obj.manager_profile.user.id
        return obj.manager.id if obj.manager else None

    def get_manager_name(self, obj):
        if obj.manager_profile:
            return obj.manager_profile.full_name_en or obj.manager_profile.full_name or obj.manager_profile.employee_id
        if obj.manager:
            return obj.manager.full_name or obj.manager.email
        return None

    def get_manager_profile_id(self, obj):
        return obj.manager_profile.id if obj.manager_profile else None

    def get_manager_profile_name(self, obj):
        if obj.manager_profile:
            return obj.manager_profile.full_name_en or obj.manager_profile.full_name or obj.manager_profile.employee_id
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
    user_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(),
        source="user",
        required=False,
        allow_null=True,
    )
    manager_profile_id = serializers.PrimaryKeyRelatedField(
        queryset=EmployeeProfile.objects.all(),
        source="manager_profile",
        required=False,
        allow_null=True,
    )

    class Meta:
        model = EmployeeProfile
        fields = [
            "id",
            "employee_id",
            "full_name",
            "full_name_en",
            "full_name_ar",
            "employee_number",
            "nationality",
            "nationality_en",
            "nationality_ar",
            "is_saudi",
            "passport_no",
            "passport_expiry",
            "passport_expiry_raw",
            "national_id",
            "id_expiry",
            "id_expiry_raw",
            "date_of_birth",
            "date_of_birth_raw",
            "mobile",
            "department_id",
            "department_name_en",
            "department_name_ar",
            "position_id",
            "job_title_en",
            "job_title_ar",
            "task_group_id",
            "sponsor_id",
            "job_offer",
            "join_date",
            "hire_date_raw",
            "contract_date",
            "contract_date_raw",
            "contract_expiry",
            "contract_expiry_raw",
            "allowed_overtime",
            "health_card",
            "health_card_expiry",
            "health_card_expiry_raw",
            "basic_salary",
            "transportation_allowance",
            "accommodation_allowance",
            "telephone_allowance",
            "petrol_allowance",
            "other_allowance",
            "total_salary",
            "data_source",
            "user_id",
            "manager_profile_id",
        ]
        read_only_fields = ["id", "employee_id"]

    def validate_full_name(self, value):
        if not value.strip():
            raise serializers.ValidationError("Full name is required.")
        return value

    def validate(self, attrs):
        full_name = attrs.get("full_name")
        full_name_en = attrs.get("full_name_en")
        if full_name is None and full_name_en:
            attrs["full_name"] = full_name_en
        return super().validate(attrs)


class EmployeeImportSerializer(serializers.ModelSerializer):
    uploader = serializers.SerializerMethodField()

    class Meta:
        model = EmployeeImport
        fields = [
            "id",
            "status",
            "inserted_rows",
            "row_count",
            "created_at",
            "uploader",
            "error_summary",
        ]

    def get_uploader(self, obj):
        if obj.uploader:
            return obj.uploader.email
        return None
