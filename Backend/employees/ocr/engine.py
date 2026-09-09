"""PaddleOCR engine wrapper and page rendering.

PaddleOCR is imported lazily so the rest of the employees app - and the whole
test suite - keeps working on a machine that has no inference stack installed.
Model directories are resolved from a provisioned root; downloading at request
time is refused unless it is explicitly enabled, because the OCR worker is not
supposed to have outbound network access.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path

from django.conf import settings
from PIL import Image, ImageOps

import paddle_models

logger = logging.getLogger(__name__)

# Language packs the pilot provisions. "ar" recognises Arabic script and the
# Latin characters printed next to it on Saudi cards; "en" is the sharper model
# for Latin-only pages such as passport MRZ bands.
SUPPORTED_LANGUAGES = paddle_models.SUPPORTED_LANGUAGES

_engine_lock = threading.Lock()
_engines: dict[str, object] = {}
_engine_version: str | None = None


class OcrEngineUnavailable(RuntimeError):
    """The OCR engine cannot run at all (missing package or unprovisioned models)."""


class TransientExtractionError(RuntimeError):
    """A retryable failure - storage hiccup, worker resource pressure."""


@dataclass(frozen=True)
class OcrLine:
    text: str
    confidence: float
    page: int = 0
    # (x0, y0, x1, y1) axis-aligned bounds of the detected box, in page pixels.
    # Empty when the source has no geometry (a PDF text layer, or a test fixture).
    box: tuple[float, float, float, float] | None = None
    # Which language pass produced the line, for bilingual selection and audit.
    language: str = ""

    @property
    def clean_text(self) -> str:
        return self.text.strip()

    @property
    def latin_ratio(self) -> float:
        """Share of Latin letters and digits among the line's alphanumerics."""

        alphanumerics = [char for char in self.text if char.isalnum()]
        if not alphanumerics:
            return 0.0
        latin = sum(1 for char in alphanumerics if char.isascii())
        return latin / len(alphanumerics)

    @property
    def is_arabic(self) -> bool:
        return any("؀" <= char <= "ۿ" for char in self.text)


@dataclass
class OcrPageResult:
    lines: list[OcrLine] = field(default_factory=list)
    rotation: int = 0
    page: int = 0
    language: str = ""

    @property
    def text(self) -> str:
        return "\n".join(line.text for line in self.lines)

    @property
    def mean_confidence(self) -> float:
        scored = [line.confidence for line in self.lines if line.text.strip()]
        return round(sum(scored) / len(scored), 4) if scored else 0.0

    @property
    def character_count(self) -> int:
        return sum(len(line.text.strip()) for line in self.lines)

    def score(self) -> float:
        """Rank a rotation attempt: readable characters weighted by confidence."""
        return self.character_count * max(self.mean_confidence, 0.01)

    def is_readable(self) -> bool:
        """Good enough to stop trying other orientations."""
        minimum_characters = int(_setting("EMPLOYEE_DOCUMENT_OCR_MIN_PAGE_CHARACTERS", 24))
        minimum_confidence = float(_setting("EMPLOYEE_DOCUMENT_OCR_MIN_CONFIDENCE", 0.6))
        return self.character_count >= minimum_characters and self.mean_confidence >= minimum_confidence


def _setting(name: str, default):
    return getattr(settings, name, default)


def model_root() -> Path:
    return Path(str(_setting("EMPLOYEE_DOCUMENT_OCR_MODEL_DIR", "/opt/paddleocr"))).expanduser()


def discover_model_dirs(language: str, root: Path | None = None) -> dict[str, str]:
    """Map PaddleOCR model kinds to provisioned directories.

    The scan itself lives in the Django-free `paddle_models` package so the image
    build can provision models in a layer that does not depend on app code.
    """

    return paddle_models.discover_model_dirs(language, root or model_root())


def engine_metadata() -> dict:
    """Engine identity recorded on every extraction, for later audit of results."""

    return {
        "engine": "paddleocr",
        "engine_version": _paddleocr_version(),
        "languages": list(SUPPORTED_LANGUAGES),
        "model_dir": str(model_root()),
    }


