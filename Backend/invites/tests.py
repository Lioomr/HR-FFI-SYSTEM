from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import Invite

User = get_user_model()


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

    def test_hr_manager_can_create_invite(self):
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.post(
            "/invites/",
            {"email": "new-user@test.com", "role": "Employee"},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertTrue(Invite.objects.filter(email="new-user@test.com", created_by=self.hr_user).exists())

    def test_hr_manager_cannot_create_system_admin_invite(self):
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.post(
            "/invites/",
            {"email": "blocked-admin@test.com", "role": "SystemAdmin"},
            format="json",
        )

        self.assertEqual(response.status_code, 422)
        self.assertFalse(Invite.objects.filter(email="blocked-admin@test.com").exists())

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

    def test_regular_employee_cannot_create_invite(self):
        self.client.force_authenticate(user=self.employee_user)

        response = self.client.post(
            "/invites/",
            {"email": "blocked-user@test.com", "role": "Employee"},
            format="json",
        )

        self.assertEqual(response.status_code, 403)
