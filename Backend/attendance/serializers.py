from rest_framework import serializers

from core.services import get_workflow_snapshot

from .models import AttendanceCorrectionRequest, AttendanceRecord, BioTimeConfig, BioTimeEmployeeMap


class AttendanceRecordSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source="employee_profile.user.get_full_name", read_only=True)
    employee_email = serializers.EmailField(source="employee_profile.user.email", read_only=True)
    workflow = serializers.SerializerMethodField()

    class Meta:
        model = AttendanceRecord
        fields = [
            "id",
            "employee_profile",
            "employee_name",
            "employee_email",
            "date",
            "check_in_at",
            "check_out_at",
            "status",
            "source",
            "manager_decision_at",
            "manager_decision_by",
            "manager_decision_note",
            "ceo_decision_at",
            "ceo_decision_by",
            "ceo_decision_note",
            "is_overridden",
            "override_reason",
            "notes",
            "workflow",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "employee_profile",
            "date",
            "check_in_at",
            "check_out_at",
            "source",
            "manager_decision_at",
            "manager_decision_by",
            "manager_decision_note",
            "ceo_decision_at",
            "ceo_decision_by",
            "ceo_decision_note",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
            "is_overridden",
        ]

    def get_workflow(self, obj):
        request = self.context.get("request")
        actor = getattr(request, "user", None) if request else None
        return get_workflow_snapshot(obj, actor=actor)


class AttendanceOverrideSerializer(serializers.ModelSerializer):
    class Meta:
        model = AttendanceRecord
        fields = ["check_in_at", "check_out_at", "status", "notes", "override_reason"]

    def validate(self, attrs):
        # Core fields that require override_reason
        core_fields = {"check_in_at", "check_out_at", "status"}

        # Check if any core field is being changed
        if any(field in attrs for field in core_fields):
            if not attrs.get("override_reason"):
                raise serializers.ValidationError(
                    {"override_reason": "Override reason is required when modifying check-in, check-out, or status."}
                )

        return attrs


class AttendanceCorrectionRequestSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source="employee_profile.full_name", read_only=True)
    employee_email = serializers.EmailField(source="employee_profile.user.email", read_only=True)
    current_check_in_at = serializers.DateTimeField(source="attendance_record.check_in_at", read_only=True)
    current_check_out_at = serializers.DateTimeField(source="attendance_record.check_out_at", read_only=True)
    current_status = serializers.CharField(source="attendance_record.status", read_only=True)
    workflow = serializers.SerializerMethodField()

    class Meta:
        model = AttendanceCorrectionRequest
        fields = [
            "id",
            "employee_profile",
            "employee_name",
            "employee_email",
            "attendance_record",
            "date",
            "current_check_in_at",
            "current_check_out_at",
            "current_status",
            "requested_check_in_at",
            "requested_check_out_at",
            "requested_status",
            "reason",
            "status",
            "manager_decision_at",
            "manager_decision_by",
            "manager_decision_note",
            "hr_decision_at",
            "hr_decision_by",
            "hr_decision_note",
            "submitted_at",
            "decided_at",
            "cancelled_at",
            "workflow",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "employee_name",
            "employee_email",
            "current_check_in_at",
            "current_check_out_at",
            "current_status",
            "status",
            "manager_decision_at",
            "manager_decision_by",
            "manager_decision_note",
            "hr_decision_at",
            "hr_decision_by",
            "hr_decision_note",
            "submitted_at",
            "decided_at",
            "cancelled_at",
            "workflow",
            "created_at",
            "updated_at",
        ]
        extra_kwargs = {
            "employee_profile": {"required": False},
            "attendance_record": {"required": False, "allow_null": True},
        }

    def validate(self, attrs):
        record = attrs.get("attendance_record") or getattr(self.instance, "attendance_record", None)
        employee_profile = attrs.get("employee_profile") or getattr(self.instance, "employee_profile", None)
        date = attrs.get("date") or getattr(self.instance, "date", None)
        check_in = attrs.get("requested_check_in_at", getattr(self.instance, "requested_check_in_at", None))
        check_out = attrs.get("requested_check_out_at", getattr(self.instance, "requested_check_out_at", None))
        requested_status = attrs.get("requested_status", getattr(self.instance, "requested_status", ""))

        if not check_in and not check_out and not requested_status:
            raise serializers.ValidationError(
                "At least one requested check-in, check-out, or status change is required."
            )
        if check_in and check_out and check_out < check_in:
            raise serializers.ValidationError({"requested_check_out_at": "Check-out cannot be before check-in."})
        if record and employee_profile and record.employee_profile_id != employee_profile.id:
            raise serializers.ValidationError(
                {"attendance_record": "Attendance record does not belong to this employee."}
            )
        if record and date and record.date != date:
            raise serializers.ValidationError({"date": "Date must match the selected attendance record."})
        if requested_status and requested_status not in {
            AttendanceRecord.Status.PRESENT,
            AttendanceRecord.Status.ABSENT,
            AttendanceRecord.Status.LATE,
            AttendanceRecord.Status.REJECTED,
        }:
            raise serializers.ValidationError(
                {"requested_status": "Requested status must be PRESENT, ABSENT, LATE, or REJECTED."}
            )
        return attrs

    def get_workflow(self, obj):
        request = self.context.get("request")
        actor = getattr(request, "user", None) if request else None
        return get_workflow_snapshot(obj, actor=actor)


class CheckInResponseSerializer(serializers.ModelSerializer):
    class Meta:
        model = AttendanceRecord
        fields = ["id", "date", "check_in_at", "status"]


class CheckOutResponseSerializer(serializers.ModelSerializer):
    class Meta:
        model = AttendanceRecord
        fields = ["id", "date", "check_in_at", "check_out_at", "status"]
class BioTimeConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = BioTimeConfig
        fields = ["server_ip", "server_port", "username", "password", "is_active", "last_sync_time"]
        read_only_fields = ["last_sync_time"]
        extra_kwargs = {"password": {"write_only": True, "required": False, "allow_blank": True}}

    def to_representation(self, instance):
        # Always output password as empty to frontend or masked to avoid leaking
        ret = super().to_representation(instance)
        ret["password"] = ""
        return ret


class BioTimeEmployeeMapSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source="employee_profile.user.get_full_name", read_only=True)
    department = serializers.CharField(source="employee_profile.department", read_only=True)
    
    class Meta:
        model = BioTimeEmployeeMap
        fields = ["id", "employee_profile", "employee_name", "department", "biotime_emp_code", "created_at"]
        read_only_fields = ["id", "created_at", "employee_name", "department"]
