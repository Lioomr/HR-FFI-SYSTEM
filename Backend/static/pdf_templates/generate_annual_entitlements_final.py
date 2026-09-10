from __future__ import annotations

import argparse
import json
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

try:
    import arabic_reshaper
    from bidi.algorithm import get_display
except ImportError:  # pragma: no cover - generation environment guard
    arabic_reshaper = None
    get_display = None


OUT_DIR = Path(__file__).resolve().parent
PDF_PATH = OUT_DIR / "annual_entitlements_disbursement_blank.pdf"
MAP_PATH = OUT_DIR / "annual_entitlements_disbursement_blank_field_map.json"
DEFAULT_LOGO = Path("output_logo_transparent.png")
PAGE_W, PAGE_H = A4

ORANGE = colors.HexColor("#FF5A00")
TEXT = colors.HexColor("#151515")
MUTED = colors.HexColor("#55585C")
BORDER = colors.HexColor("#C8CBCF")
CELL = colors.HexColor("#ECEDEF")
DATA = colors.HexColor("#FCFCFC")
ARABIC_FONT_SCALE = 1.20
FIELD_MAP: dict[str, dict] = {}


def register_fonts() -> tuple[str, str]:
    candidates = {
        "FFIRegular": [Path(r"C:\\Windows\\Fonts\\arial.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")],
        "FFIBold": [Path(r"C:\\Windows\\Fonts\\arialbd.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")],
    }
    selected = {"FFIRegular": "Helvetica", "FFIBold": "Helvetica-Bold"}
    for name, paths in candidates.items():
        for path in paths:
            if path.exists():
                pdfmetrics.registerFont(TTFont(name, str(path)))
                selected[name] = name
                break
    return selected["FFIRegular"], selected["FFIBold"]


REGULAR, BOLD = register_fonts()


def shape_arabic(value: str) -> str:
    if arabic_reshaper and get_display:
        return get_display(arabic_reshaper.reshape(value))
    return value


def bottom(top: float, height: float = 0) -> float:
    return PAGE_H - top - height


def text(pdf: canvas.Canvas, x: float, top: float, value: str, *, size: float = 7, bold: bool = False, right: bool = False, color=TEXT) -> None:
    pdf.setFillColor(color)
    pdf.setFont(BOLD if bold else REGULAR, size)
    if right:
        pdf.drawRightString(x, PAGE_H - top - size, value)
    else:
        pdf.drawString(x, PAGE_H - top - size, value)


def arabic(pdf: canvas.Canvas, x: float, top: float, value: str, **kwargs) -> None:
    size = float(kwargs.pop("size", 7)) * ARABIC_FONT_SCALE
    text(pdf, x, top, shape_arabic(value), size=size, right=True, **kwargs)


def rect(pdf: canvas.Canvas, x: float, top: float, width: float, height: float, *, fill, stroke=BORDER) -> None:
    pdf.setFillColor(fill)
    pdf.setStrokeColor(stroke)
    pdf.setLineWidth(0.55)
    pdf.rect(x, bottom(top, height), width, height, fill=1, stroke=1)


def field(key: str, x: float, top: float, width: float, height: float, **extra) -> None:
    FIELD_MAP[key] = {"page": 1, "x": round(x, 2), "y": round(bottom(top, height), 2), "width": round(width, 2), "height": round(height, 2), **extra}


def input_box(pdf: canvas.Canvas, key: str, x: float, top: float, width: float, height: float, **extra) -> None:
    rect(pdf, x, top, width, height, fill=DATA)
    field(key, x, top, width, height, **extra)


def section(pdf: canvas.Canvas, top: float, en: str, ar: str) -> None:
    pdf.setFillColor(ORANGE)
    pdf.rect(15, bottom(top + 5, 6), 6, 6, fill=1, stroke=0)
    text(pdf, 28, top, en, size=10.5, bold=True)
    arabic(pdf, PAGE_W - 17, top, ar, size=10.5, bold=True)


