from datetime import date
from io import StringIO

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from rest_framework.test import APITestCase

from employees.models import EmployeeIdAlias, EmployeeProfile
from leaves.models import LeaveRequest, LeaveType
from organization.models import UserOrganizationAccess
from organization.services import get_default_company


class LeavePublicReferenceTests(APITestCase):
    def setUp(self):
        self.company = get_default_company()
        self.leave_type = LeaveType.objects.create(company=self.company, code="ANNUAL", name="Annual Leave")
        self.employee = get_user_model().objects.create_user(email="leave-ref@example.com", password="password")
        self.profile = EmployeeProfile.objects.create(
            user=self.employee,
            company=self.company,
            employee_id="FFI-0001",
            department="Ops",
            job_title="Staff",
            hire_date=date(2021, 1, 1),
        )
        UserOrganizationAccess.objects.create(user=self.employee, organization=self.company)

    def create_leave(self):
        return LeaveRequest.objects.create(
            employee=self.employee,
            employee_profile=self.profile,
            company=self.company,
            leave_type=self.leave_type,
            start_date=date(2027, 1, 1),
            end_date=date(2027, 1, 2),
        )

    def test_new_requests_get_per_employee_references(self):
        first = self.create_leave()
        second = self.create_leave()

        self.assertEqual((first.reference_no, first.reference_sequence), ("LV-FFI-000101", 1))
        self.assertEqual((second.reference_no, second.reference_sequence), ("LV-FFI-000102", 2))

    def test_legacy_request_waits_for_renumber_then_backfills_once(self):
        EmployeeProfile.objects.filter(pk=self.profile.pk).update(employee_id="FFI-742032")
        self.profile.refresh_from_db()
        legacy = self.create_leave()
        self.assertIsNone(legacy.reference_no)

        EmployeeProfile.objects.filter(pk=self.profile.pk).update(employee_id="FFI-0001")
        preview = StringIO()
        call_command("backfill_leave_references", company_code=self.company.code, stdout=preview)
        legacy.refresh_from_db()
        self.assertIsNone(legacy.reference_no)
        self.assertIn("LV-FFI-000101", preview.getvalue())

        call_command("backfill_leave_references", company_code=self.company.code, apply=True, stdout=StringIO())
        legacy.refresh_from_db()
        self.assertEqual((legacy.reference_no, legacy.reference_sequence), ("LV-FFI-000101", 1))
        again = StringIO()
        call_command("backfill_leave_references", company_code=self.company.code, apply=True, stdout=again)
        self.assertIn("Applied 0 references", again.getvalue())

    def test_hr_can_search_by_old_employee_code_without_duplicate_requests(self):
        leave = self.create_leave()
        self.employee.groups.add(Group.objects.get_or_create(name="HRManager")[0])
        for old_code in ("FFI-742032", "FFI-742033"):
            EmployeeIdAlias.objects.create(
                company=self.company,
                employee_profile=self.profile,
                old_employee_id=old_code,
                new_employee_id=self.profile.employee_id,
            )

        self.client.force_authenticate(user=self.employee)
        response = self.client.get("/api/leaves/leave-requests/", {"search": "FFI-74203"})

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["data"]["count"], 1)
        self.assertEqual(response.data["data"]["items"][0]["id"], leave.id)
