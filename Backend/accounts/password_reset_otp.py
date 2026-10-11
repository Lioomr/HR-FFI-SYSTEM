"""Cache-backed recovery state. Call under the account's select_for_update lock."""

import math
import secrets
import time

from django.core.cache import cache
from django.utils.crypto import salted_hmac

OTP_TTL = 300
RESEND_SECONDS = 60
SEND_WINDOW = 3600
MAX_SENDS = 3
MAX_ATTEMPTS = 5


class OTPUnavailable(Exception):
    pass


def _country_code_length(digits):
    """Length of the E.164 country calling code (ITU zones; no phone library is installed)."""
    first, second = digits[0], digits[1]
    if first in "17":
        return 1
    two_digit = {
        "2": "07",
        "3": "0123469",
        "4": "013456789",
        "5": "12345678",
        "6": "0123456",
        "8": "1246",
        "9": "0123458",
    }
    return 2 if second in two_digit[first] else 3


def mask_recovery_phone(phone):
    """Show only the country code and last three digits, e.g. +966•••••567."""
    digits = phone.lstrip("+")
    cc = _country_code_length(digits)
    return f"+{digits[:cc]}{'•' * max(3, len(digits) - cc - 3)}{digits[-3:]}"


def otp_cache_key(user_id):
    return f"password_reset_otp:{user_id}"


def limit_cache_key(user_id):
    return f"password_reset_otp_limits:{user_id}"


def _hash(user_id, otp, nonce):
    # A keyed hash protects a short numeric code against offline enumeration.
    return salted_hmac("password-reset-otp", f"{user_id}:{nonce}:{otp}", algorithm="sha256").hexdigest()


def _store(key, entry, ttl):
    cache.set(key, entry, ttl)
    if cache.get(key) != entry:
        raise OTPUnavailable()


def issue_otp(user_id, token_version=0):
    now = time.time()
    key = limit_cache_key(user_id)
    recent = [sent for sent in (cache.get(key) or []) if sent > now - SEND_WINDOW]
    if recent and (now - recent[-1] < RESEND_SECONDS or len(recent) >= MAX_SENDS):
        return None
    _store(key, recent + [now], SEND_WINDOW)
    otp = f"{secrets.randbelow(1000000):06d}"
    nonce = secrets.token_hex(16)
    _store(
        otp_cache_key(user_id),
        {
            "hash": _hash(user_id, otp, nonce),
            "nonce": nonce,
            "attempts": 0,
            "expires_at": now + OTP_TTL,
            "token_version": token_version,
        },
        OTP_TTL,
    )
    return otp


def verify_otp(user_id, otp, token_version=0):
    key = otp_cache_key(user_id)
    entry = cache.get(key)
    if (
        not entry
        or entry["expires_at"] <= time.time()
        or entry["attempts"] >= MAX_ATTEMPTS
        or entry["token_version"] != token_version
    ):
        return False
    if secrets.compare_digest(entry["hash"], _hash(user_id, otp, entry["nonce"])):
        return True
    entry["attempts"] += 1
    # Preserve the original expiry when saving the failed attempt counter.
    _store(key, entry, max(1, math.ceil(entry["expires_at"] - time.time())))
    return False


def consume_otp(user_id):
    key = otp_cache_key(user_id)
    deleted = cache.delete(key)
    if not deleted or cache.get(key) is not None:
        raise OTPUnavailable()
