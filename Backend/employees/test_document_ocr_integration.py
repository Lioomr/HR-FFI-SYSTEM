"""Non-mocked OCR integration tests: real PaddleOCR inference, real models.

These run ONLY where the PaddleOCR runtime is installed and the models are
provisioned - inside the built backend/worker image. Everywhere else the whole
module is skipped, so the fast mocked unit suite stays the default.

Run them explicitly with:
    pytest employees/test_document_ocr_integration.py -m ocr_integration

Fixtures are synthetic and redacted (see `employees/ocr_test_fixtures.py`); no
real employee document is committed to the repository.
"""

from __future__ import annotations

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, tag

from organization.models import OrganizationNode

from . import ocr_test_fixtures as fixtures
from .models import EmployeeDocument, EmployeeProfile
from .ocr import engine
from .ocr.pipeline import extract_document_fields


def _runtime_available() -> tuple[bool, str]:
    """True only when real inference can actually run here."""

    try:
        import paddleocr  # noqa: F401
    except Exception as exc:
        return False, f"PaddleOCR runtime is not installed ({exc.__class__.__name__})"

    missing = [
        language
        for language in engine.SUPPORTED_LANGUAGES
        if not engine.discover_model_dirs(language).get("rec_model_dir")
    ]
    if missing:
        return False, f"OCR models are not provisioned for: {', '.join(missing)}"
    return True, ""


RUNTIME_AVAILABLE, SKIP_REASON = _runtime_available()

pytestmark = [
    pytest.mark.ocr_integration,
    pytest.mark.skipif(not RUNTIME_AVAILABLE, reason=SKIP_REASON or "OCR runtime unavailable"),
]


