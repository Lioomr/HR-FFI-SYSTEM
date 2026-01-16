from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework import serializers

User = get_user_model()

ROLE_CHOICES = ("SystemAdmin", "HRManager", "Employee")

class UserListSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "full_name", "email", "is_active", "role", "is_staff", "is_superuser"]

    def get_role(self, obj):
        g = obj.groups.first()
        return g.name if g else "Employee"

class CreateUserSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=255)
    email = serializers.EmailField()
    role = serializers.ChoiceField(choices=ROLE_CHOICES)
    is_active = serializers.BooleanField(default=True)

    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("Email already exists.")
        return value

    def create(self, validated_data):
        role = validated_data.pop("role")
        is_active = validated_data.pop("is_active", True)

        # Create user with unusable password; invite/reset will set it.
        user = User.objects.create(
            email=validated_data["email"],
            full_name=validated_data.get("full_name", ""),
            is_active=is_active,
        )
        user.set_unusable_password()
        user.save()

        group, _ = Group.objects.get_or_create(name=role)
        user.groups.clear()
        user.groups.add(group)
        return user

class UpdateStatusSerializer(serializers.Serializer):
    is_active = serializers.BooleanField()

class UpdateRoleSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=ROLE_CHOICES)

class ResetPasswordSerializer(serializers.Serializer):
    mode = serializers.ChoiceField(choices=("temporary_password", "reset_link"))
