from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework import status
from rest_framework.test import APITestCase

from employees.models import EmployeeProfile
from leaves.models import AnnualLeavePaymentRequest, LeaveRequest, LeaveType
from leaves.utils import (
    ANNUAL_LEAVE_SETTLEMENT_EXISTS_REASON,
    get_contract_year_cycle,
    has_pending_annual_leave,
)
from organization.models import OrganizationNode, UserOrganizationAccess

User = get_user_model()


class AnnualLeavePaymentFollowUpTests(APITestCase):
    def setUp(self):
        head_office = OrganizationNode.objects.create(
            code="HEAD_OFFICE_PAYMENT_FOLLOWUP",
            name="Payment Follow-up Head Office",
            node_type=OrganizationNode.NodeType.HEAD_OFFICE,
        )
        self.company = OrganizationNode.objects.create(
            code="PAYMENT_FOLLOWUP_COMPANY",
            name="Payment Follow-up Company",
            node_type=OrganizationNode.NodeType.COMPANY,
            parent=head_office,
        )
        self.employee = User.objects.create_user(email="payment-followup-employee@test.com", password="password")
        self.hr = User.objects.create_user(email="payment-followup-hr@test.com", password="password")
        self.system_admin = User.objects.create_user(email="payment-followup-admin@test.com", password="password")
        for user, role in (
            (self.employee, "Employee"),
            (self.hr, "HRManager"),
            (self.system_admin, "SystemAdmin"),
        ):
            group, _ = Group.objects.get_or_create(name=role)
            user.groups.add(group)
        UserOrganizationAccess.objects.create(user=self.employee, organization=self.company)
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.company)
        self.profile = EmployeeProfile.objects.create(
            user=self.employee,
            company=self.company,
            employee_id="EMP-PAYMENT-FOLLOWUP",
            full_name="Payment Follow-up Employee",
            contract_date=date.today() - timedelta(days=360),
            hire_date=date.today() - timedelta(days=360),
            total_salary=Decimal("3500.00"),
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        self.annual = LeaveType.objects.create(
            company=self.company,
            name="Annual Leave",
            code="ANNUAL",
            is_active=True,
        )
        self.headers = {"HTTP_X_ACTIVE_COMPANY_ID": str(self.company.id)}
        self.url = "/api/leaves/annual-leave-payments/"

    def _create_payment(self, *, status, profile=None, company=None, cycle_start=None, cycle_end=None):
        profile = profile or self.profile
        company = company or self.company
        cycle_start, cycle_end = (
            (cycle_start, cycle_end) if cycle_start is not None else get_contract_year_cycle(profile, date.today())
        )
        return AnnualLeavePaymentRequest.objects.create(
            employee=profile.user,
            employee_profile=profile,
            company=company,
            cycle_start=cycle_start,
            cycle_end=cycle_end,
            accrued_days=Decimal("21.00"),
            used_days=Decimal("0.00"),
            eligible_unused_days=Decimal("21.00"),
            salary_at_year_end=Decimal("3500.00"),
            payment_amount=Decimal("2450.00"),
            status=status,
        )

    @patch("leaves.views.notify_users_for_pending_status")
    def test_retrieve_uses_standard_success_envelope(self, notify):
        self.client.force_authenticate(self.employee)
        created = self.client.post(self.url, {}, format="json", **self.headers)
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)

        response = self.client.get(f"{self.url}{created.data['data']['id']}/", **self.headers)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "success")
        self.assertEqual(response.data["data"]["id"], created.data["data"]["id"])
        self.assertFalse(response.data["data"]["has_pending_annual_leave"])

    def test_employee_eligibility_preview_is_server_calculated(self):
        self.client.force_authenticate(self.employee)

        response = self.client.get(f"{self.url}eligibility/", **self.headers)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        payload = response.data["data"]
        self.assertTrue(payload["can_request"])
        self.assertTrue(payload["window_open"])
        self.assertEqual(payload["cycle_start"], str(self.profile.contract_date))
        # 360-day contract → today is 5 days before cycle end → 11 periods =19 eligible
        self.assertEqual(payload["eligible_unused_days"], "19.00")
        self.assertEqual(payload["salary_at_year_end"], "3500.00")
        self.assertEqual(payload["estimated_payment_amount"], "2216.67")
        self.assertFalse(payload["has_pending_annual_leave"])

    def test_active_settlement_statuses_block_eligibility(self):
        self.client.force_authenticate(self.employee)

        for payment_status in (
            AnnualLeavePaymentRequest.Status.PENDING_HR,
            AnnualLeavePaymentRequest.Status.PENDING_CEO,
            AnnualLeavePaymentRequest.Status.APPROVED,
            AnnualLeavePaymentRequest.Status.CARRIED_FORWARD,
        ):
            with self.subTest(payment_status=payment_status):
                payment = self._create_payment(status=payment_status)

                response = self.client.get(f"{self.url}eligibility/", **self.headers)

                self.assertEqual(response.status_code, status.HTTP_200_OK)
                self.assertFalse(response.data["data"]["can_request"])
                self.assertEqual(response.data["data"]["reason"], ANNUAL_LEAVE_SETTLEMENT_EXISTS_REASON)
                payment.delete()

    def test_rejected_settlement_does_not_block_eligibility(self):
        self._create_payment(status=AnnualLeavePaymentRequest.Status.REJECTED)
        self.client.force_authenticate(self.employee)

        response = self.client.get(f"{self.url}eligibility/", **self.headers)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["data"]["can_request"])
        self.assertEqual(response.data["data"]["reason"], "")

    def test_settlement_matching_respects_company_and_cycle(self):
        other_company = OrganizationNode.objects.create(
            code="PAYMENT_FOLLOWUP_OTHER_COMPANY",
            name="Payment Follow-up Other Company",
            node_type=OrganizationNode.NodeType.COMPANY,
            parent=self.company.parent,
        )
        other_user = User.objects.create_user(email="payment-followup-other@test.com", password="password")
        other_profile = EmployeeProfile.objects.create(
            user=other_user,
            company=other_company,
            employee_id="EMP-PAY-FOLLOW-OTH",
            contract_date=self.profile.contract_date,
            hire_date=self.profile.hire_date,
            total_salary=Decimal("3500.00"),
        )
        self._create_payment(
            status=AnnualLeavePaymentRequest.Status.PENDING_HR, profile=other_profile, company=other_company
        )
        _, current_end = get_contract_year_cycle(self.profile, date.today())
        future_start, future_end = get_contract_year_cycle(self.profile, current_end + timedelta(days=1))
        self._create_payment(
            status=AnnualLeavePaymentRequest.Status.PENDING_HR,
            cycle_start=future_start,
            cycle_end=future_end,
        )
        self.client.force_authenticate(self.employee)

        response = self.client.get(f"{self.url}eligibility/", **self.headers)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["data"]["can_request"])

    def test_create_validation_matches_eligibility_for_active_settlement(self):
        self._create_payment(status=AnnualLeavePaymentRequest.Status.PENDING_HR)
        self.client.force_authenticate(self.employee)

        eligibility = self.client.get(f"{self.url}eligibility/", **self.headers)
        create = self.client.post(self.url, {}, format="json", **self.headers)

        self.assertFalse(eligibility.data["data"]["can_request"])
        self.assertEqual(eligibility.data["data"]["reason"], ANNUAL_LEAVE_SETTLEMENT_EXISTS_REASON)
        self.assertEqual(create.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertTrue(
            any(ANNUAL_LEAVE_SETTLEMENT_EXISTS_REASON in error for error in create.data["errors"])
        )

    def test_pending_warning_uses_profile_identity_and_excludes_terminal_statuses(self):
        for terminal_status in (
            LeaveRequest.RequestStatus.REJECTED,
            LeaveRequest.RequestStatus.CANCELLED,
            LeaveRequest.RequestStatus.APPROVED,
        ):
            LeaveRequest.objects.create(
                employee=None,
                employee_profile=self.profile,
                company=self.company,
                leave_type=self.annual,
                start_date=date.today() + timedelta(days=10),
                end_date=date.today() + timedelta(days=10),
                status=terminal_status,
            )
        self.assertFalse(has_pending_annual_leave(self.profile, company=self.company))

        LeaveRequest.objects.create(
            employee=None,
            employee_profile=self.profile,
            company=self.company,
            leave_type=self.annual,
            start_date=date.today() + timedelta(days=11),
            end_date=date.today() + timedelta(days=11),
            status=LeaveRequest.RequestStatus.PENDING_HR,
        )

        self.assertTrue(has_pending_annual_leave(self.profile, company=self.company))

    def test_payment_detail_exposes_pending_warning(self):
        payment = AnnualLeavePaymentRequest.objects.create(
            employee=self.employee,
            employee_profile=self.profile,
            company=self.company,
            cycle_start=self.profile.contract_date,
            cycle_end=self.profile.contract_date + timedelta(days=359),
            accrued_days=Decimal("21.00"),
            used_days=Decimal("0.00"),
            eligible_unused_days=Decimal("21.00"),
            salary_at_year_end=Decimal("3500.00"),
            payment_amount=Decimal("2450.00"),
            status=AnnualLeavePaymentRequest.Status.PENDING_HR,
        )
        LeaveRequest.objects.create(
            employee=None,
            employee_profile=self.profile,
            company=self.company,
            leave_type=self.annual,
            start_date=date.today() + timedelta(days=12),
            end_date=date.today() + timedelta(days=12),
            status=LeaveRequest.RequestStatus.PENDING_HR,
        )

        self.client.force_authenticate(self.hr)
        response = self.client.get(f"{self.url}{payment.id}/", **self.headers)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["data"]["has_pending_annual_leave"])

    @patch("leaves.views.notify_users_for_pending_status")
    def test_system_admin_can_create_scoped_employee_payment_request(self, notify):
        self.client.force_authenticate(self.system_admin)

        response = self.client.post(
            self.url,
            {"employee_id": self.profile.id},
            format="json",
            **self.headers,
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        payment = AnnualLeavePaymentRequest.objects.get(pk=response.data["data"]["id"])
        self.assertEqual(payment.employee_profile_id, self.profile.id)
        self.assertEqual(payment.company_id, self.company.id)
