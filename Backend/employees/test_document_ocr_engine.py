"""Engine-level behaviour: model discovery, result normalisation, rotation retry.

The PaddleOCR runtime is stubbed here. These tests protect the glue that has to
keep working when the inference package moves between majors, and the offline
guarantee that the worker never downloads a model at request time.
"""

from unittest.mock import patch

from django.test import TestCase, override_settings
from PIL import Image

from .ocr import engine
from .ocr.engine import (
    OcrEngineUnavailable,
    OcrLine,
    OcrPageResult,
    discover_model_dirs,
    prepare_image,
    read_file_bytes,
)
from .ocr.pipeline import _languages_for, _ocr_page, merge_bilingual_lines

PADDLE_2X_RESULT = [
    [
        [[[10, 10], [200, 10], [200, 40], [10, 40]], ("P<EGYSAMPLE<<EMPLOYEE", 0.97)],
        [[[10, 50], [200, 50], [200, 80], [10, 80]], ("X123456784EGY9001011M3001018", 0.91)],
    ]
]

PADDLE_3X_RESULT = [
    {
        "rec_texts": ["P<EGYSAMPLE<<EMPLOYEE", "X123456784EGY9001011M3001018"],
        "rec_scores": [0.97, 0.91],
    }
]


class ResultNormalisationTests(TestCase):
    def test_paddleocr_2x_layout_is_normalised(self):
        lines = engine._normalise_paddle_result(PADDLE_2X_RESULT, page=0)

        self.assertEqual([line.text for line in lines], ["P<EGYSAMPLE<<EMPLOYEE", "X123456784EGY9001011M3001018"])
        self.assertAlmostEqual(lines[0].confidence, 0.97)
        self.assertEqual(lines[1].page, 0)

    def test_paddleocr_3x_layout_is_normalised(self):
        lines = engine._normalise_paddle_result(PADDLE_3X_RESULT, page=1)

        self.assertEqual([line.text for line in lines], ["P<EGYSAMPLE<<EMPLOYEE", "X123456784EGY9001011M3001018"])
        self.assertAlmostEqual(lines[1].confidence, 0.91)
        self.assertEqual(lines[0].page, 1)

    def test_empty_and_none_results_are_tolerated(self):
        self.assertEqual(engine._normalise_paddle_result(None, page=0), [])
        self.assertEqual(engine._normalise_paddle_result([], page=0), [])
        self.assertEqual(engine._normalise_paddle_result([None], page=0), [])


class ModelProvisioningTests(TestCase):
    def _provision(self, root, language_dir, kind, weight="inference.pdmodel"):
        path = root / "whl" / kind / language_dir / "v1"
        path.mkdir(parents=True, exist_ok=True)
        (path / weight).write_bytes(b"model")
        (path / "inference.pdiparams").write_bytes(b"weights")
        return path

    def test_model_dirs_are_discovered_by_scanning_the_managed_root(self):
        from pathlib import Path
        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            det = self._provision(root, "arabic_PP-OCRv3_det", "det")
            rec = self._provision(root, "arabic_PP-OCRv4_rec", "rec")
            cls = self._provision(root, "ch_ppocr_mobile_v2.0_cls", "cls")

            dirs = discover_model_dirs("ar", root=root)

            self.assertEqual(dirs["det_model_dir"], str(det))
            self.assertEqual(dirs["rec_model_dir"], str(rec))
            self.assertEqual(dirs["cls_model_dir"], str(cls))

    def test_missing_model_root_yields_no_dirs(self):
        from pathlib import Path

        self.assertEqual(discover_model_dirs("ar", root=Path("/nonexistent-model-root")), {})

    @override_settings(
        EMPLOYEE_DOCUMENT_OCR_MODEL_DIR="/nonexistent-model-root",
        EMPLOYEE_DOCUMENT_OCR_ALLOW_MODEL_DOWNLOAD=False,
    )
    def test_unprovisioned_models_refuse_to_run_rather_than_downloading(self):
        engine.reset_engine_cache()
        self.addCleanup(engine.reset_engine_cache)

        with patch.dict("sys.modules", {"paddleocr": type("Module", (), {"PaddleOCR": object})}):
            with self.assertRaises(OcrEngineUnavailable) as caught:
                engine.get_engine("ar")

        self.assertIn("not provisioned", str(caught.exception))

    def test_engine_metadata_reports_engine_and_languages(self):
        metadata = engine.engine_metadata()

        self.assertEqual(metadata["engine"], "paddleocr")
        self.assertEqual(metadata["languages"], ["en", "ar"])
        self.assertIn("engine_version", metadata)
        self.assertIn("model_dir", metadata)


class RotationRetryTests(TestCase):
    def test_a_rotated_page_is_retried_until_it_reads(self):
        image = Image.new("RGB", (600, 400), "white")
        attempts = []

        def fake_recognize(_image, *, language, page, rotation):
            attempts.append(rotation)
            if rotation != 270:
                return OcrPageResult(lines=[OcrLine(text="::", confidence=0.2)], rotation=rotation, page=page)
            return OcrPageResult(
                lines=[OcrLine(text="P<EGYSAMPLE<<EMPLOYEE<<<<<<<<<<", confidence=0.95)],
                rotation=rotation,
                page=page,
            )

        with patch("employees.ocr.pipeline.recognize_image", side_effect=fake_recognize):
            result = _ocr_page(image, document_type="PASSPORT", page=0)

        self.assertEqual(attempts[:2], [0, 270])
        self.assertEqual(result.rotation, 270)
        self.assertIn("P<EGY", result.text)

    def test_a_readable_upright_page_is_not_rotated(self):
        image = Image.new("RGB", (600, 400), "white")
        attempts = []

        def fake_recognize(_image, *, language, page, rotation):
            attempts.append(rotation)
            return OcrPageResult(
                lines=[OcrLine(text="P<EGYSAMPLE<<EMPLOYEE<<<<<<<<<<", confidence=0.95)],
                rotation=rotation,
                page=page,
            )

        with patch("employees.ocr.pipeline.recognize_image", side_effect=fake_recognize):
            result = _ocr_page(image, document_type="PASSPORT", page=0)

        self.assertEqual(attempts, [0])
        self.assertEqual(result.rotation, 0)


