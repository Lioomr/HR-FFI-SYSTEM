import time

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.cache import cache
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from rest_framework import status
from rest_framework.test import APIClient, APIRequestFactory

from employees.models import EmployeeProfile
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

    def test_system_admin_can_assign_company_access_to_employee(self):
        self.client.force_authenticate(user=self.system_admin)
        response = self.client.post(
            "/users/",
            {
                "full_name": "Company Employee",
                "email": "company-employee@test.com",
                "role": "Employee",
                "is_active": True,
                "organization_ids": [self.company_b.id],
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        employee = User.objects.get(email="company-employee@test.com")
        self.assertEqual(
            set(UserOrganizationAccess.objects.filter(user=employee).values_list("organization_id", flat=True)),
            {self.company_b.id},
        )

    def test_explicit_company_access_is_used_for_non_hr_user(self):
        employee_group, _ = Group.objects.get_or_create(name="Employee")
        employee = User.objects.create_user(
            email="assigned-employee@test.com", password="password", full_name="Assigned Employee"
        )
        employee.groups.add(employee_group)
        UserOrganizationAccess.objects.create(user=employee, organization=self.company_b)

        self.client.force_authenticate(user=self.system_admin)
        response = self.client.get(f"/users/{employee.id}/")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual([org["id"] for org in response.data["data"]["accessible_organizations"]], [self.company_b.id])

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

    def test_link_candidates_are_fast_company_scoped_unlinked_accounts(self):
        candidate = User.objects.create_user(
            email="candidate@company-a.test", password="password", full_name="Company A Candidate"
        )
        UserOrganizationAccess.objects.create(user=candidate, organization=self.company_a)

        other_company_candidate = User.objects.create_user(
            email="candidate@company-b.test", password="password", full_name="Company B Candidate"
        )
        UserOrganizationAccess.objects.create(user=other_company_candidate, organization=self.company_b)

        linked_user = User.objects.create_user(
            email="already-linked@company-a.test", password="password", full_name="Already Linked"
        )
        UserOrganizationAccess.objects.create(user=linked_user, organization=self.company_a)
        EmployeeProfile.objects.create(
            user=linked_user,
            company=self.company_a,
            employee_id="COA-LINKED-USER",
            full_name="Already Linked",
        )

        self.client.force_authenticate(user=self.scoped_hr)
        response = self.client.get(
            "/users/link-candidates/?search=Candidate",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company_a.id),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["data"]["items"], [{"id": candidate.id, "full_name": candidate.full_name, "email": candidate.email}])

    def test_unlink_keeps_account_available_to_its_company(self):
        linked_user = User.objects.create_user(
            email="relink-me@company-a.test", password="password", full_name="Relink Me"
        )
        profile = EmployeeProfile.objects.create(
            user=linked_user,
            company=self.company_a,
            employee_id="COA-RELINK-ME",
            full_name="Relink Me",
        )

        self.client.force_authenticate(user=self.scoped_hr)
        response = self.client.patch(
            f"/api/employees/{profile.id}/",
            {"user_id": None},
            format="json",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company_a.id),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertTrue(
            UserOrganizationAccess.objects.filter(user=linked_user, organization=self.company_a).exists()
        )


class AdminSummaryViewCacheTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.system_admin_group = Group.objects.create(name="SystemAdmin")
        self.system_admin = User.objects.create_user(
            email="cache-sysadmin@test.com", password="password", full_name="Cache Sys Admin"
        )
        self.system_admin.groups.add(self.system_admin_group)
        self.client.force_authenticate(user=self.system_admin)

    def tearDown(self):
        cache.clear()

    def test_second_call_is_served_from_cache_without_hitting_the_db(self):
        with CaptureQueriesContext(connection) as first_ctx:
            first_response = self.client.get("/admin/summary/")
        self.assertEqual(first_response.status_code, status.HTTP_200_OK)
        self.assertGreater(len(first_ctx.captured_queries), 0)

        with CaptureQueriesContext(connection) as second_ctx:
            second_response = self.client.get("/admin/summary/")
        self.assertEqual(second_response.status_code, status.HTTP_200_OK)
        self.assertEqual(second_response.data["data"]["users"], first_response.data["data"]["users"])
        # Permission/role resolution still runs before the cache lookup, so a
        # hit isn't literally zero queries -- but it must skip the expensive
        # aggregation work entirely, so the count drops dramatically.
        self.assertLess(len(second_ctx.captured_queries), len(first_ctx.captured_queries) / 2)

    @override_settings(ADMIN_SUMMARY_CACHE_SECONDS=3)
    def test_cache_expires_after_ttl_and_reflects_new_data(self):
        first_response = self.client.get("/admin/summary/")
        first_total = first_response.data["data"]["users"]["total"]

        # A write that lands inside the TTL window should not be visible yet.
        User.objects.create_user(email="new-user-during-ttl@test.com", password="password")
        still_cached_response = self.client.get("/admin/summary/")
        self.assertEqual(still_cached_response.data["data"]["users"]["total"], first_total)

        time.sleep(3.5)

        fresh_response = self.client.get("/admin/summary/")
        self.assertEqual(fresh_response.data["data"]["users"]["total"], first_total + 1)
