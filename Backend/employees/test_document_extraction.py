from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase

from organization.models import OrganizationNode

from .document_extraction import _extract_identity_fields, extract_document_fields
from .models import EmployeeDocument, EmployeeProfile


class EmployeeDocumentExtractionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.company = OrganizationNode.objects.create(
            code="DOCUMENT_EXTRACTION_TEST",
            name="Document Extraction Test Company",
            node_type=OrganizationNode.NodeType.COMPANY,
        )

    def tearDown(self):
        for document in EmployeeDocument.objects.exclude(file=""):
            document.file.delete(save=False)

    def _document(self, document_type):
        profile = EmployeeProfile.objects.create(
            company=self.company,
            employee_id=f"OCR-{EmployeeProfile.objects.count() + 1}",
        )
        return EmployeeDocument.objects.create(
            employee_profile=profile,
            document_type=document_type,
            file=SimpleUploadedFile("identity.jpg", b"\xff\xd8\xff\xe0image", content_type="image/jpeg"),
            original_filename="identity.jpg",
        )

    def test_passport_mrz_fields_are_extracted(self):
        text = "\n".join(
            [
                "P<EGYQESHTA<<AHMED<SAMY<NAGUIEB<MOHAMED<<<<<<",
                "A382916872EGY9704208M3107151<<<<<<<<<<<<<<<08",
                "Profession: WORKER",
            ]
        )

        fields = _extract_identity_fields(EmployeeDocument.DocumentType.PASSPORT, text)

        self.assertEqual(fields["passport_number"], "A38291687")
        self.assertEqual(fields["full_name"], "AHMED SAMY NAGUIEB MOHAMED QESHTA")
        self.assertEqual(fields["nationality"], "EGY")
        self.assertEqual(fields["date_of_birth"], "1997-04-20")
        self.assertEqual(fields["expiry_date"], "2031-07-15")
        self.assertEqual(fields["profession"], "WORKER")

    def test_iqama_fields_are_extracted_from_bilingual_ocr_text(self):
        text = """
        Full Name: AHMED SAMY NAGUIEB QESHTA
        Nationality: EGYPT
        Date of Birth: 20/04/1997
        Issue Date: 21/11/2024
        Profession: Construction Worker
        Iqama Number: 2123456789
        Iqama Expiry: 21/11/2026
        """

        fields = _extract_identity_fields(EmployeeDocument.DocumentType.IQAMA, text)

        self.assertEqual(fields["iqama_number"], "2123456789")
        self.assertEqual(fields["full_name"], "AHMED SAMY NAGUIEB QESHTA")
        self.assertEqual(fields["nationality"], "EGYPT")
        self.assertEqual(fields["date_of_birth"], "20/04/1997")
        self.assertEqual(fields["issue_date"], "21/11/2024")
        self.assertEqual(fields["profession"], "Construction Worker")
        self.assertEqual(fields["iqama_expiry_date"], "21/11/2026")

    def test_iqama_uses_safe_fallbacks_for_bilingual_card_layout(self):
        text = """
        AHMED SAMY NAGUIEB QESHTA
        2026/11/21 تاريخ الانتهاء
        2585151688 رقم الهوية
        مصر
        عامل انشاءات
        """

        fields = _extract_identity_fields(EmployeeDocument.DocumentType.IQAMA, text)

        self.assertEqual(fields["full_name"], "AHMED SAMY NAGUIEB QESHTA")
        self.assertEqual(fields["iqama_number"], "2585151688")
        self.assertEqual(fields["iqama_expiry_date"], "2026/11/21")
        self.assertEqual(fields["nationality"], "Egypt")
        self.assertEqual(fields["profession"], "عامل انشاءات")

    @patch(
        "employees.document_extraction._extract_document_text",
        return_value="""
        Full Name: Example Employee
        Nationality: Egyptian
        Date of Birth: 01/01/1990
        Iqama Number: 2123456789
        Iqama Expiry: 01/01/2030
        """,
    )
    def test_extraction_completes_without_changing_iqama_classification(self, _extract_text):
        document = self._document(EmployeeDocument.DocumentType.SAUDI_ID)

        warnings = extract_document_fields(document)

        document.refresh_from_db()
        self.assertEqual(warnings, [])
        self.assertEqual(document.document_type, EmployeeDocument.DocumentType.SAUDI_ID)
        self.assertEqual(document.extraction_status, EmployeeDocument.ExtractionStatus.SUCCESS)
        self.assertEqual(document.extracted_fields["iqama_number"], "2123456789")
        self.assertEqual(document.extracted_fields["iqama_expiry_date"], "01/01/2030")
