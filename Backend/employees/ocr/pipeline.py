"""Extraction orchestration: read the file, OCR it, parse it, persist the outcome."""

from __future__ import annotations

import logging
import re
import time
from datetime import date
from io import BytesIO
from pathlib import Path

from django.conf import settings
from django.utils import timezone
from PIL import Image, UnidentifiedImageError

from ..models import EmployeeDocument
from .engine import (
    OcrEngineUnavailable,
    OcrLine,
    OcrPageResult,
    TransientExtractionError,
    engine_metadata,
    extract_pdf_text,
    prepare_image,
    read_file_bytes,
    recognize_image,
    render_pdf_images,
)
from .parsers import ParseResult, parse_date, parse_document

logger = logging.getLogger(__name__)

OCR_DOCUMENT_TYPES = {
    EmployeeDocument.DocumentType.PASSPORT,
    EmployeeDocument.DocumentType.IQAMA,
    EmployeeDocument.DocumentType.SAUDI_ID,
    EmployeeDocument.DocumentType.VISA,
}

# Rotations tried when the first pass looks unreadable. Scanned identity cards
# are routinely fed sideways.
_ROTATIONS = (0, 270, 90, 180)
_MIN_TEXT_LAYER_CHARACTERS = 25

MISSING_ENGINE_MESSAGE = "OCR is unavailable on the worker. Ask an administrator to check the OCR model provisioning, then re-run extraction."
UNREADABLE_MESSAGE = "OCR did not detect readable text. Upload a clearer scan, then re-run extraction."
GENERIC_FAILURE_MESSAGE = "Document extraction failed. Re-run extraction, or contact an administrator if it repeats."


def _setting(name: str, default):
    return getattr(settings, name, default)


def _languages_for(document_type: str) -> tuple[str, ...]:
    """Which recognition passes a document type needs.

    A passport MRZ is Latin-only, so the English model alone is both faster and
    more accurate. Every Saudi card is bilingual: the Arabic model reads the
    Arabic script, and the English model reads the Latin names, ID digits and
    dates that the parsers actually validate. Neither model is trusted to do the
    other's job - the two passes are merged by coordinate below.
    """

    if document_type == EmployeeDocument.DocumentType.PASSPORT:
        return ("en",)
    return tuple(_setting("EMPLOYEE_DOCUMENT_OCR_BILINGUAL_LANGUAGES", ("en", "ar")))


def _area(box) -> float:
    if not box:
        return 0.0
    return max((box[2] - box[0]) * (box[3] - box[1]), 0.0)


def _containment(first, second) -> float:
    """Overlap as a fraction of the SMALLER box.

    Intersection-over-union is the wrong measure here: the two models segment
    the page differently, and the Arabic pass routinely splits one Latin line
    into separate word boxes. Those fragments never reach a meaningful IoU with
    the full line, but they are almost entirely contained inside it.
    """

    if not first or not second:
        return 0.0
    left = max(first[0], second[0])
    top = max(first[1], second[1])
    right = min(first[2], second[2])
    bottom = min(first[3], second[3])
    if right <= left or bottom <= top:
        return 0.0
    intersection = (right - left) * (bottom - top)
    smaller = min(_area(first), _area(second))
    return intersection / smaller if smaller > 0 else 0.0


def _overlap_ratio(box, other) -> float:
    """How much of `box` lies inside `other`."""

    if not box or not other:
        return 0.0
    left = max(box[0], other[0])
    top = max(box[1], other[1])
    right = min(box[2], other[2])
    bottom = min(box[3], other[3])
    if right <= left or bottom <= top:
        return 0.0
    own_area = _area(box)
    return ((right - left) * (bottom - top)) / own_area if own_area > 0 else 0.0


