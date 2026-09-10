"""HR acknowledgement of EmployeeDocument OCR suggestions.

Review is deliberately an audit marker on the document. It must never turn OCR
output into approved employee-profile data.
"""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from audit.models import AuditLog
from organization.models import OrganizationNode, UserOrganizationAccess

from .models import EmployeeDocument, EmployeeProfile
from .serializers import EmployeeDocumentSerializer

User = get_user_model()


class EmployeeDocumentOcrReviewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        groups = {
            name: Group.objects.get_or_create(name=name)[0]
            for name in ("Employee", "HRManager", "SystemAdmin", "Manager")
        }
        self.company = OrganizationNode.objects.create(
            code="DOC_REVIEW_A", name="Document Review A", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.other_company = OrganizationNode.objects.create(
            code="DOC_REVIEW_B", name="Document Review B", node_type=OrganizationNode.NodeType.COMPANY
        )

        self.employee = User.objects.create_user(email="review-owner@test.com", password="password")
        self.employee.groups.add(groups["Employee"])
        self.manager = User.objects.create_user(email="review-manager@test.com", password="password")
        self.manager.groups.add(groups["Manager"])
        self.hr = User.objects.create_user(email="review-hr@test.com", password="password")
        self.hr.groups.add(groups["HRManager"])
        self.admin = User.objects.create_user(email="review-admin@test.com", password="password")
        self.admin.groups.add(groups["SystemAdmin"])
        self.foreign_hr = User.objects.create_user(email="review-foreign-hr@test.com", password="password")
        self.foreign_hr.groups.add(groups["HRManager"])
        for user, company in (
            (self.manager, self.company),
            (self.hr, self.company),
            (self.admin, self.company),
            (self.admin, self.other_company),
            (self.foreign_hr, self.other_company),
        ):
            UserOrganizationAccess.objects.create(user=user, organization=company)

        self.profile = EmployeeProfile.objects.create(
            user=self.employee,
            company=self.company,
            employee_id="DOC-REVIEW-A-001",
            full_name="Original Employee Name",
            passport_no="ORIGINAL-123",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        self.other_profile = EmployeeProfile.objects.create(
            company=self.other_company,
            employee_id="DOC-REVIEW-B-001",
            full_name="Foreign Employee",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )

    def tearDown(self):
        for document in EmployeeDocument.objects.exclude(file=""):
            document.file.delete(save=False)

    def _document(self, profile=None, **overrides):
        profile = profile or self.profile
        values = {
            "employee_profile": profile,
            "company": profile.company,
            "document_type": EmployeeDocument.DocumentType.PASSPORT,
            "file": SimpleUploadedFile("passport.pdf", b"%PDF-1.4\ncontent", content_type="application/pdf"),
            "original_filename": "passport.pdf",
            "uploaded_by": self.hr,
            "extraction_status": EmployeeDocument.ExtractionStatus.PARTIAL,
            "extraction_completed_at": timezone.now(),
            "extracted_fields": {"passport_number": "OCR-SUGGESTION-999", "full_name": "OCR Suggested Name"},
        }
        values.update(overrides)
        return EmployeeDocument.objects.create(**values)

    def _url(self, profile, document_id):
        return f"/api/employees/{profile.id}/documents/{document_id}/review/"

    def _review(self, user, profile, document_id, company=None):
        self.client.force_authenticate(user)
        return self.client.post(
            self._url(profile, document_id),
            HTTP_X_ACTIVE_COMPANY_ID=str((company or self.company).id),
        )

    def test_hr_review_is_audited_and_does_not_apply_ocr_values_to_employee_data(self):
        document = self._document()
        original_suggestions = document.extracted_fields.copy()
        original_profile = {
            "full_name": self.profile.full_name,
            "passport_no": self.profile.passport_no,
            "updated_at": self.profile.updated_at,
        }

        response = self._review(self.hr, self.profile, document.id)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["status"], "success")
        self.assertEqual(response.data["data"]["id"], document.id)
        self.assertIsNotNone(response.data["data"]["ocr_reviewed_at"])
        self.assertEqual(response.data["data"]["ocr_reviewed_by"], self.hr.id)
        document.refresh_from_db()
        self.profile.refresh_from_db()
        self.assertEqual(document.ocr_reviewed_by, self.hr)
        self.assertIsNotNone(document.ocr_reviewed_at)
        self.assertEqual(document.extracted_fields, original_suggestions)
        self.assertEqual(self.profile.full_name, original_profile["full_name"])
        self.assertEqual(self.profile.passport_no, original_profile["passport_no"])
        self.assertEqual(self.profile.updated_at, original_profile["updated_at"])

        entry = AuditLog.objects.get(action="employee_document_ocr_reviewed", entity_id=str(document.id))
        self.assertEqual(entry.actor, self.hr)
        self.assertEqual(entry.metadata["employee_profile_id"], self.profile.id)
        self.assertEqual(entry.metadata["company_id"], self.company.id)
        self.assertEqual(entry.metadata["extraction_status"], EmployeeDocument.ExtractionStatus.PARTIAL)
        self.assertNotIn("OCR-SUGGESTION-999", str(entry.metadata))

    def test_review_is_idempotent_and_writes_one_audit_event(self):
        document = self._document()

        first = self._review(self.hr, self.profile, document.id)
        document.refresh_from_db()
        reviewed_at = document.ocr_reviewed_at
        second = self._review(self.hr, self.profile, document.id)

        self.assertEqual(first.status_code, status.HTTP_200_OK, first.data)
        self.assertEqual(second.status_code, status.HTTP_200_OK, second.data)
        document.refresh_from_db()
        self.assertEqual(document.ocr_reviewed_at, reviewed_at)
        self.assertEqual(document.ocr_reviewed_by, self.hr)
        self.assertEqual(
            AuditLog.objects.filter(action="employee_document_ocr_reviewed", entity_id=str(document.id)).count(), 1
        )

    def test_system_admin_can_review_a_document_in_the_active_company(self):
        document = self._document()

        response = self._review(self.admin, self.profile, document.id)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        document.refresh_from_db()
        self.assertEqual(document.ocr_reviewed_by, self.admin)

    def test_employee_and_manager_cannot_review(self):
        document = self._document()

        for user in (self.employee, self.manager):
            with self.subTest(user=user.email):
                response = self._review(user, self.profile, document.id)
                self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
                document.refresh_from_db()
                self.assertIsNone(document.ocr_reviewed_at)

    def test_cross_company_hr_cannot_review_a_document(self):
        document = self._document()

        response = self._review(self.foreign_hr, self.profile, document.id, company=self.other_company)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        document.refresh_from_db()
        self.assertIsNone(document.ocr_reviewed_at)

    def test_document_belonging_to_another_employee_is_not_found(self):
        document = self._document(self.other_profile)

        response = self._review(self.hr, self.profile, document.id)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        document.refresh_from_db()
        self.assertIsNone(document.ocr_reviewed_at)

    def test_system_generated_document_cannot_be_reviewed(self):
        document = self._document(extracted_fields={"generated_by_system": True, "full_name": "Generated"})

        response = self._review(self.hr, self.profile, document.id)

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn("System-generated", str(response.data["errors"]))
        document.refresh_from_db()
        self.assertIsNone(document.ocr_reviewed_at)

    def test_pending_or_failed_extraction_cannot_be_reviewed(self):
        for extraction_status in (
            EmployeeDocument.ExtractionStatus.PENDING,
            EmployeeDocument.ExtractionStatus.FAILED,
        ):
            with self.subTest(extraction_status=extraction_status):
                document = self._document(extraction_status=extraction_status)
                response = self._review(self.hr, self.profile, document.id)

                self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
                document.refresh_from_db()
                self.assertIsNone(document.ocr_reviewed_at)

    @patch("employees.tasks.extract_employee_document.apply_async")
    def test_reextracting_clears_an_existing_ocr_review(self, apply_async):
        document = self._document(ocr_reviewed_at=timezone.now(), ocr_reviewed_by=self.hr)
        self.client.force_authenticate(self.hr)

        response = self.client.post(
            f"/api/employees/{self.profile.id}/documents/{document.id}/extract/",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        document.refresh_from_db()
        self.assertIsNone(document.ocr_reviewed_at)
        self.assertIsNone(document.ocr_reviewed_by)

    def test_serializer_exposes_empty_and_completed_review_state(self):
        document = self._document()

        unreviewed = EmployeeDocumentSerializer(document).data
        self.assertIsNone(unreviewed["ocr_reviewed_at"])
        self.assertIsNone(unreviewed["ocr_reviewed_by"])

        self._review(self.hr, self.profile, document.id)
        document.refresh_from_db()
        reviewed = EmployeeDocumentSerializer(document).data
        self.assertIsNotNone(reviewed["ocr_reviewed_at"])
        self.assertEqual(reviewed["ocr_reviewed_by"], self.hr.id)
