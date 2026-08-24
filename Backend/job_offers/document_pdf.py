import json

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas

from core.pdf import shape_ar
from core.views_templates import resolve_template_path

MIN_FONT_SIZE = 4.2


def contains_arabic(value: str) -> bool:
    return any("\u0600" <= char <= "\u06ff" for char in value)


def load_document_field_map(document_key: str, individual_map_filename: str) -> dict:
    """Load the combined HR document map, with the legacy individual map as fallback."""

    combined_path = resolve_template_path("hr_documents_combined_field_map.json")
    if combined_path:
        try:
            with open(combined_path, encoding="utf-8") as field_map_file:
                combined = json.load(field_map_file)
            fields = combined.get("documents", {}).get(document_key, {}).get("fields")
            if isinstance(fields, dict) and fields:
                return fields
        except (OSError, ValueError, TypeError):
            pass

    individual_path = resolve_template_path(individual_map_filename)
    if individual_path:
        try:
            with open(individual_path, encoding="utf-8") as field_map_file:
                fields = json.load(field_map_file)
            if isinstance(fields, dict):
                return fields
        except (OSError, ValueError, TypeError):
            pass
    return {}


def fit_font_size(text: str, font: str, preferred_size: float, max_width: float) -> float:
    size = preferred_size
    while size > MIN_FONT_SIZE and pdfmetrics.stringWidth(shape_ar(text), font, size) > max_width:
        size -= 0.2
    return max(size, MIN_FONT_SIZE)


def _wrap_lines(text: str, font: str, size: float, max_width: float) -> list[str]:
    words = text.split()
    if not words:
        return []
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        if pdfmetrics.stringWidth(shape_ar(candidate), font, size) <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def _fit_multiline(
    text: str,
    font: str,
    preferred_size: float,
    max_width: float,
    max_height: float,
    max_lines: int,
) -> tuple[list[str], float]:
    size = preferred_size
    lines = _wrap_lines(text, font, size, max_width)
    while size > MIN_FONT_SIZE:
        line_height = size * 1.15
        if len(lines) <= max_lines and (size + (len(lines) - 1) * line_height) <= max_height:
            break
        size -= 0.2
        lines = _wrap_lines(text, font, size, max_width)

    if len(lines) > max_lines:
        kept = lines[: max_lines - 1]
        final_line = " ".join(lines[max_lines - 1 :])
        ellipsis = "…"
        while final_line and pdfmetrics.stringWidth(shape_ar(final_line + ellipsis), font, size) > max_width:
            final_line = final_line[:-1].rstrip()
        kept.append(final_line + ellipsis if final_line else ellipsis)
        lines = kept
    return lines, max(size, MIN_FONT_SIZE)


def draw_mapped_value(pdf: canvas.Canvas, field: dict, value: object, *, font: str) -> None:
    text = str(value or "").strip()
    if not text:
        return

    x = float(field["x"])
    y = float(field["y"])
    width = float(field["width"])
    height = float(field["height"])
    preferred_size = float(field.get("font_size", 7.2))
    max_width = max(width - 6, 1)
    is_arabic = contains_arabic(text)

    if field.get("multiline"):
        max_lines = max(1, int(field.get("max_lines", 2)))
        lines, size = _fit_multiline(text, font, preferred_size, max_width, max(height - 2, 1), max_lines)
        line_height = size * 1.15
        block_height = size + max(0, len(lines) - 1) * line_height
        baseline = y + ((height + block_height) / 2) - size
        pdf.setFont(font, size)
        for line in lines:
            shaped = shape_ar(line)
            if is_arabic:
                pdf.drawRightString(x + width - 3, baseline, shaped)
            else:
                pdf.drawCentredString(x + (width / 2), baseline, shaped)
            baseline -= line_height
        return

    shaped = shape_ar(text)
    size = fit_font_size(text, font, preferred_size, max_width)
    pdf.setFont(font, size)
    baseline = y + max(2, (height - size) / 2)
    if is_arabic:
        pdf.drawRightString(x + width - 3, baseline, shaped)
    else:
        pdf.drawCentredString(x + (width / 2), baseline, shaped)


def draw_checkbox(pdf: canvas.Canvas, checkbox: list[float] | tuple[float, float] | None, *, font: str) -> None:
    if not checkbox:
        return
    x, y = checkbox
    pdf.setFont(font, 8)
    pdf.drawCentredString(float(x), float(y) - 3, "X")