def _prefer(candidate: OcrLine, incumbent: OcrLine) -> bool:
    """Pick the better reading of one region, deterministically.

    Script decides first: a model reading foreign script produces plausible
    nonsense at high confidence, so an Arabic-script reading is only trusted
    from the Arabic pass and Latin text only from the English pass. Within one
    script the wider box wins, because the parsers match `Label: value` lines
    and a full line beats the word fragments it was split into. Confidence and
    then the text itself break the remaining ties, so the merge never depends
    on which pass happened to run first.
    """

    if candidate.is_arabic != incumbent.is_arabic:
        arabic_line, latin_line = (candidate, incumbent) if candidate.is_arabic else (incumbent, candidate)
        winner = arabic_line if arabic_line.language == "ar" else latin_line
        return winner is candidate

    if candidate.language != incumbent.language:
        expected = "ar" if candidate.is_arabic else "en"
        if candidate.language == expected:
            return True
        if incumbent.language == expected:
            return False

    candidate_area, incumbent_area = _area(candidate.box), _area(incumbent.box)
    if candidate_area and incumbent_area and abs(candidate_area - incumbent_area) > 1.0:
        return candidate_area > incumbent_area

    if abs(candidate.confidence - incumbent.confidence) > 1e-9:
        return candidate.confidence > incumbent.confidence
    return candidate.text < incumbent.text


def merge_bilingual_lines(results: list[OcrPageResult]) -> list[OcrLine]:
    """Combine per-language passes, keeping one reading per detected region.

    Lines that sit on top of each other - by containment, see `_containment` -
    are the same region read twice; `_prefer` decides which reading survives.
    Output is ordered top-to-bottom then left-to-right so the parsers see the
    document in reading order.
    """

    threshold = float(_setting("EMPLOYEE_DOCUMENT_OCR_MERGE_OVERLAP", 0.6))
    kept: list[OcrLine] = []
    for result in results:
        for line in result.lines:
            if not line.clean_text:
                continue
            if not line.box:
                kept.append(line)
                continue
            # Only *mutually* contained boxes are the same region read twice.
            # A fragment merely sitting inside a wider line is kept alongside it:
            # the two models segment differently, and a bilingual row read whole
            # by one pass carries digits the other pass split away. Dropping the
            # wider line to keep a fragment loses those digits outright, so this
            # merge only ever removes a genuine duplicate.
            duplicate = next(
                (
                    index
                    for index, existing in enumerate(kept)
                    if existing.box
                    and _containment(line.box, existing.box) >= threshold
                    and _overlap_ratio(line.box, existing.box) >= threshold
                    and _overlap_ratio(existing.box, line.box) >= threshold
                ),
                None,
            )
            if duplicate is None:
                kept.append(line)
            elif _prefer(line, kept[duplicate]):
                kept[duplicate] = line

    def order(line: OcrLine):
        if not line.box:
            return (line.page, 0.0, 0.0)
        return (line.page, round(line.box[1], 1), round(line.box[0], 1))

    return sorted(kept, key=order)


def _ocr_page(image: Image.Image, *, document_type: str, page: int) -> OcrPageResult:
    """OCR one page in every required language, retrying rotations as needed.

    The orientation is settled with the first language, then reused for the rest:
    a page is not sideways for one model and upright for another, and re-searching
    per language would multiply inference cost for no gain.
    """

    languages = _languages_for(document_type)
    prepared = prepare_image(image)

    best: OcrPageResult | None = None
    for rotation in _ROTATIONS:
        candidate_image = prepared.rotate(rotation, expand=True) if rotation else prepared
        result = recognize_image(candidate_image, language=languages[0], page=page, rotation=rotation)
        if best is None or result.score() > best.score():
            best = result
        if best.is_readable():
            break
    if best is None:
        return OcrPageResult(page=page)

    results = [best]
    if len(languages) > 1:
        oriented = prepared.rotate(best.rotation, expand=True) if best.rotation else prepared
        for language in languages[1:]:
            results.append(recognize_image(oriented, language=language, page=page, rotation=best.rotation))

    return OcrPageResult(
        lines=merge_bilingual_lines(results),
        rotation=best.rotation,
        page=page,
        language="+".join(languages),
    )


