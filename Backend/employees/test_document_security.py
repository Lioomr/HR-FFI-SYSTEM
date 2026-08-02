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


class EmployeeDocumentSecurityTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        employee_group, _ = Group.objects.get_or_create(name="Employee")
        hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.company = OrganizationNode.objects.create(
            code="DOC_SEC_A", name="Document Security A", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.other_company = OrganizationNode.objects.create(
            code="DOC_SEC_B", name="Document Security B", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.employee = User.objects.create_user(email="doc-owner@test.com", password="password")
        self.employee.groups.add(employee_group)
        self.other_employee = User.objects.create_user(email="doc-other@test.com", password="password")
        self.other_employee.groups.add(employee_group)
        self.hr = User.objects.create_user(email="doc-hr@test.com", password="password")
        self.hr.groups.add(hr_group)
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.company)
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.other_company)
        self.profile = EmployeeProfile.objects.create(
            user=self.employee,
            company=self.company,
            employee_id="DOC-A-001",
            full_name="Document Owner",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        self.other_profile = EmployeeProfile.objects.create(
            user=self.other_employee,
            company=self.other_company,
            employee_id="DOC-B-001",
            full_name="Other Document Owner",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )

    def tearDown(self):
        for document in EmployeeDocument.objects.exclude(file=""):
            document.file.delete(save=False)

    def _document(self, profile=None, company=None):
        profile = profile or self.profile
        return EmployeeDocument.objects.create(
            employee_profile=profile,
            company=company or profile.company,
            document_type=EmployeeDocument.DocumentType.PASSPORT,
            file=SimpleUploadedFile("passport.pdf", b"%PDF-1.4\ncontent", content_type="application/pdf"),
            original_filename="passport.pdf",
            uploaded_by=self.hr,
        )

    def test_employee_can_only_list_and_download_own_active_company_documents(self):
        document = self._document()
        foreign_document = self._document(self.other_profile)
        self.client.force_authenticate(self.employee)

        list_response = self.client.get(
            f"/api/employees/{self.profile.id}/documents/",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )
        download_response = self.client.get(
            f"/api/employees/{self.profile.id}/documents/{document.id}/download/",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )
        other_profile_response = self.client.get(
            f"/api/employees/{self.other_profile.id}/documents/",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )
        foreign_document_response = self.client.get(
            f"/api/employees/{self.profile.id}/documents/{foreign_document.id}/download/",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual([item["id"] for item in list_response.data["data"]], [document.id])
        self.assertEqual(download_response.status_code, status.HTTP_200_OK)
        self.assertEqual(download_response["Content-Type"], "application/octet-stream")
        self.assertIn("attachment", download_response["Content-Disposition"].lower())
        self.assertEqual(download_response["X-Content-Type-Options"], "nosniff")
        self.assertEqual(download_response["Cache-Control"], "private, no-store")
        self.assertTrue(
            AuditLog.objects.filter(
                action="employee_document_downloaded", entity_id=str(document.id), actor=self.employee
            ).exists()
        )
        self.assertEqual(other_profile_response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(foreign_document_response.status_code, status.HTTP_404_NOT_FOUND)

    def test_hr_direct_document_routes_are_limited_to_active_company(self):
        foreign_document = self._document(self.other_profile)
        self.client.force_authenticate(self.hr)

        list_response = self.client.get(
            f"/api/employees/{self.other_profile.id}/documents/",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )
        download_response = self.client.get(
            f"/api/employees/{self.other_profile.id}/documents/{foreign_document.id}/download/",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(list_response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(download_response.status_code, status.HTTP_404_NOT_FOUND)

    @patch("employees.views.extract_visa_fields", return_value=[])
    def test_upload_validates_signature_content_type_and_size(self, _extract):
        self.client.force_authenticate(self.hr)
        url = f"/api/employees/{self.profile.id}/documents/"
        base = {"document_type": EmployeeDocument.DocumentType.PASSPORT}

        invalid_signature = self.client.post(
            url,
            {**base, "file": SimpleUploadedFile("bad.pdf", b"not a pdf", content_type="application/pdf")},
            format="multipart",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )
        invalid_type = self.client.post(
            url,
            {**base, "file": SimpleUploadedFile("bad.pdf", b"%PDF-1.4", content_type="image/png")},
            format="multipart",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )
        with patch("employees.serializers.EMPLOYEE_DOCUMENT_MAX_SIZE", 4):
            oversized = self.client.post(
                url,
                {**base, "file": SimpleUploadedFile("big.pdf", b"%PDF-1.4", content_type="application/pdf")},
                format="multipart",
                HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
            )
        valid = self.client.post(
            url,
            {**base, "file": SimpleUploadedFile("valid.pdf", b"%PDF-1.4\nvalid", content_type="application/pdf")},
            format="multipart",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(invalid_signature.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(invalid_type.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(oversized.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(valid.status_code, status.HTTP_201_CREATED, valid.data)
        document = EmployeeDocument.objects.get(pk=valid.data["data"]["id"])
        self.assertEqual(document.company, self.company)
        self.assertEqual(document.original_filename, "valid.pdf")
