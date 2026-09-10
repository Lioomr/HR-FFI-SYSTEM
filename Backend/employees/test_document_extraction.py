"""OCR pipeline tests for the PaddleOCR employee document pilot.

Every fixture here is synthetic and redacted: names are placeholders and the
identity numbers are constructed to satisfy (or deliberately fail) the checksum
rules, so no real employee data is committed. The PaddleOCR runtime itself is
stubbed - these tests own the parsing, validation and status rules, not the
inference engine.
"""

from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

from organization.models import OrganizationNode

from .models import EmployeeDocument, EmployeeProfile
from .ocr import mrz
from .ocr.engine import OcrEngineUnavailable, OcrLine, TransientExtractionError
from .ocr.parsers import parse_document, saudi_id_checksum_valid
from .ocr.pipeline import (
    MISSING_ENGINE_MESSAGE,
    UNREADABLE_MESSAGE,
    extract_document_fields,
    extract_visa_fields,
)

# Synthetic TD3 passport MRZ with correct ICAO check digits (see build_mrz below).
PASSPORT_SURNAME = "TESTCASE"
PASSPORT_GIVEN_NAMES = "SAMPLE<EMPLOYEE"


def build_mrz(
    *,
    document_number="X12345678",
    nationality="EGY",
    birth="900101",
    sex="M",
    expiry="300101",
    corrupt_document_check=False,
) -> str:
    """Build a valid TD3 MRZ, optionally with a broken document-number check digit."""

    name_field = f"{PASSPORT_SURNAME}<<{PASSPORT_GIVEN_NAMES}".ljust(39, "<")[:39]
    line1 = f"P<{nationality}{name_field}"

    document_check = mrz.check_digit(document_number)
    if corrupt_document_check:
        document_check = str((int(document_check) + 1) % 10)
    birth_check = mrz.check_digit(birth)
    expiry_check = mrz.check_digit(expiry)
    personal_number = "<" * 14
    personal_check = "<"

    partial = (
        f"{document_number}{document_check}{nationality}{birth}{birth_check}{sex}{expiry}{expiry_check}"
        f"{personal_number}{personal_check}"
    )
    composite_source = partial[0:10] + partial[13:20] + partial[21:43]
    return f"{line1}\n{partial}{mrz.check_digit(composite_source)}"


ENGLISH_IQAMA_TEXT = """
Kingdom of Saudi Arabia
Full Name: SAMPLE EMPLOYEE TESTCASE
Nationality: EGYPT
Date of Birth: 01/01/1990
Iqama Number: 2345678904
Iqama Expiry: 21/11/2030
Profession: Construction Worker
"""

ARABIC_IQAMA_TEXT = """
المملكة العربية السعودية
SAMPLE EMPLOYEE TESTCASE
٢٠٣٠/١١/٢١ تاريخ الانتهاء
رقم الهوية: ٢٣٤٥٦٧٨٩٠٤
مصر
عامل انشاءات
"""

BILINGUAL_SAUDI_ID_TEXT = """
الهوية الوطنية / National Identity
Full Name: SAMPLE EMPLOYEE TESTCASE
الاسم: عينة موظف
Nationality: SAUDI
الجنسية: السعودية
ID Number: 1234567897
Expiry Date: 15/06/2032
تاريخ الانتهاء: 15/06/2032
"""

VISA_TEXT = """
Exit Re-Entry Visa
Visa Number: 4455667788
Exit Before: 30/06/2026
Visa Duration: 45
"""


def ocr_lines(text: str, confidence: float = 0.95) -> list[OcrLine]:
    return [OcrLine(text=line, confidence=confidence) for line in text.splitlines() if line.strip()]


