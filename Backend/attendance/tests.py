from datetime import date, timedelta
from django.test import TestCase
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework.test import APIClient
from rest_framework import status
from django.utils import timezone
from .models import AttendanceRecord
from audit.models import AuditLog
from employees.models import EmployeeProfile

User = get_user_model()

class AttendanceTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        
        # Groups
        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.employee_group, _ = Group.objects.get_or_create(name="Employee")
        self.admin_group, _ = Group.objects.get_or_create(name="SystemAdmin")

        # HR User
        self.hr = User.objects.create_user(email="hr@ffi.com", password="password")
        self.hr.groups.add(self.hr_group)

        # Employee 1
        self.emp1 = User.objects.create_user(email="emp1@ffi.com", password="password")
        self.emp1.groups.add(self.employee_group)
        self.profile1 = EmployeeProfile.objects.create(
            user=self.emp1, 
            employee_id="EMP001",
            department="Engineering",
            job_title="Software Engineer",
            hire_date=date.today()
        )

        # Employee 2
        self.emp2 = User.objects.create_user(email="emp2@ffi.com", password="password")
        self.emp2.groups.add(self.employee_group)
        self.profile2 = EmployeeProfile.objects.create(
            user=self.emp2, 
            employee_id="EMP002",
            department="Engineering",
            job_title="Software Engineer",
            hire_date=date.today()
        )

    def test_employee_check_in_success(self):
        self.client.force_authenticate(user=self.emp1)
        response = self.client.post("/api/attendance/me/check-in/")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["data"]["status"], "PRESENT")
        self.assertTrue(AttendanceRecord.objects.filter(employee_profile=self.profile1, date=timezone.localdate()).exists())
        # Audit
        self.assertTrue(AuditLog.objects.filter(action="attendance.check_in").exists())

    def test_employee_check_in_duplicate_fail(self):
        self.client.force_authenticate(user=self.emp1)
        self.client.post("/api/attendance/me/check-in/") # First
        response = self.client.post("/api/attendance/me/check-in/") # Duplicate
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

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
             data = data["data"] # Unwrap second layer
        
        results = data["results"] if isinstance(data, dict) and "results" in data else \
                  data["items"] if isinstance(data, dict) and "items" in data else data
                  
        self.assertEqual(len(results), 1)

    def test_hr_list_filter(self):
        AttendanceRecord.objects.create(employee_profile=self.profile1, date=timezone.localdate(), status="PRESENT")
        self.client.force_authenticate(user=self.hr)
        
        # Filter by ID and Date
        date_from = (timezone.localdate() - timedelta(days=2)).isoformat()
        date_to = timezone.localdate().isoformat()
        response = self.client.get(f"/api/attendance/?employee_id={self.profile1.id}&date_from={date_from}&date_to={date_to}")
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Normalized extraction
        # Normalized extraction with handling for double-wrapping and 'items' key
        data = response.data["data"]
        if isinstance(data, dict) and "data" in data:
             data = data["data"] # Unwrap second layer

        results = data["results"] if isinstance(data, dict) and "results" in data else \
                  data["items"] if isinstance(data, dict) and "items" in data else data
                  
        self.assertEqual(len(results), 1)

    def test_hr_override(self):
        record = AttendanceRecord.objects.create(employee_profile=self.profile1, date=timezone.localdate(), status="ABSENT")
        self.client.force_authenticate(user=self.hr)
        
        data = {
            "status": "PRESENT",
            "notes": "Fixed",
            "override_reason": "Forgot to check in" # Required for core field change
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
        record = AttendanceRecord.objects.create(employee_profile=self.profile2, date=timezone.localdate(), status="PRESENT")
        self.client.force_authenticate(user=self.emp1)
        
        # Strict separation: Employee cannot access global retrieve endpoint
        response = self.client.get(f"/api/attendance/{record.id}/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_audit_logging_check(self):
         # Already covered in individual tests, but explicit check
         self.client.force_authenticate(user=self.emp1)
         self.client.post("/api/attendance/me/check-in/")
         self.assertTrue(AuditLog.objects.filter(action="attendance.check_in").exists())
