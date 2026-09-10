"""Map-driven renderer shared by every bundled HR request form.

Each supported form ships as a pair: the blank PDF that HR approved and a field
map that names every printable box on it.  The pair is the source of truth, so
this module never carries per-form coordinates.  Views hand over plain values
and (optionally) signature images keyed by the map's own field names; anything
the map does not declare is silently ignored rather than guessed onto the page.

Two map schemas exist in the bundle and both are accepted:

``flat``
    ``{"<field>": {"page": 1, "x": .., "y": .., "width": .., "height": ..}}``
``versioned``
    ``{"template": .., "version": 3, "fields": {"<field>": {...}}}``

Coordinates use the PDF's own bottom-left origin at 1 unit = 1 point, matching
ReportLab, so a spec is drawn exactly where the map says it belongs.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from dataclasses import field as dataclass_field
from io import BytesIO
from pathlib import Path
from typing import Any, Iterable, Mapping

from pypdf import PdfReader, PdfWriter
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas

from core.pdf import font_pair, shape_ar
from core.views_templates import resolve_template_path

logger = logging.getLogger(__name__)

MIN_FONT_SIZE = 4.6
DEFAULT_FONT_SIZE = 7.5
DEFAULT_PADDING = 3.0
#: A signature smaller than this is an unreadable smear; skip it instead.
MIN_SIGNATURE_HEIGHT = 7.0
MIN_SIGNATURE_WIDTH = 14.0
#: Signature images are operator uploads, so cap what we are willing to decode.
MAX_SIGNATURE_BYTES = 2 * 1024 * 1024
_IMAGE_MAGIC = (b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff")

# Diagnostic states recorded per signature slot. They are safe to log and to
# expose in backend telemetry: they never carry bytes, paths, or tokens.
SIGNATURE_PLACED = "placed"
SIGNATURE_MISSING = "missing"
SIGNATURE_INVALID = "invalid"
SIGNATURE_UNPLACEABLE = "unplaceable"
SIGNATURE_UNMAPPED = "unmapped"


@dataclass(frozen=True)
class SignatureAsset:
    """A signer's stored signature image, already read into memory.

    ``signer_label`` is a human name for diagnostics only. The originating
    storage path is deliberately absent so it can never reach a log line, an
    audit row, or an API response.
    """

    data: bytes
    signer_label: str = ""

    def is_supported_image(self) -> bool:
        return bool(self.data) and self.data.startswith(_IMAGE_MAGIC) and len(self.data) <= MAX_SIGNATURE_BYTES


@dataclass(frozen=True)
class FormAssets:
    """A resolved template and the field map that was stored beside it."""

    template_path: str
    fields: dict[str, dict[str, Any]]
    meta: dict[str, Any] = dataclass_field(default_factory=dict)

    @property
    def directory(self) -> str:
        return str(Path(self.template_path).parent)


def _normalise_fields(payload: Any) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    """Return ``(fields, meta)`` for either supported map schema."""

    if not isinstance(payload, dict):
        return {}, {}
    nested = payload.get("fields")
    if isinstance(nested, dict):
        meta = {key: value for key, value in payload.items() if key != "fields"}
        return {k: v for k, v in nested.items() if isinstance(v, dict)}, meta
    return {k: v for k, v in payload.items() if isinstance(v, dict)}, {}


def load_form_assets(
    template_filename: str,
    map_filename: str,
    *,
    aliases: Iterable[str] | None = None,
    required_keys: Iterable[str] = (),
) -> FormAssets | None:
    """Resolve a template and the map deployed alongside it, or return ``None``.

    ``resolve_template_path`` prefers ``HR_TEMPLATES_DIR`` and only then the
    bundled defaults.  The map is read from the *resolved* template's own
    directory, never from a different search tier: filling a production PDF with
    coordinates measured against the bundled PDF would silently place values in
    the wrong labelled boxes.  A template without its paired map therefore
    resolves to ``None`` so callers can take their documented fallback.
    """

    template_path = resolve_template_path(template_filename, aliases=list(aliases or []))
    if not template_path:
        logger.warning("pdf_form.template_unresolved", extra={"template": template_filename})
        return None

    map_path = Path(template_path).with_name(map_filename)
    try:
        payload = json.loads(map_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        logger.warning(
            "pdf_form.map_unreadable",
            extra={"template": template_filename, "field_map": map_filename},
        )
        return None

    fields, meta = _normalise_fields(payload)
    missing = sorted(set(required_keys) - set(fields))
    if not fields or missing:
        logger.warning(
            "pdf_form.map_incomplete",
            extra={"template": template_filename, "field_map": map_filename, "missing_fields": missing},
        )
        return None
    return FormAssets(template_path=template_path, fields=fields, meta=meta)


def _clean(value: Any) -> str:
    text = str(value if value is not None else "").strip()
    return "" if text in {"-", "None"} else text


def _is_rtl(text: str) -> bool:
    return any("؀" <= char <= "ۿ" for char in text)


def _rect(spec: Mapping[str, Any]) -> tuple[float, float, float, float]:
    """Return ``(x0, y0, x1, y1)`` in the map's bottom-left coordinate space."""

    x, y = float(spec["x"]), float(spec["y"])
    return x, y, x + float(spec["width"]), y + float(spec["height"])


