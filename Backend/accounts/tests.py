from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from admin_portal.models import SystemSettings
from audit.models import AuditLog
from employees.models import EmployeeProfile

User = get_user_model()


@override_settings(SECURE_SSL_REDIRECT=False, ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"])
class AccountTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.password = "strongpass123"
        self.user = User.objects.create_user(email="test@ffi.com", password=self.password)
        self.settings_obj = SystemSettings.get_solo()

    def _create_phone_user(self, *, email: str, mobile: str, employee_id: str, is_active: bool = True):
        user = User.objects.create_user(email=email, password=self.password, is_active=is_active)
        EmployeeProfile.objects.create(
            user=user,
            employee_id=employee_id,
            full_name=email,
            mobile=mobile,
        )
        return user

    def test_login_success(self):
        response = self.client.post("/auth/login", {"email": "test@ffi.com", "password": self.password})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("token", response.data["data"])
        self.assertEqual(response.data["data"]["token"], response.data["data"]["access"])
        self.assertIn("refresh", response.data["data"])
        self.assertNotEqual(response.data["data"]["access"], response.data["data"]["refresh"])

    def test_login_by_full_e164_phone_works(self):
        user = self._create_phone_user(
            email="phone-e164@ffi.com",
            mobile="+966554867964",
            employee_id="PHONE-SA-E164",
        )

        response = self.client.post("/auth/login", {"email": "+966554867964", "password": self.password})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["user"]["email"], user.email)
        self.assertEqual(response.data["data"]["token"], response.data["data"]["access"])

    def test_login_by_phone_without_plus_works(self):
        user = self._create_phone_user(
            email="phone-no-plus@ffi.com",
            mobile="+966554867964",
            employee_id="PHONE-SA-NO-PLUS",
        )

        response = self.client.post("/auth/login", {"email": "966554867964", "password": self.password})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["user"]["email"], user.email)

    def test_login_by_local_saudi_phone_works(self):
        user = self._create_phone_user(
            email="phone-sa-local@ffi.com",
            mobile="+966554867964",
            employee_id="PHONE-SA-LOCAL",
        )

        response = self.client.post("/auth/login", {"email": "0554867964", "password": self.password})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["user"]["email"], user.email)

        response_without_leading_zero = self.client.post(
            "/auth/login",
            {"email": "554867964", "password": self.password},
        )

        self.assertEqual(response_without_leading_zero.status_code, status.HTTP_200_OK)
        self.assertEqual(response_without_leading_zero.data["data"]["user"]["email"], user.email)

    def test_login_by_local_egypt_phone_works(self):
        user = self._create_phone_user(
            email="phone-eg-local@ffi.com",
            mobile="+201013530963",
            employee_id="PHONE-EG-LOCAL",
        )

        response = self.client.post("/auth/login", {"identifier": "01013530963", "password": self.password})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["user"]["email"], user.email)

        response_without_leading_zero = self.client.post(
            "/auth/login",
            {"identifier": "1013530963", "password": self.password},
        )

        self.assertEqual(response_without_leading_zero.status_code, status.HTTP_200_OK)
        self.assertEqual(response_without_leading_zero.data["data"]["user"]["email"], user.email)

    def test_ambiguous_local_phone_returns_validation_error(self):
        self._create_phone_user(
            email="phone-ambiguous-sa@ffi.com",
            mobile="+966554867964",
            employee_id="PHONE-AMB-SA",
        )
        self._create_phone_user(
            email="phone-ambiguous-eg@ffi.com",
            mobile="+20554867964",
            employee_id="PHONE-AMB-EG",
        )

        response = self.client.post("/auth/login", {"email": "554867964", "password": self.password})

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        messages = [item["message"] for item in response.data["errors"]]
        self.assertIn(
            "Phone number matches more than one account. Use full international format including country code.",
            messages,
        )

    def test_inactive_user_cannot_login_by_phone(self):
        self._create_phone_user(
            email="phone-inactive@ffi.com",
            mobile="+201013530963",
            employee_id="PHONE-INACTIVE",
            is_active=False,
        )

        response = self.client.post("/auth/login", {"email": "+201013530963", "password": self.password})

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(response.data["detail"], "Unable to authenticate with the provided credentials.")

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

    def test_login_access_lifetime_is_capped_independently_of_session_timeout(self):
        self.settings_obj.session_timeout_minutes = 45
        self.settings_obj.save(update_fields=["session_timeout_minutes"])

        response = self.client.post("/auth/login", {"email": "test@ffi.com", "password": self.password})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        token = AccessToken(response.data["data"]["token"])
        lifetime_seconds = int(token["exp"] - token["iat"])
        self.assertEqual(lifetime_seconds, 15 * 60)

    def test_login_lockout_uses_configured_max_attempts(self):
        self.settings_obj.max_login_attempts = 2
        self.settings_obj.save(update_fields=["max_login_attempts"])

        for _ in range(2):
            response = self.client.post("/auth/login", {"email": "test@ffi.com", "password": "wrong"})
            self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

        locked_response = self.client.post("/auth/login", {"email": "test@ffi.com", "password": self.password})
        self.assertEqual(locked_response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(
            locked_response.data["detail"],
            "Unable to authenticate with the provided credentials.",
        )

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


@override_settings(SECURE_SSL_REDIRECT=False, ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"])
class AuthenticationLifecycleTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.password = "CurrentStrongPass123!"
        self.user = User.objects.create_user(email="lifecycle@ffi.com", password=self.password)

    def login(self):
        response = self.client.post(
            "/auth/login",
            {"email": self.user.email, "password": self.password},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.data["data"]

    def authenticated_client(self, access):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        return client

    def test_refresh_rotates_and_blacklists_the_used_refresh_token(self):
        tokens = self.login()
        old_refresh = RefreshToken(tokens["refresh"])

        response = self.client.post("/auth/refresh", {"refresh": tokens["refresh"]})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["token"], response.data["data"]["access"])
        self.assertIn("refresh", response.data["data"])
        self.assertNotEqual(response.data["data"]["refresh"], tokens["refresh"])
        old_outstanding = OutstandingToken.objects.get(jti=old_refresh["jti"])
        self.assertTrue(BlacklistedToken.objects.filter(token=old_outstanding).exists())

        reuse_response = self.client.post("/auth/refresh", {"refresh": tokens["refresh"]})
        self.assertEqual(reuse_response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(reuse_response.data["detail"], "Token is invalid or expired.")

    def test_refresh_issues_short_lived_versioned_access_token(self):
        tokens = self.login()

        response = self.client.post("/auth/refresh", {"refresh": tokens["refresh"]})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        access = AccessToken(response.data["data"]["access"])
        self.assertEqual(access["token_version"], self.user.auth_token_version)
        self.assertEqual(access["exp"] - access["iat"], 15 * 60)

    def test_logout_immediately_revokes_access_and_refresh_and_is_audited(self):
        tokens = self.login()
        authenticated = self.authenticated_client(tokens["access"])

        logout_response = authenticated.post("/auth/logout")

        self.assertEqual(logout_response.status_code, status.HTTP_200_OK)
        self.assertEqual(authenticated.get("/auth/me").status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(
            self.client.post("/auth/refresh", {"refresh": tokens["refresh"]}).status_code,
            status.HTTP_401_UNAUTHORIZED,
        )
        audit_log = AuditLog.objects.get(action="logout", actor=self.user)
        self.assertEqual(audit_log.entity, "User")
        self.assertEqual(audit_log.entity_id, str(self.user.pk))
        self.assertEqual(audit_log.metadata, {"revoked_all_sessions": True})

    def test_password_change_immediately_revokes_access_and_refresh_and_is_audited(self):
        tokens = self.login()
        authenticated = self.authenticated_client(tokens["access"])
        new_password = "ReplacementStrongPass456!"

        response = authenticated.post(
            "/auth/change-password",
            {"current_password": self.password, "new_password": new_password},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(authenticated.get("/auth/me").status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(
            self.client.post("/auth/refresh", {"refresh": tokens["refresh"]}).status_code,
            status.HTTP_401_UNAUTHORIZED,
        )
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(new_password))
        audit_log = AuditLog.objects.get(action="password_changed", actor=self.user)
        self.assertEqual(audit_log.metadata, {"revoked_all_sessions": True})

    def test_token_version_mismatch_rejects_an_otherwise_valid_access_token(self):
        refresh = RefreshToken.for_user(self.user)
        refresh["token_version"] = self.user.auth_token_version + 1
        authenticated = self.authenticated_client(str(refresh.access_token))

        response = authenticated.get("/auth/me")

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(response.data["detail"], "Token is invalid or expired.")

    def test_legacy_access_token_without_version_is_rejected(self):
        legacy_refresh = RefreshToken.for_user(self.user)
        authenticated = self.authenticated_client(str(legacy_refresh.access_token))

        self.assertEqual(authenticated.get("/auth/me").status_code, status.HTTP_401_UNAUTHORIZED)

    def test_refresh_uses_body_token_even_when_access_header_is_expired(self):
        tokens = self.login()
        expired_access = AccessToken.for_user(self.user)
        expired_access["token_version"] = self.user.auth_token_version
        expired_access.set_exp(from_time=timezone.now(), lifetime=timedelta(seconds=-1))
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {expired_access}")

        response = self.client.post("/auth/refresh", {"refresh": tokens["refresh"]})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data["data"])

    def test_expired_access_token_is_rejected_with_generic_error(self):
        access = AccessToken.for_user(self.user)
        access["token_version"] = self.user.auth_token_version
        access.set_exp(from_time=timezone.now(), lifetime=timedelta(seconds=-1))
        authenticated = self.authenticated_client(str(access))

        response = authenticated.get("/auth/me")

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertNotIn(self.user.email, str(response.data))
        self.assertNotIn("Traceback", str(response.data))

    def test_invalid_login_responses_do_not_reveal_account_existence(self):
        existing_response = self.client.post(
            "/auth/login",
            {"email": self.user.email, "password": "wrong"},
        )
        nonexistent_response = self.client.post(
            "/auth/login",
            {"email": "nobody@ffi.com", "password": "wrong"},
        )

        self.assertEqual(existing_response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(nonexistent_response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(existing_response.data["detail"], nonexistent_response.data["detail"])
        self.assertEqual(existing_response.data["detail"], "Unable to authenticate with the provided credentials.")

    def test_authentication_audits_never_contain_credentials_or_tokens(self):
        failed_response = self.client.post(
            "/auth/login",
            {"email": self.user.email, "password": "wrong"},
        )
        self.assertEqual(failed_response.status_code, status.HTTP_401_UNAUTHORIZED)
        tokens = self.login()

        logs = AuditLog.objects.filter(action__in=["login_failure", "login_success"])
        self.assertEqual(logs.count(), 2)
        serialized_metadata = " ".join(str(log.metadata) for log in logs)
        self.assertNotIn("wrong", serialized_metadata)
        self.assertNotIn(self.password, serialized_metadata)
        self.assertNotIn(tokens["access"], serialized_metadata)
        self.assertNotIn(tokens["refresh"], serialized_metadata)

    def test_invalid_refresh_response_is_generic(self):
        response = self.client.post("/auth/refresh", {"refresh": "not-a-token"})

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(response.data["detail"], "Token is invalid or expired.")
        self.assertNotIn("not-a-token", str(response.data))