def _paddleocr_version() -> str:
    global _engine_version
    if _engine_version is None:
        try:
            from importlib.metadata import version

            _engine_version = version("paddleocr")
        except Exception:  # pragma: no cover - metadata missing in slim installs
            _engine_version = "unknown"
    return _engine_version


def reset_engine_cache() -> None:
    """Drop cached engines. Used by tests and by the provisioning command."""

    with _engine_lock:
        _engines.clear()


def get_engine(language: str):
    """Return a cached PaddleOCR instance bound to provisioned local models."""

    if language not in SUPPORTED_LANGUAGES:
        language = SUPPORTED_LANGUAGES[0]
    engine = _engines.get(language)
    if engine is not None:
        return engine

    with _engine_lock:
        engine = _engines.get(language)
        if engine is not None:
            return engine
        engine = _build_engine(language)
        _engines[language] = engine
        return engine


def _build_engine(language: str):
    try:
        from paddleocr import PaddleOCR
    except Exception as exc:  # pragma: no cover - exercised through OcrEngineUnavailable
        raise OcrEngineUnavailable("The PaddleOCR runtime is not installed on this worker.") from exc

    model_dirs = discover_model_dirs(language)
    allow_download = bool(_setting("EMPLOYEE_DOCUMENT_OCR_ALLOW_MODEL_DOWNLOAD", False))
    if not model_dirs.get("rec_model_dir") and not allow_download:
        raise OcrEngineUnavailable(
            "OCR models are not provisioned for language '%s' in the managed model directory." % language
        )

    kwargs = {
        "lang": language,
        "use_angle_cls": True,
        "show_log": False,
        "use_gpu": False,
        "cpu_threads": int(_setting("EMPLOYEE_DOCUMENT_OCR_CPU_THREADS", 2)),
        **model_dirs,
    }
    try:
        return PaddleOCR(**kwargs)
    except TypeError:
        # Newer PaddleOCR majors dropped some 2.x keyword arguments.
        minimal = {"lang": language, **model_dirs}
        return PaddleOCR(**minimal)
    except Exception as exc:
        raise OcrEngineUnavailable("The OCR engine failed to initialise.") from exc


def _is_line_entry(node) -> bool:
    """A 2.x recognised line is `[box, (text, score)]` - the payload identifies it.

    Nesting depth varies between releases, so the shape of the payload, not the
    depth, is what distinguishes a line from the list that contains it.
    """

    return (
        isinstance(node, (list, tuple))
        and len(node) >= 2
        and isinstance(node[1], (list, tuple))
        and len(node[1]) >= 2
        and isinstance(node[1][0], str)
        and isinstance(node[1][1], (int, float))
    )


def _bounds(polygon) -> tuple[float, float, float, float] | None:
    """Axis-aligned bounds of a PaddleOCR quadrilateral."""

    try:
        points = [(float(point[0]), float(point[1])) for point in polygon]
    except (TypeError, ValueError, IndexError):
        return None
    if not points:
        return None
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return (min(xs), min(ys), max(xs), max(ys))


def _collect_lines(node, page: int, language: str, lines: list[OcrLine]) -> None:
    if node is None:
        return
    if isinstance(node, dict):
        texts = node.get("rec_texts") or []
        scores = node.get("rec_scores") or []
        polygons = node.get("rec_polys") or node.get("dt_polys") or []
        for index, text in enumerate(texts):
            score = scores[index] if index < len(scores) else 0.0
            polygon = polygons[index] if index < len(polygons) else None
            lines.append(
                OcrLine(
                    text=str(text),
                    confidence=float(score or 0.0),
                    page=page,
                    box=_bounds(polygon) if polygon is not None else None,
                    language=language,
                )
            )
        return
    if _is_line_entry(node):
        lines.append(
            OcrLine(
                text=str(node[1][0]),
                confidence=float(node[1][1] or 0.0),
                page=page,
                box=_bounds(node[0]),
                language=language,
            )
        )
        return
    if isinstance(node, (list, tuple)):
        for item in node:
            _collect_lines(item, page, language, lines)


