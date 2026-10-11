import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken
from rest_framework_simplejwt.tokens import RefreshToken

from audit.models import AuditLog
from core.services.whatsapp_service import WhatsAppService
from employees.models import EmployeeProfile
from organization.models import OrganizationNode

from .password_reset_otp import limit_cache_key, otp_cache_key
from .security import password_reset_cache_key, store_hashed_reset_token, verify_reset_token


@override_settings(SECURE_SSL_REDIRECT=False, ALLOWED_HOSTS=["testserver", "localhost"])
class PasswordResetOTPTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.user = get_user_model().objects.create_user(email="otp@ffi.com", password="OriginalPassword123!")
        self.company = OrganizationNode.objects.create(
            code="OTP", name="OTP", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.profile = EmployeeProfile.objects.create(
            user=self.user, company=self.company, employee_id="OTP1", full_name="OTP User", mobile="+966554867964"
        )
        self.sender = patch("accounts.views.WhatsAppService.send_template_message", return_value={"success": True})
        self.send = self.sender.start()
        self.addCleanup(self.sender.stop)

    def request_code(self, identifier=None):
        return self.client.post("/auth/password-reset/request", {"identifier": identifier or self.user.email})

    def confirm(self, otp="123456", password="ReplacementPassword456!", identifier=None):
        return self.client.post(
            "/auth/password-reset/confirm",
            {"identifier": identifier or self.user.email, "otp": otp, "new_password": password},
        )

    def issue(self):
        with patch("accounts.password_reset_otp.secrets.randbelow", return_value=123456):
            return self.request_code()

    def test_email_and_local_phone_resolve_registered_destination(self):
        self.request_code("OTP@FFI.COM")
        self.assertEqual(self.send.call_args.kwargs["phone_number"], self.profile.mobile)
        self.assertEqual(self.send.call_args.kwargs["template_name"], "password_reset_otp")
        cache.clear()
        self.request_code("0554867964")
        self.assertEqual(self.send.call_count, 2)

    def test_unknown_inactive_and_missing_phone_are_indistinguishable(self):
        known = self.issue()
        unknown = self.request_code("missing@ffi.com")
        limited = self.request_code()
        self.user.is_active = False
        self.user.save(update_fields=["is_active"])
        inactive = self.request_code()
        self.user.is_active = True
        self.user.save(update_fields=["is_active"])
        self.profile.mobile = "bad"
        self.profile.save(update_fields=["mobile"])
        invalid_phone = self.request_code()
        self.profile.delete()
        no_profile = self.request_code()
        for response in [known, limited, inactive, invalid_phone, no_profile]:
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.content, unknown.content)
        self.assertEqual(self.send.call_count, 1)

    def test_ambiguous_phone_does_not_send_or_disclose(self):
        other = get_user_model().objects.create_user(email="other@ffi.com", password="OriginalPassword123!")
        EmployeeProfile.objects.create(
            user=other, company=self.company, employee_id="OTP2", full_name="Other", mobile="+20554867964"
        )
        response = self.request_code("0554867964")
        self.assertEqual(response.data, self.request_code("missing@ffi.com").data)
        self.send.assert_not_called()

    def test_phone_mask_is_available_only_after_valid_code_verification(self):
        response = self.issue()
        self.assertNotIn("masked_phone", response.data["data"])
        self.assertNotIn("masked_phone", self.verify("654321").data.get("data", {}))
        verified = self.verify()
        self.assertEqual(verified.data["data"]["masked_phone"], "+966••••••964")
        self.assertNotIn("554867", json.dumps(verified.data, ensure_ascii=False))
        self.assertNotIn("554867", json.dumps(response.data, ensure_ascii=False))
        self.assertNotIn("masked_phone", self.request_code("missing@ffi.com").data["data"])

    def test_mask_handles_variable_length_country_codes(self):
        from .password_reset_otp import mask_recovery_phone

        self.assertEqual(mask_recovery_phone("+14155550123"), "+1•••••••123")
        self.assertEqual(mask_recovery_phone("+201001234567"), "+20•••••••567")
        self.assertEqual(mask_recovery_phone("+97150123456"), "+971•••••456")

    def verify(self, otp="123456", identifier=None):
        return self.client.post(
            "/auth/password-reset/verify", {"identifier": identifier or self.user.email, "otp": otp}
        )

    def test_verify_checks_code_without_consuming_it(self):
        self.issue()
        self.assertEqual(self.verify().status_code, 200)
        self.assertEqual(self.verify().status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("OriginalPassword123!"))
        self.assertEqual(self.confirm().status_code, 200)

    def test_verify_rejects_wrong_expired_and_exhausted_codes(self):
        self.assertEqual(self.verify().status_code, 422)
        self.issue()
        for _ in range(5):
            self.assertEqual(self.verify("654321").status_code, 422)
        self.assertEqual(self.verify().status_code, 422)
        self.assertEqual(self.verify(identifier="missing@ffi.com").status_code, 422)

    def test_reset_rejects_current_password_and_preserves_code(self):
        self.issue()
        response = self.confirm(password="OriginalPassword123!")
        self.assertEqual(response.status_code, 422)
        self.assertTrue(any(item.get("field") == "new_password" for item in response.data["errors"]))
        self.assertEqual(self.confirm().status_code, 200)

    def test_change_password_rejects_reusing_current_password(self):
        self.client.force_authenticate(self.user)
        response = self.client.post(
            "/auth/change-password",
            {"current_password": "OriginalPassword123!", "new_password": "OriginalPassword123!"},
        )
        self.assertEqual(response.status_code, 422)
        self.assertTrue(any(item.get("field") == "new_password" for item in response.data["errors"]))

    def test_otp_is_six_digits_and_hashed_at_rest(self):
        response = self.issue()
        entry = cache.get(otp_cache_key(self.user.pk))
        self.assertNotIn("123456", json.dumps(entry))
        self.assertNotIn("123456", json.dumps(response.data))
        self.assertEqual(self.send.call_args.kwargs["template_variables"], {"otp": "123456"})

    def test_resend_cooldown_hourly_limit_and_window_expiry(self):
        with patch("accounts.password_reset_otp.time.time", return_value=10000):
            self.issue()
        with patch("accounts.password_reset_otp.time.time", return_value=10059):
            self.request_code()
        self.assertEqual(self.send.call_count, 1)
        for now in [10060, 10120, 10180]:
            with patch("accounts.password_reset_otp.time.time", return_value=now):
                self.request_code()
        self.assertEqual(self.send.call_count, 3)
        with patch("accounts.password_reset_otp.time.time", return_value=13601):
            self.request_code()
        self.assertEqual(self.send.call_count, 4)

    def test_aliases_share_account_send_limits(self):
        self.issue()
        self.request_code("0554867964")
        self.send.assert_called_once()
        self.assertEqual(len(cache.get(limit_cache_key(self.user.pk))), 1)

    def test_failed_delivery_invalidates_code_and_masks_provider_errors(self):
        for failure in [{"success": False, "error": "secret 123456"}, RuntimeError("secret 123456")]:
            cache.clear()
            self.send.side_effect = failure if isinstance(failure, Exception) else None
            self.send.return_value = failure
            response = self.issue()
            self.assertEqual(response.status_code, 200)
            self.assertNotIn("secret", json.dumps(response.data))
            self.assertIsNone(cache.get(otp_cache_key(self.user.pk)))
            self.assertEqual(self.confirm().status_code, 422)

    def test_cache_write_failure_prevents_delivery(self):
        with patch("accounts.password_reset_otp.cache.set", return_value=None):
            self.assertEqual(self.issue().status_code, 200)
        self.send.assert_not_called()

    def test_otp_expires_after_five_minutes(self):
        with patch("accounts.password_reset_otp.time.time", return_value=10000):
            self.issue()
        with patch("accounts.password_reset_otp.time.time", return_value=10300):
            self.assertEqual(self.confirm().status_code, 422)

    def test_five_wrong_attempts_exhaust_code_without_extending_expiry(self):
        self.issue()
        expiry = cache.get(otp_cache_key(self.user.pk))["expires_at"]
        for _ in range(5):
            self.assertEqual(self.confirm("654321").status_code, 422)
        self.assertEqual(cache.get(otp_cache_key(self.user.pk))["expires_at"], expiry)
        self.assertEqual(self.confirm().status_code, 422)

    def test_password_policy_error_preserves_valid_code(self):
        self.issue()
        response = self.confirm(password="weak")
        self.assertEqual(response.status_code, 422)
        self.assertTrue(any(item.get("field") == "new_password" for item in response.data["errors"]))
        self.assertEqual(self.confirm().status_code, 200)

    def confirm_email(self, password="EmailReplacementPassword456!"):
        return self.client.post(
            "/auth/reset-password/confirm",
            {"uid": self.user.pk, "token": "pending-email-token", "new_password": password},
        )

    def test_otp_reset_invalidates_pending_email_link_and_both_replays(self):
        store_hashed_reset_token(self.user.pk, "pending-email-token")
        self.issue()
        self.assertEqual(self.confirm().status_code, 200)
        self.assertIsNone(cache.get(password_reset_cache_key(self.user.pk)))
        self.assertEqual(self.confirm_email().status_code, 422)
        self.assertEqual(self.confirm().status_code, 422)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("ReplacementPassword456!"))

    def test_email_link_stays_invalid_if_stale_entry_reappears_after_otp_reset(self):
        store_hashed_reset_token(self.user.pk, "pending-email-token")
        stale_entry = cache.get(password_reset_cache_key(self.user.pk))
        self.issue()
        self.assertEqual(self.confirm().status_code, 200)
        cache.set(password_reset_cache_key(self.user.pk), stale_entry, 3600)
        self.assertEqual(self.confirm_email().status_code, 422)

    def test_legacy_email_token_without_version_is_rejected(self):
        store_hashed_reset_token(self.user.pk, "pending-email-token")
        entry = cache.get(password_reset_cache_key(self.user.pk))
        entry.pop("token_version")
        cache.set(password_reset_cache_key(self.user.pk), entry, 3600)
        self.assertEqual(self.confirm_email().status_code, 422)

    def test_email_link_stays_invalid_if_stale_entry_reappears_after_email_reset(self):
        store_hashed_reset_token(self.user.pk, "pending-email-token")
        stale_entry = cache.get(password_reset_cache_key(self.user.pk))
        self.assertEqual(self.confirm_email().status_code, 200)
        cache.set(password_reset_cache_key(self.user.pk), stale_entry, 3600)
        self.assertEqual(self.confirm_email().status_code, 422)

    def test_email_reset_invalidates_pending_otp_and_both_replays(self):
        self.issue()
        store_hashed_reset_token(self.user.pk, "pending-email-token")
        self.assertEqual(self.confirm_email().status_code, 200)
        self.assertIsNone(cache.get(otp_cache_key(self.user.pk)))
        self.assertEqual(self.verify().status_code, 422)
        self.assertEqual(self.confirm().status_code, 422)
        self.assertEqual(self.confirm_email().status_code, 422)

    def test_policy_rejection_preserves_both_pending_credentials(self):
        self.issue()
        store_hashed_reset_token(self.user.pk, "pending-email-token")
        self.assertEqual(self.confirm(password="weak").status_code, 422)
        self.assertEqual(self.confirm_email(password="weak").status_code, 422)
        self.assertTrue(verify_reset_token(self.user.pk, "pending-email-token"))
        self.assertEqual(self.verify().status_code, 200)
        self.assertEqual(self.confirm().status_code, 200)

    def test_otp_reset_fails_closed_if_pending_email_link_cannot_be_removed(self):
        self.issue()
        store_hashed_reset_token(self.user.pk, "pending-email-token")
        with patch("accounts.security.cache.delete", return_value=False):
            self.assertEqual(self.confirm().status_code, 422)
        self.assertTrue(verify_reset_token(self.user.pk, "pending-email-token"))
        self.assertEqual(self.verify().status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("OriginalPassword123!"))

    def test_email_reset_rejects_pending_otp_even_if_cleanup_fails(self):
        self.issue()
        store_hashed_reset_token(self.user.pk, "pending-email-token")
        with patch("accounts.views.consume_otp", side_effect=RuntimeError("cache unavailable")):
            self.assertEqual(self.confirm_email().status_code, 200)
        self.assertIsNotNone(cache.get(otp_cache_key(self.user.pk)))
        self.assertEqual(self.verify().status_code, 422)
        self.assertEqual(self.confirm().status_code, 422)

    def test_success_single_use_revokes_sessions_and_audits_without_credentials(self):
        previous_version = self.user.auth_token_version
        refresh = RefreshToken.for_user(self.user)
        refresh["token_version"] = self.user.auth_token_version
        access = str(refresh.access_token)
        self.issue()
        self.assertEqual(self.confirm().status_code, 200)
        self.assertEqual(self.confirm().status_code, 422)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("ReplacementPassword456!"))
        self.assertEqual(self.user.auth_token_version, previous_version + 1)
        self.assertTrue(BlacklistedToken.objects.filter(token__jti=refresh["jti"]).exists())
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        self.assertEqual(self.client.get("/auth/me").status_code, 401)
        self.assertEqual(self.client.post("/auth/refresh", {"refresh": str(refresh)}).status_code, 401)
        logs = AuditLog.objects.filter(entity="User", entity_id=str(self.user.pk))
        self.assertTrue(logs.filter(action="password_reset_completed").exists())
        self.assertNotIn("123456", json.dumps(list(logs.values("metadata"))))

    def test_expired_bearer_header_does_not_block_public_recovery(self):
        self.client.credentials(HTTP_AUTHORIZATION="Bearer invalid")
        self.assertEqual(self.issue().status_code, 200)
        self.assertEqual(self.confirm().status_code, 200)

    def test_account_deleted_after_resolution_keeps_generic_responses(self):
        account = self.user
        resolved_id = account.pk
        self.profile.delete()
        account.delete()
        account.pk = resolved_id
        with patch("accounts.views.resolve_password_reset_user", return_value=account):
            requested = self.request_code()
            confirmed = self.confirm()
        self.assertEqual(requested.status_code, 200)
        self.assertEqual(confirmed.status_code, 422)
        self.assertEqual(requested.data, self.request_code("missing@ffi.com").data)
        self.assertEqual(confirmed.data, self.confirm(identifier="missing@ffi.com").data)
        self.send.assert_not_called()

    def test_delete_failure_prevents_reset(self):
        self.issue()
        with patch("accounts.password_reset_otp.cache.delete", return_value=False):
            self.assertEqual(self.confirm().status_code, 422)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("OriginalPassword123!"))

    def test_other_session_revocation_invalidates_pending_code(self):
        self.issue()
        self.user.auth_token_version += 1
        self.user.save(update_fields=["auth_token_version"])
        self.assertEqual(self.confirm().status_code, 422)

    def test_request_and_confirmation_ip_throttles(self):
        for _ in range(10):
            self.assertEqual(self.request_code("missing@ffi.com").status_code, 200)
        self.assertEqual(self.request_code("missing@ffi.com").status_code, 429)
        for _ in range(10):
            self.assertEqual(self.confirm(identifier="missing@ffi.com").status_code, 422)
        self.assertEqual(self.confirm(identifier="missing@ffi.com").status_code, 429)

    def test_template_is_arabic_first_and_contains_safety_guidance(self):
        text, error = WhatsAppService().render_template(
            template_name="password_reset_otp", template_variables={"otp": "123456"}
        )
        self.assertEqual(error, "")
        self.assertLess(text.index("رمز"), text.index("Password recovery"))
        self.assertIn("123456", text)
        self.assertIn("Do not share", text)

    def test_provider_logs_do_not_echo_otp_in_diagnostics(self):
        from core.services.messaging_providers import EvolutionWhatsAppProvider

        with patch("core.services.messaging_providers._log_delivery") as log:
            result = EvolutionWhatsAppProvider()._result(
                phone_number=self.profile.mobile,
                event="password_reset_otp",
                success=False,
                status_code=400,
                started_at=0,
                error="Provider echoed code 123456",
                message_id="123456",
                provider_status="123456",
            )
        self.assertNotIn("123456", json.dumps(result))
        self.assertNotIn("123456", json.dumps(log.call_args.kwargs))
