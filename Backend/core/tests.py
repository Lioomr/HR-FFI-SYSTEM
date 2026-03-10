from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase
from rest_framework.test import APITestCase

from audit.models import AuditLog
from core.permissions import get_role


class RoleResolutionTests(TestCase):
    def test_get_role_returns_cfo_when_cfo_group_exists(self):
        user_model = get_user_model()
        user = user_model.objects.create_user(email="cfo-role@test.com", password="password")
        cfo_group, _ = Group.objects.get_or_create(name="CFO")
        user.groups.add(cfo_group)

        self.assertEqual(get_role(user), "CFO")


class HrSummaryViewTests(APITestCase):
    def setUp(self):
        self.user_model = get_user_model()
        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.admin_group, _ = Group.objects.get_or_create(name="SystemAdmin")

        self.hr_user = self.user_model.objects.create_user(
            email="hr@test.com",
            password="StrongPass123!",
            full_name="HR Manager",
        )
        self.hr_user.groups.add(self.hr_group)

        self.admin_user = self.user_model.objects.create_user(
            email="admin@test.com",
            password="StrongPass123!",
            full_name="System Admin",
        )
        self.admin_user.groups.add(self.admin_group)

    def test_recent_activity_only_includes_hr_manager_activity(self):
        AuditLog.objects.create(
            actor=self.admin_user,
            action="invite_sent",
            entity="invite",
            entity_id="1",
        )
        AuditLog.objects.create(
            actor=self.hr_user,
            action="employee_imported",
            entity="employee",
            entity_id="2",
        )

        self.client.force_authenticate(user=self.hr_user)
        response = self.client.get("/api/hr/summary/")

        self.assertEqual(response.status_code, 200)
        recent_activity = response.data["data"]["recent_activity"]

        self.assertEqual(len(recent_activity), 1)
        self.assertEqual(recent_activity[0]["employee"], "hr@test.com")
        self.assertEqual(recent_activity[0]["action"], "employee_imported")
