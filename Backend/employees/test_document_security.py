from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from audit.models import AuditLog
from organization.models import OrganizationNode, UserOrganizationAccess

from .document_extraction import extract_document_fields
from .models import EmployeeDocument, EmployeeProfile
from .serializers import EmployeeDocumentSerializer

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
        downloaded_bytes = b"".join(download_response.streaming_content)
        for resource_closer in download_response._resource_closers:
            resource_closer()
        download_response._resource_closers.clear()
        self.assertTrue(
            AuditLog.objects.filter(
                action="employee_document_downloaded", entity_id=str(document.id), actor=self.employee
            ).exists()
        )
        self.assertEqual(other_profile_response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(foreign_document_response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(downloaded_bytes.startswith(b"%PDF"))

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

    @patch("employees.views._queue_document_extraction", return_value=[])
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

    @patch("employees.views._queue_document_extraction", return_value=[])
    def test_upload_preserves_document_type_and_returns_classification_metadata(self, _extract):
        self.client.force_authenticate(self.hr)
        url = f"/api/employees/{self.profile.id}/documents/"
        cases = [
            (EmployeeDocument.DocumentType.PASSPORT, "", "Passport"),
            (EmployeeDocument.DocumentType.IQAMA, "", "Iqama"),
            (EmployeeDocument.DocumentType.SAUDI_ID, "", "Saudi ID"),
            (EmployeeDocument.DocumentType.VISA, "", "Visa"),
            (EmployeeDocument.DocumentType.OTHER, "Medical Certificate", "Medical Certificate"),
        ]

        for index, (document_type, custom_name, display_name) in enumerate(cases):
            with self.subTest(document_type=document_type):
                response = self.client.post(
                    url,
                    {
                        "document_type": document_type,
                        "custom_name": custom_name,
                        "file": SimpleUploadedFile(
                            f"document-{index}.pdf",
                            b"%PDF-1.4\nvalid",
                            content_type="application/pdf",
                        ),
                    },
                    format="multipart",
                    HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
                )

                self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
                payload = response.data["data"]
                self.assertEqual(payload["document_type"], document_type)
                self.assertEqual(payload["display_name"], display_name)
                self.assertEqual(EmployeeDocument.objects.get(pk=payload["id"]).document_type, document_type)

    @patch("employees.views._queue_document_extraction", return_value=[])
    def test_upload_rejects_missing_document_type_instead_of_defaulting_to_visa(self, _extract):
        self.client.force_authenticate(self.hr)

        response = self.client.post(
            f"/api/employees/{self.profile.id}/documents/",
            {
                "file": SimpleUploadedFile(
                    "unclassified.pdf",
                    b"%PDF-1.4\nvalid",
                    content_type="application/pdf",
                )
            },
            format="multipart",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertFalse(EmployeeDocument.objects.filter(employee_profile=self.profile).exists())

    def test_serializer_preserves_identity_ocr_fields_for_legacy_types(self):
        extracted_fields = {
            "passport_number": "P1234567",
            "full_name": "Example Employee",
            "nationality": "Egyptian",
            "date_of_birth": "1990-01-01",
            "issue_date": "2020-01-01",
            "expiry_date": "2030-01-01",
            "profession": "Engineer",
            "iqama_number": "2123456789",
            "iqama_expiry_date": "2030-02-01",
        }
        passport = self._document()
        passport.extracted_fields = extracted_fields
        passport.save(update_fields=["extracted_fields"])
        saudi_id = self._document()
        saudi_id.document_type = EmployeeDocument.DocumentType.SAUDI_ID
        saudi_id.extracted_fields = extracted_fields
        saudi_id.save(update_fields=["document_type", "extracted_fields"])

        passport_payload = EmployeeDocumentSerializer(passport).data
        saudi_id_payload = EmployeeDocumentSerializer(saudi_id).data

        self.assertEqual(passport_payload["document_type"], "PASSPORT")
        self.assertEqual(passport_payload["display_name"], "Passport")
        self.assertEqual(passport_payload["extracted_fields"], extracted_fields)
        self.assertEqual(saudi_id_payload["document_type"], "SAUDI_ID")
        self.assertEqual(saudi_id_payload["display_name"], "Saudi ID")
        self.assertEqual(saudi_id_payload["extracted_fields"], extracted_fields)

        for document in (passport, saudi_id):
            with self.subTest(document_type=document.document_type):
                extract_document_fields(document)
                document.refresh_from_db()
                self.assertEqual(document.extracted_fields, extracted_fields)

    @patch("employees.views.extract_employee_document.apply_async")
    def test_hr_can_retry_ocr_for_an_existing_document(self, apply_async):
        document = self._document()
        document.extraction_status = EmployeeDocument.ExtractionStatus.FAILED
        document.extraction_error = "Previous OCR failure"
        document.save(update_fields=["extraction_status", "extraction_error"])
        self.client.force_authenticate(self.hr)

        response = self.client.post(
            f"/api/employees/{self.profile.id}/documents/{document.id}/extract/",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["data"]["document_type"], "PASSPORT")
        self.assertEqual(response.data["data"]["display_name"], "Passport")
        self.assertEqual(response.data["data"]["extraction_status"], "pending")
        apply_async.assert_called_once_with(args=[document.id], retry=False)
