"""Executives (CEO and General Manager) decide requests but are never a request's requester or subject."""

from datetime import date, timedelta
from decimal import Decimal

from assets.models import Asset, AssetAssignment, AssetDamageReport, AssetReturnRequest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.utils import timezone
from employees.models import EmployeeProfile
from employees.services import profile_change_requests
from leaves.models import AnnualLeavePaymentRequest, LeaveRequest, LeaveType
from leaves.services import apply_ceo_approval
from loans.models import LoanRequest
from organization.models import UserOrganizationAccess
from organization.services import get_default_company
from permission_requests import services as permission_services
from permission_requests.models import PermissionRequest
from rest_framework import status
from rest_framework.test import APITestCase

from core.executives import EXECUTIVE_REQUEST_ERROR, executive_profile_q, is_executive_profile, is_executive_user

User = get_user_model()


class ExecutiveExclusionTests(APITestCase):
    def setUp(self):
        self.company = get_default_company()
        self.annual = LeaveType.objects.create(
            company=self.company, name="Annual Leave", code="ANNUAL", annual_quota=21, is_active=True
        )
        # A CEO who is also a line manager: get_role() reports "Manager", so only the CEO group marks him.
        self.ceo = self._user("exec-ceo@example.com", "EXEC-CEO", groups=["CEO", "Manager"])
        self.ceo_profile = self.ceo.employee_profile
        self.gm_profile = EmployeeProfile.objects.create(
            company=self.company, employee_id="EXEC-GM", full_name="General Manager", job_title="  general MANAGER "
        )
        self.agm_profile = EmployeeProfile.objects.create(
            company=self.company, employee_id="EXEC-AGM", full_name="Assistant", job_title="Assistant General Manager"
        )
        self.hr = self._user("exec-hr@example.com", "EXEC-HR", groups=["HRManager"])
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.company)
        self.employee = self._user("exec-employee@example.com", "EXEC-EMP", groups=["Employee"])

    def _user(self, email, employee_id, *, groups=()):
        user = User.objects.create_user(email=email, password="password", full_name=employee_id)
        for name in groups:
            user.groups.add(Group.objects.get_or_create(name=name)[0])
        EmployeeProfile.objects.create(
            user=user,
            company=self.company,
            employee_id=employee_id,
            full_name=employee_id,
            job_title="Staff",
            hire_date=date(2020, 1, 1),
            contract_date=date(2020, 1, 1),
            basic_salary=Decimal("10000.00"),
        )
        return user

    def assert_refused(self, response, code=status.HTTP_403_FORBIDDEN):
        self.assertEqual(response.status_code, code, response.data)
        self.assertIn(EXECUTIVE_REQUEST_ERROR, str(response.data))

    def test_ceo_group_and_exact_gm_title_identify_executives(self):
        self.assertTrue(is_executive_user(self.ceo))
        self.assertTrue(is_executive_profile(self.ceo_profile))
        self.assertTrue(is_executive_profile(self.gm_profile))
        self.assertFalse(is_executive_profile(self.agm_profile))
        self.assertFalse(is_executive_user(self.hr))
        self.assertEqual(
            set(EmployeeProfile.objects.filter(executive_profile_q()).values_list("pk", flat=True)),
            {self.ceo_profile.pk, self.gm_profile.pk},
        )

    def test_ceo_cannot_submit_a_leave_request(self):
        self.client.force_authenticate(self.ceo)
        start = timezone.localdate() + timedelta(days=10)
        response = self.client.post(
            "/api/leaves/leave-requests/",
            {"leave_type": self.annual.id, "start_date": start, "end_date": start, "reason": "Rest"},
            format="json",
        )
        self.assert_refused(response)
        self.assertFalse(LeaveRequest.objects.exists())

    def test_hr_cannot_enter_a_manual_leave_for_an_executive(self):
        self.client.force_authenticate(self.hr)
        for profile in (self.ceo_profile, self.gm_profile):
            response = self.client.post(
                "/api/leaves/hr/manual-leave-requests/",
                {
                    "employee_id": profile.id,
                    "leave_type": self.annual.id,
                    "start_date": "2026-06-01",
                    "end_date": "2026-06-02",
                    "manual_entry_reason": "Paper form",
                    "source_document_ref": "paper-1",
                },
                format="json",
            )
            self.assert_refused(response, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertFalse(LeaveRequest.objects.exists())

    def test_annual_leave_settlement_is_refused_for_executives(self):
        self.client.force_authenticate(self.ceo)
        self.assert_refused(self.client.post("/api/leaves/annual-leave-payments/", {}, format="json"))
        self.client.force_authenticate(self.hr)
        response = self.client.post(
            "/api/leaves/annual-leave-payments/", {"employee_id": self.gm_profile.id}, format="json"
        )
        self.assert_refused(response, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertFalse(AnnualLeavePaymentRequest.objects.exists())

    def test_ceo_cannot_request_a_loan(self):
        self.client.force_authenticate(self.ceo)
        response = self.client.post("/api/loans/loan-requests/", {"amount": "100.00"}, format="json")
        self.assert_refused(response)
        self.assertFalse(LoanRequest.objects.exists())

    def test_ceo_cannot_submit_a_permission_request(self):
        with self.assertRaises(permission_services.PermissionRequestError) as refused:
            permission_services.submit_permission_request(user=self.ceo, profile=self.ceo_profile, data={})
        self.assertEqual(refused.exception.status, 403)
        self.assertEqual(refused.exception.message, EXECUTIVE_REQUEST_ERROR)
        self.assertFalse(PermissionRequest.objects.exists())

    def test_ceo_cannot_raise_asset_return_or_damage_requests(self):
        asset = Asset.objects.create(
            company=self.company,
            name_en="Exec Laptop",
            type=Asset.AssetType.OTHER,
            status=Asset.AssetStatus.ASSIGNED,
            flexible_attributes={"category": "laptop"},
        )
        AssetAssignment.objects.create(asset=asset, employee=self.ceo_profile, is_active=True)
        self.client.force_authenticate(self.ceo)
        self.assert_refused(self.client.post(f"/api/assets/{asset.id}/return-request/", {"note": "Done"}))
        self.assert_refused(self.client.post(f"/api/assets/{asset.id}/damage-report/", {"description": "Broken"}))
        self.assertFalse(AssetReturnRequest.objects.exists())
        self.assertFalse(AssetDamageReport.objects.exists())

    def test_ceo_cannot_request_a_profile_change(self):
        with self.assertRaises(profile_change_requests.ProfileChangeError) as refused:
            profile_change_requests.submit_change_request(
                user=self.ceo, profile=self.ceo_profile, items={"full_name": "New"}, attachment_ids=[]
            )
        self.assertEqual(refused.exception.status, 403)

    def test_request_pickers_can_leave_executives_out(self):
        self.client.force_authenticate(self.hr)
        response = self.client.get("/api/employees/", {"executives": "exclude", "page_size": 100})
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        listed = {row["employee_id"] for row in response.data["data"]["results"]}
        self.assertIn("EXEC-AGM", listed)
        self.assertIn("EXEC-EMP", listed)
        self.assertFalse({"EXEC-CEO", "EXEC-GM"} & listed)

        everyone = self.client.get("/api/employees/", {"page_size": 100})
        self.assertIn("EXEC-CEO", {row["employee_id"] for row in everyone.data["data"]["results"]})

    def test_ceo_still_approves_another_employees_leave(self):
        start = timezone.localdate() + timedelta(days=10)
        leave = LeaveRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee.employee_profile,
            company=self.company,
            leave_type=self.annual,
            start_date=start,
            end_date=start,
            status=LeaveRequest.RequestStatus.PENDING_CEO,
        )
        approver = self._user("exec-approver@example.com", "EXEC-CEO-APPROVER", groups=["CEO"])
        apply_ceo_approval(leave, actor=approver)
        leave.refresh_from_db()
        self.assertNotEqual(leave.status, LeaveRequest.RequestStatus.PENDING_CEO)
        self.assertEqual(leave.ceo_decision_by, approver)
