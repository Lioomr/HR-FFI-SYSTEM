"""Authorization and output bounds for private document thumbnails."""

from io import BytesIO

import fitz
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from PIL import Image
from rest_framework import status
from rest_framework.test import APIClient

from audit.models import AuditLog
from organization.models import OrganizationNode, UserOrganizationAccess

from .document_thumbnail import THUMBNAIL_SIZE
from .models import EmployeeDocument, EmployeeProfile

User = get_user_model()


def _pdf_bytes() -> bytes:
    document = fitz.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((72, 72), "Passport review fixture")
    result = document.tobytes()
    document.close()
    return result


def _png_bytes(size=(1600, 1000)) -> bytes:
    output = BytesIO()
    Image.new("RGB", size, "navy").save(output, format="PNG")
    return output.getvalue()


class EmployeeDocumentThumbnailTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        employee_group, _ = Group.objects.get_or_create(name="Employee")
        hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.company = OrganizationNode.objects.create(
            code="DOC_THUMB_A", name="Document Thumbnail A", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.other_company = OrganizationNode.objects.create(
            code="DOC_THUMB_B", name="Document Thumbnail B", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.employee = User.objects.create_user(email="thumb-owner@test.com", password="password")
        self.employee.groups.add(employee_group)
        self.hr = User.objects.create_user(email="thumb-hr@test.com", password="password")
        self.hr.groups.add(hr_group)
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.company)
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.other_company)
        self.profile = EmployeeProfile.objects.create(
            user=self.employee,
            company=self.company,
            employee_id="THUMB-A-001",
            full_name="Thumbnail Owner",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        self.foreign_profile = EmployeeProfile.objects.create(
            company=self.other_company,
            employee_id="THUMB-B-001",
            full_name="Foreign Thumbnail Owner",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )

    def tearDown(self):
        for document in EmployeeDocument.objects.exclude(file=""):
            document.file.delete(save=False)

    def _document(self, *, profile=None, name="passport.pdf", content=None, content_type="application/pdf"):
        profile = profile or self.profile
        return EmployeeDocument.objects.create(
            employee_profile=profile,
            company=profile.company,
            document_type=EmployeeDocument.DocumentType.PASSPORT,
            file=SimpleUploadedFile(name, content if content is not None else _pdf_bytes(), content_type=content_type),
            original_filename=name,
            uploaded_by=self.hr,
        )

    def _thumbnail(self, user, profile, document_id, company=None):
        self.client.force_authenticate(user)
        return self.client.get(
            f"/api/employees/{profile.id}/documents/{document_id}/thumbnail/",
            HTTP_X_ACTIVE_COMPANY_ID=str((company or self.company).id),
        )

    def test_pdf_thumbnail_is_a_bounded_private_jpeg_without_storage_path(self):
        document = self._document()

        response = self._thumbnail(self.hr, self.profile, document.id)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "image/jpeg")
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        self.assertTrue(response.content.startswith(b"\xff\xd8"))
        self.assertNotIn(document.file.name.encode(), response.content)
        with Image.open(BytesIO(response.content)) as thumbnail:
            self.assertLessEqual(thumbnail.width, THUMBNAIL_SIZE[0])
            self.assertLessEqual(thumbnail.height, THUMBNAIL_SIZE[1])
        self.assertTrue(
            AuditLog.objects.filter(
                action="employee_document_thumbnail_viewed", entity_id=str(document.id), actor=self.hr
            ).exists()
        )

    def test_image_thumbnail_is_normalized_to_a_bounded_jpeg(self):
        document = self._document(name="passport.png", content=_png_bytes(), content_type="image/png")

        response = self._thumbnail(self.hr, self.profile, document.id)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "image/jpeg")
        with Image.open(BytesIO(response.content)) as thumbnail:
            self.assertLessEqual(thumbnail.width, THUMBNAIL_SIZE[0])
            self.assertLessEqual(thumbnail.height, THUMBNAIL_SIZE[1])

    def test_tenant_scope_and_owner_rules_match_document_download(self):
        document = self._document()
        foreign = self._document(profile=self.foreign_profile)

        own = self._thumbnail(self.employee, self.profile, document.id)
        cross_company = self._thumbnail(self.hr, self.foreign_profile, foreign.id, self.company)
        wrong_profile = self._thumbnail(self.hr, self.profile, foreign.id)

        self.assertEqual(own.status_code, status.HTTP_200_OK)
        self.assertEqual(cross_company.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(wrong_profile.status_code, status.HTTP_404_NOT_FOUND)

    def test_unsupported_or_missing_documents_do_not_fall_back_to_a_storage_url(self):
        document = self._document(name="legacy.docx", content=b"not a supported preview", content_type="application/octet-stream")

        unsupported = self._thumbnail(self.hr, self.profile, document.id)
        missing = self._thumbnail(self.hr, self.profile, 999999)

        self.assertEqual(unsupported.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertNotIn("private_uploads", str(unsupported.data))
        self.assertEqual(missing.status_code, status.HTTP_404_NOT_FOUND)
