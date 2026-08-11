from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework.permissions import AllowAny
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from audit.utils import audit
from core.responses import error, success
from organization.services import (
    get_active_organization_for_request,
    get_default_organization_for_user,
    get_user_accessible_organizations,
    serialize_organizations,
    user_has_all_company_access,
)

from .authentication import RefreshEndpointAuthentication
from .password_policy import validate_password_against_policy
from .permissions import get_role
from .security import blacklist_outstanding_refresh_tokens
from .serializers import ChangePasswordSerializer, LoginSerializer, VersionedTokenRefreshSerializer
from .throttles import LoginRateThrottle


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
        return success(
            {
                "id": str(user.id),
                "email": user.email,
                "full_name": user.full_name,
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