class SaudiIdChecksumTests(TestCase):
    def test_checksum_accepts_well_formed_numbers(self):
        self.assertTrue(saudi_id_checksum_valid("2345678904"))
        self.assertTrue(saudi_id_checksum_valid("1234567897"))

    def test_checksum_rejects_transposed_and_short_numbers(self):
        self.assertFalse(saudi_id_checksum_valid("2345678903"))
        self.assertFalse(saudi_id_checksum_valid("234567890"))
        self.assertFalse(saudi_id_checksum_valid(""))


class PassportMrzTests(TestCase):
    def test_valid_mrz_parses_and_passes_every_check_digit(self):
        result = parse_document(EmployeeDocument.DocumentType.PASSPORT, build_mrz())

        self.assertTrue(result.valid)
        self.assertEqual(result.fields["passport_number"], "X12345678")
        self.assertEqual(result.fields["full_name"], "SAMPLE EMPLOYEE TESTCASE")
        self.assertEqual(result.fields["nationality"], "EGY")
        self.assertEqual(result.fields["date_of_birth"], "1990-01-01")
        self.assertEqual(result.fields["expiry_date"], "2030-01-01")
        self.assertTrue(result.checks["document_number"])
        self.assertTrue(result.checks["composite"])

    def test_failed_document_number_check_digit_blocks_success(self):
        result = parse_document(EmployeeDocument.DocumentType.PASSPORT, build_mrz(corrupt_document_check=True))

        self.assertFalse(result.valid)
        self.assertFalse(result.checks["document_number"])
        self.assertTrue(any("check digit" in warning for warning in result.warnings))

    def test_missing_mrz_is_reported_rather_than_guessed(self):
        result = parse_document(
            EmployeeDocument.DocumentType.PASSPORT,
            "Passport Number: X12345678\nName: SAMPLE EMPLOYEE",
        )

        self.assertFalse(result.valid)
        self.assertTrue(any("machine readable zone" in warning for warning in result.warnings))

    def test_impossible_mrz_date_is_rejected(self):
        result = parse_document(EmployeeDocument.DocumentType.PASSPORT, build_mrz(expiry="301301"))

        self.assertFalse(result.valid)
        self.assertNotIn("expiry_date", result.fields)


class IdentityParserTests(TestCase):
    def test_english_iqama_fields_are_extracted_and_valid(self):
        result = parse_document(EmployeeDocument.DocumentType.IQAMA, ENGLISH_IQAMA_TEXT)

        self.assertTrue(result.valid, result.warnings)
        self.assertEqual(result.fields["iqama_number"], "2345678904")
        self.assertEqual(result.fields["full_name"], "SAMPLE EMPLOYEE TESTCASE")
        self.assertEqual(result.fields["nationality"], "EGYPT")
        self.assertEqual(result.fields["iqama_expiry_date"], "21/11/2030")
        self.assertEqual(result.fields["profession"], "Construction Worker")

    def test_arabic_iqama_uses_arabic_indic_digits_and_labels(self):
        result = parse_document(EmployeeDocument.DocumentType.IQAMA, ARABIC_IQAMA_TEXT)

        self.assertEqual(result.fields["iqama_number"], "2345678904")
        self.assertEqual(result.fields["iqama_expiry_date"], "2030/11/21")
        self.assertEqual(result.fields["nationality"], "Egypt")
        self.assertEqual(result.fields["full_name"], "SAMPLE EMPLOYEE TESTCASE")
        self.assertTrue(result.valid, result.warnings)

    def test_bilingual_saudi_id_requires_the_saudi_leading_digit(self):
        result = parse_document(EmployeeDocument.DocumentType.SAUDI_ID, BILINGUAL_SAUDI_ID_TEXT)

        self.assertTrue(result.valid, result.warnings)
        self.assertEqual(result.fields["iqama_number"], "1234567897")
        self.assertEqual(result.fields["iqama_expiry_date"], "15/06/2032")

    def test_iqama_number_on_a_saudi_id_is_partial_with_a_clear_warning(self):
        text = BILINGUAL_SAUDI_ID_TEXT.replace("1234567897", "2345678904")

        result = parse_document(EmployeeDocument.DocumentType.SAUDI_ID, text)

        self.assertFalse(result.valid)
        self.assertFalse(result.checks["id_format"])
        self.assertTrue(any("does not start with 1" in warning for warning in result.warnings))

    def test_malformed_id_number_is_partial(self):
        text = ENGLISH_IQAMA_TEXT.replace("2345678904", "23456")

        result = parse_document(EmployeeDocument.DocumentType.IQAMA, text)

        self.assertFalse(result.valid)
        self.assertTrue(any("Could not extract" in warning for warning in result.warnings))

    def test_failed_id_checksum_is_partial(self):
        text = ENGLISH_IQAMA_TEXT.replace("2345678904", "2345678903")

        result = parse_document(EmployeeDocument.DocumentType.IQAMA, text)

        self.assertFalse(result.valid)
        self.assertFalse(result.checks["id_checksum"])
        self.assertTrue(any("checksum" in warning for warning in result.warnings))

    def test_hijri_expiry_is_flagged_instead_of_silently_accepted(self):
        text = ENGLISH_IQAMA_TEXT.replace("21/11/2030", "1452/05/12")

        result = parse_document(EmployeeDocument.DocumentType.IQAMA, text)

        self.assertFalse(result.valid)
        self.assertFalse(result.checks["expiry_parsed"])
        self.assertTrue(any("Hijri" in warning for warning in result.warnings))


