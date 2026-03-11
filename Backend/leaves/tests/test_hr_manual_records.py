from datetime import date

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework import status
from rest_framework.test import APITestCase

from employees.models import EmployeeProfile
from leaves.models import LeaveRequest, LeaveType

User = get_user_model()


class HRManualLeaveRecordTests(APITestCase):
    def setUp(self):
        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.employee_group, _ = Group.objects.get_or_create(name="Employee")

        self.hr_user = User.objects.create_user(email="hr-manual@ffi.com", password="password", full_name="HR Manual")
        self.hr_user.groups.add(self.hr_group)

        self.manager_user = User.objects.create_user(email="manager-manual@ffi.com", password="password")
        self.manager_profile = EmployeeProfile.objects.create(
            user=self.manager_user,
            employee_id="EMP-MANAGER-MANUAL",
            full_name="Manager Manual",
            hire_date=date(2020, 1, 1),
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )

        self.employee_user = User.objects.create_user(email="employee-manual@ffi.com", password="password")
        self.employee_user.groups.add(self.employee_group)
        self.employee_profile = EmployeeProfile.objects.create(
            user=self.employee_user,
            employee_id="EMP-LEAVE-MANUAL",
            full_name="Employee Manual",
            hire_date=date(2021, 1, 1),
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            manager_profile=self.manager_profile,
            manager=self.manager_user,
        )

        self.annual = LeaveType.objects.create(name="Annual Leave", code="ANNUAL", is_active=True)
        self.sick = LeaveType.objects.create(name="Sick Leave", code="SICK", is_active=True)
        self.url = "/api/leaves/hr/manual-leave-requests/"

    def test_hr_can_create_manual_record_auto_approved_with_warning(self):
        self.client.force_authenticate(user=self.hr_user)
        payload = {
            "employee_id": self.employee_profile.id,
            "leave_type": self.annual.id,
            "start_date": "2026-06-01",
            "end_date": "2026-07-15",
            "reason": "Historical manual import",
            "manual_entry_reason": "Added by HR for pre-system leave.",
            "source_document_ref": "paper-file-2026-001",
        }
        response = self.client.post(self.url, payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["data"]["status"], LeaveRequest.RequestStatus.APPROVED)
        self.assertEqual(response.data["data"]["source"], LeaveRequest.RequestSource.HR_MANUAL)
        self.assertTrue(isinstance(response.data["data"].get("warning_messages", []), list))

    def test_manual_create_blocks_non_active_employee(self):
        self.employee_profile.employment_status = EmployeeProfile.EmploymentStatus.TERMINATED
        self.employee_profile.save(update_fields=["employment_status", "updated_at"])

        self.client.force_authenticate(user=self.hr_user)
        payload = {
            "employee_id": self.employee_profile.id,
            "leave_type": self.annual.id,
            "start_date": "2026-06-01",
            "end_date": "2026-06-05",
            "reason": "Should fail",
            "manual_entry_reason": "test",
            "source_document_ref": "ref-1",
        }
        response = self.client.post(self.url, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_sick_manual_requires_document(self):
        self.client.force_authenticate(user=self.hr_user)
        payload = {
            "employee_id": self.employee_profile.id,
            "leave_type": self.sick.id,
            "start_date": "2026-06-01",
            "end_date": "2026-06-03",
            "reason": "Sick historical",
            "manual_entry_reason": "Missing previous entry",
            "source_document_ref": "hospital-report-01",
        }
        response = self.client.post(self.url, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

        payload["document"] = SimpleUploadedFile("medical_report.pdf", b"pdf-content", content_type="application/pdf")
        response = self.client.post(self.url, payload, format="multipart")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_manual_create_allows_overlap_with_existing_leave(self):
        LeaveRequest.objects.create(
            employee=self.employee_user,
            leave_type=self.annual,
            start_date=date(2026, 6, 2),
            end_date=date(2026, 6, 4),
            reason="Existing leave",
            status=LeaveRequest.RequestStatus.APPROVED,
        )

        self.client.force_authenticate(user=self.hr_user)
        payload = {
            "employee_id": self.employee_profile.id,
            "leave_type": self.annual.id,
            "start_date": "2026-06-01",
            "end_date": "2026-06-05",
            "reason": "Historical overlap import",
            "manual_entry_reason": "Added manually despite overlap.",
            "source_document_ref": "overlap-ref-01",
        }
        response = self.client.post(self.url, payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["data"]["source"], LeaveRequest.RequestSource.HR_MANUAL)

    def test_hr_can_edit_and_soft_delete_manual_record(self):
        self.client.force_authenticate(user=self.hr_user)
        create_response = self.client.post(
            self.url,
            {
                "employee_id": self.employee_profile.id,
                "leave_type": self.annual.id,
                "start_date": "2026-08-01",
                "end_date": "2026-08-02",
                "reason": "Original",
                "manual_entry_reason": "legacy insert",
                "source_document_ref": "legacy-doc",
            },
            format="json",
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        record_id = create_response.data["data"]["id"]

        patch_response = self.client.patch(
            f"{self.url}{record_id}/",
            {
                "reason": "Updated reason",
                "manual_entry_reason": "updated justification",
                "source_document_ref": "legacy-doc-updated",
            },
            format="json",
        )
        self.assertEqual(patch_response.status_code, status.HTTP_200_OK)
        self.assertEqual(patch_response.data["data"]["reason"], "Updated reason")

        delete_response = self.client.delete(f"{self.url}{record_id}/")
        self.assertEqual(delete_response.status_code, status.HTTP_200_OK)

        record = LeaveRequest.objects.get(pk=record_id)
        self.assertFalse(record.is_active)
        self.assertIsNotNone(record.deleted_at)
        self.assertEqual(record.deleted_by_id, self.hr_user.id)