def _fit_one_line(text: str, font: str, size: float, width: float) -> tuple[str, float]:
    shaped = shape_ar(text)
    while size > MIN_FONT_SIZE and pdfmetrics.stringWidth(shaped, font, size) > width:
        size -= 0.2
    if pdfmetrics.stringWidth(shaped, font, size) <= width:
        return shaped, size
    while shaped and pdfmetrics.stringWidth(f"{shaped}...", font, size) > width:
        shaped = shaped[:-1]
    return (f"{shaped}..." if shaped else "..."), size


def _wrap(text: str, font: str, size: float, width: float) -> list[str]:
    lines: list[str] = []
    current = ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if current and pdfmetrics.stringWidth(shape_ar(candidate), font, size) > width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def _place(pdf: canvas.Canvas, spec: Mapping[str, Any], shaped: str, x: float, width: float, baseline: float) -> None:
    """Draw one prepared line honouring the map's alignment (centred default)."""

    padding = float(spec.get("padding", DEFAULT_PADDING))
    align = spec.get("align", "center")
    if align == "left" and not _is_rtl(shaped):
        pdf.drawString(x + padding, baseline, shaped)
    elif align == "right" or _is_rtl(shaped):
        pdf.drawRightString(x + width - padding, baseline, shaped)
    else:
        pdf.drawCentredString(x + width / 2, baseline, shaped)


def draw_text_field(pdf: canvas.Canvas, spec: Mapping[str, Any], value: Any, *, font: str) -> bool:
    """Render one mapped text value. Returns whether anything was drawn."""

    text = _clean(value)
    if not text:
        return False
    x, y, _, _ = _rect(spec)
    width, height = float(spec["width"]), float(spec["height"])
    padding = float(spec.get("padding", DEFAULT_PADDING))
    preferred = float(spec.get("font_size", DEFAULT_FONT_SIZE))
    available = max(width - padding * 2, 1.0)
    pdf.setFillColorRGB(0.08, 0.08, 0.08)

    if spec.get("multiline"):
        max_lines = max(1, int(spec.get("max_lines", 2)))
        size = preferred
        lines = _wrap(text, font, size, available)
        while size > MIN_FONT_SIZE and (len(lines) > max_lines or len(lines) * size * 1.2 > height - 1):
            size -= 0.2
            lines = _wrap(text, font, size, available)
        if len(lines) > max_lines:
            lines = lines[:max_lines]
            lines[-1] = _fit_one_line(f"{lines[-1]}...", font, size, available)[0]
        line_height = size * 1.2
        baseline = y + (height + len(lines) * line_height) / 2 - size
        pdf.setFont(font, size)
        for line in lines:
            _place(pdf, spec, shape_ar(line), x, width, baseline)
            baseline -= line_height
        return True

    rendered, size = _fit_one_line(text, font, preferred, available)
    pdf.setFont(font, size)
    _place(pdf, spec, rendered, x, width, y + (height - size) / 2 + 1)
    return True


