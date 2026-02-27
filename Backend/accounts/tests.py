from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

User = get_user_model()


class AccountTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.password = "strongpass123"
        self.user = User.objects.create_user(email="test@ffi.com", password=self.password)

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
