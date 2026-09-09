"""Regenerate the mapped, bilingual loan-request blank form.

Run from ``Backend`` after changing the companion field-map JSON.  The script
reads the map rather than duplicating its fill coordinates.
"""

from __future__ import annotations

import json
import argparse
from pathlib import Path

import arabic_reshaper
from bidi.algorithm import get_display
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[2]
MAP_PATH = ROOT / "static" / "pdf_templates" / "loan_request_blank_field_map.json"
OUTPUT_PATH = ROOT / "static" / "pdf_templates" / "loan_request_blank.pdf"
ORANGE = HexColor("#ff5a00")
NAVY = HexColor("#151515")
PALE = HexColor("#fff7ed")
GRID = HexColor("#c8cbcf")
LABEL = HexColor("#ecedef")


def _fonts() -> tuple[str, str]:
    regular_path = next(
        (
            path
            for path in ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", r"C:\Windows\Fonts\arial.ttf")
            if Path(path).exists()
        ),
        None,
    )
    bold_path = next(
        (
            path
            for path in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", r"C:\Windows\Fonts\arialbd.ttf")
            if Path(path).exists()
        ),
        None,
    )
    if regular_path and "LoanTemplate" not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont("LoanTemplate", regular_path))
    if bold_path and "LoanTemplateBold" not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont("LoanTemplateBold", bold_path))
    return (
        "LoanTemplate" if "LoanTemplate" in pdfmetrics.getRegisteredFontNames() else "Helvetica",
        "LoanTemplateBold" if "LoanTemplateBold" in pdfmetrics.getRegisteredFontNames() else "Helvetica-Bold",
    )


def _ar(text: str) -> str:
    return get_display(arabic_reshaper.reshape(text)) if text else ""


def _label(pdf: canvas.Canvas, spec: dict, y: float, height: float, regular: str, bold: str) -> None:
    left_x, left_width = 15, 87
    right_width = 70
    right_x = A4[0] - 15 - right_width
    pdf.setFillColor(LABEL)
    pdf.rect(left_x, y, left_width, height, fill=1, stroke=0)
    pdf.rect(right_x, y, right_width, height, fill=1, stroke=0)
    pdf.setFillColor(NAVY)
    label_size = 6.6
    while label_size > 5.0 and pdfmetrics.stringWidth(spec["label_en"], regular, label_size) > left_width - 16:
        label_size -= 0.2
    pdf.setFont(regular, label_size)
    pdf.drawString(left_x + 8, y + height / 2 - label_size / 2 + 0.5, spec["label_en"])
    arabic_label = _ar(spec["label_ar"])
    arabic_size = 6.6
    while arabic_size > 5.0 and pdfmetrics.stringWidth(arabic_label, regular, arabic_size) > right_width - 16:
        arabic_size -= 0.2
    pdf.setFont(regular, arabic_size)
    pdf.drawRightString(right_x + right_width - 8, y + height / 2 - arabic_size / 2 + 0.5, arabic_label)


