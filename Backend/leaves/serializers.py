from datetime import date
from rest_framework import serializers
from django.contrib.auth import get_user_model
from django.db.models import Q
from .models import LeaveType, LeaveRequest

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
    total_days = serializers.DecimalField(max_digits=6, decimal_places=2)
    used_days = serializers.DecimalField(max_digits=6, decimal_places=2)
    remaining_days = serializers.DecimalField(max_digits=6, decimal_places=2)


class LeaveRequestSerializer(serializers.ModelSerializer):
    employee = UserSummarySerializer(read_only=True)
    leave_type = LeaveTypeSerializer(read_only=True)
    decided_by = UserSummarySerializer(read_only=True)
    days = serializers.SerializerMethodField()

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
        from .utils import get_leave_days

        return get_leave_days(obj.start_date, obj.end_date)


class LeaveRequestCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeaveRequest
        fields = ["leave_type", "start_date", "end_date", "reason"]

    def validate(self, attrs):
        start = attrs.get("start_date")
        end = attrs.get("end_date")
        leave_type = attrs.get("leave_type")

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