def draw_checkbox(pdf: canvas.Canvas, spec: Mapping[str, Any], selection: Any, *, font: str) -> bool:
    """Tick the checkbox anchor the map declares for ``selection``.

    ``selection`` may be the option key itself or a boolean, which maps onto the
    conventional ``yes``/``no`` pair used by the bundled forms.
    """

    anchors = spec.get("checkboxes") or {}
    if selection is None or not anchors:
        return False
    if isinstance(selection, bool):
        key = "yes" if selection else "no"
    else:
        key = str(selection).strip().lower()
    anchor = anchors.get(key)
    if not anchor:
        return False
    pdf.setFont(font, 8.5)
    pdf.setFillColorRGB(0, 0, 0)
    pdf.drawCentredString(float(anchor[0]), float(anchor[1]) - 3.1, "X")
    return True


def _largest_free_band(
    box: tuple[float, float, float, float],
    blockers: Iterable[tuple[float, float, float, float]],
) -> tuple[float, float] | None:
    """Return the tallest ``(y0, y1)`` slice of ``box`` no blocker covers.

    Several bundled maps deliberately let a signature box span the printed cell
    that also carries the approver's name, decision, or date.  Rather than paint
    over those values - or move the signature somewhere the map never approved -
    the image is confined to the free part of its own box.
    """

    x0, y0, x1, y1 = box
    spans: list[tuple[float, float]] = []
    for bx0, by0, bx1, by1 in blockers:
        if bx1 <= x0 or bx0 >= x1 or by1 <= y0 or by0 >= y1:
            continue
        spans.append((max(by0, y0), min(by1, y1)))
    if not spans:
        return (y0, y1)

    spans.sort()
    merged: list[list[float]] = [list(spans[0])]
    for start, end in spans[1:]:
        if start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])

    best: tuple[float, float] | None = None
    cursor = y0
    for start, end in merged + [[y1, y1]]:
        if start - cursor > 0 and (best is None or start - cursor > best[1] - best[0]):
            best = (cursor, start)
        cursor = max(cursor, end)
    return best


def draw_signature_image(
    pdf: canvas.Canvas,
    spec: Mapping[str, Any],
    asset: SignatureAsset,
    *,
    blockers: Iterable[tuple[float, float, float, float]] = (),
) -> str:
    """Draw a signature inside its mapped box. Returns a diagnostic state."""

    if not asset.is_supported_image():
        return SIGNATURE_INVALID
    band = _largest_free_band(_rect(spec), blockers)
    if band is None:
        return SIGNATURE_UNPLACEABLE

    padding = float(spec.get("padding", 2))
    x = float(spec["x"]) + padding
    width = float(spec["width"]) - padding * 2
    y = band[0] + padding
    height = (band[1] - band[0]) - padding * 2
    if width < MIN_SIGNATURE_WIDTH or height < MIN_SIGNATURE_HEIGHT:
        return SIGNATURE_UNPLACEABLE

    try:
        image = ImageReader(BytesIO(asset.data))
        source_width, source_height = image.getSize()
    except Exception:
        return SIGNATURE_INVALID
    if not source_width or not source_height:
        return SIGNATURE_INVALID

    scale = min(width / source_width, height / source_height)
    draw_width, draw_height = source_width * scale, source_height * scale
    pdf.drawImage(
        image,
        x + (width - draw_width) / 2,
        y + (height - draw_height) / 2,
        width=draw_width,
        height=draw_height,
        mask="auto",
        preserveAspectRatio=True,
        anchor="c",
    )
    return SIGNATURE_PLACED


def _page_number(spec: Mapping[str, Any]) -> int:
    try:
        return max(1, int(spec.get("page", 1)))
    except (TypeError, ValueError):
        return 1


IMAGE_FIELD_SUFFIX = "_image"


def superseded_text_fields(
    fields: Mapping[str, Mapping[str, Any]],
    signatures: Mapping[str, Any],
) -> set[str]:
    """Text fields a real signature replaces, named by the map's own convention.

    ``manager_signature_image`` and ``manager_signature`` are two spellings of
    one slot: the typed name is what the form shows until a scanned signature
    exists.  Only that exact twin is dropped - a neighbouring ``*_name`` or
    ``*_date`` that merely shares the area keeps its value and instead limits
    where the image may sit.
    """

    superseded = set()
    for key, asset in signatures.items():
        if asset is None or not key.endswith(IMAGE_FIELD_SUFFIX):
            continue
        twin = key[: -len(IMAGE_FIELD_SUFFIX)]
        if twin in fields and fields[twin].get("kind") != "image":
            superseded.add(twin)
    return superseded


