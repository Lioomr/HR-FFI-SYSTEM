from __future__ import annotations

import io

import qrcode
from barcode import Code128
from barcode.writer import ImageWriter
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas as pdf_canvas

from core.pdf import PALETTE_RGB, font_pair, get_logo_path, register_fonts, shape_ar

LABEL_SIZES_MM = {
    "50X30": (50, 30),
    "40X30": (40, 30),
    "60X40": (60, 40),
}
PAPER_SIZES = {*LABEL_SIZES_MM.keys(), "A4_GRID"}


def _build_qr_png(code: str) -> bytes:
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_Q, box_size=10, border=2)
    qr.add_data(code)
    qr.make(fit=True)
    image = qr.make_image(fill_color="black", back_color="white").convert("RGB")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _build_code128_png(code: str) -> bytes:
    buffer = io.BytesIO()
    barcode = Code128(code, writer=ImageWriter())
    barcode.write(
        buffer,
        options={
            "module_height": 6.0,
            "module_width": 0.28,
            "quiet_zone": 1.0,
            "write_text": False,
            "dpi": 300,
        },
    )
    return buffer.getvalue()


def _truncate_to_width(text: object, font_name: str, font_size: float, max_width: float) -> str:
    value = str(text or "").strip()
    if not value:
        return "-"
    if pdfmetrics.stringWidth(value, font_name, font_size) <= max_width:
        return value
    ellipsis = "..."
    max_width = max(max_width - pdfmetrics.stringWidth(ellipsis, font_name, font_size), 0)
    result = ""
    for char in value:
        if pdfmetrics.stringWidth(result + char, font_name, font_size) > max_width:
            break
        result += char
    return (result or value[:1]) + ellipsis


def _draw_single_label(pdf, x: float, y: float, w: float, h: float, asset, company=None) -> None:
    regular, bold = font_pair()
    code = str(getattr(asset, "asset_code", "") or "")
    name = str(getattr(asset, "name_en", "") or code)
    size_key = _size_key(w, h)
    padding = 2.0 * mm

    pdf.saveState()
    pdf.setFillColorRGB(1, 1, 1)
    pdf.rect(x, y, w, h, fill=1, stroke=0)
    pdf.setStrokeColorRGB(*PALETTE_RGB["border_orange"])
    pdf.setLineWidth(0.35)
    pdf.rect(x + 0.4, y + 0.4, w - 0.8, h - 0.8, fill=0, stroke=1)

    logo = get_logo_path()
    if logo and size_key != "40X30":
        try:
            logo_w = 22 if size_key == "50X30" else 28
            logo_h = 14 if size_key == "50X30" else 18
            pdf.drawImage(
                ImageReader(logo),
                x + padding,
                y + h - logo_h - 3,
                width=logo_w,
                height=logo_h,
                preserveAspectRatio=True,
                mask="auto",
            )
        except Exception:
            pass

    qr_size = {"40X30": 52, "50X30": 60, "60X40": 80}.get(size_key, min(h - (8 * mm), w * 0.42))
    qr_size = min(qr_size, h - 10, w * 0.44)
    qr_x = x + w - qr_size - padding
    qr_y = y + h - qr_size - 2.2 * mm
    pdf.drawImage(ImageReader(io.BytesIO(_build_qr_png(code))), qr_x, qr_y, width=qr_size, height=qr_size, mask="auto")

    text_right = qr_x - 3
    text_width = max(text_right - (x + padding), 20)
    name_size = 7 if size_key != "60X40" else 8
    code_size = 11 if size_key != "60X40" else 13

    pdf.setFillColorRGB(*PALETTE_RGB["dark_text"])
    pdf.setFont(bold, name_size)
    name_y = y + (18.3 * mm if size_key != "60X40" else 25.5 * mm)
    pdf.drawString(x + padding, name_y, _truncate_to_width(name, bold, name_size, text_width))

    company_name = str(getattr(company, "name", "") or "")
    if size_key == "60X40" and company_name:
        pdf.setFont(regular, 5.5)
        pdf.setFillColorRGB(*PALETTE_RGB["muted_text"])
        pdf.drawString(x + padding, y + 21.0 * mm, _truncate_to_width(shape_ar(company_name), regular, 5.5, text_width))

    pdf.setFillColorRGB(*PALETTE_RGB["dark_text"])
    pdf.setFont(bold, code_size)
    code_y = y + (12.0 * mm if size_key != "60X40" else 15.3 * mm)
    pdf.drawString(x + padding, code_y, _truncate_to_width(code, bold, code_size, text_width))

    barcode_h = 14 if size_key != "60X40" else 17
    barcode_y = y + 2
    barcode_x = x + padding
    barcode_w = w - (2 * padding)
    pdf.drawImage(
        ImageReader(io.BytesIO(_build_code128_png(code))),
        barcode_x,
        barcode_y,
        width=barcode_w,
        height=barcode_h,
        preserveAspectRatio=True,
        mask="auto",
    )
    pdf.restoreState()


def _size_key(w: float, h: float) -> str:
    width_mm = round(w / mm)
    height_mm = round(h / mm)
    return f"{width_mm}X{height_mm}"


def _render_strip(assets, size_mm: tuple[int, int]) -> bytes:
    register_fonts()
    width, height = size_mm[0] * mm, size_mm[1] * mm
    buffer = io.BytesIO()
    pdf = pdf_canvas.Canvas(buffer, pagesize=(width, height))
    pdf.setTitle("Asset Labels")
    for asset in assets:
        _draw_single_label(pdf, 0, 0, width, height, asset, getattr(asset, "company", None))
        pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def _render_grid_a4(assets) -> bytes:
    register_fonts()
    buffer = io.BytesIO()
    width, height = A4
    pdf = pdf_canvas.Canvas(buffer, pagesize=A4)
    pdf.setTitle("Asset Labels")
    margin = 10 * mm
    cols = 2
    rows = 7
    cell_w = 70 * mm
    cell_h = 37 * mm
    col_gap = (width - (2 * margin) - (cols * cell_w)) / (cols - 1)
    row_gap = (height - (2 * margin) - (rows * cell_h)) / (rows - 1)

    for index, asset in enumerate(assets):
        page_index = index % (cols * rows)
        if index and page_index == 0:
            pdf.showPage()
        row = page_index // cols
        col = page_index % cols
        x = margin + col * (cell_w + col_gap)
        y = height - margin - ((row + 1) * cell_h) - (row * row_gap)
        pdf.setStrokeColorRGB(*PALETTE_RGB["grid_orange"])
        pdf.setDash(2, 2)
        pdf.rect(x, y, cell_w, cell_h, fill=0, stroke=1)
        pdf.setDash()
        _draw_single_label(
            pdf,
            x + 1.5 * mm,
            y + 1.5 * mm,
            cell_w - 3 * mm,
            cell_h - 3 * mm,
            asset,
            getattr(asset, "company", None),
        )

    pdf.save()
    return buffer.getvalue()


def render_labels_pdf(assets, paper_size: str) -> bytes:
    if paper_size not in PAPER_SIZES:
        raise ValueError("Unsupported paper size.")
    assets = list(assets)
    if paper_size == "A4_GRID":
        return _render_grid_a4(assets)
    return _render_strip(assets, LABEL_SIZES_MM[paper_size])
