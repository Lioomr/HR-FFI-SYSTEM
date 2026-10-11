from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework.permissions import AllowAny
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from audit.utils import audit
from core.responses import error, success
from core.services.messaging_providers import is_e164, normalize_phone_number
from core.services.whatsapp_service import WhatsAppService
from organization.services import (
    get_active_organization_for_request,
    get_default_organization_for_user,
    get_user_accessible_organizations,
    serialize_organizations,
    user_has_all_company_access,
)

from .authentication import RefreshEndpointAuthentication
from .password_policy import validate_password_against_policy
from .password_reset_otp import consume_otp, issue_otp, mask_recovery_phone, verify_otp
from .permissions import get_role
from .security import (
    blacklist_outstanding_refresh_tokens,
    consume_reset_token,
    invalidate_reset_token,
    verify_reset_token,
)
from .serializers import (
    ChangePasswordSerializer,
    LoginSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetOTPConfirmSerializer,
    PasswordResetOTPRequestSerializer,
    PasswordResetOTPVerifySerializer,
    VersionedTokenRefreshSerializer,
    resolve_password_reset_user,
)
from .throttles import LoginRateThrottle, PasswordResetConfirmRateThrottle, PasswordResetRequestRateThrottle

RECOVERY_MESSAGE = "If recovery is available, a code will arrive on WhatsApp. Otherwise contact HR."
SAME_PASSWORD_MESSAGE = "New password must be different from your current password."


class PasswordResetOTPRequestView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [PasswordResetRequestRateThrottle]

    def post(self, request):
        serializer = PasswordResetOTPRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        response = success({"message": RECOVERY_MESSAGE})
        account = resolve_password_reset_user(serializer.validated_data["identifier"])
        if not account:
            return response
        with transaction.atomic():
            user = get_user_model().objects.select_for_update().filter(pk=account.pk).first()
            if not user:
                return response
            profile = getattr(user, "employee_profile", None)
            phone = normalize_phone_number(profile.mobile if profile else "")
            if not user.is_active or not is_e164(phone):
                return response
            try:
                otp = issue_otp(user.pk, user.auth_token_version)
                if not otp:
                    return response
                result = WhatsAppService().send_template_message(
                    phone_number=phone,
                    template_name="password_reset_otp",
                    template_variables={"otp": otp},
                    language="ar",
                )
                if not result.get("success"):
                    consume_otp(user.pk)
            except Exception:
                # Recovery must fail closed without leaking codes/provider diagnostics.
                try:
                    consume_otp(user.pk)
                except Exception:
                    pass
                return response
            audit(
                request,
                action="password_reset_otp_requested",
                entity="User",
                entity_id=user.pk,
                metadata={"channel": "whatsapp", "sent": bool(result.get("success"))},
            )
        return response


