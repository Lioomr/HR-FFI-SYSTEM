"""Notification worker dependency-readiness tests."""

from pathlib import Path
from unittest.mock import Mock, patch

from django.conf import settings
from django.test import SimpleTestCase

from config.celery import app
from config.worker_readiness import (
    ReadinessConfig,
    ReadinessError,
    check_evolution_api,
    check_required_services,
    load_config,
    wait_for_required_services,
)


def readiness_config(**overrides):
    values = {
        "whatsapp_enabled": True,
        "broker_url": "redis://redis:6379/2",
        "result_backend": "redis://redis:6379/3",
        "evolution_api_url": "http://evolution-api:8080",
        "evolution_api_key_configured": True,
        "evolution_instance_configured": True,
        "timeout_seconds": 5,
        "interval_seconds": 1,
        "request_timeout_seconds": 2,
    }
    values.update(overrides)
    return ReadinessConfig(**values)


class WorkerReadinessTests(SimpleTestCase):
    @patch("config.worker_readiness.requests.get")
    @patch("config.worker_readiness.socket.getaddrinfo")
    def test_evolution_api_health_check_success(self, getaddrinfo, get):
        getaddrinfo.return_value = [(None, None, None, None, None)]
        get.return_value = Mock(status_code=200)

        target = check_evolution_api("http://evolution-api:8080", request_timeout_seconds=2)

        self.assertEqual(target, "evolution-api:8080")
        get.assert_called_once_with("http://evolution-api:8080/", timeout=2, allow_redirects=False)

    @patch("config.worker_readiness.requests.get", return_value=Mock(status_code=503))
    @patch("config.worker_readiness.socket.getaddrinfo", return_value=[(None, None, None, None, None)])
    def test_evolution_api_unavailable(self, _getaddrinfo, _get):
        with self.assertRaisesRegex(ReadinessError, "HTTP 503"):
            check_evolution_api("http://evolution-api:8080", request_timeout_seconds=2)

    @patch("config.worker_readiness.socket.getaddrinfo", side_effect=OSError("DNS failed"))
    def test_evolution_dns_failure_is_safe(self, _getaddrinfo):
        with self.assertRaisesRegex(ReadinessError, "evolution-api:8080.*OSError") as raised:
            check_evolution_api("http://evolution-api:8080", request_timeout_seconds=2)
        self.assertNotIn("DNS failed", str(raised.exception))

    @patch("config.worker_readiness.check_redis", return_value="redis:6379")
    @patch("config.worker_readiness.check_evolution_api")
    def test_whatsapp_globally_disabled_skips_evolution(self, evolution, _redis):
        result = check_required_services(
            readiness_config(
                whatsapp_enabled=False,
                evolution_api_url="",
                evolution_api_key_configured=False,
                evolution_instance_configured=False,
            )
        )
        evolution.assert_not_called()
        self.assertIn("disabled", result[-1])

    @patch("config.worker_readiness.requests.get", return_value=Mock(status_code=401))
    @patch("config.worker_readiness.socket.getaddrinfo", return_value=[(None, None, None, None, None)])
    def test_external_evolution_hostname_is_supported(self, getaddrinfo, get):
        target = check_evolution_api("https://wa.example.test/api", request_timeout_seconds=4)
        self.assertEqual(target, "wa.example.test:443")
        getaddrinfo.assert_called_once_with("wa.example.test", 443, type=1)
        get.assert_called_once_with("https://wa.example.test/api/", timeout=4, allow_redirects=False)

    def test_readiness_timeout_is_bounded(self):
        clock = [0.0]

        def monotonic():
            return clock[0]

        def sleep(seconds):
            clock[0] += seconds

        with patch("config.worker_readiness.check_required_services", side_effect=ReadinessError("not ready")):
            with self.assertRaisesRegex(ReadinessError, "timed out after 2s"):
                wait_for_required_services(
                    readiness_config(timeout_seconds=2, interval_seconds=0.75),
                    sleep=sleep,
                    monotonic=monotonic,
                )
        self.assertEqual(clock[0], 2)

    @patch("config.worker_readiness.socket.getaddrinfo", side_effect=OSError("secret-token DNS failure"))
    def test_readiness_errors_do_not_expose_url_credentials(self, _getaddrinfo):
        with self.assertRaises(ReadinessError) as raised:
            check_evolution_api("https://api-user:super-secret@wa.example.test", request_timeout_seconds=2)
        message = str(raised.exception)
        self.assertNotIn("api-user", message)
        self.assertNotIn("super-secret", message)
        self.assertNotIn("secret-token", message)
        self.assertIn("wa.example.test:443", message)

    def test_environment_configuration_is_loaded_without_secret_values(self):
        config = load_config(
            {
                "NOTIFICATION_WHATSAPP_DELIVERY_ENABLED": "false",
                "CELERY_BROKER_URL": "redis://broker.example:6380/2",
                "CELERY_RESULT_BACKEND": "redis://results.example:6381/3",
                "EVOLUTION_API_BASE_URL": "https://wa.example.test",
                "EVOLUTION_API_KEY": "secret",
                "EVOLUTION_INSTANCE_NAME": "instance",
                "NOTIFICATION_WORKER_READINESS_TIMEOUT_SECONDS": "12",
            }
        )
        self.assertFalse(config.whatsapp_enabled)
        self.assertEqual(config.timeout_seconds, 12)
        self.assertTrue(config.evolution_api_key_configured)
        self.assertNotIn("secret", repr(config))

    def test_worker_entrypoint_runs_readiness_before_celery(self):
        entrypoint = Path(settings.BASE_DIR, "entrypoint.sh").read_text(encoding="utf-8")
        readiness_position = entrypoint.index("python -m config.worker_readiness")
        celery_exec_position = entrypoint.index('exec "$@"')
        self.assertLess(readiness_position, celery_exec_position)

    def test_notification_tasks_are_registered(self):
        app.autodiscover_tasks(force=True)
        registered = set(app.tasks)
        self.assertIn("in_app_notifications.tasks.deliver_whatsapp_notification", registered)
        self.assertIn("in_app_notifications.tasks.deliver_email_notification", registered)
        self.assertIn("in_app_notifications.tasks.cleanup_expired_notifications", registered)
