from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers

from employees.models import EmployeeProfile

from .models import LeaveBalanceAdjustment, LeaveRequest, LeaveType
from .utils import (
    get_leave_days,
    get_payment_breakdown,
    get_used_days_for_type,
    validate_leave_request_policy,
)

User = get_user_model()
LEAVE_ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}
LEAVE_MAX_UPLOAD_SIZE = int(getattr(settings, "MAX_LEAVE_DOCUMENT_SIZE_BYTES", 5 * 1024 * 1024))


class UserSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "full_name"]


class LeaveTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeaveType
        fields = "__all__"
        read_only_fields = ["created_at", "updated_at"]


class LeaveBalanceSerializer(serializers.Serializer):
    leave_type_id = serializers.IntegerField()
    leave_type = serializers.CharField()
    leave_code = serializers.CharField(required=False)
    total_days = serializers.DecimalField(max_digits=6, decimal_places=2)
    used_days = serializers.DecimalField(max_digits=6, decimal_places=2)
    remaining_days = serializers.DecimalField(max_digits=6, decimal_places=2)


class LeaveRequestSerializer(serializers.ModelSerializer):
    employee = UserSummarySerializer(read_only=True)
    leave_type = LeaveTypeSerializer(read_only=True)
    decided_by = UserSummarySerializer(read_only=True)
    days = serializers.SerializerMethodField()
    payment_breakdown = serializers.SerializerMethodField()
    payment_status = serializers.SerializerMethodField()
    deducted_from_leave_type = serializers.SerializerMethodField()

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

    def get_payment_breakdown(self, obj):
        year = obj.start_date.year
        used_before = max(
            0.0,
            get_used_days_for_type(obj.employee, obj.leave_type, year) - get_leave_days(obj.start_date, obj.end_date),
        )
        return get_payment_breakdown(obj.leave_type, used_before, get_leave_days(obj.start_date, obj.end_date))

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


class LeaveRequestCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeaveRequest
        fields = ["leave_type", "start_date", "end_date", "reason", "document"]

    def validate(self, attrs):
        start = attrs.get("start_date")
        end = attrs.get("end_date")
        leave_type = attrs.get("leave_type")
        reason = attrs.get("reason", "")
        document = attrs.get("document")

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
        user = self.context["request"].user

        # Check against APPROVED or PENDING requests
        # PENDING includes SUBMITTED, PENDING_MANAGER, PENDING_HR
        overlap_qs = LeaveRequest.objects.filter(
            employee=user,
            status__in=[
                LeaveRequest.RequestStatus.APPROVED,
                LeaveRequest.RequestStatus.SUBMITTED,
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


class HRManualLeaveRequestSerializer(serializers.ModelSerializer):
    employee_id = serializers.IntegerField(write_only=True)
    warning_messages = serializers.ListField(child=serializers.CharField(), read_only=True)

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
        ]

    @property
    def policy_warnings(self):
        return getattr(self, "_policy_warnings", [])

    def _get_employee_user(self, employee_profile_id):
        try:
            profile = EmployeeProfile.objects.select_related("user").get(id=employee_profile_id)
        except EmployeeProfile.DoesNotExist as exc:
            raise serializers.ValidationError({"employee_id": "Employee Profile not found."}) from exc

        if not profile.user:
            raise serializers.ValidationError({"employee_id": "Employee is not connected to a system user account."})

        if profile.employment_status != EmployeeProfile.EmploymentStatus.ACTIVE:
            raise serializers.ValidationError({"employee_id": "Only active employees are allowed."})

        return profile.user

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
        employee_user = self._get_employee_user(employee_id)

        start = attrs.get("start_date")
        end = attrs.get("end_date")
        leave_type = attrs.get("leave_type")
        reason = attrs.get("reason", "")
        document = attrs.get("document")

        if start and end and start > end:
            raise serializers.ValidationError({"end_date": "End date must be after start date."})

        if leave_type and not leave_type.is_active:
            raise serializers.ValidationError({"leave_type": "Leave type is inactive."})

        leave_code = (leave_type.code or leave_type.name or "").strip().upper().replace(" ", "_")
        if leave_code in {"SICK", "SICK_LEAVE"} and not document and not getattr(self.instance, "document", None):
            raise serializers.ValidationError({"document": "Medical report document is required for sick leave."})

        overlap_qs = LeaveRequest.objects.filter(
            employee=employee_user,
            is_active=True,
            status__in=[
                LeaveRequest.RequestStatus.APPROVED,
                LeaveRequest.RequestStatus.SUBMITTED,
                LeaveRequest.RequestStatus.PENDING_MANAGER,
                LeaveRequest.RequestStatus.PENDING_HR,
                LeaveRequest.RequestStatus.PENDING_CEO,
            ],
        ).filter(Q(start_date__lte=end) & Q(end_date__gte=start))

        if self.instance is not None:
            overlap_qs = overlap_qs.exclude(pk=self.instance.pk)

        if overlap_qs.exists():
            raise serializers.ValidationError("You already have a pending or approved leave request for this period.")

        policy_error = validate_leave_request_policy(employee_user, leave_type, start, end, reason, bool(document))
        self._policy_warnings = []
        if policy_error:
            normalized = str(policy_error).lower()
            if "exceeds remaining balance" in normalized:
                self._policy_warnings.append(policy_error)
            else:
                raise serializers.ValidationError(policy_error)

        attrs["employee_user"] = employee_user
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
        employee_user = validated_data.pop("employee_user")
        validated_data.pop("employee_id", None)
        request_user = self.context["request"].user
        return LeaveRequest.objects.create(
            employee=employee_user,
            status=LeaveRequest.RequestStatus.APPROVED,
            source=LeaveRequest.RequestSource.HR_MANUAL,
            entered_by=request_user,
            decided_by=request_user,
            decided_at=timezone.now(),
            **validated_data,
        )

    def update(self, instance, validated_data):
        validated_data.pop("employee_id", None)
        employee_user = validated_data.pop("employee_user", None)
        request_user = self.context["request"].user

        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if employee_user is not None:
            instance.employee = employee_user

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

    class Meta:
        model = LeaveBalanceAdjustment
        fields = [
            "id",
            "employee",
            "employee_id",
            "leave_type",
            "adjustment_days",
            "reason",
            "created_by",
            "created_by_name",
            "created_at",
        ]
        read_only_fields = ["employee", "created_by", "created_at"]

    def create(self, validated_data):
        emp_id = validated_data.pop("employee_id")
        try:
            profile = EmployeeProfile.objects.get(id=emp_id)
            user = profile.user
            if not user:
                raise serializers.ValidationError({"employee_id": "Employee is not connected to a system user account."})
            validated_data["employee"] = user
        except EmployeeProfile.DoesNotExist:
            raise serializers.ValidationError({"employee_id": "Employee Profile not found."})

        return super().create(validated_data)