def label_pair(pdf: canvas.Canvas, top: float, height: float, en: str, ar: str) -> None:
    rect(pdf, 15, top, 87, height, fill=CELL)
    rect(pdf, PAGE_W - 85, top, 70, height, fill=CELL)
    text(pdf, 23, top + (height - 7) / 2, en, size=6.6)
    arabic(pdf, PAGE_W - 22, top + (height - 7) / 2, ar, size=6.6)


def signature(pdf: canvas.Canvas, key: str, x: float, width: float, en: str, ar: str) -> None:
    text(pdf, x + 10, 666, en, size=7.0, bold=True, color=MUTED)
    arabic(pdf, x + width - 10, 678, ar, size=6.4, color=MUTED)
    signature_x, signature_top, signature_height = x + 10, 690, 56
    signature_width = width - 20
    FIELD_MAP[f"{key}_signature_image"] = {
        "page": 1, "x": round(signature_x, 2), "y": round(bottom(signature_top, signature_height), 2),
        "width": round(signature_width, 2), "height": signature_height, "kind": "image", "padding": 3,
        "source": f"request.signers.{key}.signature",
    }
    pdf.setStrokeColor(MUTED)
    pdf.setLineWidth(0.55)
    pdf.line(signature_x, bottom(752), signature_x + signature_width, bottom(752))
    text(pdf, x + 10, 766, "Date", size=6.2, color=MUTED)
    date_x, date_width = x + 45, width - 55
    pdf.line(date_x, bottom(772), date_x + date_width, bottom(772))
    field(f"{key}_signature_date", date_x, 756, date_width, 16, font_size=6.2, shrink=True, source="annual_entitlements.workflow_timestamp")


