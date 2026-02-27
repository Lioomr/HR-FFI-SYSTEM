from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from .models import LoginAttempt


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
    return {
        "failure_limit": getattr(settings, "LOGIN_FAILURE_LIMIT", 5),
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


def record_login_failure(email, ip_address):
    if not email:
        return
    now = timezone.now()
    settings_data = _get_settings()
    window = timedelta(seconds=settings_data["failure_window_seconds"])

    attempt, _ = LoginAttempt.objects.get_or_create(
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
