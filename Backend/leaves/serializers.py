from datetime import date
from rest_framework import serializers
from django.contrib.auth import get_user_model
from django.db.models import Q
from .models import LeaveType, LeaveRequest
from .utils import (
    get_leave_days,
    validate_leave_request_policy,
    get_used_days_for_type,
    get_payment_breakdown,
)

User = get_user_model()


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


class LeaveRequestActionSerializer(serializers.Serializer):
    comment = serializers.CharField(required=False, allow_blank=True)


from .models import LeaveBalanceAdjustment

from employees.models import EmployeeProfile


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
            validated_data["employee"] = user
        except EmployeeProfile.DoesNotExist:
            raise serializers.ValidationError({"employee_id": "Employee Profile not found."})

        return super().create(validated_data)
