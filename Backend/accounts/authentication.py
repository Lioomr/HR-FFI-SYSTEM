from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication

INVALID_TOKEN_MESSAGE = "Token is invalid or expired."


class VersionedJWTAuthentication(JWTAuthentication):
    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        token_version = validated_token.get("token_version")

        if type(token_version) is not int or token_version != user.auth_token_version:
            raise AuthenticationFailed(INVALID_TOKEN_MESSAGE, code="token_not_valid")

        return user


class RefreshEndpointAuthentication(BaseAuthentication):
    def authenticate(self, request):
        return None

    def authenticate_header(self, request):
        return "Bearer"
