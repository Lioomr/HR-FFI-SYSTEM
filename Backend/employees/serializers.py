from django.contrib.auth import get_user_model
from django.db import models
from rest_framework import serializers

from core.permissions import get_role
from hr_reference.models import Department, Position, Sponsor, TaskGroup
from organization.models import OrganizationNode

from core.services import get_workflow_snapshot

from .models import EmployeeDeletionRequest, EmployeeImport, EmployeeProfile

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
    employment_status = serializers.SerializerMethodField()

    department_id = serializers.PrimaryKeyRelatedField(source="department_ref", read_only=True)
    position_id = serializers.PrimaryKeyRelatedField(source="position_ref", read_only=True)
    task_group_id = serializers.PrimaryKeyRelatedField(source="task_group_ref", read_only=True)
    sponsor_id = serializers.PrimaryKeyRelatedField(source="sponsor_ref", read_only=True)
    company_id = serializers.PrimaryKeyRelatedField(source="company", read_only=True)
    company_name = serializers.CharField(source="company.name", read_only=True)

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
            "company_id",
            "company_name",
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

    def get_employment_status(self, obj):
        if getattr(obj, "effective_employment_status", None):
            return obj.effective_employment_status
        if getattr(obj, "active_leave_today", False) and obj.employment_status == EmployeeProfile.EmploymentStatus.ACTIVE:
            return "ON_LEAVE"
        return obj.employment_status


class DelegationCandidateSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(source="user.id", read_only=True)
    employee_profile_id = serializers.IntegerField(source="pk", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    company_id = serializers.IntegerField(read_only=True)
    company_name = serializers.CharField(source="company.name", read_only=True)

    class Meta:
        model = EmployeeProfile
        fields = [
            "id",
            "employee_profile_id",
            "employee_id",
            "full_name",
            "full_name_en",
            "full_name_ar",
            "email",
            "company_id",
            "company_name",
        ]


class EmployeeProfileWriteSerializer(serializers.ModelSerializer):
    department_id = serializers.PrimaryKeyRelatedField(queryset=Department.objects.none(), source="department_ref", required=True)
    position_id = serializers.PrimaryKeyRelatedField(queryset=Position.objects.none(), source="position_ref", required=True)
    task_group_id = serializers.PrimaryKeyRelatedField(queryset=TaskGroup.objects.none(), source="task_group_ref", required=False, allow_null=True)
    sponsor_id = serializers.PrimaryKeyRelatedField(queryset=Sponsor.objects.none(), source="sponsor_ref", required=False, allow_null=True)
    join_date = serializers.DateField(source="hire_date", required=True)
    user_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(),
        source="user",
        required=False,
        allow_null=True,
    )
    manager_profile_id = serializers.PrimaryKeyRelatedField(queryset=EmployeeProfile.objects.none(), source="manager_profile", required=False, allow_null=True)

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

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        company = getattr(request, "_active_company", None) if request else None
        if self.instance and getattr(self.instance, "company_id", None):
            company = self.instance.company
        if company is not None:
            self.fields["department_id"].queryset = Department.objects.filter(
                models.Q(company=company) | models.Q(company__isnull=True),
                is_active=True,
            )
            self.fields["position_id"].queryset = Position.objects.filter(
                models.Q(company=company) | models.Q(company__isnull=True),
                is_active=True,
            )
            self.fields["task_group_id"].queryset = TaskGroup.objects.filter(
                models.Q(company=company) | models.Q(company__isnull=True),
                is_active=True,
            )
            self.fields["sponsor_id"].queryset = Sponsor.objects.filter(
                models.Q(company=company) | models.Q(company__isnull=True),
                is_active=True,
            )
            self.fields["manager_profile_id"].queryset = EmployeeProfile.objects.filter(
                models.Q(company=company) | models.Q(company__isnull=True)
            )

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


class EmployeeDeletionRequestReadSerializer(serializers.ModelSerializer):
    employee_profile_id = serializers.IntegerField(read_only=True)
    target_user_id = serializers.IntegerField(read_only=True)
    company_id = serializers.IntegerField(read_only=True)
    company_name = serializers.CharField(source="company.name", read_only=True)
    requested_by_name = serializers.CharField(source="requested_by.full_name", read_only=True)
    approved_by_name = serializers.CharField(source="approved_by.full_name", read_only=True)
    rejected_by_name = serializers.CharField(source="rejected_by.full_name", read_only=True)
    workflow = serializers.SerializerMethodField()

    class Meta:
        model = EmployeeDeletionRequest
        fields = [
            "id",
            "company_id",
            "company_name",
            "employee_profile_id",
            "target_user_id",
            "reason",
            "status",
            "request_snapshot",
            "execution_snapshot",
            "rejection_reason",
            "requested_by",
            "requested_by_name",
            "approved_by",
            "approved_by_name",
            "rejected_by",
            "rejected_by_name",
            "approved_at",
            "rejected_at",
            "executed_at",
            "created_at",
            "updated_at",
            "workflow",
        ]

    def get_workflow(self, obj):
        request = self.context.get("request")
        actor = getattr(request, "user", None)
        return get_workflow_snapshot(obj, actor=actor)


class EmployeeDeletionRequestCreateSerializer(serializers.ModelSerializer):
    employee_profile_id = serializers.PrimaryKeyRelatedField(
        queryset=EmployeeProfile.objects.none(),
        source="employee_profile",
        write_only=True,
    )

    class Meta:
        model = EmployeeDeletionRequest
        fields = ["employee_profile_id", "reason"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request is not None:
            self.fields["employee_profile_id"].queryset = EmployeeProfile.objects.filter(company=getattr(request, "_active_company", None))

    def validate_reason(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("Reason is required.")
        return value

    def validate(self, attrs):
        employee_profile = attrs["employee_profile"]
        request = self.context["request"]
        active_company = getattr(request, "_active_company", None)

        if active_company is None:
            raise serializers.ValidationError("Active company is required.")
        if employee_profile.company_id != active_company.id:
            raise serializers.ValidationError("Employee does not belong to the active company.")

        existing = EmployeeDeletionRequest.objects.filter(
            company=active_company,
            employee_profile=employee_profile,
            status=EmployeeDeletionRequest.Status.PENDING_CEO,
        )
        if self.instance:
            existing = existing.exclude(pk=self.instance.pk)
        if existing.exists():
            raise serializers.ValidationError("A pending deletion request already exists for this employee.")

        return attrs