class ImagePreparationTests(TestCase):
    @override_settings(EMPLOYEE_DOCUMENT_OCR_MAX_IMAGE_DIMENSION=500)
    def test_oversized_images_are_bounded(self):
        prepared = prepare_image(Image.new("RGB", (4000, 2000), "white"))

        self.assertLessEqual(max(prepared.size), 500)

    @override_settings(EMPLOYEE_DOCUMENT_OCR_MAX_IMAGE_DIMENSION=5000)
    def test_small_images_are_left_alone(self):
        prepared = prepare_image(Image.new("RGB", (640, 480), "white"))

        self.assertEqual(prepared.size, (640, 480))


class StorageReadTests(TestCase):
    class _Field:
        def __init__(self, error=None, data=b"payload"):
            self.error = error
            self.data = data
            self.closed = False

        def open(self, _mode):
            if isinstance(self.error, Exception):
                raise self.error

        def read(self):
            return self.data

        def close(self):
            self.closed = True

    def test_missing_file_is_a_permanent_failure(self):
        with self.assertRaises(OcrEngineUnavailable):
            read_file_bytes(self._Field(error=FileNotFoundError()))

    def test_io_errors_are_retryable(self):
        from .ocr.engine import TransientExtractionError

        with self.assertRaises(TransientExtractionError):
            read_file_bytes(self._Field(error=OSError("device busy")))

    def test_successful_read_closes_the_handle(self):
        field = self._Field()

        self.assertEqual(read_file_bytes(field), b"payload")
        self.assertTrue(field.closed)


class BilingualMergeTests(TestCase):
    """Coordinate-aware selection between the English and Arabic passes."""

    @staticmethod
    def _page(language, lines):
        return OcrPageResult(
            lines=[OcrLine(text=text, confidence=conf, box=box, language=language) for text, conf, box in lines],
            language=language,
        )

    def test_the_same_region_read_twice_keeps_the_right_script(self):
        box = (10.0, 10.0, 300.0, 50.0)
        english = self._page("en", [("aSLooJI awjJ1", 0.67, box)])
        arabic = self._page("ar", [("المملكة العربية", 0.97, box)])

        merged = merge_bilingual_lines([english, arabic])

        self.assertEqual([line.text for line in merged], ["المملكة العربية"])

    def test_latin_text_is_taken_from_the_english_pass(self):
        box = (10.0, 10.0, 400.0, 50.0)
        english = self._page("en", [("Iqama Number: 2345678904", 0.90, box)])
        arabic = self._page("ar", [("Iqama Number 2345678904", 0.95, box)])

        merged = merge_bilingual_lines([english, arabic])

        self.assertEqual([line.text for line in merged], ["Iqama Number: 2345678904"])

    def test_a_fragment_inside_a_wider_line_never_evicts_it(self):
        """The bug this guards: an Arabic word box swallowing a line with digits."""

        wide = (10.0, 100.0, 500.0, 140.0)
        fragment = (300.0, 105.0, 400.0, 135.0)
        english = self._page("en", [("2345678904 :رقم الهوية", 0.90, wide)])
        arabic = self._page("ar", [("رقم", 0.99, fragment)])

        merged = merge_bilingual_lines([english, arabic])
        texts = [line.text for line in merged]

        self.assertIn("2345678904 :رقم الهوية", texts)
        self.assertIn("رقم", texts)

    def test_non_overlapping_lines_are_all_kept_in_reading_order(self):
        english = self._page(
            "en",
            [
                ("SECOND", 0.9, (10.0, 100.0, 200.0, 130.0)),
                ("FIRST", 0.9, (10.0, 10.0, 200.0, 40.0)),
            ],
        )

        merged = merge_bilingual_lines([english])

        self.assertEqual([line.text for line in merged], ["FIRST", "SECOND"])

    def test_lines_without_geometry_are_preserved(self):
        page = OcrPageResult(lines=[OcrLine(text="TEXT LAYER", confidence=1.0)], language="en")

        merged = merge_bilingual_lines([page])

        self.assertEqual([line.text for line in merged], ["TEXT LAYER"])

    def test_the_merge_is_order_independent(self):
        box = (10.0, 10.0, 300.0, 50.0)
        english = self._page("en", [("aSLooJI", 0.67, box)])
        arabic = self._page("ar", [("المملكة", 0.97, box)])

        forward = merge_bilingual_lines([english, arabic])
        backward = merge_bilingual_lines([arabic, english])

        self.assertEqual([line.text for line in forward], [line.text for line in backward])


class LanguageSelectionTests(TestCase):
    def test_passports_use_the_english_pass_only(self):
        self.assertEqual(_languages_for("PASSPORT"), ("en",))

    def test_saudi_documents_run_both_passes(self):
        for document_type in ("IQAMA", "SAUDI_ID", "VISA"):
            with self.subTest(document_type=document_type):
                self.assertEqual(_languages_for(document_type), ("en", "ar"))
