import secrets
import string
import hashlib
import logging

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.cache import cache
from django.db.models import Q
from rest_framework import status
from rest_framework.views import APIView

from audit.utils import audit
from core.pagination import StandardPagination
from core.permissions import IsHRManagerOrAdmin, IsSystemAdmin
from core.responses import error, success
from core.services.email_service import EmailService

from .serializers import (
    CreateUserSerializer,
    ResetPasswordSerializer,
    UpdateRoleSerializer,
    UpdateStatusSerializer,
    UserListSerializer,
)

User = get_user_model()
logger = logging.getLogger(__name__)

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


def _password_reset_cache_key(user_id: int) -> str:
    return f"password_reset_token:{user_id}"


def _store_hashed_reset_token(user_id: int, token: str) -> None:
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    ttl_seconds = int(getattr(settings, "PASSWORD_RESET_TOKEN_TTL_SECONDS", 3600))
    cache.set(_password_reset_cache_key(user_id), {"token_hash": token_hash}, ttl_seconds)


def _send_password_reset_material(user: User, *, subject: str, html_content: str, fallback_text: str) -> None:
    email_service = EmailService()
    if not email_service.is_configured():
        logger.warning("password_reset_email_not_sent_email_service_unconfigured", extra={"user_id": user.id})
        return
    email_service.send_html_email(
        to_email=user.email,
        subject=subject,
        html_content=html_content,
        fallback_text=fallback_text,
    )


class UsersListCreateView(APIView):
    permission_classes = [IsHRManagerOrAdmin]

    def get(self, request):
        search = request.query_params.get("search", "").strip()
        role = request.query_params.get("role", "").strip()
        status_param = request.query_params.get("status", "").strip()  # active/inactive optional

        qs = User.objects.all().order_by("-id")

        if search:
            qs = qs.filter(Q(email__icontains=search) | Q(full_name__icontains=search))
        if role in ("SystemAdmin", "HRManager", "Manager", "Employee", "CEO", "CFO"):
            qs = qs.filter(groups__name=role)
        if status_param == "active":
            qs = qs.filter(is_active=True)
        elif status_param == "inactive":
            qs = qs.filter(is_active=False)

        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request)
        data = UserListSerializer(page, many=True).data
        return paginator.get_paginated_response(data)

    def post(self, request):
        s = CreateUserSerializer(data=request.data, context={"request": request})

        # Validate and return user-friendly errors
        if not s.is_valid():
            # Extract the first error message for user-friendly display
            errors = s.errors
            if errors:
                # Get first field with error
                first_field = next(iter(errors.keys()))
                first_error = errors[first_field]

                # Extract message from list if needed
                if isinstance(first_error, list) and len(first_error) > 0:
                    error_message = str(first_error[0])
                else:
                    error_message = str(first_error)

                return error(error_message, errors=errors, status=422)

            return error("Validation failed", errors=errors, status=422)

        user = s.save()

        audit(
            request,
            "user_created",
            entity="user",
            entity_id=user.id,
            metadata={
                "email": user.email,
                "role": user.groups.first().name if user.groups.exists() else "Employee",
                "is_active": user.is_active,
            },
        )

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

        # Prevent self-disable
        if request.user.id == user.id and not new_active:
            return error("Cannot disable your own account.", status=422)

        # Prevent disabling the last active system admin
        if user.is_active and not new_active and is_last_active_system_admin(user):
            return error("Cannot disable the last active SystemAdmin.", status=422)

        user.is_active = new_active
        user.save(update_fields=["is_active"])

        audit(request, "user_status_changed", entity="user", entity_id=user.id, metadata={"is_active": user.is_active})

        return success(UserListSerializer(user).data)


class UserRoleView(APIView):
    permission_classes = [IsSystemAdmin]

    def put(self, request, user_id):
        user = User.objects.get(pk=user_id)
        s = UpdateRoleSerializer(data=request.data, context={"request": request})
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
            _send_password_reset_material(
                user,
                subject="Your temporary password",
                html_content=(
                    "<p>Your password has been reset by an administrator.</p>"
                    f"<p>Temporary password: <strong>{temp_password}</strong></p>"
                ),
                fallback_text=f"Your temporary password is: {temp_password}",
            )

            audit(request, "user_password_reset", entity="user", entity_id=user.id, metadata={"mode": mode})

            return success({"mode": mode, "message": "Password reset processed."})

        # mode == reset_link
        token = secrets.token_urlsafe(32)
        _store_hashed_reset_token(user.id, token)
        reset_link = f"{settings.FRONTEND_URL.rstrip('/')}/change-password?token={token}&uid={user.id}"
        _send_password_reset_material(
            user,
            subject="Reset your password",
            html_content=(
                "<p>Your password reset was requested by an administrator.</p>"
                f'<p>Use this one-time link: <a href="{reset_link}">{reset_link}</a></p>'
            ),
            fallback_text=f"Use this one-time reset link: {reset_link}",
        )

        audit(request, "user_password_reset", entity="user", entity_id=user.id, metadata={"mode": mode})

        return success({"mode": mode, "message": "Password reset processed."})