def build(logo_path: Path) -> None:
    payload = json.loads(MAP_PATH.read_text(encoding="utf-8"))
    fields = payload["fields"]
    regular, bold = _fonts()
    width, height = A4
    pdf = canvas.Canvas(str(OUTPUT_PATH), pagesize=A4, pageCompression=1)
    pdf.setTitle("Loan Request Form")
    pdf.setAuthor("FFI HR System")

    pdf.setFillColor(white)
    pdf.rect(0, 0, width, height, fill=1, stroke=0)
    logo = ImageReader(str(logo_path))
    logo_width = 220
    logo_height = logo_width * logo.getSize()[1] / logo.getSize()[0]
    pdf.drawImage(logo, 15, height - 14 - logo_height, logo_width, logo_height, mask="auto")
    pdf.setFillColor(NAVY)
    pdf.setFont(bold, 18)
    pdf.drawRightString(width - 15, 811, "Loan Request")
    pdf.setFont(bold, 18)
    pdf.drawRightString(width - 15, 783, _ar("نموذج طلب سلفة"))
    pdf.setStrokeColor(ORANGE)
    pdf.setLineWidth(0.9)
    pdf.line(15, 768, width - 15, 768)

    header_specs = (
        ("reference_no", 15, 176, "Reference No."),
        ("request_date", 202, 176, "Request Date"),
        ("filed_date", 389, 191, "Filed Date"),
    )
    for key, x, box_width, label in header_specs:
        spec = fields[key]
        pdf.setFillColor(LABEL)
        pdf.rect(x, 733, box_width, 28, fill=1, stroke=0)
        pdf.setFillColor(NAVY)
        pdf.setFont(bold, 7.3)
        pdf.drawString(x + 8, 743, label)
        pdf.setFillColor(white)
        pdf.rect(float(spec["x"]), float(spec["y"]), float(spec["width"]), float(spec["height"]), fill=1, stroke=0)

    for section in payload["sections"].values():
        pdf.setFillColor(ORANGE)
        pdf.rect(15, float(section["y"]) - 3, 6, 6, fill=1, stroke=0)
        pdf.setFillColor(NAVY)
        pdf.setFont(bold, 10.5)
        pdf.drawString(28, float(section["y"]), section["title_en"])
        pdf.setFont(regular, 10)
        pdf.drawRightString(width - 17, float(section["y"]), _ar(section["title_ar"]))

    for key, spec in fields.items():
        if (
            key in {"reference_no", "request_date", "filed_date"}
            or key.endswith(("_approval_name", "_approval_decision", "_approval_date", "_signature"))
            or key.endswith("_signature_image")
            or key.startswith("disbursement_")
            or key == "reason_details"
        ):
            continue
        y, field_height = float(spec["y"]), float(spec["height"])
        _label(pdf, spec, y, field_height, regular, bold)
        pdf.setFillColor(white)
        pdf.rect(float(spec["x"]), y, float(spec["width"]), field_height, fill=1, stroke=0)

    reason = fields["reason_details"]
    pdf.setFillColor(white)
    pdf.rect(float(reason["x"]), float(reason["y"]), float(reason["width"]), float(reason["height"]), fill=1, stroke=0)

    signing_area = payload["signing_area"]
    pdf.setStrokeColor(ORANGE)
    pdf.setLineWidth(0.9)
    pdf.line(float(signing_area["x"]), 160, float(signing_area["x"]) + float(signing_area["width"]), 160)
    for index, role in enumerate(signing_area["roles"]):
        x = float(role["x"])
        role_width = float(role["width"])
        pdf.setFillColor(NAVY)
        pdf.setFont(bold, 6.6)
        pdf.drawCentredString(x + role_width / 2, 145, role["label_en"])
        pdf.setFont(regular, 6.1)
        pdf.drawCentredString(x + role_width / 2, 133, _ar(role["label_ar"]))
        pdf.setStrokeColor(HexColor("#55585c"))
        pdf.setLineWidth(0.55)
        pdf.line(x + 8, 78, x + role_width - 8, 78)
        pdf.setFillColor(HexColor("#55585c"))
        pdf.setFont(regular, 6)
        pdf.drawString(x + 8, 56, "Date")
        pdf.line(x + 40, 54, x + role_width - 8, 54)
        if index < len(signing_area["roles"]) - 1:
            pdf.setStrokeColor(GRID)
            pdf.setLineWidth(0.45)
            pdf.line(x + role_width, 65, x + role_width, 150)

    pdf.setStrokeColor(GRID)
    pdf.setLineWidth(0.65)
    for spec in fields.values():
        if "label_en" in spec:
            pdf.rect(
                15,
                float(spec["y"]),
                width - 30,
                float(spec["height"]),
                fill=0,
                stroke=1,
            )
    pdf.rect(float(reason["x"]), float(reason["y"]), float(reason["width"]), float(reason["height"]), fill=0, stroke=1)
    pdf.setFillColor(HexColor("#667085"))
    pdf.setFont(regular, 6.4)
    pdf.drawString(28, 29, "FFI HR System - confidential personnel record")
    pdf.drawRightString(width - 28, 29, _ar("سجل موارد بشرية سري"))
    pdf.save()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate the FFI Loan Request template.")
    parser.add_argument("--logo", type=Path, default=Path("output_logo_transparent.png"))
    args = parser.parse_args()
    build(args.logo)
