from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from employees.models import EmployeeProfile
from organization.models import OrganizationNode, OrganizationScope, OrganizationScopeMembership, UserOrganizationAccess

User = get_user_model()


@override_settings(SECURE_SSL_REDIRECT=False, ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"])
class ScopedAuthorizationTests(APITestCase):
    def setUp(self):
        hr_group = Group.objects.create(name="HRManager")
        employee_group = Group.objects.create(name="Employee")
        self.company_a = OrganizationNode.objects.create(
            code="SCOPE-A", name="Scope Company A", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.company_b = OrganizationNode.objects.create(
            code="SCOPE-B", name="Scope Company B", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.hr = User.objects.create_user(email="scope-hr@example.com", password="StrongPass123!")
        self.hr.groups.add(hr_group)
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.company_a)

        self.employee_a = User.objects.create_user(email="scope-a@example.com", password="StrongPass123!")
        self.employee_a.groups.add(employee_group)
        self.profile_a = EmployeeProfile.objects.create(
            user=self.employee_a,
            company=self.company_a,
            employee_id="SCOPE-A-001",
            full_name="Scope Employee A",
        )
        self.employee_b = User.objects.create_user(email="scope-b@example.com", password="StrongPass123!")
        self.employee_b.groups.add(employee_group)
        self.profile_b = EmployeeProfile.objects.create(
            user=self.employee_b,
            company=self.company_b,
            employee_id="SCOPE-B-001",
            full_name="Scope Employee B",
        )
        self.scope = OrganizationScope.objects.create(code="SCOPE-AB", name="Both scope companies", created_by=self.hr)
        OrganizationScopeMembership.objects.create(scope=self.scope, company=self.company_a)
        OrganizationScopeMembership.objects.create(scope=self.scope, company=self.company_b)

    def test_scoped_hr_cannot_list_users_from_another_company(self):
        self.client.force_authenticate(self.hr)
        response = self.client.get("/users/")

        self.assertEqual(response.status_code, 200, response.data)
        returned_ids = {item["id"] for item in response.data["data"]["items"]}
        self.assertIn(self.hr.id, returned_ids)
        self.assertIn(self.employee_a.id, returned_ids)
        self.assertNotIn(self.employee_b.id, returned_ids)

    def test_scoped_hr_cannot_create_cross_company_delegation_outside_access(self):
        self.client.force_authenticate(self.hr)
        response = self.client.post(
            "/api/core/workflow/delegations/",
            {
                "from_user_id": self.employee_a.id,
                "to_user_id": self.employee_b.id,
                "start_at": timezone.now().isoformat(),
                "end_at": (timezone.now() + timedelta(days=1)).isoformat(),
                "scope_id": self.scope.id,
                "capabilities": ["workflow.approve"],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 422, response.data)

    def test_scoped_hr_cannot_create_cross_company_assignment_outside_access(self):
        self.client.force_authenticate(self.hr)
        response = self.client.post(
            "/api/core/cross-company-manager-assignments/",
            {
                "employee_id": self.profile_b.id,
                "manager_profile_id": self.profile_a.id,
                "scope_id": self.scope.id,
                "start_at": timezone.now().isoformat(),
                "end_at": (timezone.now() + timedelta(days=1)).isoformat(),
                "capabilities": ["employees.view"],
                "reason": "Temporary coverage",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 422, response.data)