def _pdf_text_layer_lines(text: str) -> list[OcrLine]:
    """A digital PDF text layer is exact; record it at full confidence."""

    return [OcrLine(text=line, confidence=1.0, page=0) for line in text.splitlines() if line.strip()]


def _document_lines(document: EmployeeDocument) -> tuple[list[OcrLine], dict]:
    data = read_file_bytes(document.file)
    if not data:
        raise OcrEngineUnavailable("The document file is empty.")

    extension = Path(document.original_filename or document.file.name).suffix.lower()
    metadata: dict = {"source": "image", "pages": 1}

    if extension == ".pdf":
        embedded = extract_pdf_text(data).strip()
        if len(re.sub(r"\s+", "", embedded)) >= _MIN_TEXT_LAYER_CHARACTERS:
            metadata.update({"source": "pdf_text_layer", "pages": embedded.count("\f") + 1})
            return _pdf_text_layer_lines(embedded), metadata
        images = render_pdf_images(data)
        metadata.update({"source": "pdf_render", "pages": len(images)})
    else:
        try:
            with Image.open(BytesIO(data)) as image:
                images = [image.copy()]
        except UnidentifiedImageError as exc:
            raise OcrEngineUnavailable("The uploaded file is not a readable image.") from exc

    lines: list[OcrLine] = []
    rotations: list[int] = []
    for page_number, image in enumerate(images):
        page_result = _ocr_page(image, document_type=document.document_type, page=page_number)
        lines.extend(page_result.lines)
        rotations.append(page_result.rotation)
    metadata["rotations"] = rotations
    metadata["passes"] = list(_languages_for(document.document_type))
    return lines, metadata


def _field_confidence(fields: dict[str, str], lines: list[OcrLine]) -> dict[str, float]:
    """Attribute each extracted value to the line it most likely came from."""

    confidence: dict[str, float] = {}
    for key, value in fields.items():
        if key.startswith("_"):
            continue
        needle = re.sub(r"\s+", "", str(value)).upper()
        if not needle:
            continue
        for line in lines:
            haystack = re.sub(r"\s+", "", line.text).upper()
            if needle and needle in haystack:
                confidence[key] = round(float(line.confidence), 4)
                break
    return confidence


def _overall_confidence(lines: list[OcrLine]) -> float:
    scored = [line.confidence for line in lines if line.text.strip()]
    return round(sum(scored) / len(scored), 4) if scored else 0.0


def _apply_visa_columns(document: EmployeeDocument, parsed: ParseResult) -> list[str]:
    exit_before_iso = parsed.fields.pop("_exit_before", "")
    duration_text = parsed.fields.pop("_visa_duration", "")
    document.visa_number = parsed.fields.get("visa_number", "")
    document.exit_before_raw = parsed.fields.get("exit_before_raw", "")
    document.exit_before = date.fromisoformat(exit_before_iso) if exit_before_iso else None
    document.visa_duration_raw = parsed.fields.get("visa_duration_raw", "")
    document.visa_duration = int(duration_text) if duration_text.isdigit() else None
    return ["visa_number", "exit_before", "exit_before_raw", "visa_duration", "visa_duration_raw"]


def _save_failure(document: EmployeeDocument, message: str) -> list[str]:
    document.extraction_status = EmployeeDocument.ExtractionStatus.FAILED
    document.extraction_error = message
    document.extraction_warnings = [message]
    document.extraction_completed_at = timezone.now()
    document.extraction_metadata = {**engine_metadata(), **(document.extraction_metadata or {})}
    document.save(
        update_fields=[
            "extraction_status",
            "extraction_error",
            "extraction_warnings",
            "extraction_completed_at",
            "extraction_metadata",
            "updated_at",
        ]
    )
    return [message]


