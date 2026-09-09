"""Compatibility surface for the employee document OCR pipeline.

The implementation moved to `employees.ocr` when the pilot replaced Tesseract
with self-hosted PaddleOCR. Existing callers (`employees.tasks`,
`employees.views`, `leaves.views`) keep importing from here.
"""

from .ocr import OCR_DOCUMENT_TYPES, OcrEngineUnavailable, TransientExtractionError
from .ocr.parsers import parse_date, parse_document
from .ocr.pipeline import extract_document_fields, extract_visa_fields

__all__ = [
    "OCR_DOCUMENT_TYPES",
    "OcrEngineUnavailable",
    "TransientExtractionError",
    "extract_document_fields",
    "extract_visa_fields",
    "parse_date",
    "parse_document",
]
