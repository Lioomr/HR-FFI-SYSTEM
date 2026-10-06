"""A manager sees every report, from any company, without an organization-scope selector."""

from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from core.models import CrossCompanyManagerAssignment
from employees.models import EmployeeProfile
from employees.services.manager_relationships import set_employee_manager
from organization.models import OrganizationNode, UserOrganizationAccess

User = get_user_model()

MANAGER_TEAM_FIELDS = {
    "id",
    "employee_id",
    "full_name",
    "full_name_en",
    "full_name_ar",
    "employee_number",
    "department",
    "department_id",
    "position",
    "position_id",
    "task_group",
    "task_group_id",
    "job_title",
    "employment_status",
    "manager_profile_id",
    "manager_profile_name",
}


@override_settings(SECURE_SSL_REDIRECT=False, ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"])
class ManagerTeamWithoutScopeTests(APITestCase):
    def setUp(self):
        self.company_a = OrganizationNode.objects.create(
            code="TEAM_A", name="Team Company A", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.company_b = OrganizationNode.objects.create(
            code="TEAM_B", name="Team Company B", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.hr = self._user("hr@team.test", self.company_a, "TEAM-HR")
        # The manager works for company B; one report is in company A.
        self.manager = self._user("manager@team.test", self.company_b, "TEAM-MGR", full_name="Mona Manager")
        self.cross_report = self._user("cross@team.test", self.company_a, "TEAM-CROSS", full_name="Cara Cross")
        self.direct_report = self._user(
            "direct@team.test", self.company_b, "TEAM-DIRECT", full_name="Dina Direct", manager=self.manager
        )
        self.no_login_report = EmployeeProfile.objects.create(
            company=self.company_a, employee_id="TEAM-NOLOGIN", full_name="Nour No Login"
        )
        self.assignment = set_employee_manager(
            self.profile(self.cross_report), self.profile(self.manager), actor=self.hr
        ).assignment
        set_employee_manager(self.no_login_report, self.profile(self.manager), actor=self.hr)

        self.other_manager = self._user("other-manager@team.test", self.company_b, "TEAM-OTHER-MGR")
        self._user("other-report@team.test", self.company_b, "TEAM-OTHER-REP", manager=self.other_manager)
        self.colleague = self._user("colleague@team.test", self.company_a, "TEAM-COLLEAGUE")

    def _user(self, email, company, employee_id, *, full_name=None, manager=None):
        user = User.objects.create_user(email=email, password="StrongPass123!", full_name=full_name or employee_id)
        EmployeeProfile.objects.create(
            user=user,
            company=company,
            employee_id=employee_id,
            full_name=full_name or employee_id,
            manager_profile=self.profile(manager) if manager else None,
            manager=manager,
            basic_salary=5000,
            mobile="0500000000",
        )
        UserOrganizationAccess.objects.get_or_create(user=user, organization=company)
        return user

    def profile(self, user):
        return EmployeeProfile.objects.get(user=user)

    def _as(self, user, company):
        self.client.force_authenticate(user=user)
        return {"HTTP_X_ACTIVE_COMPANY_ID": str(company.id)}

    def _team_ids(self, response):
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        return {item["id"] for item in response.data["data"]["results"]}

    def test_team_lists_every_report_without_a_scope_header_in_the_least_privilege_shape(self):
        headers = self._as(self.manager, self.company_b)
        expected = {self.profile(self.cross_report).id, self.profile(self.direct_report).id, self.no_login_report.id}

        for path in ("/api/employees/manager/team/", "/employees/manager/team/"):
            response = self.client.get(path, **headers)
            self.assertEqual(self._team_ids(response), expected)
            for item in response.data["data"]["results"]:
                self.assertEqual(set(item), MANAGER_TEAM_FIELDS)
        cross_item = next(
            item
            for item in self.client.get("/api/employees/manager/team/", **headers).data["data"]["results"]
            if item["id"] == self.profile(self.cross_report).id
        )
        self.assertEqual(cross_item["manager_profile_name"], "Mona Manager")
        self.assertNotIn("Team Company", str(cross_item))

    def test_team_search_and_pagination_are_unchanged(self):
        headers = self._as(self.manager, self.company_b)
        search = self.client.get("/api/employees/manager/team/?search=Cara", **headers)
        self.assertEqual(self._team_ids(search), {self.profile(self.cross_report).id})
        page = self.client.get("/api/employees/manager/team/?page_size=1", **headers)
        self.assertEqual(page.data["data"]["count"], 3)
        self.assertEqual(len(page.data["data"]["results"]), 1)

    def test_manager_access_counts_reports_from_every_company(self):
        response = self.client.get("/api/employees/manager/access/", **self._as(self.manager, self.company_b))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["managed_employee_count"], 3)
        self.assertEqual(response.data["data"]["source"], "direct_reports")
        self.assertTrue(response.data["data"]["has_access"])

        # A manager whose only report is in another company is still a direct manager.
        set_employee_manager(self.profile(self.direct_report), None, actor=self.hr)
        response = self.client.get("/api/employees/manager/access/", **self._as(self.manager, self.company_b))
        self.assertEqual(response.data["data"]["managed_employee_count"], 2)
        self.assertEqual(response.data["data"]["source"], "direct_reports")

    def test_detail_opens_a_cross_company_report_without_a_scope_header(self):
        headers = self._as(self.manager, self.company_b)
        cross = self.client.get(f"/api/employees/{self.profile(self.cross_report).id}/", **headers)
        self.assertEqual(cross.status_code, status.HTTP_200_OK, cross.data)
        self.assertEqual(set(cross.data["data"]), MANAGER_TEAM_FIELDS)

        no_login = self.client.get(f"/api/employees/{self.no_login_report.id}/", **headers)
        self.assertEqual(no_login.status_code, status.HTTP_200_OK)

        # Same-company reports keep the existing profile shape.
        direct = self.client.get(f"/api/employees/{self.profile(self.direct_report).id}/", **headers)
        self.assertEqual(direct.status_code, status.HTTP_200_OK)
        self.assertIn("mobile", direct.data["data"])

    def test_scope_header_path_still_works(self):
        # The documented scope selector (a selected member company would narrow it to that company).
        self.client.force_authenticate(user=self.manager)
        headers = {"HTTP_X_ORGANIZATION_SCOPE_ID": str(self.assignment.scope_id)}
        team = self.client.get("/api/employees/manager/team/", **headers)
        self.assertIn(self.profile(self.cross_report).id, self._team_ids(team))
        detail = self.client.get(f"/api/employees/{self.profile(self.cross_report).id}/", **headers)
        self.assertEqual(detail.status_code, status.HTTP_200_OK)
        self.assertEqual(set(detail.data["data"]), MANAGER_TEAM_FIELDS)

    def test_forged_company_selector_is_still_refused(self):
        self.client.force_authenticate(user=self.manager)
        response = self.client.get("/api/employees/manager/team/", HTTP_X_ACTIVE_COMPANY_ID=str(self.company_a.id))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_another_manager_of_the_same_company_sees_nothing_of_it(self):
        headers = self._as(self.other_manager, self.company_b)
        self.assertNotIn(
            self.profile(self.cross_report).id,
            self._team_ids(self.client.get("/api/employees/manager/team/", **headers)),
        )
        for profile_id in (self.profile(self.cross_report).id, self.profile(self.direct_report).id):
            response = self.client.get(f"/api/employees/{profile_id}/", **headers)
            self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_an_employee_of_the_reports_company_gains_nothing(self):
        headers = self._as(self.colleague, self.company_a)
        self.assertEqual(
            self.client.get("/api/employees/manager/team/", **headers).status_code, status.HTTP_403_FORBIDDEN
        )
        response = self.client.get(f"/api/employees/{self.profile(self.cross_report).id}/", **headers)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_revoked_manager_loses_the_report(self):
        set_employee_manager(self.profile(self.cross_report), None, actor=self.hr)
        headers = self._as(self.manager, self.company_b)
        self.assertNotIn(
            self.profile(self.cross_report).id,
            self._team_ids(self.client.get("/api/employees/manager/team/", **headers)),
        )
        response = self.client.get(f"/api/employees/{self.profile(self.cross_report).id}/", **headers)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_an_archived_report_disappears(self):
        EmployeeProfile.objects.filter(pk=self.profile(self.cross_report).pk).update(is_archived=True)
        headers = self._as(self.manager, self.company_b)
        self.assertNotIn(
            self.profile(self.cross_report).id,
            self._team_ids(self.client.get("/api/employees/manager/team/", **headers)),
        )
        response = self.client.get(f"/api/employees/{self.profile(self.cross_report).id}/", **headers)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_an_assignment_without_employee_view_grants_no_visibility(self):
        CrossCompanyManagerAssignment.objects.filter(pk=self.assignment.pk).update(
            capabilities=[
                value
                for value in CrossCompanyManagerAssignment.Capability.values
                if value != CrossCompanyManagerAssignment.Capability.EMPLOYEE_VIEW
            ]
        )
        headers = self._as(self.manager, self.company_b)
        self.assertNotIn(
            self.profile(self.cross_report).id,
            self._team_ids(self.client.get("/api/employees/manager/team/", **headers)),
        )
        response = self.client.get(f"/api/employees/{self.profile(self.cross_report).id}/", **headers)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_the_report_never_sees_the_managers_company(self):
        headers = self._as(self.cross_report, self.company_a)
        response = self.client.get(f"/api/employees/{self.profile(self.cross_report).id}/", **headers)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["manager_profile_name"], "Mona Manager")
        self.assertNotIn("Team Company B", str(response.data["data"]))
