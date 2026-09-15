from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework import status
from rest_framework.test import APIClient

from accounts.security import ResetTokenUnavailable, password_reset_cache_key

User = get_user_model()


@override_settings(SECURE_SSL_REDIRECT=False)
@patch("admin_portal.views_users._send_password_reset_material")
class ResetLinkIssuanceTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.admin = User.objects.create_user(
            email="reset-admin@test.com", password="password", full_name="Reset Admin"
        )
        self.admin.groups.add(Group.objects.get_or_create(name="SystemAdmin")[0])
        self.target = User.objects.create_user(email="reset-link-target@test.com", password="password")
        self.client.force_authenticate(user=self.admin)

    def _issue_link(self, **headers):
        return self.client.post(
            f"/users/{self.target.id}/reset-password/", {"mode": "reset_link"}, format="json", **headers
        )

    def test_reset_link_stores_a_token_and_emails_it(self, send_email):
        response = self._issue_link()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNotNone(cache.get(password_reset_cache_key(self.target.id)))
        send_email.assert_called_once()
        self.assertIn("/reset-password?token=", send_email.call_args.kwargs["fallback_text"])

    def test_reset_link_is_refused_when_the_token_cannot_be_stored(self, send_email):
        with patch("admin_portal.views_users.store_hashed_reset_token", side_effect=ResetTokenUnavailable):
            response = self._issue_link()

        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertIn("temporarily unavailable", response.data["message"])
        send_email.assert_not_called()

    def test_unavailable_message_is_translated_to_arabic(self, send_email):
        with patch("admin_portal.views_users.store_hashed_reset_token", side_effect=ResetTokenUnavailable):
            response = self._issue_link(HTTP_ACCEPT_LANGUAGE="ar")

        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertEqual(
            response.data["message"],
            "روابط إعادة تعيين كلمة المرور غير متاحة مؤقتاً. حاول مرة أخرى بعد قليل أو أرسل كلمة مرور مؤقتة بدلاً من ذلك.",
        )
