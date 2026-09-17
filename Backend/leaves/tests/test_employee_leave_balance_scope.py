from datetime import date

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework import status
from rest_framework.test import APITestCase

from employees.models import EmployeeProfile
from leaves.models import LeaveType
from organization.models import OrganizationNode, UserOrganizationAccess

User = get_user_model()


class EmployeeLeaveBalanceScopeTests(APITestCase):
    def setUp(self):
        self.employee_group, _ = Group.objects.get_or_create(name="Employee")

        self.head_office = OrganizationNode.objects.create(
            code="HEAD_OFFICE_EMP_TEST",
            name="Head Office Emp Test",
            node_type=OrganizationNode.NodeType.HEAD_OFFICE,
        )
        self.ffi = OrganizationNode.objects.create(
            code="FFI_EMP_TEST",
            name="FFI Emp Test",
            node_type=OrganizationNode.NodeType.COMPANY,
            parent=self.head_office,
        )
        self.aseco = OrganizationNode.objects.create(
            code="ASECO_EMP_TEST",
            name="Aseco Emp Test",
            node_type=OrganizationNode.NodeType.COMPANY,
            parent=self.head_office,
        )

        self.user = User.objects.create_user(email="employee-balance@test.com", password="password")
        self.user.groups.add(self.employee_group)
        UserOrganizationAccess.objects.create(user=self.user, organization=self.ffi)
        self.profile = EmployeeProfile.objects.create(
            user=self.user,
            employee_id="EMP-BAL-001",
            hire_date=date(2022, 1, 1),
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            company=self.ffi,
        )

        LeaveType.objects.create(company=self.ffi, name="Annual Leave", code="ANNUAL", is_active=True)
        LeaveType.objects.create(company=self.aseco, name="Annual Leave", code="ANNUAL", is_active=True)
        LeaveType.objects.create(company=self.ffi, name="Unpaid Leave", code="UNPAID", is_active=True, is_paid=False)
        LeaveType.objects.create(company=self.aseco, name="Unpaid Leave", code="UNPAID", is_active=True, is_paid=False)
        # PostgreSQL permits duplicate NULL values under a composite unique
        # constraint. These represent legacy global policy types that must not
        # prevent company-scoped balances from loading.
        LeaveType.objects.create(name="Legacy Annual Leave A", code="ANNUAL", is_active=True)
        LeaveType.objects.create(name="Legacy Annual Leave B", code="ANNUAL", is_active=True)

    def test_employee_balance_uses_active_company_scope(self):
        self.client.force_authenticate(user=self.user)

        response = self.client.get(
            "/api/leaves/employee/leave-balance/",
            {"year": 2026},
            HTTP_X_ACTIVE_COMPANY_ID=str(self.ffi.id),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "success")
        self.assertTrue(isinstance(response.data["data"], list))

    def test_employee_without_profile_gets_actionable_balance_error(self):
        user_without_profile = User.objects.create_user(email="no-profile@test.com", password="password")
        user_without_profile.groups.add(self.employee_group)
        UserOrganizationAccess.objects.create(user=user_without_profile, organization=self.ffi)
        self.client.force_authenticate(user=user_without_profile)

        response = self.client.get(
            "/api/leaves/employee/leave-balance/",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.ffi.id),
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(
            response.data["message"],
            "No employee profile is linked to your account in the selected company.",
        )
