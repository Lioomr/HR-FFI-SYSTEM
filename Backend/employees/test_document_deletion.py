"""Permanent deletion of archived employee documents.

DELETE /api/employees/{employee_id}/documents/{document_id}/ removes the private
file and the record together. These tests pin the authorization boundary, the
system-generated exemption, the storage-failure rollback and the audit trail.
"""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from audit.models import AuditLog
from organization.models import OrganizationNode, UserOrganizationAccess

from .models import EmployeeDocument, EmployeeProfile

User = get_user_model()


class EmployeeDocumentDeletionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        groups = {
            name: Group.objects.get_or_create(name=name)[0]
            for name in ("Employee", "HRManager", "SystemAdmin", "Manager")
        }
        self.company = OrganizationNode.objects.create(
            code="DOC_DEL_A", name="Document Deletion A", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.other_company = OrganizationNode.objects.create(
            code="DOC_DEL_B", name="Document Deletion B", node_type=OrganizationNode.NodeType.COMPANY
        )

        self.employee = User.objects.create_user(email="del-owner@test.com", password="password")
        self.employee.groups.add(groups["Employee"])
        self.manager = User.objects.create_user(email="del-manager@test.com", password="password")
        self.manager.groups.add(groups["Manager"])
        UserOrganizationAccess.objects.create(user=self.manager, organization=self.company)
        self.hr = User.objects.create_user(email="del-hr@test.com", password="password")
        self.hr.groups.add(groups["HRManager"])
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.company)
        self.admin = User.objects.create_user(email="del-admin@test.com", password="password")
        self.admin.groups.add(groups["SystemAdmin"])
        UserOrganizationAccess.objects.create(user=self.admin, organization=self.company)
        UserOrganizationAccess.objects.create(user=self.admin, organization=self.other_company)
        self.foreign_hr = User.objects.create_user(email="del-foreign-hr@test.com", password="password")
        self.foreign_hr.groups.add(groups["HRManager"])
        UserOrganizationAccess.objects.create(user=self.foreign_hr, organization=self.other_company)

        self.profile = EmployeeProfile.objects.create(
            user=self.employee,
            company=self.company,
            employee_id="DEL-A-001",
            full_name="Deletion Owner",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        self.other_profile = EmployeeProfile.objects.create(
            company=self.other_company,
            employee_id="DEL-B-001",
            full_name="Foreign Owner",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        # The manager is a real member of the company, so the rejection below
        # comes from the role check rather than from company scoping.
        self.manager_profile = EmployeeProfile.objects.create(
            user=self.manager,
            company=self.company,
            employee_id="DEL-A-002",
            full_name="Team Manager",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        self.profile.manager_profile = self.manager_profile
        self.profile.manager = self.manager
        self.profile.save(update_fields=["manager_profile", "manager"])

    def tearDown(self):
        for document in EmployeeDocument.objects.exclude(file=""):
            document.file.delete(save=False)

    def _document(self, profile=None, *, extracted_fields=None, filename="passport.pdf"):
        profile = profile or self.profile
        return EmployeeDocument.objects.create(
            employee_profile=profile,
            company=profile.company,
            document_type=EmployeeDocument.DocumentType.PASSPORT,
            file=SimpleUploadedFile(filename, b"%PDF-1.4\ncontent", content_type="application/pdf"),
            original_filename=filename,
            uploaded_by=self.hr,
            extracted_fields=extracted_fields or {},
        )

    def _url(self, profile, document_id):
        return f"/api/employees/{profile.id}/documents/{document_id}/"

    def _delete(self, user, profile, document_id, company=None):
        self.client.force_authenticate(user)
        return self.client.delete(
            self._url(profile, document_id),
            HTTP_X_ACTIVE_COMPANY_ID=str((company or self.company).id),
        )

    def test_hr_deletion_removes_the_file_and_the_record(self):
        document = self._document()
        storage = document.file.storage
        file_name = document.file.name
        self.assertTrue(storage.exists(file_name))

        response = self._delete(self.hr, self.profile, document.id)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["status"], "success")
        self.assertEqual(response.data["data"]["id"], document.id)
        self.assertTrue(response.data["data"]["deleted"])
        self.assertEqual(response.data["data"]["document_type"], "PASSPORT")
        self.assertFalse(EmployeeDocument.objects.filter(pk=document.id).exists())
        self.assertFalse(storage.exists(file_name))

    def test_system_admin_may_delete_inside_the_active_company(self):
        document = self._document()

        response = self._delete(self.admin, self.profile, document.id)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertFalse(EmployeeDocument.objects.filter(pk=document.id).exists())

    def test_deletion_writes_an_audit_event_without_file_or_ocr_content(self):
        document = self._document(filename="employee-passport.pdf")
        document.extraction_raw_text = "P<EGYSAMPLE<<EMPLOYEE"
        document.extracted_fields = {"passport_number": "X12345678"}
        document.save(update_fields=["extraction_raw_text", "extracted_fields"])

        self._delete(self.hr, self.profile, document.id)

        entry = AuditLog.objects.get(action="employee_document_deleted", entity_id=str(document.id))
        self.assertEqual(entry.actor, self.hr)
        self.assertEqual(entry.entity, "employee_document")
        self.assertEqual(entry.metadata["employee_profile_id"], self.profile.id)
        self.assertEqual(entry.metadata["document_id"], document.id)
        self.assertEqual(entry.metadata["document_type"], "PASSPORT")
        self.assertEqual(entry.metadata["original_filename"], "employee-passport.pdf")
        serialized = str(entry.metadata)
        self.assertNotIn("P<EGY", serialized)
        self.assertNotIn("X12345678", serialized)
        self.assertNotIn("%PDF", serialized)

    def test_employee_cannot_delete_their_own_document(self):
        document = self._document()

        response = self._delete(self.employee, self.profile, document.id)

        # Non-HR write requests never resolve a profile, so the archive does not
        # confirm the document exists - the same shape the PATCH route uses.
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(EmployeeDocument.objects.filter(pk=document.id).exists())

    def test_manager_cannot_delete_a_team_document(self):
        document = self._document()

        response = self._delete(self.manager, self.profile, document.id)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(EmployeeDocument.objects.filter(pk=document.id).exists())

    def test_unauthenticated_deletion_is_rejected(self):
        document = self._document()

        response = self.client.delete(
            self._url(self.profile, document.id),
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertTrue(EmployeeDocument.objects.filter(pk=document.id).exists())

    def test_hr_cannot_act_under_a_company_they_have_no_access_to(self):
        document = self._document(self.other_profile)

        response = self._delete(self.foreign_hr, self.other_profile, document.id, company=self.company)

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(EmployeeDocument.objects.filter(pk=document.id).exists())

    def test_cross_company_hr_cannot_delete_another_companys_document(self):
        document = self._document()

        response = self._delete(self.foreign_hr, self.profile, document.id, company=self.other_company)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(EmployeeDocument.objects.filter(pk=document.id).exists())

    def test_admin_cannot_delete_outside_the_active_company_scope(self):
        document = self._document(self.other_profile)

        response = self._delete(self.admin, self.other_profile, document.id, company=self.company)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(EmployeeDocument.objects.filter(pk=document.id).exists())

    def test_missing_document_returns_not_found(self):
        response = self._delete(self.hr, self.profile, 999999)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_document_belonging_to_another_employee_returns_not_found(self):
        document = self._document(self.other_profile)

        response = self._delete(self.hr, self.profile, document.id)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(EmployeeDocument.objects.filter(pk=document.id).exists())

    def test_system_generated_documents_cannot_be_deleted(self):
        document = self._document(extracted_fields={"generated_by_system": True, "hr_only": True})

        response = self._delete(self.hr, self.profile, document.id)

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn("System-generated", str(response.data["errors"]))
        self.assertTrue(EmployeeDocument.objects.filter(pk=document.id).exists())
        self.assertTrue(document.file.storage.exists(document.file.name))

    def test_storage_failure_preserves_the_database_record(self):
        document = self._document()
        file_name = document.file.name
        storage = document.file.storage

        with patch(
            "employees.storage.PrivateUploadStorage.delete",
            side_effect=OSError("permission denied"),
        ):
            response = self._delete(self.hr, self.profile, document.id)

        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertEqual(response.data["status"], "error")
        self.assertTrue(EmployeeDocument.objects.filter(pk=document.id).exists())
        self.assertTrue(storage.exists(file_name))
        self.assertFalse(AuditLog.objects.filter(action="employee_document_deleted").exists())

    def test_storage_that_silently_keeps_the_file_preserves_the_record(self):
        document = self._document()

        with patch("employees.storage.PrivateUploadStorage.delete", return_value=None):
            response = self._delete(self.hr, self.profile, document.id)

        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertTrue(EmployeeDocument.objects.filter(pk=document.id).exists())

    def test_patch_metadata_still_works_on_the_shared_route(self):
        document = self._document()
        self.client.force_authenticate(self.hr)

        response = self.client.patch(
            self._url(self.profile, document.id),
            {"document_type": EmployeeDocument.DocumentType.OTHER, "custom_name": "Medical Certificate"},
            format="json",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        document.refresh_from_db()
        self.assertEqual(document.document_type, EmployeeDocument.DocumentType.OTHER)
        self.assertEqual(document.custom_name, "Medical Certificate")
