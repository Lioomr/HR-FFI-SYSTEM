"""Optional, privacy-preserving Sentry initialization for Django processes."""

import logging

logger = logging.getLogger(__name__)


def initialize_sentry(
    *,
    dsn: str,
    environment: str,
    traces_sample_rate: float,
    profiles_sample_rate: float,
    release: str = "",
) -> bool:
    """Initialize Sentry only when the deployment supplies a DSN."""
    if not dsn:
        return False

    try:
        import sentry_sdk
    except ImportError:
        logger.warning("sentry_sdk_not_installed")
        return False

    # Scanners probing the raw server IP trigger DisallowedHost on every request; it is noise, not an app bug.
    from django.core.exceptions import DisallowedHost

    options = {
        "ignore_errors": [DisallowedHost],
        "dsn": dsn,
        "environment": environment,
        "traces_sample_rate": traces_sample_rate,
        "profiles_sample_rate": profiles_sample_rate,
        "send_default_pii": False,
    }
    if release:
        options["release"] = release

    sentry_sdk.init(**options)
    try:
        from sentry_sdk.integrations.logging import ignore_logger

        ignore_logger("django.security.DisallowedHost")
    except ImportError:
        pass
    return True