@tag("ocr_integration")
class OcrRuntimeIntegrationTests(TestCase):
    """Drive the real engine end to end over rendered identity documents."""

    @classmethod
    def setUpTestData(cls):
        cls.company = OrganizationNode.objects.create(
            code="OCR_INTEGRATION",
            name="OCR Integration Company",
            node_type=OrganizationNode.NodeType.COMPANY,
        )

    def tearDown(self):
        for document in EmployeeDocument.objects.exclude(file=""):
            document.file.delete(save=False)

    def _document(self, document_type, filename, content):
        profile = EmployeeProfile.objects.create(
            company=self.company,
            employee_id=f"OCRINT-{EmployeeProfile.objects.count() + 1}",
        )
        return EmployeeDocument.objects.create(
            employee_profile=profile,
            company=self.company,
            document_type=document_type,
            file=SimpleUploadedFile(filename, content, content_type="application/octet-stream"),
            original_filename=filename,
        )

    def _extract(self, fixture, *, as_pdf=False, **render):
        content = fixture.pdf_bytes(**render) if as_pdf else fixture.png_bytes(**render)
        suffix = "pdf" if as_pdf else "png"
        document = self._document(fixture.document_type, f"{fixture.name}.{suffix}", content)
        warnings = extract_document_fields(document)
        document.refresh_from_db()
        return document, warnings

    def _report(self, fixture, document, warnings):
        """Printed so the run itself is the evidence of real extraction."""

        print(
            f"\n[{fixture.name}] type={document.document_type} status={document.extraction_status} "
            f"confidence={document.extraction_confidence} "
            f"passes={document.extraction_metadata.get('passes')} "
            f"fields={document.extracted_fields} warnings={warnings}"
        )

    # --- per-type extraction -------------------------------------------------

    def test_english_iqama_extracts_required_fields(self):
        fixture = fixtures.ENGLISH_IQAMA
        document, warnings = self._extract(fixture)
        self._report(fixture, document, warnings)

        self.assertEqual(document.extracted_fields.get("iqama_number"), fixture.expected["iqama_number"])
        self.assertEqual(document.extraction_status, EmployeeDocument.ExtractionStatus.SUCCESS, warnings)
        self.assertGreater(document.extraction_confidence, 0.5)

    def test_bilingual_iqama_reads_latin_fields_next_to_arabic_labels(self):
        fixture = fixtures.BILINGUAL_IQAMA
        document, warnings = self._extract(fixture)
        self._report(fixture, document, warnings)

        self.assertEqual(document.extracted_fields.get("iqama_number"), fixture.expected["iqama_number"])
        self.assertEqual(document.extracted_fields.get("iqama_expiry_date"), fixture.expected["iqama_expiry_date"])
        self.assertEqual(document.extraction_status, EmployeeDocument.ExtractionStatus.SUCCESS, warnings)

    def test_arabic_iqama_extracts_the_identity_number(self):
        fixture = fixtures.ARABIC_IQAMA
        document, warnings = self._extract(fixture)
        self._report(fixture, document, warnings)

        self.assertEqual(document.extracted_fields.get("iqama_number"), fixture.expected["iqama_number"])
        self.assertIn(
            document.extraction_status,
            {EmployeeDocument.ExtractionStatus.SUCCESS, EmployeeDocument.ExtractionStatus.PARTIAL},
        )

    def test_bilingual_saudi_id_extracts_required_fields(self):
        fixture = fixtures.BILINGUAL_SAUDI_ID
        document, warnings = self._extract(fixture)
        self._report(fixture, document, warnings)

        self.assertEqual(document.extracted_fields.get("iqama_number"), fixture.expected["iqama_number"])
        self.assertEqual(document.extraction_status, EmployeeDocument.ExtractionStatus.SUCCESS, warnings)

    def test_visa_extracts_number_exit_date_and_duration(self):
        fixture = fixtures.VISA
        document, warnings = self._extract(fixture)
        self._report(fixture, document, warnings)

        self.assertEqual(document.visa_number, fixture.expected["visa_number"])
        self.assertEqual(document.exit_before.isoformat(), "2026-06-30")
        self.assertEqual(document.visa_duration, 45)
        self.assertEqual(document.extraction_status, EmployeeDocument.ExtractionStatus.SUCCESS, warnings)

    def test_passport_mrz_is_read_and_its_check_digits_validate(self):
        fixture = fixtures.PASSPORT
        document, warnings = self._extract(fixture)
        self._report(fixture, document, warnings)

        self.assertEqual(document.extracted_fields.get("passport_number"), fixture.expected["passport_number"])
        self.assertEqual(document.extracted_fields.get("expiry_date"), fixture.expected["expiry_date"])
        self.assertTrue(document.extraction_metadata["checks"]["document_number"])
        self.assertEqual(document.extraction_status, EmployeeDocument.ExtractionStatus.SUCCESS, warnings)

    # --- degraded inputs -----------------------------------------------------

    def test_rotated_card_is_recovered(self):
        """A sideways scan still yields the required fields.

        Recovery can come from PaddleOCR's angle classifier or from the
        pipeline's page-rotation search, so the assertion is on the extracted
        result rather than on which mechanism happened to fix it.
        """

        fixture = fixtures.ENGLISH_IQAMA
        document, warnings = self._extract(fixture, rotate=270)
        self._report(fixture, document, warnings)

        self.assertEqual(document.extracted_fields.get("iqama_number"), fixture.expected["iqama_number"])
        self.assertEqual(document.extracted_fields.get("iqama_expiry_date"), fixture.expected["iqama_expiry_date"])

    def test_low_quality_scan_still_extracts_or_reports_clearly(self):
        fixture = fixtures.ENGLISH_IQAMA
        document, warnings = self._extract(fixture, scale=0.55, noise=True)
        self._report(fixture, document, warnings)

        if document.extraction_status == EmployeeDocument.ExtractionStatus.SUCCESS:
            self.assertEqual(document.extracted_fields.get("iqama_number"), fixture.expected["iqama_number"])
        else:
            # A degraded scan must never be silently accepted.
            self.assertNotEqual(document.extraction_status, EmployeeDocument.ExtractionStatus.SUCCESS)
            self.assertTrue(warnings)

    def test_scanned_pdf_is_rendered_and_extracted(self):
        fixture = fixtures.BILINGUAL_SAUDI_ID
        document, warnings = self._extract(fixture, as_pdf=True)
        self._report(fixture, document, warnings)

        self.assertEqual(document.extraction_metadata["source"], "pdf_render")
        self.assertEqual(document.extracted_fields.get("iqama_number"), fixture.expected["iqama_number"])

    def test_blank_page_fails_rather_than_inventing_fields(self):
        import io

        from PIL import Image

        buffer = io.BytesIO()
        Image.new("RGB", (900, 600), "white").save(buffer, format="PNG")
        document = self._document(EmployeeDocument.DocumentType.IQAMA, "blank.png", buffer.getvalue())

        warnings = extract_document_fields(document)
        document.refresh_from_db()

        self.assertNotEqual(document.extraction_status, EmployeeDocument.ExtractionStatus.SUCCESS)
        self.assertTrue(warnings)
        self.assertFalse(document.extracted_fields.get("iqama_number"))

    # --- offline guarantee ---------------------------------------------------

    def test_engine_resolves_local_models_for_every_language(self):
        for language in engine.SUPPORTED_LANGUAGES:
            with self.subTest(language=language):
                dirs = engine.discover_model_dirs(language)
                self.assertTrue(dirs.get("det_model_dir"), f"no detection model for {language}")
                self.assertTrue(dirs.get("rec_model_dir"), f"no recognition model for {language}")

    def test_bilingual_documents_run_both_language_passes(self):
        fixture = fixtures.BILINGUAL_IQAMA
        document, _ = self._extract(fixture)

        self.assertEqual(document.extraction_metadata["passes"], ["en", "ar"])

    def test_passport_runs_the_english_pass_only(self):
        document, _ = self._extract(fixtures.PASSPORT)

        self.assertEqual(document.extraction_metadata["passes"], ["en"])
