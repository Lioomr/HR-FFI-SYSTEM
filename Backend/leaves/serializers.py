from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers

from core.services import get_obligations_summary, get_workflow_snapshot, sync_leave_obligations
from employees.models import EmployeeProfile

from .models import LeaveBalanceAdjustment, LeaveRequest, LeaveType
from .utils import (
    get_leave_days,
    get_payment_breakdown,
    get_used_days_for_type,
    resolve_employee_profile,
    validate_leave_request_policy,
)

User = get_user_model()
LEAVE_ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}
LEAVE_MAX_UPLOAD_SIZE = int(getattr(settings, "MAX_LEAVE_DOCUMENT_SIZE_BYTES", 5 * 1024 * 1024))


def delegation_user_queryset():
    return User.objects.filter(
        is_active=True,
        employee_profile__employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
    ).filter(Q(employee_profile__company__is_active=True) | Q(employee_profile__company__isnull=True))


class UserSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "full_name"]


class LeaveTypeSerializer(serializers.ModelSerializer):
    company_id = serializers.PrimaryKeyRelatedField(source="company", read_only=True)
    company_name = serializers.CharField(source="company.name", read_only=True)

    class Meta:
        model = LeaveType
        fields = "__all__"
        read_only_fields = ["created_at", "updated_at"]


class LeaveBalanceSerializer(serializers.Serializer):
    leave_type_id = serializers.IntegerField()
    leave_type = serializers.CharField()
    leave_code = serializers.CharField(required=False)
    available_annual_year_days = serializers.DecimalField(max_digits=6, decimal_places=2, required=False)
    total_days = serializers.DecimalField(max_digits=6, decimal_places=2)
    used_days = serializers.DecimalField(max_digits=6, decimal_places=2)
    remaining_days = serializers.DecimalField(max_digits=6, decimal_places=2)


class LeaveRequestSerializer(serializers.ModelSerializer):
    employee = serializers.SerializerMethodField()
    leave_type = LeaveTypeSerializer(read_only=True)
    decided_by = UserSummarySerializer(read_only=True)
    delegated_to = UserSummarySerializer(read_only=True)
    days = serializers.SerializerMethodField()
    payment_breakdown = serializers.SerializerMethodField()
    payment_status = serializers.SerializerMethodField()
    deducted_from_leave_type = serializers.SerializerMethodField()
    workflow = serializers.SerializerMethodField()
    obligations_summary = serializers.SerializerMethodField()
    requires_hr_completion_visa = serializers.SerializerMethodField()
    employee_documents = serializers.SerializerMethodField()
    company_id = serializers.PrimaryKeyRelatedField(source="company", read_only=True)
    company_name = serializers.CharField(source="company.name", read_only=True)

    class Meta:
        model = LeaveRequest
        fields = "__all__"
        read_only_fields = [
            "employee",
            "status",
            "decided_by",
            "decided_at",
            "decision_reason",
            "created_at",
            "updated_at",
        ]

    def get_days(self, obj):
        return get_leave_days(obj.start_date, obj.end_date)

    def get_employee(self, obj):
        if obj.employee:
            return UserSummarySerializer(obj.employee).data

        profile = obj.employee_profile
        if not profile:
            profile = resolve_employee_profile(obj.employee)
        if not profile:
            return None

        return {
            "id": None,
            "email": "",
            "full_name": profile.full_name or profile.full_name_en or profile.employee_id,
        }

    def get_payment_breakdown(self, obj):
        year = obj.start_date.year
        employee_subject = obj.employee_profile or obj.employee
        company = obj.company or obj.leave_type.company
        current_days = get_leave_days(obj.start_date, obj.end_date)
        used_total = get_used_days_for_type(employee_subject, obj.leave_type, year)
        if obj.status == LeaveRequest.RequestStatus.APPROVED:
            used_before = max(0.0, used_total - current_days)
        else:
            used_before = used_total
        return get_payment_breakdown(
            obj.leave_type,
            used_before,
            current_days,
            employee_subject=employee_subject,
            year=year,
            company=company,
        )

    def get_payment_status(self, obj):
        breakdown = self.get_payment_breakdown(obj)
        if not breakdown:
            return "unknown"
        percents = {b["pay_percent"] for b in breakdown}
        if percents == {100}:
            return "full_pay"
        if percents == {0}:
            return "unpaid"
        if percents == {70}:
            return "partial_pay_70"
        if percents == {50}:
            return "half_pay"
        return "mixed"

    def get_deducted_from_leave_type(self, obj):
        code = (obj.leave_type.code or obj.leave_type.name or "").strip().upper().replace(" ", "_")
        if code in {"EMERGENCY", "EMERGENCY_LEAVE"}:
            return "ANNUAL"
        return code

    def get_workflow(self, obj):
        request = self.context.get("request")
        actor = getattr(request, "user", None) if request else None
        return get_workflow_snapshot(obj, actor=actor)

    def get_obligations_summary(self, obj):
        request = self.context.get("request")
        actor = getattr(request, "user", None) if request else None
        try:
            return sync_leave_obligations(obj, actor=actor)
        except Exception:
            return get_obligations_summary(obj)

    def get_requires_hr_completion_visa(self, obj):
        profile = obj.employee_profile or resolve_employee_profile(obj.employee)
        return bool(profile and not profile.is_saudi and obj.status == LeaveRequest.RequestStatus.PENDING_HR_COMPLETION)

    def get_employee_documents(self, obj):
        from employees.serializers import EmployeeDocumentSerializer

        documents = obj.employee_documents.select_related("uploaded_by", "company", "leave_request")
        return EmployeeDocumentSerializer(documents, many=True, context=self.context).data


