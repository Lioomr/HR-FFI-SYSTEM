"""Self-hosted PaddleOCR pipeline for employee identity documents.

The worker never reaches the internet at runtime: models are provisioned into
`settings.EMPLOYEE_DOCUMENT_OCR_MODEL_DIR` during the image build (or once into
a mounted volume via `manage.py provision_ocr_models`).
"""

from .engine import (
    OcrEngineUnavailable,
    OcrLine,
    OcrPageResult,
    TransientExtractionError,
    engine_metadata,
    reset_engine_cache,
)
from .pipeline import OCR_DOCUMENT_TYPES, extract_document_fields, extract_visa_fields

__all__ = [
    "OCR_DOCUMENT_TYPES",
    "OcrEngineUnavailable",
    "OcrLine",
    "OcrPageResult",
    "TransientExtractionError",
    "engine_metadata",
    "extract_document_fields",
    "extract_visa_fields",
    "reset_engine_cache",
]
