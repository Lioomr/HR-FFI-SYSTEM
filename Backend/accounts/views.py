from rest_framework.views import APIView
from rest_framework.permissions import AllowAny
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework import status
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError

from .serializers import LoginSerializer, ChangePasswordSerializer
from .permissions import get_role
from core.responses import success, error

class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        s = LoginSerializer(data=request.data)
        if not s.is_valid():
            # 422 handled by exception handler only when raise_exception=True
            return error("Validation error", s.errors, status=422)

        user = s.validated_data["user"]
        refresh = RefreshToken.for_user(user)
        access = str(refresh.access_token)

        return success({
            "token": access,
            "user": {
                "id": str(user.id),
                "email": user.email,
                "role": get_role(user),
            }
        })

class ChangePasswordView(APIView):
    def post(self, request):
        s = ChangePasswordSerializer(data=request.data)
        s.is_valid(raise_exception=True)

        user = request.user
        if not user.check_password(s.validated_data["current_password"]):
            return error("Invalid current password", status=422)

        try:
            validate_password(s.validated_data["new_password"], user=user)
        except DjangoValidationError as e:
            return error("Validation error", {"new_password": list(e.messages)}, status=422)

        user.set_password(s.validated_data["new_password"])
        user.save(update_fields=["password"])

        return success({})

class LogoutView(APIView):
    """
    If you only return access token from login, logout can still invalidate
    ALL refresh tokens for this user (global logout).
    """
    def post(self, request):
        # blacklist all outstanding refresh tokens for the user
        for t in OutstandingToken.objects.filter(user=request.user):
            try:
                BlacklistedToken.objects.get_or_create(token=t)
            except Exception:
                pass
        return success({})
