"""Safe, bounded thumbnails for privately stored employee documents.

The thumbnail is a derived, first-page-only image.  It never creates a public
storage URL and deliberately discards the source bytes once the response has
been created.
"""

from __future__ import annotations

from io import BytesIO
from pathlib import Path

from django.conf import settings
from PIL import Image, ImageOps, UnidentifiedImageError


class DocumentThumbnailError(RuntimeError):
    """A document cannot safely be represented as a thumbnail."""


THUMBNAIL_SIZE = (420, 300)
MAX_THUMBNAIL_PIXELS = 16_000_000
DEFAULT_MAX_SOURCE_BYTES = 6 * 1024 * 1024


def _max_source_bytes() -> int:
    configured = int(getattr(settings, "EMPLOYEE_DOCUMENT_THUMBNAIL_MAX_SOURCE_BYTES", DEFAULT_MAX_SOURCE_BYTES))
    return max(1, min(configured, 10 * 1024 * 1024))


def _read_private_file(file_field) -> bytes:
    maximum = _max_source_bytes()
    try:
        file_field.open("rb")
        data = file_field.read(maximum + 1)
    except FileNotFoundError as exc:
        raise DocumentThumbnailError("The document file is missing from storage.") from exc
    except OSError as exc:
        raise DocumentThumbnailError("The document file could not be read from storage.") from exc
    finally:
        try:
            file_field.close()
        except Exception:
            pass
    if len(data) > maximum:
        raise DocumentThumbnailError("The document is too large to preview.")
    if not data:
        raise DocumentThumbnailError("The document is empty.")
    return data


def _render_pdf_first_page(data: bytes) -> Image.Image:
    import pypdfium2 as pdfium

    try:
        document = pdfium.PdfDocument(data)
    except Exception as exc:
        raise DocumentThumbnailError("The PDF could not be opened for preview.") from exc

    try:
        if len(document) < 1:
            raise DocumentThumbnailError("The PDF has no pages to preview.")
        page = document[0]
        try:
            # One modest rendering pass is enough for a compact HR comparison
            # card, and avoids allocating OCR-sized multi-page bitmaps.
            bitmap = page.render(scale=1.0)
            try:
                return bitmap.to_pil().convert("RGB").copy()
            finally:
                bitmap.close()
        finally:
            page.close()
    except DocumentThumbnailError:
        raise
    except Exception as exc:
        raise DocumentThumbnailError("The PDF could not be rendered for preview.") from exc
    finally:
        document.close()


def _open_image(data: bytes) -> Image.Image:
    try:
        with Image.open(BytesIO(data)) as source:
            if source.width * source.height > MAX_THUMBNAIL_PIXELS:
                raise DocumentThumbnailError("The image is too large to preview.")
            source.load()
            return ImageOps.exif_transpose(source).convert("RGB").copy()
    except DocumentThumbnailError:
        raise
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError, ValueError) as exc:
        raise DocumentThumbnailError("The image could not be opened for preview.") from exc


def build_document_thumbnail(file_field) -> bytes:
    """Return a JPEG thumbnail for a supported private employee document."""

    extension = Path(file_field.name or "").suffix.lower()
    data = _read_private_file(file_field)
    if extension == ".pdf":
        image = _render_pdf_first_page(data)
    elif extension in {".jpg", ".jpeg", ".png"}:
        image = _open_image(data)
    else:
        raise DocumentThumbnailError("This document type cannot be previewed.")

    image.thumbnail(THUMBNAIL_SIZE, Image.Resampling.LANCZOS)
    output = BytesIO()
    image.save(output, format="JPEG", quality=82, optimize=True, progressive=True)
    return output.getvalue()
