from datetime import date, time

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import WorkflowInstance
from employees.models import EmployeeProfile
from hr_reference.models import Department, Position

from .models import AttendanceCorrectionRequest, AttendanceRecord

User = get_user_model()


class AttendanceCorrectionRequestTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.employee_group, _ = Group.objects.get_or_create(name="Employee")
        self.manager_group, _ = Group.objects.get_or_create(name="Manager")
        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")

        self.department = Department.objects.create(code="ENG", name="Engineering")
        self.position = Position.objects.create(code="DEV", name="Developer")

        self.hr_user = User.objects.create_user(email="hr-corrections@ffi.com", password="password")
        self.hr_user.groups.add(self.hr_group)
        self.manager_user = User.objects.create_user(email="manager-corrections@ffi.com", password="password")
        self.manager_user.groups.add(self.manager_group)
        self.employee_user = User.objects.create_user(email="employee-corrections@ffi.com", password="password")
        self.employee_user.groups.add(self.employee_group)
        self.no_manager_user = User.objects.create_user(email="no-manager-corrections@ffi.com", password="password")
        self.no_manager_user.groups.add(self.employee_group)

        self.manager_profile = EmployeeProfile.objects.create(
            user=self.manager_user,
            employee_id="MGR-CORR",
            department_ref=self.department,
            position_ref=self.position,
            hire_date=date.today(),
        )
        self.employee_profile = EmployeeProfile.objects.create(
            user=self.employee_user,
            employee_id="EMP-CORR",
            department_ref=self.department,
            position_ref=self.position,
            hire_date=date.today(),
            manager_profile=self.manager_profile,
        )
        self.no_manager_profile = EmployeeProfile.objects.create(
            user=self.no_manager_user,
            employee_id="EMP-NOMGR-CORR",
            department_ref=self.department,
            position_ref=self.position,
            hire_date=date.today(),
        )

    def test_employee_correction_flows_manager_to_hr_and_updates_record(self):
        work_date = date(2026, 5, 15)
        record = AttendanceRecord.objects.create(
            employee_profile=self.employee_profile,
            date=work_date,
            check_in_at=timezone.make_aware(timezone.datetime.combine(work_date, time(8, 0))),
            status=AttendanceRecord.Status.PRESENT,
        )
        corrected_checkout = timezone.make_aware(timezone.datetime.combine(work_date, time(17, 30)))

        self.client.force_authenticate(user=self.employee_user)
        create_response = self.client.post(
            "/api/attendance-correction-requests/",
            {
                "attendance_record": record.id,
                "date": str(work_date),
                "requested_check_out_at": corrected_checkout.isoformat(),
                "reason": "Forgot to check out.",
            },
            format="json",
        )

        self.assertEqual(create_response.status_code, 201)
        request_id = create_response.data["data"]["id"]
        submit_response = self.client.post(f"/api/attendance-correction-requests/{request_id}/submit/")
        self.assertEqual(submit_response.status_code, 200)
        self.assertEqual(submit_response.data["data"]["status"], AttendanceCorrectionRequest.Status.PENDING_MANAGER)

        self.client.force_authenticate(user=self.manager_user)
        manager_response = self.client.post(
            f"/api/attendance-correction-requests/{request_id}/approve/",
            {"notes": "Confirmed."},
            format="json",
        )
        self.assertEqual(manager_response.status_code, 200)
        self.assertEqual(manager_response.data["data"]["status"], AttendanceCorrectionRequest.Status.PENDING_HR)

        self.client.force_authenticate(user=self.hr_user)
        hr_response = self.client.post(
            f"/api/attendance-correction-requests/{request_id}/approve/",
            {"notes": "Applied."},
            format="json",
        )
        self.assertEqual(hr_response.status_code, 200)
        self.assertEqual(hr_response.data["data"]["status"], AttendanceCorrectionRequest.Status.APPROVED)

        record.refresh_from_db()
        self.assertEqual(record.check_out_at, corrected_checkout)
        self.assertTrue(record.is_overridden)
        self.assertTrue(
            WorkflowInstance.objects.filter(
                definition__key="attendance_correction_request",
                object_id=request_id,
            ).exists()
        )

    def test_employee_without_manager_submits_directly_to_hr_and_creates_record(self):
        work_date = date(2026, 5, 16)
        requested_check_in = timezone.make_aware(timezone.datetime.combine(work_date, time(9, 0)))

        self.client.force_authenticate(user=self.no_manager_user)
        create_response = self.client.post(
            "/api/attendance-correction-requests/",
            {
                "date": str(work_date),
                "requested_check_in_at": requested_check_in.isoformat(),
                "requested_status": AttendanceRecord.Status.PRESENT,
                "reason": "Missing attendance import.",
            },
            format="json",
        )
        self.assertEqual(create_response.status_code, 201)
        request_id = create_response.data["data"]["id"]

        submit_response = self.client.post(f"/api/attendance-correction-requests/{request_id}/submit/")
        self.assertEqual(submit_response.status_code, 200)
        self.assertEqual(submit_response.data["data"]["status"], AttendanceCorrectionRequest.Status.PENDING_HR)

        self.client.force_authenticate(user=self.hr_user)
        approve_response = self.client.post(f"/api/attendance-correction-requests/{request_id}/approve/")
        self.assertEqual(approve_response.status_code, 200)

        record = AttendanceRecord.objects.get(employee_profile=self.no_manager_profile, date=work_date)
        self.assertEqual(record.check_in_at, requested_check_in)
        self.assertEqual(record.status, AttendanceRecord.Status.PRESENT)
