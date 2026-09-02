import hashlib
import logging
import secrets
import string

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.cache import cache
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.template.loader import render_to_string
from django.utils import timezone
from rest_framework import status
from rest_framework.views import APIView

from accounts.password_policy import get_password_policy
from audit.utils import audit
from core.pagination import StandardPagination
from core.permissions import IsHRManagerOrAdmin, IsSystemAdmin, get_role
from core.responses import error, success
from core.services.bird_email_service import _resolve_logo_source
from core.services.email_service import EmailService
from organization.services import get_user_accessible_company_ids, user_has_all_company_access

from .serializers import (
    CreateUserSerializer,
    ResetPasswordSerializer,
    UpdateRoleSerializer,
    UpdateStatusSerializer,
    UpdateUserOrganizationsSerializer,
    UserListSerializer,
    sync_user_organization_access,
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
    policy = get_password_policy()
    target_length = max(length, policy["min_length"])
    password_chars: list[str] = []

    if policy["require_upper"]:
        password_chars.append(secrets.choice(string.ascii_uppercase))
    if policy["require_lower"]:
        password_chars.append(secrets.choice(string.ascii_lowercase))
    if policy["require_number"]:
        password_chars.append(secrets.choice(string.digits))
    if policy["require_special"]:
        password_chars.append(secrets.choice("!@#$%^&*()-_=+"))

    base_alphabet = string.ascii_letters + string.digits + "!@#$%^&*()-_=+"
    while len(password_chars) < target_length:
        password_chars.append(secrets.choice(base_alphabet))

    secrets.SystemRandom().shuffle(password_chars)
    return "".join(password_chars)


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


def _display_datetime(value):
    tzinfo = getattr(settings, "EMAIL_DISPLAY_TZINFO", None)
    return timezone.localtime(value, tzinfo) if tzinfo else timezone.localtime(value)


class UsersListCreateView(APIView):
    permission_classes = [IsHRManagerOrAdmin]

    def get(self, request):
        search = request.query_params.get("search", "").strip()
        role = request.query_params.get("role", "").strip()
        status_param = request.query_params.get("status", "").strip()  # active/inactive optional

        qs = (
            User.objects.all()
            .select_related("employee_profile")
            .prefetch_related("groups", "organization_access_entries__organization")
            .order_by("-id")
        )

        if get_role(request.user) == "HRManager" and not user_has_all_company_access(request.user):
            accessible_company_ids = get_user_accessible_company_ids(request.user)
            qs = qs.filter(
                Q(employee_profile__company_id__in=accessible_company_ids)
                | Q(organization_access_entries__organization_id__in=accessible_company_ids)
            ).distinct()

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
        data = UserListSerializer(page, many=True, context={"request": request}).data
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

        return success(UserListSerializer(user, context={"request": request}).data, status=status.HTTP_201_CREATED)


class UserDetailView(APIView):
    permission_classes = [IsSystemAdmin]

    def get(self, request, user_id):
        user = get_object_or_404(
            User.objects.select_related("employee_profile")
            .prefetch_related("groups", "organization_access_entries__organization"),
            pk=user_id,
        )
        return success(UserListSerializer(user, context={"request": request}).data)

    def patch(self, request, user_id):
        user = get_object_or_404(User, pk=user_id)
        serializer = UpdateUserOrganizationsSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)

        if not user.groups.filter(name="HRManager").exists():
            return error("Organization access can only be managed for HR Manager users.", status=422)

        organization_ids = serializer.validated_data["organization_ids"]
        sync_user_organization_access(user, organization_ids)

        audit(
            request,
            "user_organization_access_changed",
            entity="user",
            entity_id=user.id,
            metadata={"organization_ids": organization_ids},
        )

        refreshed_user = (
            User.objects.select_related("employee_profile")
            .prefetch_related("groups", "organization_access_entries__organization")
            .get(pk=user.pk)
        )
        return success(UserListSerializer(refreshed_user, context={"request": request}).data)


class UserStatusView(APIView):
    permission_classes = [IsSystemAdmin]

    def patch(self, request, user_id):
        user = get_object_or_404(User, pk=user_id)
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

        return success(UserListSerializer(user, context={"request": request}).data)


class UserRoleView(APIView):
    permission_classes = [IsSystemAdmin]

    def put(self, request, user_id):
        user = get_object_or_404(User, pk=user_id)
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

        return success(UserListSerializer(user, context={"request": request}).data)


