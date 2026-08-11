from datetime import date

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework import status
from rest_framework.test import APITestCase

from employees.models import EmployeeProfile
from leaves.models import LeaveRequest, LeaveType
from organization.models import OrganizationNode

User = get_user_model()


class EmployeeSelfLeaveCompanyScopeTests(APITestCase):
    def setUp(self):
        employee_group, _ = Group.objects.get_or_create(name="Employee")
        self.company = OrganizationNode.objects.create(
            code="SELF_LEAVE_A", name="Self Leave A", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.other_company = OrganizationNode.objects.create(
            code="SELF_LEAVE_B", name="Self Leave B", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.user = User.objects.create_user(email="self-leave@test.com", password="password")
        self.user.groups.add(employee_group)
        self.other_user = User.objects.create_user(email="other-leave@test.com", password="password")
        self.other_user.groups.add(employee_group)
        EmployeeProfile.objects.create(
            user=self.user,
            company=self.company,
            employee_id="SELF-LEAVE-001",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        EmployeeProfile.objects.create(
            user=self.other_user,
            company=self.company,
            employee_id="SELF-LEAVE-002",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        self.leave_type = LeaveType.objects.create(company=self.company, name="Annual A", code="ANNUAL_A")
        self.other_leave_type = LeaveType.objects.create(company=self.other_company, name="Annual B", code="ANNUAL_B")
        self.own = self._leave(self.user, self.company, self.leave_type, date(2026, 8, 1))
        self.cross_company = self._leave(self.user, self.other_company, self.other_leave_type, date(2026, 9, 1))
        self.other_owner = self._leave(self.other_user, self.company, self.leave_type, date(2026, 10, 1))

    @staticmethod
    def _leave(user, company, leave_type, start):
        return LeaveRequest.objects.create(
            employee=user,
            company=company,
            leave_type=leave_type,
            start_date=start,
            end_date=start,
            reason="Scope test",
            is_active=True,
        )

    def test_list_and_detail_only_expose_owner_records_in_active_company(self):
        self.client.force_authenticate(self.user)

        list_response = self.client.get(
            "/api/leaves/employee/leave-requests/",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
            HTTP_X_EMPLOYEE_ID=str(self.other_user.id),
        )
        own_detail = self.client.get(
            f"/api/leaves/employee/leave-requests/{self.own.id}/",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )
        cross_company_detail = self.client.get(
            f"/api/leaves/employee/leave-requests/{self.cross_company.id}/",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )
        other_owner_detail = self.client.get(
            f"/api/leaves/employee/leave-requests/{self.other_owner.id}/",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual([item["id"] for item in list_response.data["data"]["items"]], [self.own.id])
        self.assertEqual(own_detail.status_code, status.HTTP_200_OK)
        self.assertEqual(cross_company_detail.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(other_owner_detail.status_code, status.HTTP_404_NOT_FOUND)

    def test_employee_id_query_override_is_rejected(self):
        self.client.force_authenticate(self.user)

        response = self.client.get(
            "/api/leaves/employee/leave-requests/",
            {"employee_id": self.other_user.id},
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