def _mark_not_applicable(document: EmployeeDocument) -> list[str]:
    """Non-identity documents are archived as-is; there is nothing to extract."""

    document.extraction_status = EmployeeDocument.ExtractionStatus.SUCCESS
    document.extraction_error = ""
    document.extraction_warnings = []
    document.extraction_confidence = None
    document.extraction_completed_at = timezone.now()
    document.extraction_metadata = {**engine_metadata(), "ocr": "skipped"}
    document.save(
        update_fields=[
            "extraction_status",
            "extraction_error",
            "extraction_warnings",
            "extraction_confidence",
            "extraction_completed_at",
            "extraction_metadata",
            "updated_at",
        ]
    )
    return []


def extract_document_fields(document: EmployeeDocument) -> list[str]:
    """Extract fields for the stored classification without ever changing document_type.

    Returns the warning list. Employee master data is never written here: a
    `success` result only means the document itself validated.
    """

    if document.document_type not in OCR_DOCUMENT_TYPES:
        return _mark_not_applicable(document)

    started = time.monotonic()
    try:
        lines, source_metadata = _document_lines(document)
    except TransientExtractionError:
        raise
    except OcrEngineUnavailable as exc:
        logger.warning(
            "employee_document_ocr_unavailable",
            extra={"document_id": document.id, "reason": str(exc)},
        )
        return _save_failure(document, MISSING_ENGINE_MESSAGE)
    except Exception:
        logger.exception("employee_document_ocr_failed", extra={"document_id": document.id})
        return _save_failure(document, GENERIC_FAILURE_MESSAGE)

    text = "\n".join(line.text for line in lines)
    if not text.strip():
        return _save_failure(document, UNREADABLE_MESSAGE)

    parsed = parse_document(document.document_type, text)
    warnings = list(parsed.warnings)
    update_fields = [
        "extracted_fields",
        "extraction_raw_text",
        "extraction_error",
        "extraction_status",
        "extraction_warnings",
        "extraction_confidence",
        "extraction_metadata",
        "extraction_completed_at",
        "updated_at",
    ]
    if document.document_type == EmployeeDocument.DocumentType.VISA:
        update_fields.extend(_apply_visa_columns(document, parsed))

    overall_confidence = _overall_confidence(lines)
    minimum_confidence = float(_setting("EMPLOYEE_DOCUMENT_OCR_MIN_CONFIDENCE", 0.6))
    low_confidence = overall_confidence < minimum_confidence
    if low_confidence:
        warnings.append(
            f"OCR confidence {overall_confidence:.2f} is below the {minimum_confidence:.2f} threshold; verify every field."
        )

    fields = {key: value for key, value in parsed.fields.items() if not key.startswith("_")}
    document.extracted_fields = fields
    document.extraction_raw_text = text
    document.extraction_error = ""
    document.extraction_warnings = warnings
    document.extraction_confidence = overall_confidence
    document.extraction_metadata = {
        **engine_metadata(),
        **source_metadata,
        "checks": parsed.checks,
        "field_confidence": _field_confidence(fields, lines),
        "min_confidence": minimum_confidence,
        "duration_ms": int((time.monotonic() - started) * 1000),
        "line_count": len(lines),
    }
    document.extraction_status = (
        EmployeeDocument.ExtractionStatus.SUCCESS
        if parsed.valid and not low_confidence
        else EmployeeDocument.ExtractionStatus.PARTIAL
    )
    document.extraction_completed_at = timezone.now()
    document.save(update_fields=update_fields)
    return warnings


def extract_visa_fields(document: EmployeeDocument) -> list[str]:
    """Backward-compatible entry point used by the business-trip completion workflow."""

    if document.document_type != EmployeeDocument.DocumentType.VISA:
        return []
    return extract_document_fields(document)


__all__ = [
    "GENERIC_FAILURE_MESSAGE",
    "MISSING_ENGINE_MESSAGE",
    "OCR_DOCUMENT_TYPES",
    "UNREADABLE_MESSAGE",
    "extract_document_fields",
    "extract_visa_fields",
    "parse_date",
]
