from unittest.mock import patch

import requests
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

User = get_user_model()
PROVIDER_SETTINGS = {
    "EVOLUTION_API_BASE_URL": "https://provider.example.test",
    "EVOLUTION_API_KEY": "super-secret-api-key",
    "EVOLUTION_INSTANCE_NAME": "ffi-instance",
}
SENSITIVE_TEXT = "super-secret-api-key Authorization: Bearer token https://internal.example.test raw-provider-secret"


@override_settings(SECURE_SSL_REDIRECT=False)
class WhatsAppTemplatePermissionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = self._user("template-admin@example.com", "SystemAdmin")
        self.hr = self._user("template-hr@example.com", "HRManager")
        self.employee = self._user("template-employee@example.com", "Employee")
        self.url = "/api/core/whatsapp-templates/employee_invitation/test/"
        self.preview_url = "/api/core/whatsapp-templates/employee_invitation/preview/"

    @staticmethod
    def _user(email, role):
        user = User.objects.create_user(email=email, password="StrongPassword123!")
        user.groups.add(Group.objects.get_or_create(name=role)[0])
        return user

    @patch("core.views_whatsapp_templates.EvolutionWhatsAppProvider.send_text", return_value={"success": True})
    def test_only_system_admin_can_send_live_template_test(self, send_text):
        self.client.force_authenticate(self.admin)
        response = self.client.post(self.url, {"phone_number": "+201001234567"}, format="json")
        self.assertEqual(response.status_code, 200)
        send_text.assert_called_once()

        for user in (self.hr, self.employee):
            with self.subTest(role=user.groups.first().name):
                self.client.force_authenticate(user)
                response = self.client.post(self.url, {"phone_number": "+201001234567"}, format="json")
                self.assertEqual(response.status_code, 403)
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.post(self.url, {"phone_number": "+201001234567"}).status_code, 401)
        self.assertEqual(send_text.call_count, 1)

    def test_preview_remains_available_to_hr_manager(self):
        self.client.force_authenticate(self.hr)
        response = self.client.post(self.preview_url, {}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertIn("preview", response.data["data"])


@override_settings(SECURE_SSL_REDIRECT=False, **PROVIDER_SETTINGS)
class WhatsAppIntegrationSanitizationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(email="integration-admin@example.com", password="StrongPassword123!")
        self.admin.groups.add(Group.objects.get_or_create(name="SystemAdmin")[0])
        self.client.force_authenticate(self.admin)

    def assertSanitized(self, response):
        serialized = str(response.data)
        for secret in ("super-secret-api-key", "Bearer token", "internal.example.test", "raw-provider-secret"):
            self.assertNotIn(secret, serialized)
        self.assertNotIn("provider_response", serialized)

    @patch("core.views_whatsapp_integration._request")
    def test_status_does_not_return_raw_provider_data(self, provider_request):
        provider_request.return_value = (200, {"state": "open", "authorization": SENSITIVE_TEXT})
        response = self.client.get("/api/integrations/whatsapp/status/")
        self.assertEqual(response.data["data"]["connection_state"], "open")
        self.assertTrue(response.data["data"]["connected"])
        self.assertSanitized(response)

    @patch("core.views_whatsapp_integration._request")
    def test_connect_and_qr_only_return_whitelisted_provider_fields(self, provider_request):
        provider_request.return_value = (200, {"base64": "safe-qr-code", "raw": SENSITIVE_TEXT})
        for url, method in (
            ("/api/integrations/whatsapp/connect/", self.client.post),
            ("/api/integrations/whatsapp/qr/", self.client.get),
        ):
            with self.subTest(url=url):
                response = method(url, {}, format="json") if method == self.client.post else method(url)
                self.assertTrue(response.data["data"]["qr_available"])
                self.assertEqual(response.data["data"]["provider_status_code"], 200)
                self.assertSanitized(response)

    @patch("core.views_whatsapp_integration._request", return_value=(200, {"raw": SENSITIVE_TEXT}))
    def test_logout_does_not_return_provider_response(self, provider_request):
        response = self.client.post("/api/integrations/whatsapp/logout/", {}, format="json")
        self.assertFalse(response.data["data"]["connected"])
        self.assertEqual(response.data["data"]["connection_state"], "disconnected")
        self.assertSanitized(response)

    @patch("core.views_whatsapp_integration.WhatsAppService.send_template_message")
    def test_test_endpoint_whitelists_result_and_hides_errors(self, send_message):
        send_message.return_value = {
            "success": False,
            "status_code": 502,
            "provider": "evolution_whatsapp",
            "message_id": SENSITIVE_TEXT,
            "error": SENSITIVE_TEXT,
        }
        response = self.client.post(
            "/api/integrations/whatsapp/test/", {"phone_number": "+201001234567"}, format="json"
        )
        self.assertEqual(response.data["data"], {"sent": False, "provider_status_code": 502})
        self.assertSanitized(response)

    @patch("core.views_whatsapp_integration._request", side_effect=requests.ConnectionError(SENSITIVE_TEXT))
    def test_provider_exceptions_are_generic(self, provider_request):
        for url, method in (
            ("/api/integrations/whatsapp/status/", self.client.get),
            ("/api/integrations/whatsapp/connect/", self.client.post),
            ("/api/integrations/whatsapp/qr/", self.client.get),
            ("/api/integrations/whatsapp/logout/", self.client.post),
        ):
            with self.subTest(url=url):
                response = method(url)
                self.assertSanitized(response)
