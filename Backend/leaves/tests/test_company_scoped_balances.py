from datetime import date

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework import status
from rest_framework.test import APITestCase

from employees.models import EmployeeProfile
from leaves.models import LeaveRequest, LeaveType
from organization.models import OrganizationNode, UserOrganizationAccess

User = get_user_model()


class CompanyScopedLeaveBalanceTests(APITestCase):
    def setUp(self):
        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.employee_group, _ = Group.objects.get_or_create(name="Employee")

        self.head_office = OrganizationNode.objects.create(
            code="HEAD_OFFICE_TEST",
            name="Head Office Test",
            node_type=OrganizationNode.NodeType.HEAD_OFFICE,
        )
        self.ffi = OrganizationNode.objects.create(
            code="FFI_TEST",
            name="FFI Test",
            node_type=OrganizationNode.NodeType.COMPANY,
            parent=self.head_office,
        )
        self.aseco = OrganizationNode.objects.create(
            code="ASECO_TEST",
            name="Aseco Test",
            node_type=OrganizationNode.NodeType.COMPANY,
            parent=self.head_office,
        )

        self.hr = User.objects.create_user(email="hr-scope@test.com", password="password")
        self.hr.groups.add(self.hr_group)
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.ffi)
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.aseco)

        self.employee = User.objects.create_user(email="employee-scope@test.com", password="password")
        self.employee.groups.add(self.employee_group)
        self.profile = EmployeeProfile.objects.create(
            user=self.employee,
            employee_id="EMP-SCOPE-001",
            hire_date=date(2020, 1, 1),
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            company=self.ffi,
        )

        self.ffi_annual = LeaveType.objects.create(company=self.ffi, name="Annual Leave", code="ANNUAL", is_active=True)
        LeaveType.objects.create(company=self.aseco, name="Annual Leave", code="ANNUAL", is_active=True)
        LeaveType.objects.create(company=self.ffi, name="Unpaid Leave", code="UNPAID", is_active=True, is_paid=False)
        LeaveType.objects.create(company=self.aseco, name="Unpaid Leave", code="UNPAID", is_active=True, is_paid=False)

        LeaveRequest.objects.create(
            employee=self.employee,
            employee_profile=self.profile,
            company=self.ffi,
            leave_type=self.ffi_annual,
            start_date=date(2026, 1, 10),
            end_date=date(2026, 1, 12),
            status=LeaveRequest.RequestStatus.APPROVED,
            decided_by=self.hr,
        )

    def test_hr_leave_list_scopes_balances_by_active_company(self):
        self.client.force_authenticate(user=self.hr)

        response = self.client.get(
            "/api/leaves/leave-requests/",
            {"page": 1, "page_size": 10},
            HTTP_X_ACTIVE_COMPANY_ID=str(self.ffi.id),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "success")
        self.assertEqual(response.data["data"]["count"], 1)
