"""Settings accessors for document integrity, with safe defaults."""

from __future__ import annotations

import base64
import hashlib
from pathlib import Path

from django.conf import settings

MODE_OFF = "off"
MODE_FREEZE = "freeze"
MODE_SEAL = "seal"
MODE_PERSONAL = "personal"
MODES = (MODE_OFF, MODE_FREEZE, MODE_SEAL, MODE_PERSONAL)
DEFAULT_MODE = MODE_FREEZE


class SigningConfigurationError(RuntimeError):
    """Signing was requested but the key material or settings are not usable."""


def signing_mode() -> str:
    mode = str(getattr(settings, "DOCUMENT_SIGNING_MODE", DEFAULT_MODE) or "").strip().lower()
    return mode if mode in MODES else DEFAULT_MODE


def freezing_enabled() -> bool:
    return signing_mode() != MODE_OFF


def sealing_enabled(mode: str | None = None) -> bool:
    return (mode or signing_mode()) in (MODE_SEAL, MODE_PERSONAL)


def personal_signing_enabled(mode: str | None = None) -> bool:
    return (mode or signing_mode()) == MODE_PERSONAL


def key_dir() -> Path:
    configured = str(getattr(settings, "DOCUMENT_SIGNING_KEY_DIR", "") or "").strip()
    if configured:
        return Path(configured)
    return Path(settings.PRIVATE_UPLOAD_ROOT) / "signing"


def dev_autogenerate() -> bool:
    return bool(getattr(settings, "DOCUMENT_SIGNING_DEV_AUTOGENERATE", False))


def fernet_key() -> bytes:
    """The key encrypting private keys at rest.

    Production must set ``DOCUMENT_SIGNING_KEY_ENCRYPTION_KEY``. In DEBUG (or with
    dev auto-generation on) a key is derived from ``SECRET_KEY`` so local signing
    works without extra setup; that couples the two secrets and is dev-only.
    """

    configured = str(getattr(settings, "DOCUMENT_SIGNING_KEY_ENCRYPTION_KEY", "") or "").strip()
    if configured:
        return configured.encode("ascii")
    if settings.DEBUG or dev_autogenerate():
        digest = hashlib.sha256(f"document-signing:{settings.SECRET_KEY}".encode()).digest()
        return base64.urlsafe_b64encode(digest)
    raise SigningConfigurationError("DOCUMENT_SIGNING_KEY_ENCRYPTION_KEY is required to store signing keys.")


def tsa_url() -> str:
    return str(getattr(settings, "DOCUMENT_SIGNING_TSA_URL", "") or "").strip()


def tsa_timeout() -> int:
    return max(1, int(getattr(settings, "DOCUMENT_SIGNING_TSA_TIMEOUT_SECONDS", 10) or 10))


def seal_async() -> bool:
    return bool(getattr(settings, "DOCUMENT_SIGNING_SEAL_ASYNC", False))
