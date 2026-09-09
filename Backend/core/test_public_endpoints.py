from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APITestCase

from core.views import ERROR_REPORT_MAX_STACK_CHARS, ERROR_REPORT_MAX_URL_CHARS
from core.views_health import HEALTH_COMPONENTS_CACHE_KEY

User = get_user_model()

HEALTHY_COMPONENTS = {
    "database": "ok",
    "database_migrations": "ok",
    "redis": "ok",
    "celery_broker": "ok",
    "celery_worker": "ok",
    "evolution_api": "disabled",
    "email_provider": "configured",
}


# A private cache so clearing throttle/health entries cannot disturb other tests.
@override_settings(
    SECURE_SSL_REDIRECT=False,
    ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"],
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "health-check-tests"}},
)
class HealthCheckDisclosureTests(APITestCase):
    def setUp(self):
        cache.clear()

    def test_anonymous_caller_gets_liveness_only(self):
        with patch("core.views_health._collect_components") as collect:
            response = self.client.get("/healthz/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})
        # Anonymous probes must not be able to drive the dependency checks.
        collect.assert_not_called()

    @override_settings(HEALTH_CHECK_TOKEN="probe-secret")
    def test_wrong_probe_token_gets_liveness_only(self):
        with patch("core.views_health._collect_components") as collect:
            response = self.client.get("/healthz/", HTTP_X_HEALTH_TOKEN="not-the-token")

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("components", response.json())
        collect.assert_not_called()

    @override_settings(HEALTH_CHECK_TOKEN="probe-secret")
    def test_valid_probe_token_gets_diagnostics(self):
        with patch("core.views_health._collect_components", return_value=dict(HEALTHY_COMPONENTS)):
            response = self.client.get("/healthz/", HTTP_X_HEALTH_TOKEN="probe-secret")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["components"], HEALTHY_COMPONENTS)

    @override_settings(HEALTH_CHECK_TOKEN="probe-secret")
    def test_degraded_dependency_returns_503_for_authorized_probe(self):
        degraded = dict(HEALTHY_COMPONENTS, redis="down")
        with patch("core.views_health._collect_components", return_value=degraded):
            response = self.client.get("/healthz/", HTTP_X_HEALTH_TOKEN="probe-secret")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["status"], "degraded")

    def test_staff_user_gets_diagnostics(self):
        staff = User.objects.create_user(email="health-staff@example.com", password="StrongPass123!", is_staff=True)
        self.client.force_authenticate(user=staff)

        with patch("core.views_health._collect_components", return_value=dict(HEALTHY_COMPONENTS)):
            response = self.client.get("/healthz/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("components", response.json())

    def test_non_admin_user_gets_liveness_only(self):
        employee = User.objects.create_user(email="health-employee@example.com", password="StrongPass123!")
        self.client.force_authenticate(user=employee)

        with patch("core.views_health._collect_components") as collect:
            response = self.client.get("/healthz/")

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("components", response.json())
        collect.assert_not_called()

    @override_settings(HEALTH_CHECK_TOKEN="probe-secret", HEALTH_CHECK_CACHE_SECONDS=60)
    def test_dependency_probes_are_cached_between_requests(self):
        with patch("core.views_health._collect_components", return_value=dict(HEALTHY_COMPONENTS)) as collect:
            self.client.get("/healthz/", HTTP_X_HEALTH_TOKEN="probe-secret")
            self.client.get("/healthz/", HTTP_X_HEALTH_TOKEN="probe-secret")
            self.client.get("/healthz/", HTTP_X_HEALTH_TOKEN="probe-secret")

        self.assertEqual(collect.call_count, 1)
        self.assertEqual(cache.get(HEALTH_COMPONENTS_CACHE_KEY), HEALTHY_COMPONENTS)


@override_settings(
    SECURE_SSL_REDIRECT=False,
    ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"],
    ADMIN_ERROR_REPORT_EMAIL="admin@example.com",
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "error-report-tests"}},
)
class ReportErrorEndpointTests(APITestCase):
    url = "/api/core/report-error/"

    def setUp(self):
        cache.clear()

    def test_anonymous_report_is_queued_not_sent_inline(self):
        with patch("core.views.send_error_report_email.delay") as delay:
            response = self.client.post(
                self.url,
                {"message": "Boom", "stack": "at foo()", "url": "https://app.example.test/leaves"},
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        delay.assert_called_once()
        subject, text_body, _html_body = delay.call_args[0]
        self.assertIn("https://app.example.test/leaves", subject)
        self.assertIn("Boom", text_body)
        self.assertIn("Anonymous/Unauthenticated User", text_body)

    def test_authenticated_report_does_not_crash(self):
        # Regression: the view used to read a non-existent User.role attribute,
        # so every report from a signed-in user raised AttributeError.
        user = User.objects.create_user(email="reporter@example.com", password="StrongPass123!")
        self.client.force_authenticate(user=user)

        with patch("core.views.send_error_report_email.delay") as delay:
            response = self.client.post(self.url, {"message": "Boom"}, format="json")

        self.assertEqual(response.status_code, 200)
        _subject, text_body, _html_body = delay.call_args[0]
        self.assertIn("reporter@example.com", text_body)
        self.assertIn("Role: Employee", text_body)

    def test_oversized_payload_is_truncated(self):
        with patch("core.views.send_error_report_email.delay") as delay:
            response = self.client.post(
                self.url,
                {"message": "m" * 50000, "stack": "s" * 200000, "url": "u" * 5000},
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        _subject, text_body, _html_body = delay.call_args[0]
        self.assertIn("[truncated]", text_body)
        self.assertLess(text_body.count("s"), ERROR_REPORT_MAX_STACK_CHARS + 200)
        self.assertLess(text_body.count("u"), ERROR_REPORT_MAX_URL_CHARS + 200)

    def test_newlines_in_url_cannot_inject_email_headers(self):
        injected_url = "https://app.example.test/a\nBcc: victim@example.com"
        with patch("core.views.send_error_report_email.delay") as delay:
            self.client.post(self.url, {"message": "Boom", "url": injected_url}, format="json")

        subject, _text_body, _html_body = delay.call_args[0]
        self.assertNotIn("\n", subject)
        self.assertNotIn("\r", subject)

    def test_html_in_report_is_escaped_for_the_admin_inbox(self):
        with patch("core.views.send_error_report_email.delay") as delay:
            self.client.post(self.url, {"message": "<script>alert(1)</script>"}, format="json")

        _subject, _text_body, html_body = delay.call_args[0]
        self.assertNotIn("<script>", html_body)
        self.assertIn("&lt;script&gt;", html_body)

    def test_enqueue_failure_returns_generic_error(self):
        broker_error = OSError("redis://user:secret@broker unreachable")
        with patch("core.views.send_error_report_email.delay", side_effect=broker_error):
            response = self.client.post(self.url, {"message": "Boom"}, format="json")

        self.assertEqual(response.status_code, 500)
        body = response.json()
        self.assertEqual(body["message"], "Failed to send error report.")
        # The underlying broker/provider error must not leak back to the caller.
        self.assertNotIn("redis://", str(body))
        self.assertNotIn("unreachable", str(body))

    def test_endpoint_is_rate_limited(self):
        with patch("core.views.send_error_report_email.delay"):
            statuses = [
                self.client.post(self.url, {"message": f"Boom {index}"}, format="json").status_code
                for index in range(12)
            ]

        self.assertIn(429, statuses)