def render_mapped_form(
    assets: FormAssets,
    values: Mapping[str, Any],
    *,
    signatures: Mapping[str, SignatureAsset | None] | None = None,
) -> tuple[bytes, list[dict[str, str]]]:
    """Overlay ``values`` and ``signatures`` onto the approved template pages.

    The original pages are preserved and merged with a generated overlay, so the
    company artwork, labels, and bilingual copy stay exactly as HR approved them.
    Returns the PDF bytes plus one diagnostic row per requested signature slot.
    """

    signatures = dict(signatures or {})
    reader = PdfReader(assets.template_path)
    if not reader.pages:
        raise ValueError(f"{Path(assets.template_path).name} has no pages.")

    regular_font, bold_font = font_pair()
    diagnostics: list[dict[str, str]] = []

    # Text and checkboxes are collected first: the boxes they actually fill
    # constrain signature placement, so a signature can never bury a value the
    # form has to show.
    occupied: dict[int, list[tuple[float, float, float, float]]] = {}
    text_ops: dict[int, list[tuple[dict, Any]]] = {}
    checkbox_ops: dict[int, list[tuple[dict, Any]]] = {}

    superseded = superseded_text_fields(assets.fields, signatures)
    for key, spec in assets.fields.items():
        if spec.get("kind") == "image" or key in superseded:
            continue
        page_no = _page_number(spec)
        if "checkboxes" in spec:
            if key in values:
                checkbox_ops.setdefault(page_no, []).append((spec, values[key]))
            continue
        if "x" not in spec:
            continue
        if _clean(values.get(key)):
            text_ops.setdefault(page_no, []).append((spec, values[key]))
            occupied.setdefault(page_no, []).append(_rect(spec))

    for key, asset in signatures.items():
        spec = assets.fields.get(key)
        if not spec or spec.get("kind") != "image" or "x" not in spec:
            diagnostics.append({"field": key, "state": SIGNATURE_UNMAPPED, "signer": ""})
        elif asset is None:
            diagnostics.append({"field": key, "state": SIGNATURE_MISSING, "signer": ""})

    output_pages = []
    for index, page in enumerate(reader.pages, start=1):
        width = float(page.mediabox.width)
        height = float(page.mediabox.height)
        buffer = BytesIO()
        pdf = canvas.Canvas(buffer, pagesize=(width, height), pageCompression=1)

        for spec, value in text_ops.get(index, []):
            draw_text_field(pdf, spec, value, font=regular_font)
        for spec, value in checkbox_ops.get(index, []):
            draw_checkbox(pdf, spec, value, font=bold_font)

        for key, asset in signatures.items():
            spec = assets.fields.get(key)
            if not spec or spec.get("kind") != "image" or "x" not in spec:
                continue
            if asset is None or _page_number(spec) != index:
                continue
            state = draw_signature_image(pdf, spec, asset, blockers=occupied.get(index, []))
            diagnostics.append({"field": key, "state": state, "signer": asset.signer_label})

        # An overlay with nothing on it must still be a one-page document, or
        # merging a page that has no values would fail instead of no-opping.
        pdf.showPage()
        pdf.save()
        buffer.seek(0)
        page.merge_page(PdfReader(buffer).pages[0])
        output_pages.append(page)

    result = BytesIO()
    writer = PdfWriter()
    for page in output_pages:
        writer.add_page(page)
    writer.write(result)
    return result.getvalue(), diagnostics


def log_signature_diagnostics(form_key: str, entity_id: Any, diagnostics: Iterable[Mapping[str, str]]) -> None:
    """Record unfilled signature slots so a missing signature is observable.

    Only field names, states, and signer display names are emitted - never image
    bytes, storage paths, or tokens.
    """

    unresolved = [row for row in diagnostics if row.get("state") != SIGNATURE_PLACED]
    if not unresolved:
        return
    logger.info(
        "pdf_form.signatures_unresolved",
        extra={
            "form": form_key,
            "entity_id": str(entity_id) if entity_id is not None else "",
            "slots": [{"field": row.get("field", ""), "state": row.get("state", "")} for row in unresolved],
        },
    )