class VisaParserTests(TestCase):
    def test_visa_fields_are_extracted_and_valid(self):
        result = parse_document(EmployeeDocument.DocumentType.VISA, VISA_TEXT)

        self.assertTrue(result.valid, result.warnings)
        self.assertEqual(result.fields["visa_number"], "4455667788")
        self.assertEqual(result.fields["exit_before_raw"], "30/06/2026")
        self.assertEqual(result.fields["visa_duration_raw"], "45")

    def test_non_numeric_duration_is_partial(self):
        text = VISA_TEXT.replace("Visa Duration: 45", "Visa Duration: forty five")

        result = parse_document(EmployeeDocument.DocumentType.VISA, text)

        self.assertFalse(result.valid)
        self.assertTrue(any("Visa Duration" in warning for warning in result.warnings))

    def test_out_of_range_duration_is_partial(self):
        text = VISA_TEXT.replace("Visa Duration: 45", "Visa Duration: 9999")

        result = parse_document(EmployeeDocument.DocumentType.VISA, text)

        self.assertFalse(result.valid)
        self.assertFalse(result.checks["visa_duration_valid"])

    def test_unparseable_exit_date_is_partial(self):
        text = VISA_TEXT.replace("30/06/2026", "31/31/2026")

        result = parse_document(EmployeeDocument.DocumentType.VISA, text)

        self.assertFalse(result.valid)
        self.assertFalse(result.checks["exit_before_parsed"])


