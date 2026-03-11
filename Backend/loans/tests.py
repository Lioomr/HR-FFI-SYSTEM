from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework import status
from rest_framework.test import APITestCase

from employees.models import EmployeeProfile
from hr_reference.models import Department, Position
from loans.models import LoanRequest, LoanWorkflowConfig
from payroll.models import PayrollRun

User = get_user_model()


class LoanWorkflowTests(APITestCase):
    def setUp(self):
        self.system_admin_group, _ = Group.objects.get_or_create(name="SystemAdmin")
        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.manager_group, _ = Group.objects.get_or_create(name="Manager")
        self.employee_group, _ = Group.objects.get_or_create(name="Employee")
        self.cfo_group, _ = Group.objects.get_or_create(name="CFO")
        self.ceo_group, _ = Group.objects.get_or_create(name="CEO")

        self.finance_dept = Department.objects.create(id=8, code="ACCOUNTANT", name="Accounting Department")
        self.it_dept = Department.objects.create(id=4, code="IT", name="IT Department")
        self.ceo_dept = Department.objects.create(id=1, code="CEO", name="CEO Department")
        self.finance_position = Position.objects.create(id=24, code="ACCOUNTANT", name="Accountant")
        self.cfo_position = Position.objects.create(id=3, code="CFO", name="CFO")
        self.ceo_position = Position.objects.create(id=1, code="CEO", name="Chief Executive Officer")
        self.other_position = Position.objects.create(id=12, code="ENG", name="Engineer")

        LoanWorkflowConfig.objects.create(
            finance_department_id=8,
            finance_position_id=24,
            cfo_position_id=3,
            ceo_position_id=1,
            require_manager_stage=True,
            is_active=True,
        )

        self.manager = User.objects.create_user(email="manager@ffi.test", password="password")
        self.manager.groups.add(self.manager_group)
        self.manager_profile = EmployeeProfile.objects.create(
            user=self.manager,
            employee_id="EMP-MANAGER-1",
            full_name="Manager One",
            basic_salary=Decimal("10000.00"),
            department_ref=self.it_dept,
            position_ref=self.other_position,
            hire_date=date(2024, 1, 1),
        )

        self.employee = User.objects.create_user(email="employee@ffi.test", password="password")
        self.employee.groups.add(self.employee_group)
        self.employee_profile = EmployeeProfile.objects.create(
            user=self.employee,
            employee_id="EMP-EMP-1",
            full_name="Employee One",
            basic_salary=Decimal("5000.00"),
            department_ref=self.it_dept,
            position_ref=self.other_position,
            hire_date=date(2025, 1, 1),
            manager_profile=self.manager_profile,
        )

        self.hr_user = User.objects.create_user(email="hr@ffi.test", password="password")
        self.hr_user.groups.add(self.hr_group)
        self.hr_profile = EmployeeProfile.objects.create(
            user=self.hr_user,
            employee_id="EMP-HR-1",
            full_name="HR One",
            department_ref=self.it_dept,
            position_ref=self.other_position,
            hire_date=date(2024, 1, 1),
        )

        self.accountant = User.objects.create_user(email="accountant@ffi.test", password="password")
        self.accountant.groups.add(self.employee_group)
        self.accountant_profile = EmployeeProfile.objects.create(
            user=self.accountant,
            employee_id="EMP-ACC-1",
            full_name="Accountant One",
            department_ref=self.finance_dept,
            position_ref=self.finance_position,
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            basic_salary=Decimal("6000.00"),
            hire_date=date(2024, 1, 1),
        )

        self.cfo = User.objects.create_user(email="cfo@ffi.test", password="password")
        self.cfo.groups.add(self.cfo_group)
        self.cfo_profile = EmployeeProfile.objects.create(
            user=self.cfo,
            employee_id="EMP-CFO-1",
            full_name="CFO User",
            department_ref=self.finance_dept,
            position_ref=self.cfo_position,
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            basic_salary=Decimal("12000.00"),
            hire_date=date(2024, 1, 1),
        )

        self.ceo = User.objects.create_user(email="ceo@ffi.test", password="password")
        self.ceo.groups.add(self.ceo_group)
        self.ceo_profile = EmployeeProfile.objects.create(
            user=self.ceo,
            employee_id="EMP-CEO-1",
            full_name="CEO User",
            department_ref=self.ceo_dept,
            position_ref=self.ceo_position,
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            basic_salary=Decimal("18000.00"),
            hire_date=date(2024, 1, 1),
        )

        self.loan_requests_url = "/api/loans/loan-requests/"
        self.manager_loan_requests_url = "/api/loans/manager/loan-requests/"
        self.cfo_loan_requests_url = "/api/loans/cfo/loan-requests/"
        self.ceo_loan_requests_url = "/api/loans/ceo/loan-requests/"
        self.disbursement_url = "/api/loans/disbursements/"

        self.ceo_direct_employee = User.objects.create_user(email="ceo-direct@ffi.test", password="password")
        self.ceo_direct_employee.groups.add(self.employee_group)
        self.ceo_direct_profile = EmployeeProfile.objects.create(
            user=self.ceo_direct_employee,
            employee_id="EMP-CEO-REPORT",
            full_name="CEO Direct Report",
            basic_salary=Decimal("4500.00"),
            department_ref=self.it_dept,
            position_ref=self.other_position,
            hire_date=date(2025, 1, 1),
            manager_profile=self.ceo_profile,
        )

        self.cfo_direct_employee = User.objects.create_user(email="cfo-direct@ffi.test", password="password")
        self.cfo_direct_employee.groups.add(self.employee_group)
        self.cfo_direct_profile = EmployeeProfile.objects.create(
            user=self.cfo_direct_employee,
            employee_id="EMP-CFO-REPORT",
            full_name="CFO Direct Report",
            basic_salary=Decimal("4300.00"),
            department_ref=self.finance_dept,
            position_ref=self.other_position,
            hire_date=date(2025, 1, 1),
            manager_profile=self.cfo_profile,
        )
        self.employee_manager = User.objects.create_user(email="employee-manager@ffi.test", password="password")
        self.employee_manager.groups.add(self.employee_group)
        self.employee_manager_profile = EmployeeProfile.objects.create(
            user=self.employee_manager,
            employee_id="EMP-EMP-MGR",
            full_name="Employee Manager",
            basic_salary=Decimal("5200.00"),
            department_ref=self.it_dept,
            position_ref=self.other_position,
            hire_date=date(2024, 1, 1),
        )
        self.employee_manager_direct_employee = User.objects.create_user(
            email="employee-manager-direct@ffi.test", password="password"
        )
        self.employee_manager_direct_employee.groups.add(self.employee_group)
        self.employee_manager_direct_profile = EmployeeProfile.objects.create(
            user=self.employee_manager_direct_employee,
            employee_id="EMP-EMP-REPORT",
            full_name="Employee Manager Report",
            basic_salary=Decimal("4100.00"),
            department_ref=self.it_dept,
            position_ref=self.other_position,
            hire_date=date(2025, 1, 1),
            manager_profile=self.employee_manager_profile,
        )

    def _create_pending_manager_request(self):
        return LoanRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee_profile,
            requested_amount=Decimal("1000.00"),
            status=LoanRequest.RequestStatus.PENDING_MANAGER,
        )

    def _create_pending_hr_request(self):
        return LoanRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee_profile,
            requested_amount=Decimal("1000.00"),
            status=LoanRequest.RequestStatus.PENDING_HR,
        )

    def _create_pending_cfo_request(self):
        return LoanRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee_profile,
            requested_amount=Decimal("1000.00"),
            status=LoanRequest.RequestStatus.PENDING_CFO,
        )

    def _create_pending_ceo_request(self):
        return LoanRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee_profile,
            requested_amount=Decimal("1000.00"),
            status=LoanRequest.RequestStatus.PENDING_CEO,
        )

    def _create_pending_disbursement_request(self):
        return LoanRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee_profile,
            requested_amount=Decimal("1000.00"),
            approved_amount=Decimal("1000.00"),
            status=LoanRequest.RequestStatus.PENDING_DISBURSEMENT,
        )

    def _create_pending_manager_request_for(self, employee, profile):
        return LoanRequest.objects.create(
            employee=employee,
            employee_profile=profile,
            requested_amount=Decimal("1000.00"),
            status=LoanRequest.RequestStatus.PENDING_MANAGER,
        )

    def test_employee_submission_with_manager_sets_pending_manager(self):
        self.client.force_authenticate(user=self.employee)
        response = self.client.post(self.loan_requests_url, {"amount": "1200", "reason": "Medical"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["data"]["status"], LoanRequest.RequestStatus.PENDING_MANAGER)

    def test_employee_submission_without_manager_sets_pending_hr(self):
        self.employee_profile.manager_profile = None
        self.employee_profile.manager = None
        self.employee_profile.save(update_fields=["manager_profile", "manager", "updated_at"])

        self.client.force_authenticate(user=self.employee)
        response = self.client.post(self.loan_requests_url, {"amount": "1200", "reason": "Medical"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["data"]["status"], LoanRequest.RequestStatus.PENDING_HR)

    def test_hr_manager_submission_sets_pending_ceo(self):
        self.client.force_authenticate(user=self.hr_user)
        response = self.client.post(self.loan_requests_url, {"amount": "800", "reason": "Travel"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["data"]["status"], LoanRequest.RequestStatus.PENDING_CEO)

    def test_manager_can_submit_and_view_own_employee_loan_requests(self):
        self.client.force_authenticate(user=self.manager)

        create_response = self.client.post(self.loan_requests_url, {"amount": "900", "reason": "Personal"}, format="json")
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)

        request_id = create_response.data["data"]["id"]
        list_response = self.client.get("/api/loans/employee/loan-requests/")
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(list_response.data["data"]["count"], 1)
        self.assertEqual(list_response.data["data"]["items"][0]["id"], request_id)

        detail_response = self.client.get(f"/api/loans/employee/loan-requests/{request_id}/")
        self.assertEqual(detail_response.status_code, status.HTTP_200_OK)
        self.assertEqual(detail_response.data["data"]["id"], request_id)

    def test_manager_cannot_view_other_employee_loan_request_via_employee_endpoint(self):
        request_obj = LoanRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee_profile,
            requested_amount=Decimal("1400.00"),
            status=LoanRequest.RequestStatus.PENDING_MANAGER,
        )

        self.client.force_authenticate(user=self.manager)
        response = self.client.get(f"/api/loans/employee/loan-requests/{request_obj.id}/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_manager_reject_forwards_to_hr_with_recommendation(self):
        request_obj = self._create_pending_manager_request()
        self.client.force_authenticate(user=self.manager)
        response = self.client.post(
            f"{self.manager_loan_requests_url}{request_obj.id}/reject/",
            {"comment": "Not recommended"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["status"], LoanRequest.RequestStatus.PENDING_HR)
        self.assertEqual(response.data["data"]["manager_recommendation"], LoanRequest.Recommendation.REJECT)

    def test_hr_reject_forwards_to_cfo_with_recommendation(self):
        request_obj = self._create_pending_hr_request()
        self.client.force_authenticate(user=self.hr_user)
        response = self.client.post(
            f"{self.loan_requests_url}{request_obj.id}/reject/",
            {"comment": "Policy concern"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["status"], LoanRequest.RequestStatus.PENDING_CFO)
        self.assertEqual(response.data["data"]["hr_recommendation"], LoanRequest.Recommendation.REJECT)

    def test_cfo_approve_moves_to_pending_disbursement(self):
        request_obj = self._create_pending_cfo_request()
        self.client.force_authenticate(user=self.cfo)
        response = self.client.post(
            f"{self.cfo_loan_requests_url}{request_obj.id}/approve/",
            {"comment": "Approved"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["status"], LoanRequest.RequestStatus.PENDING_DISBURSEMENT)
        today = date.today()
        self.assertEqual(response.data["data"]["approved_year"], today.year)
        self.assertEqual(response.data["data"]["approved_month"], today.month)
        self.assertEqual(response.data["data"]["target_deduction_year"], today.year)
        self.assertEqual(response.data["data"]["target_deduction_month"], today.month)

    def test_cfo_approve_sets_next_month_target_if_current_payroll_closed(self):
        today = date.today()
        PayrollRun.objects.create(year=today.year, month=today.month, status=PayrollRun.Status.COMPLETED)
        request_obj = self._create_pending_cfo_request()

        self.client.force_authenticate(user=self.cfo)
        response = self.client.post(
            f"{self.cfo_loan_requests_url}{request_obj.id}/approve/",
            {"comment": "Approved"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        if today.month == 12:
            expected_year, expected_month = today.year + 1, 1
        else:
            expected_year, expected_month = today.year, today.month + 1

        self.assertEqual(response.data["data"]["target_deduction_year"], expected_year)
        self.assertEqual(response.data["data"]["target_deduction_month"], expected_month)

    def test_cfo_can_refer_to_ceo(self):
        request_obj = self._create_pending_cfo_request()
        self.client.force_authenticate(user=self.cfo)
        response = self.client.post(
            f"{self.cfo_loan_requests_url}{request_obj.id}/refer-to-ceo/",
            {"comment": "Escalating"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["status"], LoanRequest.RequestStatus.PENDING_CEO)

    def test_ceo_reject_is_final(self):
        request_obj = self._create_pending_ceo_request()
        self.client.force_authenticate(user=self.ceo)
        response = self.client.post(
            f"{self.ceo_loan_requests_url}{request_obj.id}/reject/",
            {"comment": "Rejected"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["status"], LoanRequest.RequestStatus.REJECTED)

    def test_accountant_disbursement_flow(self):
        request_obj = self._create_pending_disbursement_request()
        self.client.force_authenticate(user=self.accountant)

        list_response = self.client.get(self.disbursement_url)
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)

        mark_response = self.client.post(
            f"{self.disbursement_url}{request_obj.id}/mark-disbursed/",
            {"comment": "Paid by transfer"},
            format="json",
        )
        self.assertEqual(mark_response.status_code, status.HTTP_200_OK)
        self.assertEqual(mark_response.data["data"]["status"], LoanRequest.RequestStatus.APPROVED)

    def test_accountant_cannot_access_hr_approval(self):
        request_obj = self._create_pending_hr_request()
        self.client.force_authenticate(user=self.accountant)
        response = self.client.post(
            f"{self.loan_requests_url}{request_obj.id}/approve/",
            {"comment": "No access"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_hr_cannot_access_disbursement_actions(self):
        request_obj = self._create_pending_disbursement_request()
        self.client.force_authenticate(user=self.hr_user)
        response = self.client.post(
            f"{self.disbursement_url}{request_obj.id}/mark-disbursed/",
            {"comment": "No access"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_legacy_pending_finance_compatible_with_hr_actions(self):
        request_obj = LoanRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee_profile,
            requested_amount=Decimal("1000.00"),
            status=LoanRequest.RequestStatus.PENDING_FINANCE,
        )
        self.client.force_authenticate(user=self.hr_user)
        response = self.client.post(
            f"{self.loan_requests_url}{request_obj.id}/approve/",
            {"comment": "Legacy approval"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["status"], LoanRequest.RequestStatus.PENDING_CFO)

    def test_ceo_manager_scope_is_direct_reports_only(self):
        direct_request = self._create_pending_manager_request_for(self.ceo_direct_employee, self.ceo_direct_profile)
        self._create_pending_manager_request()

        self.client.force_authenticate(user=self.ceo)
        response = self.client.get(self.manager_loan_requests_url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        items = response.data["data"]["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["id"], direct_request.id)

    def test_ceo_can_approve_direct_report_loan_from_manager_endpoint(self):
        request_obj = self._create_pending_manager_request_for(self.ceo_direct_employee, self.ceo_direct_profile)

        self.client.force_authenticate(user=self.ceo)
        response = self.client.post(
            f"{self.manager_loan_requests_url}{request_obj.id}/approve/",
            {"comment": "Approved"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["status"], LoanRequest.RequestStatus.PENDING_HR)

    def test_cfo_can_approve_direct_report_loan_from_manager_endpoint(self):
        request_obj = self._create_pending_manager_request_for(self.cfo_direct_employee, self.cfo_direct_profile)

        self.client.force_authenticate(user=self.cfo)
        response = self.client.post(
            f"{self.manager_loan_requests_url}{request_obj.id}/approve/",
            {"comment": "Approved"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["status"], LoanRequest.RequestStatus.PENDING_HR)

    def test_employee_role_direct_manager_can_approve_loan_from_manager_endpoint(self):
        request_obj = self._create_pending_manager_request_for(
            self.employee_manager_direct_employee, self.employee_manager_direct_profile
        )

        self.client.force_authenticate(user=self.employee_manager)
        response = self.client.post(
            f"{self.manager_loan_requests_url}{request_obj.id}/approve/",
            {"comment": "Approved"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["status"], LoanRequest.RequestStatus.PENDING_HR)

    def test_payroll_deducts_open_loan_when_target_month_is_due(self):
        from payroll.views import _generate_payroll_items

        run = PayrollRun.objects.create(year=2026, month=2)
        loan = LoanRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee_profile,
            requested_amount=Decimal("500.00"),
            approved_amount=Decimal("500.00"),
            status=LoanRequest.RequestStatus.APPROVED,
            target_deduction_year=2026,
            target_deduction_month=1,
        )
        _generate_payroll_items(run)
        loan.refresh_from_db()
        self.assertEqual(loan.status, LoanRequest.RequestStatus.DEDUCTED)
        self.assertEqual(loan.deduction_payroll_run_id, run.id)

    def test_payroll_does_not_deduct_open_loan_before_target_month(self):
        from payroll.views import _generate_payroll_items

        run = PayrollRun.objects.create(year=2026, month=2)
        loan = LoanRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee_profile,
            requested_amount=Decimal("500.00"),
            approved_amount=Decimal("500.00"),
            status=LoanRequest.RequestStatus.APPROVED,
            target_deduction_year=2026,
            target_deduction_month=3,
        )
        _generate_payroll_items(run)
        loan.refresh_from_db()
        self.assertEqual(loan.status, LoanRequest.RequestStatus.APPROVED)
        self.assertIsNone(loan.deduction_payroll_run_id)
