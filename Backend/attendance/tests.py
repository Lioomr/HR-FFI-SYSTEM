from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from audit.models import AuditLog
from employees.models import EmployeeProfile
from hr_reference.models import Department, Position

from .models import AttendanceRecord

User = get_user_model()


class AttendanceTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        # Groups
        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.employee_group, _ = Group.objects.get_or_create(name="Employee")
        self.admin_group, _ = Group.objects.get_or_create(name="SystemAdmin")
        self.ceo_group, _ = Group.objects.get_or_create(name="CEO")
        self.cfo_group, _ = Group.objects.get_or_create(name="CFO")

        # HR User
        self.hr = User.objects.create_user(email="hr@ffi.com", password="password")
        self.hr.groups.add(self.hr_group)
        self.ceo_approver = User.objects.create_user(email="ceo-approver@ffi.com", password="password")
        self.ceo_approver.groups.add(self.ceo_group)

        self.ceo_dept = Department.objects.create(id=1, code="CEO", name="CEO Department")
        self.base_dept = Department.objects.create(id=11, code="ENG", name="Engineering Department")
        self.base_position = Position.objects.create(id=901, code="EMP", name="Employee")

        # Employee 1
        self.emp1 = User.objects.create_user(email="emp1@ffi.com", password="password")
        self.emp1.groups.add(self.employee_group)
        self.profile1 = EmployeeProfile.objects.create(
            user=self.emp1,
            employee_id="EMP001",
            department="Engineering",
            job_title="Software Engineer",
            department_ref=self.base_dept,
            position_ref=self.base_position,
            hire_date=date.today(),
        )

        # Employee 2
        self.emp2 = User.objects.create_user(email="emp2@ffi.com", password="password")
        self.emp2.groups.add(self.employee_group)
        self.profile2 = EmployeeProfile.objects.create(
            user=self.emp2,
            employee_id="EMP002",
            department="Engineering",
            job_title="Software Engineer",
            department_ref=self.base_dept,
            position_ref=self.base_position,
            hire_date=date.today(),
        )
        self.ceo_profile = EmployeeProfile.objects.create(
            user=self.ceo_approver,
            employee_id="EMP003",
            department_ref=self.ceo_dept,
            position_ref=self.base_position,
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            hire_date=date.today(),
        )
        self.cfo_user = User.objects.create_user(email="cfo-manager@ffi.com", password="password")
        self.cfo_user.groups.add(self.cfo_group)
        self.cfo_profile = EmployeeProfile.objects.create(
            user=self.cfo_user,
            employee_id="EMP004",
            department_ref=self.base_dept,
            position_ref=self.base_position,
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            hire_date=date.today(),
        )
        self.ceo_direct_user = User.objects.create_user(email="ceo-direct@ffi.com", password="password")
        self.ceo_direct_user.groups.add(self.employee_group)
        self.ceo_direct_profile = EmployeeProfile.objects.create(
            user=self.ceo_direct_user,
            employee_id="EMP005",
            department_ref=self.base_dept,
            position_ref=self.base_position,
            hire_date=date.today(),
            manager_profile=self.ceo_profile,
        )
        self.cfo_direct_user = User.objects.create_user(email="cfo-direct@ffi.com", password="password")
        self.cfo_direct_user.groups.add(self.employee_group)
        self.cfo_direct_profile = EmployeeProfile.objects.create(
            user=self.cfo_direct_user,
            employee_id="EMP006",
            department_ref=self.base_dept,
            position_ref=self.base_position,
            hire_date=date.today(),
            manager_profile=self.cfo_profile,
        )
        self.employee_manager_user = User.objects.create_user(email="employee-manager@ffi.com", password="password")
        self.employee_manager_user.groups.add(self.employee_group)
        self.employee_manager_profile = EmployeeProfile.objects.create(
            user=self.employee_manager_user,
            employee_id="EMP007",
            department_ref=self.base_dept,
            position_ref=self.base_position,
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            hire_date=date.today(),
        )
        self.employee_manager_direct_user = User.objects.create_user(
            email="employee-manager-direct@ffi.com", password="password"
        )
        self.employee_manager_direct_user.groups.add(self.employee_group)
        self.employee_manager_direct_profile = EmployeeProfile.objects.create(
            user=self.employee_manager_direct_user,
            employee_id="EMP008",
            department_ref=self.base_dept,
            position_ref=self.base_position,
            hire_date=date.today(),
            manager_profile=self.employee_manager_profile,
        )
        self.manager_group, _ = Group.objects.get_or_create(name="Manager")
        self.manager_user = User.objects.create_user(email="manager-self@ffi.com", password="password")
        self.manager_user.groups.add(self.manager_group)
        self.manager_profile = EmployeeProfile.objects.create(
            user=self.manager_user,
            employee_id="EMP009",
            department_ref=self.base_dept,
            position_ref=self.base_position,
            hire_date=date.today(),
        )

    def test_employee_check_in_success(self):
        self.client.force_authenticate(user=self.emp1)
        response = self.client.post("/api/attendance/me/check-in/")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["data"]["status"], "PENDING_HR")
        self.assertTrue(
            AttendanceRecord.objects.filter(employee_profile=self.profile1, date=timezone.localdate()).exists()
        )
        # Audit
        self.assertTrue(AuditLog.objects.filter(action="attendance.check_in").exists())

    def test_employee_check_in_duplicate_fail(self):
        self.client.force_authenticate(user=self.emp1)
        self.client.post("/api/attendance/me/check-in/")  # First
        response = self.client.post("/api/attendance/me/check-in/")  # Duplicate
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_manager_can_use_attendance_self_service(self):
        self.client.force_authenticate(user=self.manager_user)
        create_response = self.client.post("/api/attendance/me/check-in/")
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)

        list_response = self.client.get("/api/attendance/me/")
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        data = list_response.data["data"]
        if isinstance(data, dict) and "data" in data:
            data = data["data"]
        items = (
            data["results"]
            if isinstance(data, dict) and "results" in data
            else data["items"]
            if isinstance(data, dict) and "items" in data
            else data
        )
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["employee_profile"], self.manager_profile.id)

    def test_employee_check_out_fail_no_check_in(self):
        self.client.force_authenticate(user=self.emp1)
        response = self.client.post("/api/attendance/me/check-out/")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_employee_check_out_success(self):
        self.client.force_authenticate(user=self.emp1)
        self.client.post("/api/attendance/me/check-in/")
        response = self.client.post("/api/attendance/me/check-out/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        record = AttendanceRecord.objects.get(employee_profile=self.profile1, date=timezone.localdate())
        self.assertIsNotNone(record.check_out_at)
        # Audit
        self.assertTrue(AuditLog.objects.filter(action="attendance.check_out").exists())

    def test_employee_cannot_list_all(self):
        self.client.force_authenticate(user=self.emp1)
        # Strict separation: Employee must get 403 on global list endpoint
        response = self.client.get("/api/attendance/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_employee_limit_scope(self):
        # Create records for emp1 and emp2
        date1 = timezone.localdate() - timedelta(days=1)
        AttendanceRecord.objects.create(employee_profile=self.profile1, date=date1, status="PRESENT")
        AttendanceRecord.objects.create(employee_profile=self.profile2, date=date1, status="PRESENT")

        self.client.force_authenticate(user=self.emp1)

        # Explicit date range
        date_from = (timezone.localdate() - timedelta(days=2)).isoformat()
        date_to = timezone.localdate().isoformat()
        response = self.client.get(f"/api/attendance/me/?date_from={date_from}&date_to={date_to}")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Normalized extraction
        # Normalized extraction with handling for double-wrapping and 'items' key
        data = response.data["data"]
        if isinstance(data, dict) and "data" in data:
            data = data["data"]  # Unwrap second layer

        results = (
            data["results"]
            if isinstance(data, dict) and "results" in data
            else data["items"]
            if isinstance(data, dict) and "items" in data
            else data
        )

        self.assertEqual(len(results), 1)

    def test_hr_list_filter(self):
        AttendanceRecord.objects.create(employee_profile=self.profile1, date=timezone.localdate(), status="PRESENT")
        self.client.force_authenticate(user=self.hr)

        # Filter by ID and Date
        date_from = (timezone.localdate() - timedelta(days=2)).isoformat()
        date_to = timezone.localdate().isoformat()
        response = self.client.get(
            f"/api/attendance/?employee_id={self.profile1.id}&date_from={date_from}&date_to={date_to}"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Normalized extraction
        # Normalized extraction with handling for double-wrapping and 'items' key
        data = response.data["data"]
        if isinstance(data, dict) and "data" in data:
            data = data["data"]  # Unwrap second layer

        results = (
            data["results"]
            if isinstance(data, dict) and "results" in data
            else data["items"]
            if isinstance(data, dict) and "items" in data
            else data
        )

        self.assertEqual(len(results), 1)

    def test_hr_override(self):
        record = AttendanceRecord.objects.create(
            employee_profile=self.profile1, date=timezone.localdate(), status="ABSENT"
        )
        self.client.force_authenticate(user=self.hr)

        data = {
            "status": "PRESENT",
            "notes": "Fixed",
            "override_reason": "Forgot to check in",  # Required for core field change
        }
        response = self.client.patch(f"/api/attendance/{record.id}/", data)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        record.refresh_from_db()
        self.assertTrue(record.is_overridden)
        self.assertEqual(record.source, "HR")
        self.assertEqual(record.updated_by, self.hr)
        # Audit
        self.assertTrue(AuditLog.objects.filter(action="attendance.override").exists())

    def test_employee_view_other_forbidden(self):
        record = AttendanceRecord.objects.create(
            employee_profile=self.profile2, date=timezone.localdate(), status="PRESENT"
        )
        self.client.force_authenticate(user=self.emp1)

        # Strict separation: Employee cannot access global retrieve endpoint
        response = self.client.get(f"/api/attendance/{record.id}/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_audit_logging_check(self):
        # Already covered in individual tests, but explicit check
        self.client.force_authenticate(user=self.emp1)
        self.client.post("/api/attendance/me/check-in/")
        self.assertTrue(AuditLog.objects.filter(action="attendance.check_in").exists())

    def test_hr_manager_check_in_goes_to_pending_ceo_and_ceo_can_approve(self):
        self.client.force_authenticate(user=self.hr)
        create_response = self.client.post("/api/attendance/me/check-in/")
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        record_id = create_response.data["data"]["id"]
        self.assertEqual(create_response.data["data"]["status"], "PENDING_CEO")

        self.client.force_authenticate(user=self.ceo_approver)
        approve_response = self.client.post(f"/api/attendance/ceo/attendance/{record_id}/approve/", {"notes": "Approved"})
        self.assertEqual(approve_response.status_code, status.HTTP_200_OK)
        self.assertEqual(approve_response.data["data"]["status"], "PRESENT")

    def test_ceo_manager_attendance_scope_is_direct_reports_only(self):
        own_record = AttendanceRecord.objects.create(
            employee_profile=self.ceo_direct_profile,
            date=timezone.localdate(),
            status=AttendanceRecord.Status.PENDING_MANAGER,
        )
        AttendanceRecord.objects.create(
            employee_profile=self.profile1,
            date=timezone.localdate() - timedelta(days=1),
            status=AttendanceRecord.Status.PENDING_MANAGER,
        )

        self.client.force_authenticate(user=self.ceo_approver)
        response = self.client.get("/api/manager/attendance/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        items = response.data["data"]["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["id"], own_record.id)

    def test_ceo_can_approve_direct_report_attendance(self):
        record = AttendanceRecord.objects.create(
            employee_profile=self.ceo_direct_profile,
            date=timezone.localdate(),
            status=AttendanceRecord.Status.PENDING_MANAGER,
        )

        self.client.force_authenticate(user=self.ceo_approver)
        response = self.client.post(f"/api/manager/attendance/{record.id}/approve/", {"notes": "Approved"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["status"], AttendanceRecord.Status.PENDING_HR)

    def test_cfo_can_approve_direct_report_attendance(self):
        record = AttendanceRecord.objects.create(
            employee_profile=self.cfo_direct_profile,
            date=timezone.localdate(),
            status=AttendanceRecord.Status.PENDING_MANAGER,
        )

        self.client.force_authenticate(user=self.cfo_user)
        response = self.client.post(f"/api/manager/attendance/{record.id}/approve/", {"notes": "Approved"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["status"], AttendanceRecord.Status.PENDING_HR)

    def test_employee_role_direct_manager_can_approve_attendance(self):
        record = AttendanceRecord.objects.create(
            employee_profile=self.employee_manager_direct_profile,
            date=timezone.localdate(),
            status=AttendanceRecord.Status.PENDING_MANAGER,
        )

        self.client.force_authenticate(user=self.employee_manager_user)
        response = self.client.post(f"/api/manager/attendance/{record.id}/approve/", {"notes": "Approved"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["status"], AttendanceRecord.Status.PENDING_HR)
