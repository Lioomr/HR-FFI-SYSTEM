from rest_framework import serializers
from .models import AttendanceRecord

class AttendanceRecordSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source="employee_profile.user.get_full_name", read_only=True)
    employee_email = serializers.EmailField(source="employee_profile.user.email", read_only=True)

    class Meta:
        model = AttendanceRecord
        fields = [
            "id", "employee_profile", "employee_name", "employee_email",
            "date", "check_in_at", "check_out_at",
            "status", "source", "is_overridden", "override_reason", "notes",
            "created_at", "updated_at"
        ]
        read_only_fields = [
            "id", "employee_profile", "date", 
            "check_in_at", "check_out_at", "source", 
            "created_by", "updated_by", "created_at", "updated_at",
            "is_overridden" 
        ]

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
                raise serializers.ValidationError({"override_reason": "Override reason is required when modifying check-in, check-out, or status."})
        
        return attrs

class CheckInResponseSerializer(serializers.ModelSerializer):
    class Meta:
        model = AttendanceRecord
        fields = ["id", "date", "check_in_at", "status"]

class CheckOutResponseSerializer(serializers.ModelSerializer):
    class Meta:
        model = AttendanceRecord
        fields = ["id", "date", "check_in_at", "check_out_at", "status"]
