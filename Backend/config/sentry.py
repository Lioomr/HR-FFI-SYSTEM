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

    options = {
        "dsn": dsn,
        "environment": environment,
        "traces_sample_rate": traces_sample_rate,
        "profiles_sample_rate": profiles_sample_rate,
        "send_default_pii": False,
    }
    if release:
        options["release"] = release

    sentry_sdk.init(**options)
    return True
