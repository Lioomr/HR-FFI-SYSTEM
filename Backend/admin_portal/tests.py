from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient, APIRequestFactory

from organization.models import OrganizationNode, UserOrganizationAccess

from .serializers import CreateUserSerializer, UpdateUserOrganizationsSerializer

User = get_user_model()


class OrganizationAccessScopeTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.factory = APIRequestFactory()

        self.system_admin_group = Group.objects.create(name="SystemAdmin")
        self.hr_group = Group.objects.create(name="HRManager")

        self.company_a = OrganizationNode.objects.create(
            code="COA",
            name="Company A",
            node_type=OrganizationNode.NodeType.COMPANY,
            employee_id_prefix="COA",
        )
        self.company_b = OrganizationNode.objects.create(
            code="COB",
            name="Company B",
            node_type=OrganizationNode.NodeType.COMPANY,
            employee_id_prefix="COB",
        )

        self.system_admin = User.objects.create_user(
            email="sysadmin@test.com", password="password", full_name="Sys Admin"
        )
        self.system_admin.groups.add(self.system_admin_group)

        # Scoped HRManager: only has access to company_a, not company_b.
        self.scoped_hr = User.objects.create_user(
            email="scoped-hr@test.com", password="password", full_name="Scoped HR"
        )
        self.scoped_hr.groups.add(self.hr_group)
        UserOrganizationAccess.objects.create(user=self.scoped_hr, organization=self.company_a)

        # An existing HRManager account scoped to company_a, used as the PATCH target.
        self.target_hr = User.objects.create_user(
            email="target-hr@test.com", password="password", full_name="Target HR"
        )
        self.target_hr.groups.add(self.hr_group)
        UserOrganizationAccess.objects.create(user=self.target_hr, organization=self.company_a)

    def _request_for(self, user):
        request = self.factory.post("/")
        request.user = user
        return request

    def test_scoped_hr_manager_cannot_create_hr_manager_with_access_to_another_company(self):
        self.client.force_authenticate(user=self.scoped_hr)
        response = self.client.post(
            "/users/",
            {
                "full_name": "New HR",
                "email": "new-hr@test.com",
                "role": "HRManager",
                "is_active": True,
                "organization_ids": [self.company_b.id],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 422, response.data)
        self.assertFalse(User.objects.filter(email="new-hr@test.com").exists())

    def test_scoped_hr_manager_cannot_update_another_hr_managers_access_to_another_company(self):
        serializer = UpdateUserOrganizationsSerializer(
            data={"organization_ids": [self.company_b.id]},
            context={"request": self._request_for(self.scoped_hr)},
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn("organization_ids", serializer.errors)

        # The target account's access must be unchanged.
        self.assertEqual(
            set(UserOrganizationAccess.objects.filter(user=self.target_hr).values_list("organization_id", flat=True)),
            {self.company_a.id},
        )

    def test_system_admin_can_assign_any_active_company(self):
        self.client.force_authenticate(user=self.system_admin)
        response = self.client.post(
            "/users/",
            {
                "full_name": "Cross Company HR",
                "email": "cross-hr@test.com",
                "role": "HRManager",
                "is_active": True,
                "organization_ids": [self.company_a.id, self.company_b.id],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        new_user = User.objects.get(email="cross-hr@test.com")
        self.assertEqual(
            set(UserOrganizationAccess.objects.filter(user=new_user).values_list("organization_id", flat=True)),
            {self.company_a.id, self.company_b.id},
        )

    def test_valid_in_scope_assignment_still_succeeds(self):
        self.client.force_authenticate(user=self.scoped_hr)
        response = self.client.post(
            "/users/",
            {
                "full_name": "In Scope HR",
                "email": "in-scope-hr@test.com",
                "role": "HRManager",
                "is_active": True,
                "organization_ids": [self.company_a.id],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        new_user = User.objects.get(email="in-scope-hr@test.com")
        self.assertEqual(
            set(UserOrganizationAccess.objects.filter(user=new_user).values_list("organization_id", flat=True)),
            {self.company_a.id},
        )

    def test_create_user_serializer_context_carries_request_for_scope_check(self):
        # Direct serializer-level check that request context actually reaches the
        # validator (independent of the view wiring already covered above).
        serializer = CreateUserSerializer(
            data={
                "full_name": "Direct Check HR",
                "email": "direct-check-hr@test.com",
                "role": "HRManager",
                "is_active": True,
                "organization_ids": [self.company_b.id],
            },
            context={"request": self._request_for(self.scoped_hr)},
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn("organization_ids", serializer.errors)