def _normalise_paddle_result(raw, page: int, language: str = "") -> list[OcrLine]:
    """Accept both the 2.x list layout and the 3.x dict layout."""

    lines: list[OcrLine] = []
    _collect_lines(raw, page, language, lines)
    return lines


def recognize_image(image: Image.Image, *, language: str, page: int = 0, rotation: int = 0) -> OcrPageResult:
    """Run one OCR pass over a prepared page image."""

    import numpy as np

    engine = get_engine(language)
    array = np.array(image.convert("RGB"))[:, :, ::-1]
    try:
        if hasattr(engine, "ocr"):
            raw = engine.ocr(array, cls=True)
        else:  # pragma: no cover - 3.x pipeline API
            raw = engine.predict(array)
    except OcrEngineUnavailable:
        raise
    except MemoryError as exc:
        raise TransientExtractionError("The OCR worker ran out of memory for this document.") from exc
    except Exception as exc:
        raise OcrEngineUnavailable("The OCR engine failed while reading this document.") from exc

    return OcrPageResult(
        lines=_normalise_paddle_result(raw, page, language), rotation=rotation, page=page, language=language
    )


def prepare_image(image: Image.Image) -> Image.Image:
    """Normalise orientation and size before OCR.

    PaddleOCR does its own binarisation, so the image is left in colour; only
    EXIF rotation and an upper size bound are applied.
    """

    image = ImageOps.exif_transpose(image).convert("RGB")
    max_dimension = int(_setting("EMPLOYEE_DOCUMENT_OCR_MAX_IMAGE_DIMENSION", 3000))
    if max(image.size) > max_dimension:
        image.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)
    return image


def read_file_bytes(file_field) -> bytes:
    """Read a private-storage file, mapping I/O blips to a retryable error."""

    try:
        file_field.open("rb")
    except FileNotFoundError as exc:
        raise OcrEngineUnavailable("The document file is missing from storage.") from exc
    except OSError as exc:
        raise TransientExtractionError("The document file could not be read from storage.") from exc
    try:
        return file_field.read()
    except OSError as exc:
        raise TransientExtractionError("The document file could not be read from storage.") from exc
    finally:
        try:
            file_field.close()
        except Exception:  # pragma: no cover - closing a partially opened handle
            logger.debug("employee_document_file_close_failed", exc_info=True)


def extract_pdf_text(data: bytes) -> str:
    """Embedded text layer, used to skip OCR on digitally generated PDFs."""

    from pypdf import PdfReader

    max_pages = int(_setting("EMPLOYEE_DOCUMENT_OCR_MAX_PAGES", 3))
    try:
        reader = PdfReader(BytesIO(data))
        return "\n".join((page.extract_text() or "") for page in reader.pages[:max_pages])
    except Exception:
        logger.info("employee_document_pdf_text_layer_unreadable", exc_info=True)
        return ""


def render_pdf_images(data: bytes) -> list[Image.Image]:
    import pypdfium2 as pdfium

    scale = float(_setting("EMPLOYEE_DOCUMENT_OCR_PDF_RENDER_SCALE", 2.5))
    max_pages = int(_setting("EMPLOYEE_DOCUMENT_OCR_MAX_PAGES", 3))
    try:
        document = pdfium.PdfDocument(data)
    except Exception as exc:
        raise OcrEngineUnavailable("The PDF could not be opened for rendering.") from exc

    images: list[Image.Image] = []
    try:
        for index in range(min(len(document), max_pages)):
            page = document[index]
            try:
                bitmap = page.render(scale=scale)
                try:
                    images.append(bitmap.to_pil().convert("RGB").copy())
                finally:
                    bitmap.close()
            finally:
                page.close()
    finally:
        document.close()
    return images
