import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

from .models import LoginAttempt


def blacklist_outstanding_refresh_tokens(user):
    outstanding_tokens = OutstandingToken.objects.select_for_update().filter(user=user)
    for token in outstanding_tokens.iterator():
        BlacklistedToken.objects.get_or_create(token=token)


def password_reset_cache_key(user_id) -> str:
    return f"password_reset_token:{user_id}"


class ResetTokenUnavailable(Exception):
    """The reset token could not be stored, so an emailed link would never work."""


def store_hashed_reset_token(user_id, token: str) -> None:
    """Cache a one-time password-reset token for `user_id`, hashed at rest.

    Consumed (and deleted) by `consume_reset_token`, which backs the
    unauthenticated reset-confirmation endpoint the emailed reset link points to.
    Raises `ResetTokenUnavailable` when the cache did not keep the token.
    """
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    ttl_seconds = int(getattr(settings, "PASSWORD_RESET_TOKEN_TTL_SECONDS", 3600))
    key = password_reset_cache_key(user_id)
    entry = {"token_hash": token_hash}
    cache.set(key, entry, ttl_seconds)
    # The cache fails open when Redis is down (config/settings.py), so confirm the
    # write rather than email a link that can never be redeemed.
    if cache.get(key) != entry:
        raise ResetTokenUnavailable("Password reset token could not be stored.")


def verify_reset_token(user_id, token: str) -> bool:
    """Check `token` against the cached hash for `user_id` without consuming it.

    Use this to gate a reset attempt before doing other validation (e.g. the
    new password's strength) so a rejected attempt doesn't burn the token.
    """
    entry = cache.get(password_reset_cache_key(user_id))
    if not entry:
        return False
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return secrets.compare_digest(token_hash, entry.get("token_hash", ""))


def consume_reset_token(user_id, token: str) -> bool:
    """Validate `token` against the cached hash for `user_id` and delete it.

    Single-use by design: a valid check always consumes the token, so the same
    reset link cannot be replayed even within its TTL. Call this only once the
    reset is actually going to succeed.
    """
    if not verify_reset_token(user_id, token):
        return False
    cache.delete(password_reset_cache_key(user_id))
    return True


def get_client_ip(request):
    remote_addr = request.META.get("REMOTE_ADDR", "")
    trusted_proxies = set(getattr(settings, "TRUSTED_PROXY_IPS", []))
    if remote_addr and remote_addr in trusted_proxies:
        xff = request.META.get("HTTP_X_FORWARDED_FOR")
        if xff:
            # X-Forwarded-For can be a list; take the first hop.
            return xff.split(",")[0].strip()
    return remote_addr


def _get_settings():
    from admin_portal.models import SystemSettings

    settings_obj = SystemSettings.get_solo()
    return {
        "failure_limit": settings_obj.max_login_attempts or getattr(settings, "LOGIN_FAILURE_LIMIT", 5),
        "failure_window_seconds": getattr(settings, "LOGIN_FAILURE_WINDOW_SECONDS", 900),
        "lockout_seconds": getattr(settings, "LOGIN_LOCKOUT_SECONDS", 900),
    }


def is_locked_out(email, ip_address):
    if not email:
        return False
    try:
        attempt = LoginAttempt.objects.get(email=email, ip_address=ip_address)
    except LoginAttempt.DoesNotExist:
        return False
    if attempt.locked_until and attempt.locked_until > timezone.now():
        return True
    return False


def get_lockout_remaining_seconds(email, ip_address):
    if not email:
        return 0
    try:
        attempt = LoginAttempt.objects.get(email=email, ip_address=ip_address)
    except LoginAttempt.DoesNotExist:
        return 0

    if not attempt.locked_until:
        return 0

    remaining = int((attempt.locked_until - timezone.now()).total_seconds())
    return max(0, remaining)


def record_login_failure(email, ip_address):
    if not email:
        return
    now = timezone.now()
    settings_data = _get_settings()
    window = timedelta(seconds=settings_data["failure_window_seconds"])

    with transaction.atomic():
        attempt, _ = LoginAttempt.objects.select_for_update().get_or_create(
            email=email,
            ip_address=ip_address,
            defaults={"failed_count": 0, "first_failed_at": now, "last_failed_at": now},
        )

        if attempt.locked_until and attempt.locked_until <= now:
            attempt.failed_count = 0
            attempt.first_failed_at = now
            attempt.locked_until = None

        if attempt.first_failed_at and now - attempt.first_failed_at > window:
            attempt.failed_count = 0
            attempt.first_failed_at = now

        attempt.failed_count += 1
        attempt.last_failed_at = now

        if attempt.failed_count >= settings_data["failure_limit"]:
            attempt.locked_until = now + timedelta(seconds=settings_data["lockout_seconds"])

        attempt.save(update_fields=["failed_count", "first_failed_at", "last_failed_at", "locked_until"])


def clear_login_failures(email, ip_address):
    if not email:
        return
    LoginAttempt.objects.filter(email=email, ip_address=ip_address).delete()
