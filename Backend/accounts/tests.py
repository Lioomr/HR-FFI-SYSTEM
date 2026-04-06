from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from admin_portal.models import SystemSettings

User = get_user_model()


class AccountTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.password = "strongpass123"
        self.user = User.objects.create_user(email="test@ffi.com", password=self.password)
        self.settings_obj = SystemSettings.get_solo()

    def test_login_success(self):
        response = self.client.post("/auth/login", {"email": "test@ffi.com", "password": self.password})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("token", response.data["data"])

    def test_login_fail(self):
        response = self.client.post("/auth/login", {"email": "test@ffi.com", "password": "wrong"})
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_change_password(self):
        self.client.force_authenticate(user=self.user)
        new_pass = "newpass123"
        data = {"current_password": self.password, "new_password": new_pass}

        response = self.client.post("/auth/change-password", data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Verify
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(new_pass))

    def test_logout(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post("/auth/logout")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_login_uses_configured_session_timeout(self):
        self.settings_obj.session_timeout_minutes = 45
        self.settings_obj.save(update_fields=["session_timeout_minutes"])

        response = self.client.post("/auth/login", {"email": "test@ffi.com", "password": self.password})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        token = AccessToken(response.data["data"]["token"])
        lifetime_seconds = int(token["exp"] - token["iat"])
        self.assertEqual(lifetime_seconds, 45 * 60)

    def test_login_lockout_uses_configured_max_attempts(self):
        self.settings_obj.max_login_attempts = 2
        self.settings_obj.save(update_fields=["max_login_attempts"])

        for _ in range(2):
            response = self.client.post("/auth/login", {"email": "test@ffi.com", "password": "wrong"})
            self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

        locked_response = self.client.post("/auth/login", {"email": "test@ffi.com", "password": self.password})
        self.assertEqual(locked_response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertIn("Too many failed login attempts", str(locked_response.data["detail"]))

    def test_change_password_uses_dynamic_password_policy(self):
        self.settings_obj.password_min_length = 10
        self.settings_obj.password_require_upper = True
        self.settings_obj.password_require_lower = True
        self.settings_obj.password_require_number = True
        self.settings_obj.password_require_special = True
        self.settings_obj.save(
            update_fields=[
                "password_min_length",
                "password_require_upper",
                "password_require_lower",
                "password_require_number",
                "password_require_special",
            ]
        )

        self.client.force_authenticate(user=self.user)
        response = self.client.post(
            "/auth/change-password",
            {"current_password": self.password, "new_password": "weakpass1"},
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        error_messages = [item["message"].lower() for item in response.data["errors"]]
        self.assertTrue(any("uppercase" in message for message in error_messages))
        self.assertTrue(any("special" in message for message in error_messages))
