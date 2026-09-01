from datetime import date, datetime, timedelta
from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from audit.models import AuditLog
from core.models import DelegationRule
from employees.models import EmployeeProfile
from hr_reference.models import Department, Position
from organization.models import OrganizationNode, UserOrganizationAccess

from .biotime_client import BioTimeClient
from .models import AttendanceRecord, BioTimeConfig, BioTimeDeviceEmployee, BioTimeEmployeeMap
from .services import SyncBioTimeService

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

        self.company = OrganizationNode.objects.create(
            code="ATTENDANCE_A",
            name="Attendance Company A",
            node_type=OrganizationNode.NodeType.COMPANY,
        )
        self.other_company = OrganizationNode.objects.create(
            code="ATTENDANCE_B",
            name="Attendance Company B",
            node_type=OrganizationNode.NodeType.COMPANY,
        )

        # HR User
        self.hr = User.objects.create_user(email="hr@ffi.com", password="password")
        self.hr.groups.add(self.hr_group)
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.company)
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.other_company)
        self.ceo_approver = User.objects.create_user(email="ceo-approver@ffi.com", password="password")
        self.ceo_approver.groups.add(self.ceo_group)

        self.ceo_dept = Department.objects.create(
            id=1,
            code="CEO",
            name="CEO Department",
            company=self.company,
        )
        self.base_dept = Department.objects.create(
            id=11,
            code="ENG",
            name="Engineering Department",
            company=self.company,
        )
        self.base_position = Position.objects.create(
            id=901,
            code="EMP",
            name="Employee",
            company=self.company,
        )
        self.other_dept = Department.objects.create(
            id=12,
            code="ENG-B",
            name="Other Engineering Department",
            company=self.other_company,
        )
        self.other_position = Position.objects.create(
            id=902,
            code="EMP-B",
            name="Other Employee",
            company=self.other_company,
        )
        self.hr_profile = EmployeeProfile.objects.create(
            user=self.hr,
            company=self.company,
            employee_id="EMP000",
            department="Human Resources",
            job_title="HR Manager",
            department_ref=self.base_dept,
            position_ref=self.base_position,
            hire_date=date.today(),
        )

        # Employee 1
        self.emp1 = User.objects.create_user(email="emp1@ffi.com", password="password")
        self.emp1.groups.add(self.employee_group)
        self.profile1 = EmployeeProfile.objects.create(
            user=self.emp1,
            company=self.company,
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
            company=self.other_company,
            employee_id="EMP002",
            department="Engineering",
            job_title="Software Engineer",
            department_ref=self.other_dept,
            position_ref=self.other_position,
            hire_date=date.today(),
        )
        self.ceo_profile = EmployeeProfile.objects.create(
            user=self.ceo_approver,
            company=self.company,
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
            company=self.company,
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
            company=self.company,
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
            company=self.company,
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
            company=self.company,
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
            company=self.company,
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
            company=self.company,
            employee_id="EMP009",
            department_ref=self.base_dept,
            position_ref=self.base_position,
            hire_date=date.today(),
        )
        self.delegate_user = User.objects.create_user(email="attendance-delegate@ffi.com", password="password")
        self.delegate_profile = EmployeeProfile.objects.create(
            user=self.delegate_user,
            company=self.company,
            employee_id="EMP010",
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

    def test_employee_check_in_with_inactive_manager_falls_back_to_hr(self):
        self.profile1.manager_profile = self.manager_profile
        self.profile1.save(update_fields=["manager_profile", "updated_at"])
        self.manager_profile.employment_status = EmployeeProfile.EmploymentStatus.SUSPENDED
        self.manager_profile.save(update_fields=["employment_status", "updated_at"])

        self.client.force_authenticate(user=self.emp1)
        response = self.client.post("/api/attendance/me/check-in/")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["data"]["status"], AttendanceRecord.Status.PENDING_HR)

    def test_employee_check_in_duplicate_fail(self):
        self.client.force_authenticate(user=self.emp1)
        self.client.post("/api/attendance/me/check-in/")  # First
        response = self.client.post("/api/attendance/me/check-in/")  # Duplicate
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            AttendanceRecord.objects.filter(employee_profile=self.profile1, date=timezone.localdate()).count(),
            1,
        )

    def test_employee_without_profile_gets_safe_not_found_errors(self):
        user = User.objects.create_user(email="attendance-no-profile@ffi.com", password="password")
        user.groups.add(self.employee_group)
        self.client.force_authenticate(user=user)

        check_in_response = self.client.post("/api/attendance/me/check-in/")
        check_out_response = self.client.post("/api/attendance/me/check-out/")

        self.assertEqual(check_in_response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(check_out_response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(check_in_response.data["message"], "Employee profile not found.")

    def test_employee_without_company_cannot_create_attendance(self):
        user = User.objects.create_user(email="attendance-no-company@ffi.com", password="password")
        user.groups.add(self.employee_group)
        profile = EmployeeProfile.objects.create(
            user=user,
            employee_id="EMP-NO-COMPANY",
            hire_date=date.today(),
            is_archived=True,
        )
        self.client.force_authenticate(user=user)

        response = self.client.post("/api/attendance/me/check-in/")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(AttendanceRecord.objects.filter(employee_profile=profile).exists())

    def test_unauthenticated_employee_endpoints_are_rejected(self):
        self.assertEqual(self.client.get("/api/attendance/me/").status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(self.client.post("/api/attendance/me/check-in/").status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(self.client.post("/api/attendance/me/check-out/").status_code, status.HTTP_401_UNAUTHORIZED)

    def test_cfo_cannot_use_employee_self_service(self):
        self.client.force_authenticate(user=self.cfo_user)

        self.assertEqual(self.client.get("/api/attendance/me/").status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.post("/api/attendance/me/check-in/").status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.post("/api/attendance/me/check-out/").status_code, status.HTTP_403_FORBIDDEN)

    def test_ceo_cannot_use_employee_self_service(self):
        self.client.force_authenticate(user=self.ceo_approver)

        self.assertEqual(self.client.get("/api/attendance/me/").status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.post("/api/attendance/me/check-in/").status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.client.post("/api/attendance/me/check-out/").status_code, status.HTTP_403_FORBIDDEN)

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

    def test_employee_check_out_duplicate_fail(self):
        self.client.force_authenticate(user=self.emp1)
        self.client.post("/api/attendance/me/check-in/")
        first_response = self.client.post("/api/attendance/me/check-out/")
        duplicate_response = self.client.post("/api/attendance/me/check-out/")

        self.assertEqual(first_response.status_code, status.HTTP_200_OK)
        self.assertEqual(duplicate_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(AuditLog.objects.filter(action="attendance.check_out").count(), 1)

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

    def test_hr_list_is_limited_to_active_company(self):
        own_company_record = AttendanceRecord.objects.create(
            employee_profile=self.profile1,
            date=timezone.localdate(),
            status=AttendanceRecord.Status.PRESENT,
        )
        other_company_record = AttendanceRecord.objects.create(
            employee_profile=self.profile2,
            date=timezone.localdate(),
            status=AttendanceRecord.Status.PRESENT,
        )
        self.client.force_authenticate(user=self.hr)

        response = self.client.get(
            "/api/attendance/",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        items = response.data["data"]["items"]
        self.assertEqual([item["id"] for item in items], [own_company_record.id])
        self.assertNotIn(other_company_record.id, [item["id"] for item in items])

    def test_hr_cannot_retrieve_or_override_other_active_company_record(self):
        other_company_record = AttendanceRecord.objects.create(
            employee_profile=self.profile2,
            date=timezone.localdate(),
            status=AttendanceRecord.Status.ABSENT,
        )
        self.client.force_authenticate(user=self.hr)

        retrieve_response = self.client.get(
            f"/api/attendance/{other_company_record.id}/",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )
        update_response = self.client.patch(
            f"/api/attendance/{other_company_record.id}/",
            {"status": AttendanceRecord.Status.PRESENT, "override_reason": "Correction"},
            format="json",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(retrieve_response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(update_response.status_code, status.HTTP_404_NOT_FOUND)
        other_company_record.refresh_from_db()
        self.assertEqual(other_company_record.status, AttendanceRecord.Status.ABSENT)

    def test_hr_self_service_rejects_active_company_mismatch(self):
        self.client.force_authenticate(user=self.hr)

        response = self.client.post(
            "/api/attendance/me/check-in/",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.other_company.id),
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(AttendanceRecord.objects.filter(employee_profile=self.hr_profile).exists())

    def test_direct_attendance_create_is_not_supported(self):
        self.client.force_authenticate(user=self.hr)

        response = self.client.post(
            "/api/attendance/",
            {"employee_profile": self.profile1.id},
            format="json",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

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
        approve_response = self.client.post(f"/api/ceo/attendance/{record_id}/approve/", {"notes": "Approved"})
        self.assertEqual(approve_response.status_code, status.HTTP_200_OK)
        self.assertEqual(approve_response.data["data"]["status"], "PRESENT")

    def test_delegated_ceo_can_approve_attendance(self):
        DelegationRule.objects.create(
            from_user=self.ceo_approver,
            to_user=self.delegate_user,
            start_at=timezone.now(),
            created_by=self.ceo_approver,
        )
        record = AttendanceRecord.objects.create(
            employee_profile=self.profile1,
            date=timezone.localdate(),
            status=AttendanceRecord.Status.PENDING_CEO,
        )

        self.client.force_authenticate(user=self.delegate_user)
        response = self.client.post(
            f"/api/ceo/attendance/{record.id}/approve/",
            {"notes": "Delegated CEO approval"},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["status"], AttendanceRecord.Status.PRESENT)

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

    def test_manager_cannot_access_direct_report_in_another_company(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            EmployeeProfile.objects.filter(pk=self.profile2.pk).update(
                manager_id=self.manager_user.id,
                manager_profile_id=self.manager_profile.id,
            )
        other_company_record = AttendanceRecord.objects.create(
            employee_profile=self.profile2,
            date=timezone.localdate(),
            status=AttendanceRecord.Status.PENDING_MANAGER,
        )
        self.client.force_authenticate(user=self.manager_user)

        list_response = self.client.get(
            "/api/manager/attendance/",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )
        approve_response = self.client.post(
            f"/api/manager/attendance/{other_company_record.id}/approve/",
            {"notes": "Should not apply"},
            format="json",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(list_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(approve_response.status_code, status.HTTP_403_FORBIDDEN)
        other_company_record.refresh_from_db()
        self.assertEqual(other_company_record.status, AttendanceRecord.Status.PENDING_MANAGER)

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


class BioTimeSyncTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(email="admin@ffi.com", password="password", is_staff=True)
        self.admin.groups.add(Group.objects.get_or_create(name="SystemAdmin")[0])
        self.company = OrganizationNode.objects.create(
            code="BIOTIME_A", name="BioTime Company A", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.other_company = OrganizationNode.objects.create(
            code="BIOTIME_B", name="BioTime Company B", node_type=OrganizationNode.NodeType.COMPANY
        )
        UserOrganizationAccess.objects.create(user=self.admin, organization=self.company)
        UserOrganizationAccess.objects.create(user=self.admin, organization=self.other_company)
        self.employee = User.objects.create_user(email="biotime-user@ffi.com", password="password")
        self.profile = EmployeeProfile.objects.create(
            user=self.employee,
            company=self.company,
            employee_id="EMP100",
            department="Operations",
            job_title="Operator",
            hire_date=date.today(),
        )
        self.config = BioTimeConfig.get_solo()
        self.config.server_ip = "192.168.1.10"
        self.config.server_port = "8090"
        self.config.username = "admin"
        self.config.password = "secret"
        self.config.is_active = True
        self.config.last_sync_time = None
        self.config.save()

    @patch("attendance.services.BioTimeClient")
    def test_sync_creates_attendance_record_for_mapped_employee(self, client_cls):
        BioTimeEmployeeMap.objects.create(employee_profile=self.profile, biotime_emp_code="100001")
        client = client_cls.return_value
        client.test_connection.return_value = True
        client.get_transactions.return_value = [
            {"emp_code": "100001", "punch_time": "2026-04-01 08:00:00", "is_attendance": 1},
            {"emp_code": "100001", "punch_time": "2026-04-01 17:30:00", "is_attendance": 1},
        ]

        successful, result = SyncBioTimeService.execute(days_back=3)

        self.assertTrue(successful)
        self.assertEqual(result["processed"], 1)
        self.assertEqual(result["created"], 1)
        record = AttendanceRecord.objects.get(employee_profile=self.profile, date=date(2026, 4, 1))
        self.assertEqual(record.source, AttendanceRecord.Source.SYSTEM)
        self.assertEqual(record.status, AttendanceRecord.Status.PENDING_HR)
        self.assertIsNotNone(record.check_in_at)
        self.assertIsNotNone(record.check_out_at)
        self.assertIsNotNone(BioTimeConfig.get_solo().last_sync_time)

    @patch("attendance.services.BioTimeClient")
    def test_sync_uses_last_sync_time_when_available(self, client_cls):
        BioTimeEmployeeMap.objects.create(employee_profile=self.profile, biotime_emp_code="100001")
        client = client_cls.return_value
        client.test_connection.return_value = True
        client.get_transactions.return_value = []
        last_sync = timezone.now() - timedelta(hours=2)
        self.config.last_sync_time = last_sync
        self.config.save(update_fields=["last_sync_time"])

        SyncBioTimeService.execute(days_back=30)

        client.get_transactions.assert_called_once()
        called_kwargs = client.get_transactions.call_args.kwargs
        self.assertEqual(called_kwargs["start_time"], last_sync.strftime("%Y-%m-%d 00:00:00"))

    @patch("attendance.services.BioTimeClient")
    def test_get_unmapped_users_returns_device_users_not_linked_locally(self, client_cls):
        BioTimeEmployeeMap.objects.create(employee_profile=self.profile, biotime_emp_code="100001")
        client = client_cls.return_value
        client.get_employees.return_value = [
            {"emp_code": "100001", "first_name": "Mapped", "last_name": "User", "dept_name": "Ops"},
            {"emp_code": "100002", "first_name": "New", "last_name": "Person", "dept_name": "Ops"},
        ]

        unmapped = SyncBioTimeService.get_unmapped_users()

        self.assertEqual(
            unmapped,
            [{"emp_code": "100002", "first_name": "New", "last_name": "Person", "department": "Ops"}],
        )

    def test_unmapped_users_are_available_from_an_active_company_for_all_company_admin(self):
        BioTimeDeviceEmployee.objects.create(
            emp_code="100002",
            first_name="New",
            last_name="Person",
            department="Operations",
        )
        self.client.force_authenticate(user=self.admin)

        response = self.client.get(
            "/api/biotime-mappings/unmapped/",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["count"], 1)
        self.assertEqual(response.data["data"]["items"][0]["emp_code"], "100002")

    def test_config_put_preserves_password_when_blank(self):
        self.client.force_authenticate(user=self.admin)

        response = self.client.put(
            "/api/biotime/config/",
            {
                "server_ip": "10.0.0.10",
                "server_port": "8090",
                "username": "updated-admin",
                "password": "",
                "is_active": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        config = BioTimeConfig.get_solo()
        self.assertEqual(config.server_ip, "10.0.0.10")
        self.assertEqual(config.username, "updated-admin")
        self.assertEqual(config.password, "secret")
        self.assertNotIn("password", response.data["data"])

    def test_biotime_client_uses_documented_token_authentication(self):
        client = BioTimeClient("10.0.0.1", "8090", "api-user", "api-password")
        response = Mock(status_code=200)
        response.json.return_value = {"token": "biotime-token"}
        client.session.post = Mock(return_value=response)

        self.assertTrue(client.authenticate())
        self.assertEqual(client.get_headers()["Authorization"], "Token biotime-token")
        client.session.post.assert_called_once_with(
            "http://10.0.0.1:8090/api-token-auth/",
            json={"username": "api-user", "password": "api-password"},
            timeout=10,
        )

    def test_sync_skips_unmapped_and_invalid_transactions(self):
        client = Mock()
        client.test_connection.return_value = True
        client.get_transactions.return_value = [
            {"emp_code": "UNKNOWN", "punch_time": "2026-04-02 08:00:00", "is_attendance": 1},
            {"emp_code": "100001", "punch_time": "not-a-date", "is_attendance": 1},
        ]
        with patch("attendance.services.BioTimeClient", return_value=client):
            successful, result = SyncBioTimeService.execute(days_back=1)

        self.assertTrue(successful)
        self.assertEqual(result["unmapped"], 1)
        self.assertEqual(result["invalid"], 1)
        self.assertEqual(result["processed"], 0)

    @patch("attendance.services.BioTimeClient")
    def test_sync_preserves_manual_record_and_updates_system_bounds(self, client_cls):
        BioTimeEmployeeMap.objects.create(employee_profile=self.profile, biotime_emp_code="100001")
        manual = AttendanceRecord.objects.create(
            employee_profile=self.profile,
            date=date(2026, 4, 3),
            check_in_at=timezone.make_aware(datetime(2026, 4, 3, 9, 0)),
            source=AttendanceRecord.Source.HR,
            status=AttendanceRecord.Status.PRESENT,
        )
        system = AttendanceRecord.objects.create(
            employee_profile=self.profile,
            date=date(2026, 4, 4),
            check_in_at=timezone.make_aware(datetime(2026, 4, 4, 9, 0)),
            check_out_at=timezone.make_aware(datetime(2026, 4, 4, 17, 0)),
            source=AttendanceRecord.Source.SYSTEM,
            status=AttendanceRecord.Status.LATE,
        )
        client = client_cls.return_value
        client.test_connection.return_value = True
        client.get_transactions.return_value = [
            {"emp_code": "100001", "punch_time": "2026-04-03 08:00:00", "is_attendance": 1},
            {"emp_code": "100001", "punch_time": "2026-04-03 18:00:00", "is_attendance": 1},
            {"emp_code": "100001", "punch_time": "2026-04-04 08:00:00", "is_attendance": 1, "terminal_sn": "DEV-1"},
            {"emp_code": "100001", "punch_time": "2026-04-04 18:00:00", "is_attendance": 1, "terminal_sn": "DEV-1"},
        ]

        successful, result = SyncBioTimeService.execute(days_back=1)

        self.assertTrue(successful)
        self.assertEqual(result["updated"], 1)
        self.assertEqual(result["skipped"], 1)
        manual.refresh_from_db()
        system.refresh_from_db()
        self.assertEqual(manual.check_in_at, timezone.make_aware(datetime(2026, 4, 3, 9, 0)))
        self.assertEqual(system.check_in_at, timezone.make_aware(datetime(2026, 4, 4, 8, 0)))
        self.assertEqual(system.check_out_at, timezone.make_aware(datetime(2026, 4, 4, 18, 0)))
        self.assertEqual(system.status, AttendanceRecord.Status.PENDING_HR)
        self.assertEqual(system.biotime_emp_code, "100001")
        self.assertEqual(system.biotime_terminal_sn, "DEV-1")

    def test_mapping_api_enforces_active_company_and_duplicate_rules(self):
        second_user = User.objects.create_user(email="biotime-second@ffi.com", password="password")
        second_profile = EmployeeProfile.objects.create(
            user=second_user,
            company=self.company,
            employee_id="EMP101",
            department="Operations",
            job_title="Operator",
            hire_date=date.today(),
        )
        other_profile = EmployeeProfile.objects.create(
            employee_id="EMP102",
            company=self.other_company,
            department="Operations",
            job_title="Operator",
            hire_date=date.today(),
        )
        self.client.force_authenticate(user=self.admin)
        headers = {"HTTP_X_ACTIVE_COMPANY_ID": str(self.company.id)}

        created = self.client.post(
            "/api/biotime-mappings/",
            {"employee_profile": self.profile.id, "biotime_emp_code": "100001"},
            format="json",
            **headers,
        )
        duplicate_code = self.client.post(
            "/api/biotime-mappings/",
            {"employee_profile": second_profile.id, "biotime_emp_code": "100001"},
            format="json",
            **headers,
        )
        duplicate_employee = self.client.post(
            "/api/biotime-mappings/",
            {"employee_profile": self.profile.id, "biotime_emp_code": "100002"},
            format="json",
            **headers,
        )
        cross_company = self.client.post(
            "/api/biotime-mappings/",
            {"employee_profile": other_profile.id, "biotime_emp_code": "100003"},
            format="json",
            **headers,
        )
        listing = self.client.get("/api/biotime-mappings/", **headers)

        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        self.assertEqual(created.data["status"], "success")
        self.assertEqual(duplicate_code.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(duplicate_employee.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(cross_company.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(listing.data["data"]["count"], 1)
