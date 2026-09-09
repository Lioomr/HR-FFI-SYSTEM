import sys
from types import SimpleNamespace
from unittest.mock import Mock, patch

from config.sentry import initialize_sentry


def test_sentry_is_disabled_without_a_dsn():
    assert (
        initialize_sentry(
            dsn="",
            environment="development",
            traces_sample_rate=0.0,
            profiles_sample_rate=0.0,
        )
        is False
    )


def test_sentry_uses_privacy_preserving_options_when_configured():
    init = Mock()
    sentry_sdk = SimpleNamespace(init=init)

    with patch.dict(sys.modules, {"sentry_sdk": sentry_sdk}):
        assert (
            initialize_sentry(
                dsn="https://public@example.ingest.sentry.io/1",
                environment="production",
                traces_sample_rate=0.1,
                profiles_sample_rate=0.0,
                release="ffi-hr@2026.09.09",
            )
            is True
        )

    init.assert_called_once_with(
        dsn="https://public@example.ingest.sentry.io/1",
        environment="production",
        traces_sample_rate=0.1,
        profiles_sample_rate=0.0,
        send_default_pii=False,
        release="ffi-hr@2026.09.09",
    )
