from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from employees.models import EmployeeProfile

from .models import Invite

User = get_user_model()


@override_settings(SECURE_SSL_REDIRECT=False, ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"])
class InvitePermissionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.employee_group, _ = Group.objects.get_or_create(name="Employee")

        self.hr_user = User.objects.create_user(
            email="hr-invite@test.com",
            password="StrongPass123!",
            full_name="HR Inviter",
        )
        self.hr_user.groups.add(self.hr_group)

        self.employee_user = User.objects.create_user(
            email="employee@test.com",
            password="StrongPass123!",
            full_name="Regular Employee",
        )
        self.employee_user.groups.add(self.employee_group)

    @patch("invites.views.send_user_invite_email")
    def test_hr_manager_can_create_invite(self, send_email):
        send_email.return_value = {"success": True, "provider": "bird", "message_id": "email-1", "status_code": 202}
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.post(
            "/invites/",
            {"email": "new-user@test.com", "role": "Employee"},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertTrue(Invite.objects.filter(email="new-user@test.com", created_by=self.hr_user).exists())
        invite = Invite.objects.get(email="new-user@test.com")
        self.assertEqual(invite.channel, Invite.Channel.EMAIL)
        self.assertEqual(response.data["data"]["channel"], Invite.Channel.EMAIL)
        self.assertTrue(response.data["data"]["email_delivery"]["sent"])
        self.assertIsNone(response.data["data"]["whatsapp_delivery"])
        self.assertEqual(response.data["data"]["last_delivery"]["channel"], Invite.Channel.EMAIL)
        self.assertEqual(response.data["data"]["email_delivery"]["provider"], "bird")
        self.assertEqual(response.data["data"]["email_delivery"]["provider_label"], "Email delivery service")
        self.assertEqual(response.data["data"]["email_delivery"]["delivery_status_label"], "Submitted")
        self.assertEqual(response.data["data"]["email_delivery"]["message_id"], "email-1")
        self.assertTrue(response.data["data"]["email_delivery"]["provider_submitted"])
        self.assertEqual(response.data["data"]["email_delivery"]["delivery_status"], Invite.DeliveryStatus.SENT)
        invite.refresh_from_db()
        self.assertEqual(invite.last_delivery_channel, Invite.Channel.EMAIL)
        self.assertTrue(invite.last_delivery_sent)
        self.assertTrue(invite.provider_submitted)
        self.assertEqual(invite.delivery_status, Invite.DeliveryStatus.SENT)
        self.assertEqual(invite.last_delivery_provider, "bird")
        self.assertEqual(invite.last_delivery_message_id, "email-1")
        send_email.assert_called_once()

    @patch("core.services.whatsapp_notifications.WhatsAppService.send_template_message")
    @patch("invites.views.send_user_invite_email")
    def test_hr_manager_can_create_whatsapp_invite(self, send_email, whatsapp_send):
        whatsapp_send.return_value = {
            "success": True,
            "provider": "evolution_whatsapp",
            "message_id": "wa-1",
            "provider_status": "PENDING",
            "status_code": 201,
            "error": None,
        }
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.post(
            "/invites/",
            {"channel": "whatsapp", "phone_number": "201013530963", "role": "Employee"},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        invite = Invite.objects.get(phone_number="+201013530963")
        self.assertIsNone(invite.email)
        self.assertEqual(invite.channel, Invite.Channel.WHATSAPP)
        self.assertFalse(response.data["data"]["whatsapp_delivery"]["sent"])
        self.assertTrue(response.data["data"]["whatsapp_delivery"]["provider_submitted"])
        self.assertEqual(response.data["data"]["whatsapp_delivery"]["provider_status"], "PENDING")
        self.assertEqual(response.data["data"]["whatsapp_delivery"]["delivery_status"], Invite.DeliveryStatus.QUEUED)
        self.assertIsNone(response.data["data"]["email_delivery"])
        self.assertEqual(response.data["data"]["last_delivery"]["channel"], Invite.Channel.WHATSAPP)
        self.assertEqual(response.data["data"]["whatsapp_delivery"]["provider"], "evolution_whatsapp")
        self.assertEqual(response.data["data"]["whatsapp_delivery"]["provider_label"], "WhatsApp delivery service")
        self.assertEqual(response.data["data"]["whatsapp_delivery"]["delivery_status_label"], "Queued")
        self.assertEqual(response.data["data"]["whatsapp_delivery"]["message_id"], "wa-1")
        invite.refresh_from_db()
        self.assertEqual(invite.last_delivery_channel, Invite.Channel.WHATSAPP)
        self.assertFalse(invite.last_delivery_sent)
        self.assertTrue(invite.provider_submitted)
        self.assertEqual(invite.provider_status, "PENDING")
        self.assertEqual(invite.delivery_status, Invite.DeliveryStatus.QUEUED)
        self.assertEqual(invite.external_message_id, "wa-1")
        self.assertEqual(invite.last_delivery_provider, "evolution_whatsapp")
        self.assertEqual(invite.last_delivery_message_id, "wa-1")
        send_email.assert_not_called()
        whatsapp_send.assert_called_once()
        self.assertEqual(whatsapp_send.call_args.kwargs["template_name"], "employee_invitation")
        self.assertIn("/register?token=", whatsapp_send.call_args.kwargs["template_variables"]["invite_link"])

    @patch("core.services.whatsapp_notifications.WhatsAppService.send_template_message")
    def test_hr_manager_can_create_whatsapp_invite_with_expected_email(self, whatsapp_send):
        whatsapp_send.return_value = {
            "success": True,
            "provider": "evolution_whatsapp",
            "message_id": "wa-email-1",
            "provider_status": "PENDING",
            "status_code": 201,
            "error": None,
        }
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.post(
            "/invites/",
            {
                "channel": "whatsapp",
                "phone_number": "+201515091693",
                "email": "Expected.WA@TEST.COM",
                "role": "Employee",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        invite = Invite.objects.get(phone_number="+201515091693")
        self.assertEqual(invite.email, "expected.wa@test.com")
        self.assertEqual(response.data["data"]["email"], "expected.wa@test.com")

        list_response = self.client.get("/invites/")
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(list_response.data["data"]["items"][0]["email"], "expected.wa@test.com")

        detail_response = self.client.get(f"/invites/{invite.id}/")
        self.assertEqual(detail_response.status_code, 200)
        self.assertEqual(detail_response.data["data"]["email"], "expected.wa@test.com")

        accept_response = self.client.get("/invites/accept/", {"token": invite.token})
        self.assertEqual(accept_response.status_code, 200)
        self.assertEqual(accept_response.data["data"]["email"], "expected.wa@test.com")

    @patch("core.services.whatsapp_notifications.WhatsAppService.send_template_message")
    def test_whatsapp_invite_with_registered_expected_email_is_rejected(self, whatsapp_send):
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.post(
            "/invites/",
            {
                "channel": "whatsapp",
                "phone_number": "+201515091694",
                "email": self.employee_user.email,
                "role": "Employee",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("email", {item["field"] for item in response.data["errors"]})
        self.assertFalse(Invite.objects.filter(phone_number="+201515091694").exists())
        whatsapp_send.assert_not_called()

    @patch("core.services.whatsapp_notifications.WhatsAppService.send_template_message")
    def test_whatsapp_provider_failure_is_returned_and_persisted(self, whatsapp_send):
        whatsapp_send.return_value = {
            "success": False,
            "provider": "evolution_whatsapp",
            "message_id": None,
            "status_code": 0,
            "error": "Evolution WhatsApp provider is not configured.",
        }
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.post(
            "/invites/",
            {"channel": "whatsapp", "phone_number": "+201515091691", "role": "Employee"},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        delivery = response.data["data"]["whatsapp_delivery"]
        self.assertFalse(delivery["sent"])
        self.assertFalse(delivery["provider_submitted"])
        self.assertEqual(delivery["delivery_status"], Invite.DeliveryStatus.FAILED)
        self.assertEqual(delivery["provider"], "evolution_whatsapp")
        self.assertEqual(delivery["status_code"], 0)
        self.assertIn("not configured", delivery["error"])
        invite = Invite.objects.get(phone_number="+201515091691")
        self.assertEqual(invite.last_delivery_channel, Invite.Channel.WHATSAPP)
        self.assertFalse(invite.last_delivery_sent)
        self.assertFalse(invite.provider_submitted)
        self.assertEqual(invite.delivery_status, Invite.DeliveryStatus.FAILED)
        self.assertIn("not configured", invite.last_delivery_error)

    @patch("core.services.whatsapp_notifications.WhatsAppService.send_template_message")
    def test_evolution_pending_invite_is_submitted_not_delivered(self, whatsapp_send):
        whatsapp_send.return_value = {
            "success": True,
            "provider": "evolution_whatsapp",
            "message_id": "wa-pending",
            "provider_status": "PENDING",
            "status_code": 201,
            "error": None,
        }
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.post(
            "/invites/",
            {"channel": "whatsapp", "phone_number": "+201515091692", "role": "Employee"},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        delivery = response.data["data"]["whatsapp_delivery"]
        self.assertFalse(delivery["sent"])
        self.assertTrue(delivery["provider_submitted"])
        self.assertEqual(delivery["provider_status"], "PENDING")
        self.assertEqual(delivery["delivery_status"], Invite.DeliveryStatus.QUEUED)
        self.assertIsNone(delivery["sent_at"])
        self.assertIsNotNone(delivery["submitted_at"])
        invite = Invite.objects.get(phone_number="+201515091692")
        self.assertTrue(invite.provider_submitted)
        self.assertEqual(invite.provider_status, "PENDING")
        self.assertEqual(invite.delivery_status, Invite.DeliveryStatus.QUEUED)
        self.assertFalse(invite.last_delivery_sent)

    @patch("invites.views.WhatsAppService.send_template_message")
    def test_hr_manager_can_send_whatsapp_provider_test(self, whatsapp_send):
        whatsapp_send.return_value = {
            "success": True,
            "provider": "evolution_whatsapp",
            "message_id": "wa-test",
            "status_code": 201,
            "error": None,
        }
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.post(
            "/invites/test-whatsapp/",
            {"phone_number": "+201515091691"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["data"]["sent"])
        self.assertEqual(response.data["data"]["provider"], "evolution_whatsapp")
        self.assertEqual(response.data["data"]["status_code"], 201)
        self.assertEqual(response.data["data"]["message_id"], "wa-test")
        whatsapp_send.assert_called_once()
        self.assertEqual(whatsapp_send.call_args.kwargs["phone_number"], "+201515091691")
        self.assertEqual(whatsapp_send.call_args.kwargs["template_name"], "whatsapp_provider_test")

    def test_employee_cannot_send_whatsapp_provider_test(self):
        self.client.force_authenticate(user=self.employee_user)

        response = self.client.post(
            "/invites/test-whatsapp/",
            {"phone_number": "+201515091691"},
            format="json",
        )

        self.assertEqual(response.status_code, 403)

    def test_whatsapp_provider_test_rejects_invalid_phone_number(self):
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.post(
            "/invites/test-whatsapp/",
            {"phone_number": "123"},
            format="json",
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("phone_number", {item["field"] for item in response.data["errors"]})

    @patch("invites.views.WhatsAppService.send_template_message")
    def test_whatsapp_provider_test_failure_returns_controlled_result(self, whatsapp_send):
        whatsapp_send.return_value = {
            "success": False,
            "provider": "evolution_whatsapp",
            "message_id": None,
            "status_code": None,
            "error": "Evolution WhatsApp provider is not configured.",
        }
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.post(
            "/invites/test-whatsapp/",
            {"phone_number": "+201515091691"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["data"]["sent"])
        self.assertEqual(response.data["data"]["provider"], "evolution_whatsapp")
        self.assertIsNone(response.data["data"]["status_code"])
        self.assertIsNone(response.data["data"]["message_id"])
        self.assertIn("not configured", response.data["data"]["error"])

    def test_whatsapp_invite_requires_phone_number(self):
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.post(
            "/invites/",
            {"channel": "whatsapp", "role": "Employee"},
            format="json",
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("phone_number", {item["field"] for item in response.data["errors"]})

    def test_email_invite_requires_email(self):
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.post(
            "/invites/",
            {"channel": "email", "role": "Employee"},
            format="json",
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("email", {item["field"] for item in response.data["errors"]})

    def test_hr_manager_cannot_create_system_admin_invite(self):
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.post(
            "/invites/",
            {"email": "blocked-admin@test.com", "role": "SystemAdmin"},
            format="json",
        )

        self.assertEqual(response.status_code, 422)
        self.assertFalse(Invite.objects.filter(email="blocked-admin@test.com").exists())

    def test_new_manager_invite_is_rejected(self):
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.post(
            "/invites/",
            {"email": "blocked-manager@test.com", "role": "Manager"},
            format="json",
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("role", {item["field"] for item in response.data["errors"]})
        self.assertFalse(Invite.objects.filter(email="blocked-manager@test.com").exists())

    def test_hr_manager_can_list_invites(self):
        now = timezone.now()
        Invite.objects.create(
            email="listed-user@test.com",
            role="Employee",
            token=Invite.generate_token(),
            status=Invite.Status.SENT,
            sent_at=now,
            expires_at=now + timedelta(hours=72),
            created_by=self.hr_user,
        )
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.get("/invites/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["data"]["count"], 1)

    def test_existing_manager_invite_rows_serialize_safely(self):
        now = timezone.now()
        invite = Invite.objects.create(
            email="legacy-manager@test.com",
            role="Manager",
            token=Invite.generate_token(),
            status=Invite.Status.SENT,
            sent_at=now,
            expires_at=now + timedelta(hours=72),
            created_by=self.hr_user,
        )
        self.client.force_authenticate(user=self.hr_user)

        list_response = self.client.get("/invites/")
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(list_response.data["data"]["items"][0]["role"], "Manager")

        detail_response = self.client.get(f"/invites/{invite.id}/")
        self.assertEqual(detail_response.status_code, 200)
        self.assertEqual(detail_response.data["data"]["role"], "Manager")

    def test_invite_list_includes_delivery_info(self):
        now = timezone.now()
        Invite.objects.create(
            email=None,
            phone_number="+201515091691",
            channel=Invite.Channel.WHATSAPP,
            role="Employee",
            token=Invite.generate_token(),
            status=Invite.Status.SENT,
            sent_at=now,
            expires_at=now + timedelta(hours=72),
            created_by=self.hr_user,
            last_delivery_channel=Invite.Channel.WHATSAPP,
            last_delivery_sent=False,
            last_delivery_provider="evolution_whatsapp",
            last_delivery_status_code=0,
            last_delivery_message_id="",
            last_delivery_error="Evolution instance disconnected.",
            last_delivery_at=now,
        )
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.get("/invites/")

        self.assertEqual(response.status_code, 200)
        item = response.data["data"]["items"][0]
        self.assertEqual(item["channel"], Invite.Channel.WHATSAPP)
        self.assertIsNone(item["email"])
        self.assertEqual(item["phone_number"], "+201515091691")
        self.assertIsNone(item["email_delivery"])
        self.assertFalse(item["whatsapp_delivery"]["sent"])
        self.assertEqual(item["whatsapp_delivery"]["delivery_status"], Invite.DeliveryStatus.UNKNOWN)
        self.assertEqual(item["whatsapp_delivery"]["provider"], "evolution_whatsapp")
        self.assertEqual(item["whatsapp_delivery"]["status_code"], 0)
        self.assertIn("disconnected", item["whatsapp_delivery"]["error"])
        self.assertEqual(item["last_delivery"]["channel"], Invite.Channel.WHATSAPP)

    def test_regular_employee_cannot_create_invite(self):
        self.client.force_authenticate(user=self.employee_user)

        response = self.client.post(
            "/invites/",
            {"email": "blocked-user@test.com", "role": "Employee"},
            format="json",
        )

        self.assertEqual(response.status_code, 403)

    def test_accept_email_invite_without_phone_still_works(self):
        now = timezone.now()
        invite = Invite.objects.create(
            email="accepted-email@test.com",
            channel=Invite.Channel.EMAIL,
            role="Employee",
            token=Invite.generate_token(),
            status=Invite.Status.SENT,
            sent_at=now,
            expires_at=now + timedelta(hours=72),
            created_by=self.hr_user,
        )

        response = self.client.post(
            "/invites/accept/",
            {
                "token": invite.token,
                "full_name": "Accepted Email",
                "password": "StrongPass123!",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        user = User.objects.get(email="accepted-email@test.com")
        profile = EmployeeProfile.objects.get(user=user)
        self.assertEqual(profile.mobile, "")

    def test_accept_whatsapp_invite_with_phone_stores_employee_profile_mobile(self):
        now = timezone.now()
        invite = Invite.objects.create(
            email=None,
            phone_number="+201515091690",
            channel=Invite.Channel.WHATSAPP,
            role="Employee",
            token=Invite.generate_token(),
            status=Invite.Status.SENT,
            sent_at=now,
            expires_at=now + timedelta(hours=72),
            created_by=self.hr_user,
        )

        response = self.client.post(
            "/invites/accept/",
            {
                "token": invite.token,
                "email": "accepted-whatsapp@test.com",
                "phone_number": "+201515091691",
                "full_name": "Accepted WhatsApp",
                "password": "StrongPass123!",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        user = User.objects.get(email="accepted-whatsapp@test.com")
        profile = EmployeeProfile.objects.get(user=user)
        self.assertEqual(profile.mobile, "+201515091691")
        invite.refresh_from_db()
        self.assertEqual(invite.email, "accepted-whatsapp@test.com")
        self.assertEqual(invite.phone_number, "+201515091691")
        self.assertEqual(User.objects.filter(email="accepted-whatsapp@test.com").count(), 1)

        self.client.force_authenticate(user=self.hr_user)
        list_response = self.client.get("/invites/")
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(list_response.data["data"]["items"][0]["email"], "accepted-whatsapp@test.com")
        self.assertEqual(list_response.data["data"]["items"][0]["phone_number"], "+201515091691")
        self.client.force_authenticate(user=None)

        duplicate_response = self.client.post(
            "/invites/accept/",
            {
                "token": invite.token,
                "email": "accepted-whatsapp@test.com",
                "phone_number": "+201515091691",
                "full_name": "Accepted WhatsApp",
                "password": "StrongPass123!",
            },
            format="json",
        )

        self.assertEqual(duplicate_response.status_code, 422)
        self.assertEqual(User.objects.filter(email="accepted-whatsapp@test.com").count(), 1)

    def test_accept_whatsapp_invite_with_prefilled_email_rejects_different_email(self):
        now = timezone.now()
        invite = Invite.objects.create(
            email="expected-accept@test.com",
            phone_number="+201515091695",
            channel=Invite.Channel.WHATSAPP,
            role="Employee",
            token=Invite.generate_token(),
            status=Invite.Status.SENT,
            sent_at=now,
            expires_at=now + timedelta(hours=72),
            created_by=self.hr_user,
        )

        response = self.client.post(
            "/invites/accept/",
            {
                "token": invite.token,
                "email": "different-accept@test.com",
                "phone_number": "+201515091695",
                "full_name": "Mismatch Email",
                "password": "StrongPass123!",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("email", {item["field"] for item in response.data["errors"]})
        self.assertFalse(
            User.objects.filter(email__in=["expected-accept@test.com", "different-accept@test.com"]).exists()
        )
        invite.refresh_from_db()
        self.assertEqual(invite.status, Invite.Status.SENT)

    def test_accept_whatsapp_invite_with_prefilled_email_uses_invite_email(self):
        now = timezone.now()
        invite = Invite.objects.create(
            email="prefilled-accept@test.com",
            phone_number="+201515091696",
            channel=Invite.Channel.WHATSAPP,
            role="Employee",
            token=Invite.generate_token(),
            status=Invite.Status.SENT,
            sent_at=now,
            expires_at=now + timedelta(hours=72),
            created_by=self.hr_user,
        )

        response = self.client.post(
            "/invites/accept/",
            {
                "token": invite.token,
                "email": "PREFILLED-ACCEPT@TEST.COM",
                "phone_number": "+201515091696",
                "full_name": "Prefilled Accept",
                "password": "StrongPass123!",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        user = User.objects.get(email="prefilled-accept@test.com")
        profile = EmployeeProfile.objects.get(user=user)
        self.assertEqual(profile.mobile, "+201515091696")
        invite.refresh_from_db()
        self.assertEqual(invite.email, "prefilled-accept@test.com")

    def test_existing_manager_invite_acceptance_is_rejected(self):
        now = timezone.now()
        invite = Invite.objects.create(
            email="legacy-manager-accept@test.com",
            channel=Invite.Channel.EMAIL,
            role="Manager",
            token=Invite.generate_token(),
            status=Invite.Status.SENT,
            sent_at=now,
            expires_at=now + timedelta(hours=72),
            created_by=self.hr_user,
        )

        response = self.client.post(
            "/invites/accept/",
            {
                "token": invite.token,
                "full_name": "Legacy Manager",
                "password": "StrongPass123!",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(
            response.data["message"],
            "Manager role invites are no longer supported. Ask HR to resend as Employee.",
        )
        self.assertIn("role", {item["field"] for item in response.data["errors"]})
        self.assertFalse(User.objects.filter(email="legacy-manager-accept@test.com").exists())
        invite.refresh_from_db()
        self.assertEqual(invite.status, Invite.Status.SENT)

    def test_accept_details_returns_whatsapp_phone_number(self):
        now = timezone.now()
        invite = Invite.objects.create(
            email=None,
            phone_number="+201515091691",
            channel=Invite.Channel.WHATSAPP,
            role="Employee",
            token=Invite.generate_token(),
            status=Invite.Status.SENT,
            sent_at=now,
            expires_at=now + timedelta(hours=72),
            created_by=self.hr_user,
        )

        response = self.client.get("/invites/accept/", {"token": invite.token})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["data"]["channel"], Invite.Channel.WHATSAPP)
        self.assertIsNone(response.data["data"]["email"])
        self.assertEqual(response.data["data"]["phone_number"], "+201515091691")

    def test_accept_invite_rejects_invalid_phone_number(self):
        now = timezone.now()
        invite = Invite.objects.create(
            email="invalid-phone-accept@test.com",
            channel=Invite.Channel.EMAIL,
            role="Employee",
            token=Invite.generate_token(),
            status=Invite.Status.SENT,
            sent_at=now,
            expires_at=now + timedelta(hours=72),
            created_by=self.hr_user,
        )

        response = self.client.post(
            "/invites/accept/",
            {
                "token": invite.token,
                "phone_number": "123",
                "full_name": "Invalid Phone",
                "password": "StrongPass123!",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("phone_number", {item["field"] for item in response.data["errors"]})

    @patch("invites.views.send_user_invite_whatsapp")
    @patch("invites.views.send_user_invite_email")
    def test_resend_email_invite_calls_email_path(self, send_email, send_whatsapp):
        send_email.return_value = {
            "success": True,
            "provider": "bird",
            "message_id": "email-resend",
            "status_code": 202,
        }
        now = timezone.now()
        invite = Invite.objects.create(
            email="resend-email@test.com",
            channel=Invite.Channel.EMAIL,
            role="Employee",
            token=Invite.generate_token(),
            status=Invite.Status.SENT,
            sent_at=now,
            expires_at=now + timedelta(hours=72),
            created_by=self.hr_user,
        )
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.post(f"/invites/{invite.id}/resend/", {}, format="json")

        self.assertEqual(response.status_code, 200)
        send_email.assert_called_once()
        send_whatsapp.assert_not_called()
        self.assertTrue(response.data["data"]["email_delivery"]["sent"])
        self.assertIsNone(response.data["data"]["whatsapp_delivery"])
        self.assertEqual(response.data["data"]["email_delivery"]["message_id"], "email-resend")
        invite.refresh_from_db()
        self.assertEqual(invite.last_delivery_channel, Invite.Channel.EMAIL)
        self.assertTrue(invite.last_delivery_sent)

    @patch("core.services.whatsapp_notifications.WhatsAppService.send_template_message")
    @patch("invites.views.send_user_invite_email")
    def test_resend_whatsapp_invite_calls_whatsapp_path_without_email_fallback(self, send_email, whatsapp_send):
        whatsapp_send.return_value = {
            "success": True,
            "provider": "evolution_whatsapp",
            "message_id": "wa-resend",
            "provider_status": "PENDING",
            "status_code": 201,
            "error": None,
        }
        now = timezone.now()
        invite = Invite.objects.create(
            email=None,
            phone_number="+201515091691",
            channel=Invite.Channel.WHATSAPP,
            role="Employee",
            token=Invite.generate_token(),
            status=Invite.Status.SENT,
            sent_at=now,
            expires_at=now + timedelta(hours=72),
            created_by=self.hr_user,
        )
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.post(f"/invites/{invite.id}/resend/", {}, format="json")

        self.assertEqual(response.status_code, 200)
        send_email.assert_not_called()
        whatsapp_send.assert_called_once()
        self.assertFalse(response.data["data"]["whatsapp_delivery"]["sent"])
        self.assertTrue(response.data["data"]["whatsapp_delivery"]["provider_submitted"])
        self.assertEqual(response.data["data"]["whatsapp_delivery"]["delivery_status"], Invite.DeliveryStatus.QUEUED)
        self.assertIsNone(response.data["data"]["email_delivery"])
        self.assertEqual(response.data["data"]["whatsapp_delivery"]["message_id"], "wa-resend")
        invite.refresh_from_db()
        self.assertEqual(invite.last_delivery_channel, Invite.Channel.WHATSAPP)
        self.assertFalse(invite.last_delivery_sent)
        self.assertTrue(invite.provider_submitted)
        self.assertEqual(invite.delivery_status, Invite.DeliveryStatus.QUEUED)