class PasswordResetOTPVerifyView(APIView):
    """Checks the code without consuming it so the UI can advance to the new-password step."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [PasswordResetConfirmRateThrottle]

    def post(self, request):
        serializer = PasswordResetOTPVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        invalid = error("This code is invalid or has expired.", status=422)
        account = resolve_password_reset_user(serializer.validated_data["identifier"])
        if not account:
            return invalid
        with transaction.atomic():
            user = get_user_model().objects.select_for_update().filter(pk=account.pk).first()
            if not user or not user.is_active:
                return invalid
            try:
                if not verify_otp(user.pk, serializer.validated_data["otp"], user.auth_token_version):
                    return invalid
            except Exception:
                return invalid
            profile = getattr(user, "employee_profile", None)
            phone = normalize_phone_number(profile.mobile if profile else "")
            data = {"masked_phone": mask_recovery_phone(phone)} if is_e164(phone) else {}
        return success(data)


class PasswordResetOTPConfirmView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [PasswordResetConfirmRateThrottle]

    def post(self, request):
        serializer = PasswordResetOTPConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        invalid = error("This code is invalid or has expired.", status=422)
        account = resolve_password_reset_user(serializer.validated_data["identifier"])
        if not account:
            return invalid
        with transaction.atomic():
            user = get_user_model().objects.select_for_update().filter(pk=account.pk).first()
            if not user:
                return invalid
            try:
                if not user.is_active or not verify_otp(
                    user.pk, serializer.validated_data["otp"], user.auth_token_version
                ):
                    return invalid
                if user.check_password(serializer.validated_data["new_password"]):
                    return error("Validation error", {"new_password": [SAME_PASSWORD_MESSAGE]}, status=422)
                try:
                    validate_password_against_policy(serializer.validated_data["new_password"], user=user)
                except DjangoValidationError as exc:
                    return error("Validation error", {"new_password": list(exc.messages)}, status=422)
                if not invalidate_reset_token(user.pk):
                    return invalid
                consume_otp(user.pk)
            except Exception:
                return invalid
            user.set_password(serializer.validated_data["new_password"])
            user.auth_token_version += 1
            user.save(update_fields=["password", "auth_token_version"])
            blacklist_outstanding_refresh_tokens(user)
            audit(
                request,
                action="password_reset_completed",
                entity="User",
                entity_id=user.pk,
                metadata={"channel": "whatsapp", "revoked_all_sessions": True},
                actor=user,
            )
        return success({})


class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [LoginRateThrottle]

    def post(self, request):
        s = LoginSerializer(data=request.data, context={"request": request})
        s.is_valid(raise_exception=True)

        user = s.validated_data["user"]
        refresh = RefreshToken.for_user(user)
        refresh["token_version"] = user.auth_token_version
        access = str(refresh.access_token)

        audit(
            request,
            action="login_success",
            entity="User",
            entity_id=user.pk,
            metadata={"email": user.email},
            actor=user,
        )

        accessible_orgs = get_user_accessible_organizations(user)
        active_org = get_default_organization_for_user(user)

        return success(
            {
                "token": access,
                "access": access,
                "refresh": str(refresh),
                "user": {
                    "id": str(user.id),
                    "email": user.email,
                    "role": get_role(user),
                    "accessible_organizations": serialize_organizations(accessible_orgs),
                    "default_organization_id": active_org.id if active_org else None,
                    "has_all_company_access": user_has_all_company_access(user),
                },
            }
        )


class TokenRefreshView(APIView):
    authentication_classes = [RefreshEndpointAuthentication]
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = VersionedTokenRefreshSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return success(serializer.validated_data)


class ChangePasswordView(APIView):
    def post(self, request):
        s = ChangePasswordSerializer(data=request.data)
        s.is_valid(raise_exception=True)

        with transaction.atomic():
            user = type(request.user).objects.select_for_update().get(pk=request.user.pk)
            if not user.check_password(s.validated_data["current_password"]):
                return error("Invalid current password", status=422)

            if s.validated_data["new_password"] == s.validated_data["current_password"]:
                return error("Validation error", {"new_password": [SAME_PASSWORD_MESSAGE]}, status=422)

            try:
                validate_password_against_policy(s.validated_data["new_password"], user=user)
            except DjangoValidationError as e:
                return error("Validation error", {"new_password": list(e.messages)}, status=422)

            user.set_password(s.validated_data["new_password"])
            user.auth_token_version += 1
            user.save(update_fields=["password", "auth_token_version"])
            blacklist_outstanding_refresh_tokens(user)

        audit(
            request,
            action="password_changed",
            entity="User",
            entity_id=user.pk,
            metadata={"revoked_all_sessions": True},
            actor=user,
        )

        return success({})


class PasswordResetConfirmView(APIView):
    """Consumes the one-time token from an emailed `reset_link` and sets a new
    password. Unauthenticated by design: the token itself is the credential —
    the user reaching this link cannot be assumed to know any existing password.
    """

    permission_classes = [AllowAny]
    throttle_classes = [PasswordResetConfirmRateThrottle]

    def post(self, request):
        s = PasswordResetConfirmSerializer(data=request.data)
        s.is_valid(raise_exception=True)

        uid = s.validated_data["uid"]
        token = s.validated_data["token"]
        invalid_response = error("This reset link is invalid or has expired.", status=422)

        with transaction.atomic():
            user = get_user_model().objects.select_for_update().filter(pk=uid).first()
            if not user or not user.is_active or not verify_reset_token(uid, token):
                return invalid_response

            try:
                validate_password_against_policy(s.validated_data["new_password"], user=user)
            except DjangoValidationError as e:
                return error("Validation error", {"new_password": list(e.messages)}, status=422)

            # Re-check-and-delete right before committing: consume_reset_token is
            # the single-use gate, closing the window between the peek above and
            # the write below without letting a slow client keep the token alive.
            if not consume_reset_token(uid, token):
                return invalid_response

            user.set_password(s.validated_data["new_password"])
            user.auth_token_version += 1
            user.save(update_fields=["password", "auth_token_version"])
            blacklist_outstanding_refresh_tokens(user)

            # The version change already rejects this OTP; cleanup is best effort
            # because email recovery must work even without a pending OTP.
            try:
                consume_otp(user.pk)
            except Exception:
                pass

        audit(
            request,
            action="password_reset_completed",
            entity="User",
            entity_id=user.pk,
            metadata={"revoked_all_sessions": True},
            actor=user,
        )

        return success({})


class LogoutView(APIView):
    def post(self, request):
        with transaction.atomic():
            user = type(request.user).objects.select_for_update().get(pk=request.user.pk)
            user.auth_token_version += 1
            user.save(update_fields=["auth_token_version"])
            blacklist_outstanding_refresh_tokens(user)

        audit(
            request,
            action="logout",
            entity="User",
            entity_id=user.pk,
            metadata={"revoked_all_sessions": True},
            actor=user,
        )
        return success({})


class UserMeView(APIView):
    def get(self, request):
        user = request.user
        accessible_orgs = get_user_accessible_organizations(user)
        active_org = get_active_organization_for_request(request) or get_default_organization_for_user(user)
        # Display names per language: the employee profile holds the English
        # and Arabic names; accounts without a profile fall back to the user.
        profile = getattr(user, "employee_profile", None)
        full_name_en = (profile and (profile.full_name_en or profile.full_name)) or user.full_name or None
        full_name_ar = (profile and profile.full_name_ar) or None
        return success(
            {
                "id": str(user.id),
                "email": user.email,
                "full_name": user.full_name,
                "full_name_en": full_name_en,
                "full_name_ar": full_name_ar,
                "role": get_role(user),
                "is_active": user.is_active,
                "date_joined": user.date_joined,
                "accessible_organizations": serialize_organizations(accessible_orgs),
                "default_organization_id": active_org.id
                if active_org
                else (accessible_orgs[0].id if accessible_orgs else None),
                "has_all_company_access": user_has_all_company_access(user),
            }
        )