class UserResetPasswordView(APIView):
    permission_classes = [IsSystemAdmin]

    def post(self, request, user_id):
        user = get_object_or_404(User, pk=user_id)
        s = ResetPasswordSerializer(data=request.data)
        s.is_valid(raise_exception=True)

        mode = s.validated_data["mode"]
        requested_at = _display_datetime(timezone.now()).strftime("%Y-%m-%d %I:%M %p %Z")

        if mode == "temporary_password":
            temp_password = generate_temp_password()
            user.set_password(temp_password)
            user.save(update_fields=["password"])

            context = {
                "logo_url": _resolve_logo_source(),
                "contact_email": getattr(settings, "EMAIL_CONTACT_EMAIL", "hr@fficontracting.com"),
                "contact_name": getattr(settings, "EMAIL_CONTACT_NAME", "") or "",
                "contact_phone": getattr(settings, "EMAIL_CONTACT_PHONE", "") or "",
                "title": "Your temporary password",
                "title_ar": "كلمة المرور المؤقتة الخاصة بك",
                "employee_name": user.full_name or user.email,
                "message": "Your password has been reset by an administrator. Use the temporary password below to sign in — you will be asked to change it immediately.",
                "message_ar": "تمت إعادة تعيين كلمة المرور الخاصة بك من قِبل مسؤول النظام. استخدم كلمة المرور المؤقتة أدناه لتسجيل الدخول، وسيُطلب منك تغييرها فوراً.",
                "status_label": "Security",
                "status_label_ar": "أمان",
                "status_color": "#C2410C",
                "rows": [
                    {"label": "Temporary password", "label_ar": "كلمة المرور المؤقتة", "value": temp_password,
                     "value_html": f"<span style='font-family:Consolas,\"Courier New\",monospace;font-size:16px;letter-spacing:2px;color:#1c1f24;'>{temp_password}</span>"},
                    {"label": "Issued at", "label_ar": "وقت الإصدار", "value": requested_at},
                ],
                "details_title": "Sign-in details",
                "details_title_ar": "بيانات تسجيل الدخول",
                "security_note": "If you did not expect this change, contact HR immediately.",
                "security_note_ar": "إذا لم تكن تتوقع هذا التغيير، يُرجى التواصل مع الموارد البشرية فوراً.",
            }
            html = render_to_string("emails/generic_notification.html", context)

            _send_password_reset_material(
                user,
                subject="Your temporary password",
                html_content=html,
                fallback_text=f"Your temporary password is: {temp_password}",
            )

            audit(request, "user_password_reset", entity="user", entity_id=user.id, metadata={"mode": mode})

            return success({"mode": mode, "message": "Password reset processed."})

        # mode == reset_link
        token = secrets.token_urlsafe(32)
        _store_hashed_reset_token(user.id, token)
        reset_link = f"{settings.FRONTEND_URL.rstrip('/')}/change-password?token={token}&uid={user.id}"

        context = {
            "logo_url": _resolve_logo_source(),
            "contact_email": getattr(settings, "EMAIL_CONTACT_EMAIL", "hr@fficontracting.com"),
            "contact_name": getattr(settings, "EMAIL_CONTACT_NAME", "") or "",
            "contact_phone": getattr(settings, "EMAIL_CONTACT_PHONE", "") or "",
            "title": "Reset your password",
            "title_ar": "إعادة تعيين كلمة المرور",
            "employee_name": user.full_name or user.email,
            "message": "A password reset was requested for your account by an administrator. Click the button below to set a new password — the link can be used once and then expires.",
            "message_ar": "تم طلب إعادة تعيين كلمة المرور لحسابك من قِبل مسؤول النظام. انقر على الزر أدناه لتعيين كلمة مرور جديدة — الرابط صالح للاستخدام مرة واحدة فقط ثم تنتهي صلاحيته.",
            "status_label": "Security",
            "status_label_ar": "أمان",
            "status_color": "#C2410C",
            "rows": [
                {"label": "Requested at", "label_ar": "وقت الطلب", "value": requested_at},
            ],
            "details_title": "Request details",
            "details_title_ar": "تفاصيل الطلب",
            "action_url": reset_link,
            "action_text": "Reset password",
            "action_text_ar": "إعادة تعيين كلمة المرور",
            "security_note": "If you did not expect this, contact HR immediately and do not use the link.",
            "security_note_ar": "إذا لم تكن تتوقع ذلك، تواصل مع الموارد البشرية فوراً ولا تستخدم الرابط.",
        }
        html = render_to_string("emails/generic_notification.html", context)

        _send_password_reset_material(
            user,
            subject="Reset your password",
            html_content=html,
            fallback_text=f"Use this one-time reset link: {reset_link}",
        )

        audit(request, "user_password_reset", entity="user", entity_id=user.id, metadata={"mode": mode})

        return success({"mode": mode, "message": "Password reset processed."})
