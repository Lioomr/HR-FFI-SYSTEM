from datetime import date
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework import status
from rest_framework.test import APITestCase

from audit.models import AuditLog
from employees.models import EmployeeDocument, EmployeeProfile
from leaves.models import LeaveRequest, LeaveType
from leaves.services import (
    NOT_AWAITING_HR_COMPLETION_MESSAGE,
    VISA_REQUIRED_MESSAGE,
    LeaveTransitionError,
    apply_hr_completion,
)
from organization.models import UserOrganizationAccess
from organization.services import get_default_company

User = get_user_model()

Status = LeaveRequest.RequestStatus
REQUESTS_URL = "/api/leaves/leave-requests/"


def _visa_upload(name="visa.pdf"):
    return SimpleUploadedFile(name, b"%PDF-1.4 completion test", content_type="application/pdf")


class HRCompletionTests(APITestCase):
    def setUp(self):
        self.company = get_default_company()
        self.leave_type, _ = LeaveType.objects.get_or_create(
            company=self.company, code="ANNUAL", defaults={"name": "Annual Leave", "is_active": True}
        )
        hr_group, _ = Group.objects.get_or_create(name="HRManager")

        self.traveller = self._user("completion-traveller@example.com", "EMP-CMP-1")
        self.saudi_traveller = self._user("completion-saudi@example.com", "EMP-CMP-2", is_saudi=True)
        self.hr_user = self._user("completion-hr@example.com", "EMP-CMP-HR")
        self.hr_user.groups.add(hr_group)
        UserOrganizationAccess.objects.create(user=self.hr_user, organization=self.company)

    def _user(self, email, employee_id, *, is_saudi=False):
        user = User.objects.create_user(email=email, password="password")
        EmployeeProfile.objects.create(
            user=user,
            company=self.company,
            employee_id=employee_id,
            department="Ops",
            job_title="Staff",
            hire_date=date(2021, 1, 1),
            is_saudi=is_saudi,
        )
        return user

    def _leave(self, *, employee=None, status=Status.PENDING_HR_COMPLETION):
        employee = employee or self.traveller
        return LeaveRequest.objects.create(
            employee=employee,
            employee_profile=employee.employee_profile,
            company=self.company,
            leave_type=self.leave_type,
            start_date=date(2027, 4, 1),
            end_date=date(2027, 4, 5),
            status=status,
            will_travel=True,
        )

    # --- service ---

    @patch("leaves.services.extract_visa_fields", return_value=["Visa duration not found."])
    def test_traveller_completion_stores_visa_and_approves(self, _extract):
        leave = self._leave()

        result = apply_hr_completion(leave, actor=self.hr_user, note="Visa checked", visa_file=_visa_upload())

        leave.refresh_from_db()
        self.assertEqual(leave.status, Status.APPROVED)
        self.assertEqual(leave.hr_completed_by, self.hr_user)
        self.assertIsNotNone(leave.hr_completed_at)
        self.assertEqual(leave.hr_completion_note, "Visa checked")
        self.assertEqual(result.from_status, Status.PENDING_HR_COMPLETION)
        self.assertIs(result.visa_required, True)
        self.assertEqual(result.extraction_warnings, ["Visa duration not found."])
        document = EmployeeDocument.objects.get(leave_request=leave)
        self.assertEqual(result.document, document)
        self.assertEqual(document.document_type, EmployeeDocument.DocumentType.VISA)
        self.assertEqual(document.uploaded_by, self.hr_user)
        self.assertTrue(
            AuditLog.objects.filter(action="employee_document_uploaded", entity_id=str(document.id)).exists()
        )

    def test_traveller_without_visa_is_refused(self):
        leave = self._leave()

        with self.assertRaisesMessage(LeaveTransitionError, VISA_REQUIRED_MESSAGE):
            apply_hr_completion(leave, actor=self.hr_user)

        leave.refresh_from_db()
        self.assertEqual(leave.status, Status.PENDING_HR_COMPLETION)
        self.assertFalse(EmployeeDocument.objects.filter(leave_request=leave).exists())

    def test_saudi_traveller_completes_without_visa(self):
        leave = self._leave(employee=self.saudi_traveller)

        result = apply_hr_completion(leave, actor=self.hr_user)

        leave.refresh_from_db()
        self.assertEqual(leave.status, Status.APPROVED)
        self.assertIs(result.visa_required, False)
        self.assertIsNone(result.document)

    def test_completion_refuses_request_not_awaiting_completion(self):
        for current in (Status.PENDING_CEO, Status.APPROVED):
            with self.subTest(status=current):
                leave = self._leave(status=current)
                with self.assertRaisesMessage(LeaveTransitionError, NOT_AWAITING_HR_COMPLETION_MESSAGE):
                    apply_hr_completion(leave, actor=self.hr_user, visa_file=_visa_upload())
                self.assertFalse(EmployeeDocument.objects.filter(leave_request=leave).exists())

    def test_failure_after_upload_deletes_stored_file_and_rolls_back(self):
        leave = self._leave()
        stored = {}

        def fail_extraction(document):
            stored["storage"], stored["name"] = document.file.storage, document.file.name
            raise RuntimeError("extraction unavailable")

        with (
            patch("leaves.services.extract_visa_fields", side_effect=fail_extraction),
            self.assertRaises(RuntimeError),
        ):
            apply_hr_completion(leave, actor=self.hr_user, visa_file=_visa_upload())

        self.assertFalse(stored["storage"].exists(stored["name"]))
        self.assertFalse(EmployeeDocument.objects.filter(leave_request=leave).exists())
        leave.refresh_from_db()
        self.assertEqual(leave.status, Status.PENDING_HR_COMPLETION)

    # --- API ---

    @patch("leaves.services.notify_leave_approved")
    @patch("leaves.services.extract_visa_fields", return_value=[])
    def test_complete_endpoint_returns_document_and_notifies_employee(self, _extract, notify_approved):
        leave = self._leave()
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.post(
            f"{REQUESTS_URL}{leave.id}/complete/",
            {"comment": "Done", "visa_document": _visa_upload()},
            format="multipart",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        document = EmployeeDocument.objects.get(leave_request=leave)
        self.assertEqual(response.data["data"]["status"], Status.APPROVED)
        self.assertEqual(response.data["data"]["completion_document_id"], document.id)
        self.assertEqual(response.data["data"]["extraction_warnings"], [])
        notify_approved.assert_called_once()
        audit_log = AuditLog.objects.filter(action="complete_hr", entity_id=str(leave.id)).last()
        self.assertIs(audit_log.metadata["visa_required"], True)
        self.assertEqual(audit_log.metadata["visa_document_id"], document.id)

    def test_state_error_is_reported_before_upload_validation(self):
        leave = self._leave(status=Status.APPROVED)
        self.client.force_authenticate(user=self.hr_user)
        not_a_pdf = SimpleUploadedFile("visa.png", b"\x89PNG\r\n", content_type="image/png")

        response = self.client.post(
            f"{REQUESTS_URL}{leave.id}/complete/", {"visa_document": not_a_pdf}, format="multipart"
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn(NOT_AWAITING_HR_COMPLETION_MESSAGE, str(response.data))

    def test_completion_notification_failure_does_not_undo_approval(self):
        leave = self._leave(employee=self.saudi_traveller)
        self.client.force_authenticate(user=self.hr_user)

        with (
            self.assertLogs("leaves.services", level="ERROR") as logs,
            patch("leaves.services.notify_leave_approved", side_effect=RuntimeError("provider down")),
        ):
            response = self.client.post(f"{REQUESTS_URL}{leave.id}/complete/", {"comment": "Done"}, format="multipart")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        leave.refresh_from_db()
        self.assertEqual(leave.status, Status.APPROVED)
        self.assertTrue(any("leave_completion_notification_failed" in line for line in logs.output))