class DocumentExtractionPipelineTests(TestCase):
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

    def _document(self, document_type, *, filename="identity.jpg", content=b"\xff\xd8\xff\xe0image"):
        profile = EmployeeProfile.objects.create(
            company=self.company,
            employee_id=f"OCR-{EmployeeProfile.objects.count() + 1}",
        )
        return EmployeeDocument.objects.create(
            employee_profile=profile,
            company=self.company,
            document_type=document_type,
            file=SimpleUploadedFile(filename, content, content_type="image/jpeg"),
            original_filename=filename,
        )

    def _run(self, document, text, *, confidence=0.95, metadata=None):
        lines = ocr_lines(text, confidence)
        with patch(
            "employees.ocr.pipeline._document_lines",
            return_value=(lines, metadata or {"source": "image", "pages": 1}),
        ):
            return extract_document_fields(document)

    def test_successful_passport_extraction_records_engine_metadata(self):
        document = self._document(EmployeeDocument.DocumentType.PASSPORT)

        warnings = self._run(document, build_mrz())

        document.refresh_from_db()
        self.assertEqual(warnings, [])
        self.assertEqual(document.extraction_status, EmployeeDocument.ExtractionStatus.SUCCESS)
        self.assertEqual(document.extracted_fields["passport_number"], "X12345678")
        self.assertEqual(document.extraction_metadata["engine"], "paddleocr")
        self.assertIn("engine_version", document.extraction_metadata)
        self.assertTrue(document.extraction_metadata["checks"]["document_number"])
        self.assertGreater(document.extraction_confidence, 0.9)
        self.assertIn("passport_number", document.extraction_metadata["field_confidence"])
        self.assertIsNotNone(document.extraction_completed_at)

    def test_raw_text_is_retained_only_in_the_private_column(self):
        document = self._document(EmployeeDocument.DocumentType.PASSPORT)

        self._run(document, build_mrz())

        document.refresh_from_db()
        self.assertIn("P<EGY", document.extraction_raw_text)
        self.assertNotIn("raw_text", document.extracted_fields)

    def test_passport_header_text_is_never_saved_as_an_issue_date(self):
        document = self._document(EmployeeDocument.DocumentType.PASSPORT)

        self._run(document, "Date of Issue Date of Expiry\n" + build_mrz())

        document.refresh_from_db()
        self.assertNotIn("issue_date", document.extracted_fields)
        self.assertEqual(document.extracted_fields["expiry_date"], "2030-01-01")

    def test_low_confidence_downgrades_a_valid_read_to_partial(self):
        document = self._document(EmployeeDocument.DocumentType.PASSPORT)

        warnings = self._run(document, build_mrz(), confidence=0.35)

        document.refresh_from_db()
        self.assertEqual(document.extraction_status, EmployeeDocument.ExtractionStatus.PARTIAL)
        self.assertTrue(any("confidence" in warning for warning in warnings))
        self.assertEqual(document.extraction_warnings, warnings)

    def test_failed_checksum_produces_partial_with_warnings(self):
        document = self._document(EmployeeDocument.DocumentType.PASSPORT)

        warnings = self._run(document, build_mrz(corrupt_document_check=True))

        document.refresh_from_db()
        self.assertEqual(document.extraction_status, EmployeeDocument.ExtractionStatus.PARTIAL)
        self.assertTrue(warnings)
        self.assertEqual(document.extraction_error, "")

    def test_arabic_document_extraction_succeeds_end_to_end(self):
        document = self._document(EmployeeDocument.DocumentType.IQAMA)

        warnings = self._run(document, ARABIC_IQAMA_TEXT)

        document.refresh_from_db()
        self.assertEqual(warnings, [])
        self.assertEqual(document.extraction_status, EmployeeDocument.ExtractionStatus.SUCCESS)
        self.assertEqual(document.extracted_fields["iqama_number"], "2345678904")

    def test_scanned_pdf_pages_are_rendered_and_reported_in_metadata(self):
        document = self._document(EmployeeDocument.DocumentType.IQAMA, filename="scan.pdf", content=b"%PDF-1.4\nscan")

        self._run(document, ENGLISH_IQAMA_TEXT, metadata={"source": "pdf_render", "pages": 2, "rotations": [0, 270]})

        document.refresh_from_db()
        self.assertEqual(document.extraction_metadata["source"], "pdf_render")
        self.assertEqual(document.extraction_metadata["pages"], 2)
        self.assertEqual(document.extraction_metadata["rotations"], [0, 270])
        self.assertEqual(document.extraction_status, EmployeeDocument.ExtractionStatus.SUCCESS)

    def test_document_type_is_never_reclassified_by_extraction(self):
        document = self._document(EmployeeDocument.DocumentType.SAUDI_ID)

        self._run(document, BILINGUAL_SAUDI_ID_TEXT)

        document.refresh_from_db()
        self.assertEqual(document.document_type, EmployeeDocument.DocumentType.SAUDI_ID)
        self.assertEqual(document.extraction_status, EmployeeDocument.ExtractionStatus.SUCCESS)

    def test_extraction_never_writes_employee_master_data(self):
        document = self._document(EmployeeDocument.DocumentType.PASSPORT)
        profile = document.employee_profile

        self._run(document, build_mrz())

        profile.refresh_from_db()
        self.assertEqual(profile.passport_no, None)
        self.assertIsNone(profile.passport_expiry)
        self.assertEqual(profile.full_name, "")

    def test_visa_columns_are_populated_from_a_valid_read(self):
        document = self._document(EmployeeDocument.DocumentType.VISA)

        with patch(
            "employees.ocr.pipeline._document_lines",
            return_value=(ocr_lines(VISA_TEXT), {"source": "image", "pages": 1}),
        ):
            result = extract_visa_fields(document)

        document.refresh_from_db()
        self.assertEqual(result, [])
        self.assertEqual(document.visa_number, "4455667788")
        self.assertEqual(document.exit_before.isoformat(), "2026-06-30")
        self.assertEqual(document.visa_duration, 45)
        self.assertEqual(document.extraction_status, EmployeeDocument.ExtractionStatus.SUCCESS)

    def test_unreadable_document_fails_with_an_actionable_message(self):
        document = self._document(EmployeeDocument.DocumentType.PASSPORT)

        warnings = self._run(document, "   \n  \n")

        document.refresh_from_db()
        self.assertEqual(document.extraction_status, EmployeeDocument.ExtractionStatus.FAILED)
        self.assertEqual(document.extraction_error, UNREADABLE_MESSAGE)
        self.assertEqual(warnings, [UNREADABLE_MESSAGE])

    def test_missing_ocr_models_fail_with_an_administrator_facing_message(self):
        document = self._document(EmployeeDocument.DocumentType.PASSPORT)

        with patch(
            "employees.ocr.pipeline._document_lines",
            side_effect=OcrEngineUnavailable("models are not provisioned in /opt/paddleocr"),
        ):
            warnings = extract_document_fields(document)

        document.refresh_from_db()
        self.assertEqual(document.extraction_status, EmployeeDocument.ExtractionStatus.FAILED)
        self.assertEqual(warnings, [MISSING_ENGINE_MESSAGE])
        self.assertNotIn("/opt/paddleocr", document.extraction_error)

    def test_transient_storage_errors_propagate_for_celery_to_retry(self):
        document = self._document(EmployeeDocument.DocumentType.PASSPORT)

        with patch(
            "employees.ocr.pipeline._document_lines",
            side_effect=TransientExtractionError("storage blip"),
        ):
            with self.assertRaises(TransientExtractionError):
                extract_document_fields(document)

        document.refresh_from_db()
        self.assertEqual(document.extraction_status, EmployeeDocument.ExtractionStatus.PENDING)

    def test_non_identity_documents_skip_ocr(self):
        document = self._document(EmployeeDocument.DocumentType.OTHER)

        warnings = extract_document_fields(document)

        document.refresh_from_db()
        self.assertEqual(warnings, [])
        self.assertEqual(document.extraction_status, EmployeeDocument.ExtractionStatus.SUCCESS)
        self.assertEqual(document.extraction_metadata["ocr"], "skipped")

    @override_settings(EMPLOYEE_DOCUMENT_OCR_MIN_CONFIDENCE=0.9)
    def test_confidence_threshold_is_configurable(self):
        document = self._document(EmployeeDocument.DocumentType.PASSPORT)

        self._run(document, build_mrz(), confidence=0.8)

        document.refresh_from_db()
        self.assertEqual(document.extraction_status, EmployeeDocument.ExtractionStatus.PARTIAL)
        self.assertEqual(document.extraction_metadata["min_confidence"], 0.9)
