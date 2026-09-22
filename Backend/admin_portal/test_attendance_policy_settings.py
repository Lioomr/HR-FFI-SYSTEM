from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from organization.models import OrganizationNode, UserOrganizationAccess

from .models import SystemSettings

User = get_user_model()


class AttendancePolicySettingsAuthorizationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.company_a = OrganizationNode.objects.create(
            code="SETTINGS-A", name="Settings A", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.company_b = OrganizationNode.objects.create(
            code="SETTINGS-B", name="Settings B", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.admin_group, _ = Group.objects.get_or_create(name="SystemAdmin")
        self.employee_group, _ = Group.objects.get_or_create(name="Employee")
        self.hr = User.objects.create_user(email="policy-hr@ffi.test", password="password")
        self.hr.groups.add(self.hr_group)
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.company_a)
        self.admin = User.objects.create_user(email="policy-admin@ffi.test", password="password")
        self.admin.groups.add(self.admin_group)
        self.employee = User.objects.create_user(email="policy-employee@ffi.test", password="password")
        self.employee.groups.add(self.employee_group)
        UserOrganizationAccess.objects.create(user=self.employee, organization=self.company_a)
        self.headers = {"HTTP_X_ACTIVE_COMPANY_ID": str(self.company_a.id)}

    def test_hr_manager_can_update_attendance_only_and_legacy_alias_stays_synchronized(self):
        self.client.force_authenticate(self.hr)
        canonical = self.client.put(
            "/settings/",
            {"attendance": {"grace_window_minutes": 18}},
            format="json",
            **self.headers,
        )
        self.assertEqual(canonical.status_code, status.HTTP_200_OK, canonical.data)
        self.assertEqual(canonical.data["data"]["attendance"]["grace_window_minutes"], 18)
        self.assertEqual(canonical.data["data"]["attendance"]["late_grace_minutes"], 18)

        legacy = self.client.put(
            "/settings/",
            {"attendance": {"late_grace_minutes": 12}},
            format="json",
            **self.headers,
        )
        self.assertEqual(legacy.status_code, status.HTTP_200_OK, legacy.data)
        settings_obj = SystemSettings.get_solo()
        self.assertEqual(settings_obj.grace_window_minutes, 12)
        self.assertEqual(settings_obj.late_grace_minutes, 12)

    def test_system_admin_can_update_attendance_policy(self):
        self.client.force_authenticate(self.admin)
        response = self.client.put(
            "/settings/",
            {"attendance": {"grace_window_minutes": 20, "post_grace_tolerance_minutes": 5}},
            format="json",
            **self.headers,
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(SystemSettings.get_solo().grace_window_minutes, 20)

    def test_employee_is_denied_attendance_policy_updates(self):
        self.client.force_authenticate(self.employee)
        response = self.client.put(
            "/settings/",
            {"attendance": {"grace_window_minutes": 20}},
            format="json",
            **self.headers,
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_hr_manager_cannot_update_unrelated_security_or_invite_settings(self):
        self.client.force_authenticate(self.hr)
        response = self.client.put(
            "/settings/",
            {
                "password_policy": {
                    "min_length": 8,
                    "require_upper": True,
                    "require_lower": True,
                    "require_number": True,
                    "require_special": False,
                },
                "session": {"timeout_minutes": 30},
                "invites": {"default_expiry_hours": 72},
                "security": {"max_login_attempts": 1},
            },
            format="json",
            **self.headers,
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_out_of_range_attendance_update_returns_flattened_field_errors(self):
        self.client.force_authenticate(self.hr)
        response = self.client.put(
            "/settings/",
            {"attendance": {"grace_window_minutes": 999}},
            format="json",
            **self.headers,
        )
        message = "Ensure this value is less than or equal to 240."
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(response.data["message"], message)
        self.assertEqual(response.data["errors"], [{"field": "attendance.grace_window_minutes", "message": message}])
        self.assertNotEqual(SystemSettings.get_solo().grace_window_minutes, 999)

    def test_mismatched_grace_alias_error_is_attributed_to_the_nested_field(self):
        self.client.force_authenticate(self.hr)
        response = self.client.put(
            "/settings/",
            {"attendance": {"grace_window_minutes": 15, "late_grace_minutes": 10}},
            format="json",
            **self.headers,
        )
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(
            response.data["errors"],
            [
                {
                    "field": "attendance.grace_window_minutes",
                    "message": "Must match late_grace_minutes when both fields are supplied.",
                }
            ],
        )

    def test_removed_work_week_and_grace_limit_settings_are_absent_from_the_response(self):
        """Both are fixed policy now: the late threshold is 3, the week is by nationality."""
        self.client.force_authenticate(self.hr)

        response = self.client.get("/settings/", **self.headers)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        attendance = response.data["data"]["attendance"]
        self.assertNotIn("grace_use_limit_per_month", attendance)
        self.assertNotIn("work_week_days", attendance)

    def test_removed_settings_are_ignored_rather_than_stored_when_a_client_still_sends_them(self):
        self.client.force_authenticate(self.hr)

        response = self.client.put(
            "/settings/",
            {
                "attendance": {
                    "grace_window_minutes": 15,
                    "grace_use_limit_per_month": 9,
                    "work_week_days": [0, 1, 2],
                }
            },
            format="json",
            **self.headers,
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertNotIn("grace_use_limit_per_month", response.data["data"]["attendance"])
        self.assertNotIn("work_week_days", response.data["data"]["attendance"])
        settings_obj = SystemSettings.get_solo()
        self.assertFalse(hasattr(settings_obj, "grace_use_limit_per_month"))
        self.assertFalse(hasattr(settings_obj, "work_week_days"))

    def test_policy_is_global_even_when_an_active_company_header_is_present(self):
        self.client.force_authenticate(self.hr)
        response = self.client.put(
            "/settings/",
            {"attendance": {"grace_window_minutes": 19}},
            format="json",
            **self.headers,
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(SystemSettings.objects.count(), 1)
        self.assertEqual(SystemSettings.get_solo().grace_window_minutes, 19)
