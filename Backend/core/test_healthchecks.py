from unittest.mock import Mock, patch

import requests
from django.test import SimpleTestCase, override_settings

from core.tasks import ping_healthchecks


class HealthchecksTaskTests(SimpleTestCase):
    @override_settings(HEALTHCHECKS_PING_URL="")
    @patch("core.tasks.requests.get")
    def test_ping_is_disabled_without_a_url(self, get):
        assert ping_healthchecks.run() is False
        get.assert_not_called()

    @override_settings(HEALTHCHECKS_PING_URL="https://hc-ping.com/test", HEALTHCHECKS_PING_TIMEOUT_SECONDS=7)
    @patch("core.tasks.requests.get")
    def test_ping_uses_configured_url_and_timeout(self, get):
        response = Mock()
        get.return_value = response

        assert ping_healthchecks.run() is True

        get.assert_called_once_with("https://hc-ping.com/test", timeout=7)
        response.raise_for_status.assert_called_once_with()

    @override_settings(HEALTHCHECKS_PING_URL="https://hc-ping.com/test")
    @patch("core.tasks.requests.get", side_effect=requests.RequestException("network unavailable"))
    def test_ping_fails_safely_on_network_error(self, _get):
        assert ping_healthchecks.run() is False
