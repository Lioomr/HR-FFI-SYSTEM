import secrets
import string

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db.models import Q
from rest_framework.views import APIView
from rest_framework import status
from rest_framework.response import Response

from core.permissions import IsSystemAdmin
from core.responses import success, error
from audit.utils import audit
from .serializers import (
    UserListSerializer, CreateUserSerializer,
    UpdateStatusSerializer, UpdateRoleSerializer,
    ResetPasswordSerializer
)

User = get_user_model()

ROLE_SYSTEM_ADMIN = "SystemAdmin"

def system_admin_count():
    return User.objects.filter(groups__name=ROLE_SYSTEM_ADMIN, is_active=True).count()

def is_last_active_system_admin(user: User) -> bool:
    # if this user is an active system admin and it's the only one
    if not user.is_active:
        return False
    return user.groups.filter(name=ROLE_SYSTEM_ADMIN).exists() and system_admin_count() <= 1

def generate_temp_password(length=12):
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))

class UsersListCreateView(APIView):
    permission_classes = [IsSystemAdmin]

    def get(self, request):
        search = request.query_params.get("search", "").strip()
        role = request.query_params.get("role", "").strip()
        status_param = request.query_params.get("status", "").strip()  # active/inactive optional

        qs = User.objects.all().order_by("-id")

        if search:
            qs = qs.filter(Q(email__icontains=search) | Q(full_name__icontains=search))
        if role in ("SystemAdmin", "HRManager", "Employee"):
            qs = qs.filter(groups__name=role)
        if status_param == "active":
            qs = qs.filter(is_active=True)
        elif status_param == "inactive":
            qs = qs.filter(is_active=False)

        # Let DRF pagination handle if you later switch this to GenericAPIView + pagination.
        data = UserListSerializer(qs, many=True).data
        return success({"items": data})

    def post(self, request):
        s = CreateUserSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user = s.save()

        audit(request, "user_created", entity="user", entity_id=user.id, metadata={
            "email": user.email,
            "role": user.groups.first().name if user.groups.exists() else "Employee",
            "is_active": user.is_active,
        })

        return success(UserListSerializer(user).data, status=status.HTTP_201_CREATED)

class UserDetailView(APIView):
    permission_classes = [IsSystemAdmin]

    def get(self, request, user_id):
        user = User.objects.get(pk=user_id)
        return success(UserListSerializer(user).data)

class UserStatusView(APIView):
    permission_classes = [IsSystemAdmin]

    def patch(self, request, user_id):
        user = User.objects.get(pk=user_id)
        s = UpdateStatusSerializer(data=request.data)
        s.is_valid(raise_exception=True)

        new_active = s.validated_data["is_active"]

        # Prevent disabling the last active system admin
        if user.is_active and not new_active and is_last_active_system_admin(user):
            return error("Cannot disable the last active SystemAdmin.", status=422)

        user.is_active = new_active
        user.save(update_fields=["is_active"])

        audit(request, "user_status_changed", entity="user", entity_id=user.id, metadata={
            "is_active": user.is_active
        })

        return success(UserListSerializer(user).data)

class UserRoleView(APIView):
    permission_classes = [IsSystemAdmin]

    def put(self, request, user_id):
        user = User.objects.get(pk=user_id)
        s = UpdateRoleSerializer(data=request.data)
        s.is_valid(raise_exception=True)

        new_role = s.validated_data["role"]

        # Prevent removing the last active system admin role
        if user.groups.filter(name=ROLE_SYSTEM_ADMIN).exists() and new_role != ROLE_SYSTEM_ADMIN:
            if is_last_active_system_admin(user):
                return error("Cannot change role of the last active SystemAdmin.", status=422)

        group, _ = Group.objects.get_or_create(name=new_role)
        user.groups.clear()
        user.groups.add(group)

        audit(request, "user_role_changed", entity="user", entity_id=user.id, metadata={"role": new_role})

        return success(UserListSerializer(user).data)

class UserResetPasswordView(APIView):
    permission_classes = [IsSystemAdmin]

    def post(self, request, user_id):
        user = User.objects.get(pk=user_id)
        s = ResetPasswordSerializer(data=request.data)
        s.is_valid(raise_exception=True)

        mode = s.validated_data["mode"]

        if mode == "temporary_password":
            temp_password = generate_temp_password()
            user.set_password(temp_password)
            user.save(update_fields=["password"])

            audit(request, "user_password_reset", entity="user", entity_id=user.id, metadata={"mode": mode})

            # Return temp password ONCE (Phase 1). Frontend can show it in modal.
            return success({"mode": mode, "temporary_password": temp_password})

        # mode == reset_link
        # Phase 1: generate a token you can later email. We'll return it for now.
        # In production: send email + don't return token.
        token = secrets.token_urlsafe(32)

        audit(request, "user_password_reset", entity="user", entity_id=user.id, metadata={"mode": mode})

        return success({"mode": mode, "reset_token": token})
