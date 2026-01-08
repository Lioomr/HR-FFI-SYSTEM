from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework import serializers
from django.utils.timezone import now, timedelta

from .models import User
from .audit import log_action
from .utils import generate_temp_password
from .email_service import send_invite_email


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["role"] = user.role
        token["user_id"] = str(user.id)
        token["email"] = user.email
        return token

    def validate(self, attrs):
        data = super().validate(attrs)

        user = self.user
        data["role"] = user.role
        data["must_change_password"] = user.must_change_password

        log_action(
            actor=user,
            action="LOGIN",
            target=user.email,
            ip=self.context["request"].META.get("REMOTE_ADDR"),
        )

        return data


class AdminUserCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "email", "role", "is_active")

    def create(self, validated_data):
        temp_password = generate_temp_password()

        user = User.objects.create(
            email=validated_data["email"],
            role=validated_data.get("role", "EMPLOYEE"),
            is_active=True,
            must_change_password=True,
            invite_expires_at=now() + timedelta(hours=24),
        )

        user.set_password(temp_password)
        user.save()

        send_invite_email(user.email, temp_password)

        request = self.context.get("request")
        log_action(
            actor=request.user,
            action="CREATE_USER",
            target=user.email,
            ip=request.META.get("REMOTE_ADDR"),
        )

        return user
