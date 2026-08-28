from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import RequestFactory, TestCase
from rest_framework import status
from rest_framework.test import APIClient

from audit.models import AuditLog
from employees.models import EmployeeProfile
from organization.models import OrganizationNode

from .models import PayrollRun, Payslip
from .views import _export_payroll_run_response

User = get_user_model()


class EmployeePayslipSecurityTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        employee_group, _ = Group.objects.get_or_create(name="Employee")
        self.company = OrganizationNode.objects.create(
            code="PAYSLIP_SEC_A", name="Payslip Security A", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.other_company = OrganizationNode.objects.create(
            code="PAYSLIP_SEC_B", name="Payslip Security B", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.employee = User.objects.create_user(email="payslip-owner@test.com", password="password")
        self.employee.groups.add(employee_group)
        self.other_employee = User.objects.create_user(email="payslip-other@test.com", password="password")
        self.other_employee.groups.add(employee_group)
        EmployeeProfile.objects.create(
            user=self.employee,
            company=self.company,
            employee_id="PAY-A-001",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        EmployeeProfile.objects.create(
            user=self.other_employee,
            company=self.company,
            employee_id="PAY-A-002",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )

        self.completed_run = PayrollRun.objects.create(
            company=self.company, year=2026, month=1, status=PayrollRun.Status.COMPLETED
        )
        self.paid_run = PayrollRun.objects.create(
            company=self.company, year=2025, month=12, status=PayrollRun.Status.PAID
        )
        self.draft_run = PayrollRun.objects.create(
            company=self.company, year=2026, month=2, status=PayrollRun.Status.DRAFT
        )
        self.inactive_run = PayrollRun.objects.create(
            company=self.company, year=2026, month=3, status=PayrollRun.Status.PAID
        )
        self.foreign_run = PayrollRun.objects.create(
            company=self.other_company, year=2026, month=1, status=PayrollRun.Status.PAID
        )
        self.current = self._payslip(self.employee, self.completed_run, 2026, 1)
        self.previous = self._payslip(self.employee, self.paid_run, 2025, 12)
        self.draft = self._payslip(self.employee, self.draft_run, 2026, 2)
        self.inactive = self._payslip(self.employee, self.inactive_run, 2026, 3, is_active=False)
        self.foreign = self._payslip(self.employee, self.foreign_run, 2026, 1)
        self.other_owner = self._payslip(self.other_employee, self.completed_run, 2026, 1)

    @staticmethod
    def _payslip(employee, run, year, month, *, is_active=True):
        return Payslip.objects.create(
            employee=employee,
            payroll_run=run,
            year=year,
            month=month,
            basic_salary="1000.00",
            total_salary="1000.00",
            net_salary="900.00",
            is_active=is_active,
        )

    def test_list_is_owner_finalized_active_company_and_year_scoped(self):
        self.client.force_authenticate(self.employee)

        response = self.client.get(
            "/employee/payslips/",
            {"year": 2026},
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
            HTTP_X_EMPLOYEE_ID=str(self.other_employee.id),
            HTTP_X_USER_ID=str(self.other_employee.id),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([item["id"] for item in response.data["data"]["items"]], [self.current.id])
        self.assertTrue(
            AuditLog.objects.filter(action="payslip_list_viewed", actor=self.employee, entity="Payslip").exists()
        )

    def test_invalid_year_and_employee_query_override_are_rejected(self):
        self.client.force_authenticate(self.employee)

        invalid_year = self.client.get(
            "/employee/payslips/",
            {"year": "not-a-year"},
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )
        employee_override = self.client.get(
            "/employee/payslips/",
            {"employee_id": self.other_employee.id},
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(invalid_year.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(employee_override.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_detail_hides_other_owner_other_company_draft_and_inactive_records(self):
        self.client.force_authenticate(self.employee)

        own_response = self.client.get(
            f"/employee/payslips/{self.current.id}/",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )
        hidden_responses = [
            self.client.get(
                f"/employee/payslips/{payslip.id}/",
                HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
            )
            for payslip in [self.other_owner, self.foreign, self.draft, self.inactive]
        ]

        self.assertEqual(own_response.status_code, status.HTTP_200_OK)
        self.assertTrue(
            AuditLog.objects.filter(
                action="payslip_viewed", actor=self.employee, entity_id=str(self.current.id)
            ).exists()
        )
        self.assertTrue(all(response.status_code == status.HTTP_404_NOT_FOUND for response in hidden_responses))

    @patch("payroll.views._build_payslip_pdf", return_value=b"%PDF-1.4\nsecure")
    def test_download_forces_security_headers_and_audits_success(self, _build_pdf):
        self.client.force_authenticate(self.employee)

        response = self.client.get(
            f"/employee/payslips/{self.current.id}/download/",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )
        foreign_response = self.client.get(
            f"/employee/payslips/{self.foreign.id}/download/",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "application/octet-stream")
        self.assertEqual(response["Content-Disposition"], f'attachment; filename="payslip_{self.current.id}.pdf"')
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.assertEqual(response["Pragma"], "no-cache")
        self.assertTrue(
            AuditLog.objects.filter(
                action="payslip_downloaded", actor=self.employee, entity_id=str(self.current.id)
            ).exists()
        )
        self.assertEqual(foreign_response.status_code, status.HTTP_404_NOT_FOUND)

    @patch("payroll.views._build_payroll_report_pdf", return_value=b"%PDF-1.4\nsecure")
    def test_payroll_exports_force_sensitive_download_headers(self, _build_pdf):
        factory = RequestFactory()
        for export_format in ("csv", "xlsx", "pdf"):
            request = factory.get(
                f"/payroll-runs/{self.completed_run.id}/export/",
                {"file_format": export_format},
            )
            request.user = self.employee
            request.query_params = request.GET
            response = _export_payroll_run_response(request, self.completed_run)

            self.assertEqual(response["Content-Type"], "application/octet-stream")
            self.assertTrue(response["Content-Disposition"].startswith("attachment; filename=\""))
            self.assertEqual(response["X-Content-Type-Options"], "nosniff")
            self.assertEqual(response["Cache-Control"], "private, no-store")
