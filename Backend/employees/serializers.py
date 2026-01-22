from rest_framework import serializers
from django.contrib.auth import get_user_model
from core.permissions import get_role
from .models import EmployeeProfile

User = get_user_model()

class UserMinimalSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "email", "full_name", "role", "is_active"]

    def get_role(self, obj):
        return get_role(obj)

class EmployeeProfileSerializer(serializers.ModelSerializer):
    user = UserMinimalSerializer(read_only=True)
    manager = UserMinimalSerializer(read_only=True)

    class Meta:
        model = EmployeeProfile
        fields = [
            "id", "user", "employee_id", "department", "job_title", 
            "hire_date", "employment_status", "manager", 
            "created_at", "updated_at"
        ]
        read_only_fields = ["employee_id", "created_at", "updated_at"]


class EmployeeProfileCreateUpdateSerializer(serializers.ModelSerializer):
    # User is writable only on creation
    user_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(), 
        source="user", 
        write_only=True
    )
    manager_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(), 
        source="manager", 
        required=False,
        allow_null=True,
        write_only=True
    )

    class Meta:
        model = EmployeeProfile
        fields = [
            "id", "employee_id",
            "user_id", "department", "job_title", 
            "hire_date", "employment_status", "manager_id"
        ]
        read_only_fields = ["id", "employee_id"]

    def validate_user_id(self, value):
        if self.instance:
            # Update: Cannot change user
            if self.instance.user != value:
                raise serializers.ValidationError("Cannot change the user associated with this profile.")
        else:
            # Create: Check uniqueness
            if EmployeeProfile.objects.filter(user=value).exists():
                raise serializers.ValidationError("This user already has an employee profile.")
        return value
