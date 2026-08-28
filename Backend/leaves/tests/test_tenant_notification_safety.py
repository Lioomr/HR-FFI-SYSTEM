from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase
from django.utils import timezone

from employees.models import EmployeeProfile
from leaves.tasks import _hr_users_for_company, send_annual_leave_year_end_notifications
from organization.models import OrganizationNode, UserOrganizationAccess

User = get_user_model()


class TenantNotificationSafetyTests(TestCase):
    def setUp(self):
        hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.company_a = OrganizationNode.objects.create(
            code="TASK_SCOPE_A",
            name="Task Scope A",
            node_type=OrganizationNode.NodeType.COMPANY,
        )
        self.company_b = OrganizationNode.objects.create(
            code="TASK_SCOPE_B",
            name="Task Scope B",
            node_type=OrganizationNode.NodeType.COMPANY,
        )
        self.hr_users = []
        for index, company in enumerate((self.company_a, self.company_b), start=1):
            user = User.objects.create_user(email=f"task-hr-{index}@scope.test", password="password")
            user.groups.add(hr_group)
            UserOrganizationAccess.objects.create(user=user, organization=company)
            EmployeeProfile.objects.create(user=user, company=company, employee_id=f"TASK-HR-{index}", full_name="Task HR")
            self.hr_users.append(user)

    def test_null_company_hr_lookup_fails_closed(self):
        self.assertFalse(_hr_users_for_company(None).exists())

    def test_company_hr_lookup_never_returns_cross_company_or_access_only_users(self):
        UserOrganizationAccess.objects.create(user=self.hr_users[1], organization=self.company_a)

        recipients = set(_hr_users_for_company(self.company_a))

        self.assertEqual(recipients, {self.hr_users[0]})

    @patch("leaves.tasks.dispatch_notification_channels")
    @patch("leaves.tasks.get_contract_year_cycle")
    @patch("leaves.tasks.EmployeeProfile.objects.filter")
    def test_invalid_active_null_company_profile_cannot_notify_any_hr_user(
        self,
        filter_profiles,
        get_cycle,
        dispatch,
    ):
        today = timezone.localdate()
        invalid_profile = SimpleNamespace(
            id=9001,
            company=None,
            company_id=None,
            full_name="Invalid Unassigned Profile",
            employee_id="INVALID-NULL-COMPANY",
        )
        filtered = MagicMock()
        filtered.select_related.return_value = [invalid_profile]
        filter_profiles.return_value = filtered
        get_cycle.side_effect = [
            (today - timedelta(days=360), today + timedelta(days=5)),
            (None, None),
        ]

        result = send_annual_leave_year_end_notifications()

        self.assertEqual(result, {"reminders_sent": 0, "decisions_sent": 0})
        dispatch.assert_not_called()
