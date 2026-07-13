from urllib.parse import parse_qs

from channels.auth import AuthMiddlewareStack
from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError


@database_sync_to_async
def _jwt_user(raw_token: str):
    authentication = JWTAuthentication()
    try:
        token = authentication.get_validated_token(raw_token)
        return authentication.get_user(token)
    except (InvalidToken, TokenError):
        return AnonymousUser()


class JwtAuthMiddleware(BaseMiddleware):
    async def __call__(self, scope, receive, send):
        if not scope.get("user") or not scope["user"].is_authenticated:
            headers = dict(scope.get("headers", []))
            authorization = headers.get(b"authorization", b"").decode("utf-8")
            raw_token = authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""
            if not raw_token:
                query = parse_qs(scope.get("query_string", b"").decode("utf-8"))
                raw_token = (query.get("access_token") or query.get("token") or [""])[0]
            scope["user"] = await _jwt_user(raw_token) if raw_token else AnonymousUser()
        return await super().__call__(scope, receive, send)


def JwtOrSessionAuthMiddlewareStack(inner):
    return AuthMiddlewareStack(JwtAuthMiddleware(inner))