class LeaveRequestCreateSerializer(serializers.ModelSerializer):
    delegated_to = serializers.PrimaryKeyRelatedField(
        queryset=delegation_user_queryset(), allow_null=True, required=False
    )

    class Meta:
        model = LeaveRequest
        fields = [
            "leave_type",
            "start_date",
            "end_date",
            "reason",
            "document",
            "other_leave_description",
            "date_of_rejoin",
            "po_box",
            "full_address",
            "airplane_ticket_payer",
            "airplane_ticket_address",
            "delegated_to",
            "delegation_note",
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        qs = delegation_user_queryset()
        if request and getattr(request, "user", None) and request.user.is_authenticated:
            qs = qs.exclude(id=request.user.id)
        self.fields["delegated_to"].queryset = qs

    def validate(self, attrs):
        start = attrs.get("start_date")
        end = attrs.get("end_date")
        leave_type = attrs.get("leave_type")
        reason = attrs.get("reason", "")
        document = attrs.get("document")
        delegated_to = attrs.get("delegated_to")
        user = self.context["request"].user

        if delegated_to and delegated_to.id == user.id:
            raise serializers.ValidationError(
                {"delegated_to": "You cannot delegate your own leave request to yourself."}
            )

        if start and end:
            if start > end:
                raise serializers.ValidationError({"end_date": "End date must be after start date."})

            # Optional: Past date check
            # if start < date.today():
            #    raise serializers.ValidationError({"start_date": "Cannot request leave in the past."})

            # Optional: Past date check
            # if start < date.today():
            #    raise serializers.ValidationError({"start_date": "Cannot request leave in the past."})

        if leave_type and not leave_type.is_active:
            raise serializers.ValidationError({"leave_type": "Leave type is inactive."})

        leave_code = (leave_type.code or leave_type.name or "").strip().upper().replace(" ", "_")
        if leave_code in {"SICK", "SICK_LEAVE"} and not document:
            raise serializers.ValidationError({"document": "Medical report document is required for sick leave."})

        # Overlap Check
        # Check against APPROVED or PENDING requests across all companies —
        # an employee is one person and cannot take overlapping leave regardless
        # of which company the leave is assigned to.
        overlap_qs = LeaveRequest.objects.filter(
            employee=user,
            is_active=True,
            status__in=[
                LeaveRequest.RequestStatus.APPROVED,
                LeaveRequest.RequestStatus.SUBMITTED,
                LeaveRequest.RequestStatus.PENDING_DELEGATE,
                LeaveRequest.RequestStatus.PENDING_MANAGER,
                LeaveRequest.RequestStatus.PENDING_HR,
            ],
        ).filter(
            # (start <= req.end) AND (end >= req.start)
            Q(start_date__lte=end) & Q(end_date__gte=start)
        )

        if overlap_qs.exists():
            raise serializers.ValidationError("You already have a pending or approved leave request for this period.")

        policy_error = validate_leave_request_policy(user, leave_type, start, end, reason, bool(document))
        if policy_error:
            raise serializers.ValidationError(policy_error)

        return attrs

    def validate_document(self, value):
        if not value:
            return value
        extension = Path(value.name).suffix.lower()
        if extension not in LEAVE_ALLOWED_EXTENSIONS:
            raise serializers.ValidationError("Unsupported file type.")
        if value.size > LEAVE_MAX_UPLOAD_SIZE:
            raise serializers.ValidationError("File size exceeds maximum limit.")
        return value


class LeaveRequestActionSerializer(serializers.Serializer):
    comment = serializers.CharField(required=False, allow_blank=True)
    waiver_reason = serializers.CharField(required=False, allow_blank=True)


class LeaveRequestCompleteSerializer(serializers.Serializer):
    comment = serializers.CharField(required=False, allow_blank=True)
    visa_document = serializers.FileField(required=False, allow_null=True)

    def validate_visa_document(self, value):
        if not value:
            return value
        extension = Path(value.name).suffix.lower()
        if extension != ".pdf":
            raise serializers.ValidationError("Visa document must be a PDF.")
        if value.size > LEAVE_MAX_UPLOAD_SIZE:
            raise serializers.ValidationError("File size exceeds maximum limit.")
        return value


class LeaveRequestDelegationSerializer(serializers.Serializer):
    delegated_to = serializers.PrimaryKeyRelatedField(queryset=delegation_user_queryset())
    delegation_note = serializers.CharField(required=False, allow_blank=True)


class HRManualLeaveRequestSerializer(serializers.ModelSerializer):
    employee_id = serializers.IntegerField(write_only=True)
    warning_messages = serializers.ListField(child=serializers.CharField(), read_only=True)
    delegated_to = serializers.PrimaryKeyRelatedField(queryset=User.objects.all(), allow_null=True, required=False)

    class Meta:
        model = LeaveRequest
        fields = [
            "id",
            "employee_id",
            "leave_type",
            "start_date",
            "end_date",
            "reason",
            "document",
            "manual_entry_reason",
            "source_document_ref",
            "warning_messages",
            "other_leave_description",
            "date_of_rejoin",
            "po_box",
            "full_address",
            "airplane_ticket_payer",
            "airplane_ticket_address",
            "delegated_to",
            "delegation_note",
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["delegated_to"].queryset = delegation_user_queryset()

    @property
    def policy_warnings(self):
        return getattr(self, "_policy_warnings", [])

    def _get_employee_profile(self, employee_profile_id):
        try:
            profile = EmployeeProfile.objects.select_related("user").get(id=employee_profile_id)
        except EmployeeProfile.DoesNotExist as exc:
            raise serializers.ValidationError({"employee_id": "Employee Profile not found."}) from exc

        if profile.employment_status != EmployeeProfile.EmploymentStatus.ACTIVE:
            raise serializers.ValidationError({"employee_id": "Only active employees are allowed."})

        return profile

    def validate_manual_entry_reason(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError("manual_entry_reason is required.")
        return value

    def validate_source_document_ref(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError("source_document_ref is required.")
        return value

    def validate(self, attrs):
        employee_id = attrs.get("employee_id")
        if employee_id is None:
            if self.instance is None:
                raise serializers.ValidationError({"employee_id": "employee_id is required."})
            employee_profile = self.instance.employee_profile or resolve_employee_profile(self.instance.employee)
        else:
            employee_profile = self._get_employee_profile(employee_id)

        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end = attrs.get("end_date", getattr(self.instance, "end_date", None))
        leave_type = attrs.get("leave_type", getattr(self.instance, "leave_type", None))
        reason = attrs.get("reason", getattr(self.instance, "reason", ""))
        document = attrs.get("document", getattr(self.instance, "document", None))
        delegated_to = attrs.get("delegated_to", getattr(self.instance, "delegated_to", None))

        if delegated_to and employee_profile.user_id and delegated_to.id == employee_profile.user_id:
            raise serializers.ValidationError(
                {"delegated_to": "You cannot delegate a leave request to the same employee."}
            )

        if start and end and start > end:
            raise serializers.ValidationError({"end_date": "End date must be after start date."})

        if leave_type and not leave_type.is_active:
            raise serializers.ValidationError({"leave_type": "Leave type is inactive."})

        leave_code = (leave_type.code or leave_type.name or "").strip().upper().replace(" ", "_")
        if leave_code in {"SICK", "SICK_LEAVE"} and not document and not getattr(self.instance, "document", None):
            raise serializers.ValidationError({"document": "Medical report document is required for sick leave."})

        policy_error = validate_leave_request_policy(employee_profile, leave_type, start, end, reason, bool(document))
        self._policy_warnings = []
        if policy_error:
            normalized = str(policy_error).lower()
            if "exceeds remaining balance" in normalized:
                self._policy_warnings.append(policy_error)
            else:
                raise serializers.ValidationError(policy_error)

        attrs["employee_profile_obj"] = employee_profile
        return attrs

    def validate_document(self, value):
        if not value:
            return value
        extension = Path(value.name).suffix.lower()
        if extension not in LEAVE_ALLOWED_EXTENSIONS:
            raise serializers.ValidationError("Unsupported file type.")
        if value.size > LEAVE_MAX_UPLOAD_SIZE:
            raise serializers.ValidationError("File size exceeds maximum limit.")
        return value

    def create(self, validated_data):
        employee_profile = validated_data.pop("employee_profile_obj")
        validated_data.pop("employee_id", None)
        request_user = self.context["request"].user
        return LeaveRequest.objects.create(
            employee=employee_profile.user,
            employee_profile=employee_profile,
            company=employee_profile.company,
            status=LeaveRequest.RequestStatus.APPROVED,
            source=LeaveRequest.RequestSource.HR_MANUAL,
            entered_by=request_user,
            decided_by=request_user,
            decided_at=timezone.now(),
            **validated_data,
        )

    def update(self, instance, validated_data):
        validated_data.pop("employee_id", None)
        employee_profile = validated_data.pop("employee_profile_obj", None)
        request_user = self.context["request"].user

        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if employee_profile is not None:
            instance.employee_profile = employee_profile
            instance.employee = employee_profile.user

        instance.status = LeaveRequest.RequestStatus.APPROVED
        instance.source = LeaveRequest.RequestSource.HR_MANUAL
        instance.decided_by = request_user
        instance.decided_at = timezone.now()
        instance.entered_by = instance.entered_by or request_user
        instance.save()
        return instance


class LeaveBalanceAdjustmentSerializer(serializers.ModelSerializer):
    created_by_name = serializers.ReadOnlyField(source="created_by.full_name")
    employee_id = serializers.IntegerField(write_only=True)
    employee_name = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = LeaveBalanceAdjustment
        fields = [
            "id",
            "employee",
            "employee_profile",
            "employee_id",
            "employee_name",
            "leave_type",
            "adjustment_days",
            "reason",
            "created_by",
            "created_by_name",
            "created_at",
        ]
        read_only_fields = ["employee", "employee_profile", "employee_name", "created_by", "created_at"]

    def get_employee_name(self, obj):
        if obj.employee:
            return getattr(obj.employee, "full_name", "") or getattr(obj.employee, "email", "") or ""
        profile = obj.employee_profile
        if profile:
            return profile.full_name or profile.full_name_en or profile.employee_id
        return ""

    def create(self, validated_data):
        emp_id = validated_data.pop("employee_id")
        try:
            profile = EmployeeProfile.objects.get(id=emp_id)
        except EmployeeProfile.DoesNotExist:
            raise serializers.ValidationError({"employee_id": "Employee Profile not found."})

        validated_data["employee_profile"] = profile
        validated_data["employee"] = profile.user
        validated_data["company"] = profile.company
        return super().create(validated_data)
