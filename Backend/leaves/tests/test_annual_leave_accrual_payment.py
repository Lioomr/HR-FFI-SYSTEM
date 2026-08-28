from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework import status
from rest_framework.test import APITestCase

from employees.models import EmployeeProfile
from leaves.models import AnnualLeavePaymentRequest, LeaveRequest, LeaveType
from leaves.utils import get_annual_accrual_details
from organization.models import OrganizationNode, UserOrganizationAccess

User = get_user_model()


class AnnualLeaveAccrualPaymentTests(APITestCase):
    def setUp(self):
        head_office = OrganizationNode.objects.create(
            code="HEAD_OFFICE_ANNUAL_PAYMENT",
            name="Annual Payment Head Office",
            node_type=OrganizationNode.NodeType.HEAD_OFFICE,
        )
        self.company = OrganizationNode.objects.create(
            code="ANNUAL_PAYMENT_COMPANY",
            name="Annual Payment Company",
            node_type=OrganizationNode.NodeType.COMPANY,
            parent=head_office,
        )
        self.employee = User.objects.create_user(email="annual.employee@test.com", password="password")
        self.hr = User.objects.create_user(email="annual.hr@test.com", password="password")
        self.ceo = User.objects.create_user(email="annual.ceo@test.com", password="password")
        for user, role in ((self.employee, "Employee"), (self.hr, "HRManager"), (self.ceo, "CEO")):
            group, _ = Group.objects.get_or_create(name=role)
            user.groups.add(group)
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.company)
        self.profile = EmployeeProfile.objects.create(
            user=self.employee,
            company=self.company,
            employee_id="EMP-ANNUAL-PAYMENT",
            full_name="Annual Payment Employee",
            contract_date=date.today() - timedelta(days=360),
            hire_date=date.today() - timedelta(days=360),
            total_salary=Decimal("3500.00"),
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        EmployeeProfile.objects.create(
            user=self.hr,
            company=self.company,
            employee_id="EMP-ANNUAL-HR",
            full_name="Annual Payment HR",
        )
        EmployeeProfile.objects.create(
            user=self.ceo,
            company=self.company,
            employee_id="EMP-ANNUAL-CEO",
            full_name="Annual Payment CEO",
        )
        self.annual = LeaveType.objects.create(
            company=self.company,
            name="Annual Leave",
            code="ANNUAL",
            is_active=True,
        )
        self.client.defaults["HTTP_X_ACTIVE_COMPANY_ID"] = str(self.company.id)

    def test_exact_30_day_periods_and_six_period_eligibility(self):
        # Calendar-month accrual: verify 5 months before 6th anniversary, 6 on/after.
        # Use deterministic contract 2023-01-01 to avoid month-length variability of
        # the relative 360-day contract used in setUp.
        from employees.models import EmployeeProfile

        cal_profile = EmployeeProfile(
            contract_date=date(2023, 1, 1), hire_date=date(2023, 1, 1)
        )
        details_before = get_annual_accrual_details(cal_profile, date(2023, 6, 30))
        details_after = get_annual_accrual_details(cal_profile, date(2023, 7, 1))

        self.assertEqual(details_before["completed_periods"], 5)
        self.assertEqual(details_before["accrued_days"], Decimal("8.75"))
        self.assertEqual(details_after["completed_periods"], 6)
        self.assertEqual(details_after["accrued_days"], Decimal("10.50"))

    def test_balance_exposes_whole_requestable_days_and_fraction(self):
        from leaves.utils import calculate_leave_balance

        # With calendar months, contract+210 days (≈6 months) yields 6 periods =10.5 days
        balances = calculate_leave_balance(self.employee, date.today().year, as_of=self.profile.contract_date + timedelta(days=210))
        annual = next(item for item in balances if item["leave_code"] == "ANNUAL")

        self.assertEqual(annual["total_days"], 10.5)
        self.assertEqual(annual["requestable_days"], 10.0)
        self.assertEqual(annual["fractional_days"], 0.5)

    def test_pending_annual_request_reserves_balance(self):
        # Keep both requests inside the same in-progress contract cycle. The
        # settlement workflow tests intentionally use the final five-day
        # window, but that would put these future requests in the next cycle.
        self.profile.contract_date = date.today() - timedelta(days=210)
        self.profile.hire_date = self.profile.contract_date
        self.profile.save(update_fields=["contract_date", "hire_date"])
        LeaveRequest.objects.create(
            employee=self.employee,
            employee_profile=self.profile,
            leave_type=self.annual,
            start_date=date.today() + timedelta(days=10),
            end_date=date.today() + timedelta(days=14),
            status=LeaveRequest.RequestStatus.PENDING_HR,
        )
        self.client.force_authenticate(self.employee)
        response = self.client.post(
            "/api/leaves/leave-requests/",
            {
                "leave_type": self.annual.id,
                "start_date": str(date.today() + timedelta(days=20)),
                "end_date": str(date.today() + timedelta(days=36)),
            },
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("Annual leave exceeds available balance", str(response.data))

    @patch("leaves.views.notify_users_for_pending_status")
    def test_payment_hr_review_and_ceo_approval_uses_year_end_salary(self, notify):
        self.client.force_authenticate(self.employee)
        response = self.client.post("/api/leaves/annual-leave-payments/", {})
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        payment_id = response.data["data"]["id"]
        # With calendar-month accrual and a 360-day contract, today is 5 days
        # before cycle end, so 11 periods =19.25 days → floor 19 eligible.
        # 19 * 3500 / 30 = 2216.67
        self.assertEqual(Decimal(str(response.data["data"]["payment_amount"])), Decimal("2216.67"))

        self.client.force_authenticate(self.hr)
        review = self.client.post(
            f"/api/leaves/annual-leave-payments/{payment_id}/review/",
            {"decision": "forward", "comment": "Reviewed by HR"},
        )
        self.assertEqual(review.status_code, status.HTTP_200_OK)
        self.assertEqual(review.data["data"]["status"], AnnualLeavePaymentRequest.Status.PENDING_CEO)

        self.client.force_authenticate(self.ceo)
        approved = self.client.post(
            f"/api/leaves/annual-leave-payments/{payment_id}/approve/",
            {"comment": "Approved"},
        )
        self.assertEqual(approved.status_code, status.HTTP_200_OK)
        self.assertEqual(approved.data["data"]["status"], AnnualLeavePaymentRequest.Status.APPROVED)

    @patch("leaves.views.notify_users_for_pending_status")
    def test_ceo_rejection_does_not_settle_balance(self, notify):
        self.client.force_authenticate(self.employee)
        payment = self.client.post("/api/leaves/annual-leave-payments/", {}).data["data"]
        self.client.force_authenticate(self.hr)
        self.client.post(
            f"/api/leaves/annual-leave-payments/{payment['id']}/review/",
            {"decision": "forward"},
        )
        self.client.force_authenticate(self.ceo)
        response = self.client.post(
            f"/api/leaves/annual-leave-payments/{payment['id']}/reject/",
            {"comment": "Balance remains available"},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["status"], AnnualLeavePaymentRequest.Status.REJECTED)
        self.assertIsNone(AnnualLeavePaymentRequest.objects.get(pk=payment["id"]).settled_at)

    @patch("leaves.views.notify_users_for_pending_status")
    def test_terminated_employee_before_six_months_can_be_paid_by_hr(self, notify):
        terminated_user = User.objects.create_user(email="terminated.annual@test.com", password="password")
        terminated = EmployeeProfile.objects.create(
            user=terminated_user,
            company=self.company,
            employee_id="EMP-ANNUAL-TERM",
            contract_date=date.today() - timedelta(days=100),
            hire_date=date.today() - timedelta(days=100),
            total_salary=Decimal("3000.00"),
            employment_status=EmployeeProfile.EmploymentStatus.TERMINATED,
        )
        self.client.force_authenticate(self.hr)
        response = self.client.post(
            "/api/leaves/annual-leave-payments/",
            {"employee_id": terminated.id, "termination_date": str(date.today())},
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["data"]["is_termination_settlement"], True)
        self.assertEqual(Decimal(str(response.data["data"]["eligible_unused_days"])), Decimal("5.00"))