def build(logo_path: Path) -> None:
    if not logo_path.exists():
        raise FileNotFoundError(f"FFI logo was not found: {logo_path}")
    FIELD_MAP.clear()
    pdf = canvas.Canvas(str(PDF_PATH), pagesize=A4, pageCompression=1)
    pdf.setTitle("FFI Annual Entitlements Disbursement Request Blank Template")

    logo = ImageReader(str(logo_path))
    logo_width = 220
    logo_height = logo_width * logo.getSize()[1] / logo.getSize()[0]
    pdf.drawImage(logo, 15, bottom(14, logo_height), logo_width, logo_height, mask="auto")
    text(pdf, PAGE_W - 15, 14, "Annual Entitlements", size=17, bold=True, right=True)
    text(pdf, PAGE_W - 15, 34, "Disbursement Request", size=10.4, right=True, color=MUTED)
    arabic(pdf, PAGE_W - 15, 51, "طلب صرف المستحقات السنوية", size=13, bold=True)
    pdf.setStrokeColor(ORANGE)
    pdf.setLineWidth(0.8)
    pdf.line(15, bottom(78), PAGE_W - 15, bottom(78))

    for x, width in [(15, 176), (202, 176), (389, 191)]:
        rect(pdf, x, 86, width, 28, fill=CELL)
    text(pdf, 23, 96, "Reference No.", size=7.3, bold=True)
    input_box(pdf, "reference_no", 89, 91, 78, 18, font_size=8)
    text(pdf, 210, 96, "Request Date", size=7.3, bold=True)
    input_box(pdf, "request_date", 290, 91, 74, 18, font_size=7.4)
    text(pdf, 397, 96, "Filed Date", size=7.3, bold=True)
    input_box(pdf, "filed_date", 465, 91, 92, 18, font_size=7.4, source="annual_entitlements.filed_at")

    section(pdf, 130, "Request Details", "تفاصيل الطلب")
    label_pair(pdf, 150, 32, "Purpose", "الغرض")
    input_box(pdf, "purpose", 102, 153, 406, 26, font_size=8, multiline=True, max_lines=2, shrink=True)
    label_pair(pdf, 182, 25, "Employee Name", "اسم الموظف")
    input_box(pdf, "employee_name", 102, 185, 406, 19, font_size=8, shrink=True, source="employee.full_name")
    label_pair(pdf, 207, 25, "Employee ID", "رقم الموظف")
    input_box(pdf, "employee_id", 102, 210, 406, 19, font_size=8, shrink=True, source="employee.employee_id")
    label_pair(pdf, 232, 25, "Department", "الإدارة")
    input_box(pdf, "department", 102, 235, 406, 19, font_size=8, shrink=True, source="employee.department")

    section(pdf, 278, "Employee Declaration", "إقرار الموظف")
    rect(pdf, 15, 297, PAGE_W - 30, 161, fill=DATA)
    declaration_en = [
        "I request the disbursement of my annual entitlements in accordance with the",
        "company policy. I confirm that the information provided in this request is correct",
        "and I understand that the request remains subject to the applicable approval process.",
    ]
    declaration_ar = [
        "أطلب صرف مستحقاتي السنوية وفقاً لسياسة الشركة. وأقر بأن المعلومات المقدمة",
        "في هذا الطلب صحيحة، وأتفهم أن الطلب يخضع لمسار الاعتماد المعمول به.",
    ]
    for index, value in enumerate(declaration_en):
        text(pdf, 29, 316 + index * 16, value, size=8.3, color=MUTED)
    for index, value in enumerate(declaration_ar):
        arabic(pdf, PAGE_W - 29, 380 + index * 16, value, size=8.3, color=MUTED)
    field("letter_body", 28, 307, PAGE_W - 56, 141, font_size=8.2, multiline=True, max_lines=7)

    label_pair(pdf, 473, 25, "Applicant Name", "اسم مقدم الطلب")
    input_box(pdf, "applicant_name", 102, 476, 406, 19, font_size=8, shrink=True, source="employee.full_name")
    section(pdf, 523, "Signatures", "التوقيعات")
    pdf.setStrokeColor(ORANGE)
    pdf.setLineWidth(0.9)
    pdf.line(15, bottom(542), PAGE_W - 15, bottom(542))

    applicant_x, applicant_width = 15, 185
    text(pdf, applicant_x + 10, 552, "Applicant", size=7, bold=True, color=MUTED)
    arabic(pdf, applicant_x + applicant_width - 10, 564, "مقدم الطلب", size=6.4, color=MUTED)
    FIELD_MAP["applicant_signature_image"] = {
        "page": 1, "x": 25, "y": round(bottom(576, 62), 2), "width": 165, "height": 62,
        "kind": "image", "padding": 3, "source": "request.signers.applicant.signature",
    }
    pdf.setStrokeColor(MUTED)
    pdf.line(25, bottom(644), 190, bottom(644))
    text(pdf, 25, 657, "Date", size=6.2, color=MUTED)
    pdf.line(60, bottom(663), 190, bottom(663))
    field("applicant_signature_date", 60, 647, 130, 16, font_size=6.2, shrink=True, source="annual_entitlements.workflow_timestamp")
    pdf.setStrokeColor(BORDER)
    pdf.line(200, bottom(550), 200, bottom(680))

    approval_width = (PAGE_W - 215) / 3
    for index, (key, en, ar) in enumerate([
        ("financial_management", "Financial Management", "الإدارة المالية"),
        ("hr_department", "HR Department", "الموارد البشرية"),
        ("accounts_officer", "Accounts Officer", "مسؤول الحسابات"),
    ]):
        x = 200 + index * approval_width
        signature(pdf, key, x, approval_width, en, ar)
        if index < 2:
            pdf.setStrokeColor(BORDER)
            pdf.line(x + approval_width, bottom(550), x + approval_width, bottom(680))

    pdf.showPage()
    pdf.save()
    MAP_PATH.write_text(json.dumps(FIELD_MAP, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate the annual entitlements request template.")
    parser.add_argument("--logo", type=Path, default=DEFAULT_LOGO, help="Path to the FFI logo PNG.")
    args = parser.parse_args()
    build(args.logo)
