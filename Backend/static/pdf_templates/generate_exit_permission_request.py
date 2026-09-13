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
PDF_PATH = OUT_DIR / "exit_permission_request_blank.pdf"
MAP_PATH = OUT_DIR / "exit_permission_request_blank_field_map.json"
DEFAULT_LOGO = Path(__file__).resolve().parents[3] / "output_logo_transparent.png"
PAGE_W, PAGE_H = A4

ORANGE = colors.HexColor("#FF5A00")
TEXT = colors.HexColor("#151515")
MUTED = colors.HexColor("#55585C")
BORDER = colors.HexColor("#C8CBCF")
CELL = colors.HexColor("#ECEDEF")
DATA = colors.HexColor("#FCFCFC")
WHITE = colors.white

FIELD_MAP: dict[str, dict] = {}


def register_fonts() -> tuple[str, str]:
    candidates = {
        "FFIRegular": [Path(r"C:\Windows\Fonts\arial.ttf"), Path(r"/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")],
        "FFIBold": [Path(r"C:\Windows\Fonts\arialbd.ttf"), Path(r"/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")],
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
    y = PAGE_H - top - size
    if right:
        pdf.drawRightString(x, y, value)
    else:
        pdf.drawString(x, y, value)


def ar_text(pdf: canvas.Canvas, x: float, top: float, value: str, *, size: float = 7, bold: bool = False, color=TEXT) -> None:
    text(pdf, x, top, shape_arabic(value), size=size * 1.05, bold=bold, right=True, color=color)


def rect(pdf: canvas.Canvas, x: float, top: float, width: float, height: float, *, fill=WHITE, stroke=BORDER, line=0.55) -> None:
    pdf.setFillColor(fill)
    pdf.setStrokeColor(stroke)
    pdf.setLineWidth(line)
    pdf.rect(x, bottom(top, height), width, height, fill=1, stroke=1)


def map_field(key: str, x: float, top: float, width: float, height: float, **extra) -> None:
    FIELD_MAP[key] = {
        "page": 1,
        "x": round(x, 2),
        "y": round(bottom(top, height), 2),
        "width": round(width, 2),
        "height": round(height, 2),
        **extra,
    }


def input_box(pdf: canvas.Canvas, key: str, x: float, top: float, width: float, height: float, **extra) -> None:
    rect(pdf, x, top, width, height, fill=DATA)
    map_field(key, x, top, width, height, **extra)


def section(pdf: canvas.Canvas, top: float, en: str, ar: str) -> None:
    pdf.setFillColor(ORANGE)
    pdf.rect(15, bottom(top + 5, 6), 6, 6, fill=1, stroke=0)
    text(pdf, 28, top, en, size=10.5, bold=True)
    ar_text(pdf, PAGE_W - 17, top, ar, size=10.5, bold=True)


def label_cell(pdf: canvas.Canvas, x: float, top: float, width: float, height: float, en: str, ar: str) -> None:
    rect(pdf, x, top, width, height, fill=CELL)
    text(pdf, x + 8, top + (height - 7) / 2, en, size=6.5)
    ar_text(pdf, x + width - 8, top + (height - 7) / 2, ar, size=6.5)


def labeled_row(pdf: canvas.Canvas, key: str, top: float, en: str, ar: str, *, height: float = 25, font_size: float = 7.8, multiline: bool = False, max_lines: int = 2) -> None:
    left_width = 145
    right_width = 145
    value_x = 15 + left_width
    value_width = PAGE_W - 30 - left_width - right_width
    rect(pdf, 15, top, left_width, height, fill=CELL)
    rect(pdf, PAGE_W - 15 - right_width, top, right_width, height, fill=CELL)
    text(pdf, 23, top + (height - 8) / 2, en, size=7.1)
    ar_text(pdf, PAGE_W - 23, top + (height - 8) / 2, ar, size=7.1)
    input_box(pdf, key, value_x, top + 3, value_width, height - 6, font_size=font_size, shrink=True, multiline=multiline, max_lines=max_lines)


def checkbox(pdf: canvas.Canvas, x: float, top: float, en: str, ar: str) -> tuple[float, float]:
    size = 10
    rect(pdf, x, top, size, size, fill=WHITE, stroke=MUTED)
    text(pdf, x + 15, top + 0.5, en, size=6.8)
    ar_text(pdf, x + 75, top + 0.5, ar, size=6.8)
    return x + size / 2, bottom(top, size) + size / 2


def signature_area(pdf: canvas.Canvas, key: str, top: float, en: str, ar: str, *, line_x: float = 25, line_width: float = 365, height: float = 58) -> None:
    text(pdf, line_x, top, en, size=7.2, bold=True)
    ar_text(pdf, line_x + line_width, top, ar, size=7.2, bold=True)
    signature_top = top + 14
    map_field(key, line_x, signature_top, line_width, height, kind="image", padding=4, source=f"request.signers.{key.removesuffix('_signature_image')}.signature")


def date_field(pdf: canvas.Canvas, key: str, top: float, *, source: str) -> None:
    x, width, height = 430, 135, 20
    rect(pdf, x, top, width, height, fill=CELL)
    text(pdf, x + 8, top + 6, "Date", size=6.8, bold=True)
    ar_text(pdf, x + width - 8, top + 6, "التاريخ", size=6.8, bold=True)
    input_box(pdf, key, x + 42, top + 3, width - 84, height - 6, font_size=6.8, shrink=True, source=source)


def build(logo_path: Path) -> None:
    if not logo_path.exists():
        raise FileNotFoundError(f"FFI logo was not found: {logo_path}")

    FIELD_MAP.clear()
    pdf = canvas.Canvas(str(PDF_PATH), pagesize=A4, pageCompression=1)
    pdf.setTitle("FFI Exit Permission Request Blank Template")

    logo = ImageReader(str(logo_path))
    logo_width = 220
    logo_height = logo_width * logo.getSize()[1] / logo.getSize()[0]
    pdf.drawImage(logo, 15, bottom(14, logo_height), logo_width, logo_height, mask="auto")
    text(pdf, PAGE_W - 15, 14, "EXIT PERMISSION REQUEST", size=17.5, bold=True, right=True)
    ar_text(pdf, PAGE_W - 15, 39, "طلب استئذان أثناء الدوام الرسمي", size=15.5, bold=True)
    pdf.setStrokeColor(ORANGE)
    pdf.setLineWidth(0.8)
    pdf.line(15, bottom(73), PAGE_W - 15, bottom(73))

    # Request metadata
    rect(pdf, 15, 81, 274, 28, fill=CELL)
    rect(pdf, 297, 81, 283, 28, fill=CELL)
    text(pdf, 23, 91, "Reference No.", size=7.3, bold=True)
    ar_text(pdf, 280, 91, "الرقم المرجعي", size=7.3, bold=True)
    input_box(pdf, "reference_no", 158, 86, 123, 18, font_size=8)
    text(pdf, 305, 91, "Request Date", size=7.3, bold=True)
    ar_text(pdf, 572, 91, "تاريخ الطلب", size=7.3, bold=True)
    input_box(pdf, "request_date", 440, 86, 123, 18, font_size=7.4)

    section(pdf, 118, "EMPLOYEE INFORMATION", "بيانات الموظف")
    employee_rows = [
        ("employee_name", "Employee Name", "اسم الموظف"),
        ("employee_id", "Employee ID", "الرقم الوظيفي"),
        ("department", "Department", "الإدارة"),
        ("job_title", "Job Title", "المسمى الوظيفي"),
        ("direct_manager", "Direct Manager", "المدير المباشر"),
    ]
    for index, row in enumerate(employee_rows):
        labeled_row(pdf, row[0], 137 + index * 25, row[1], row[2])

    section(pdf, 270, "EXIT DETAILS", "تفاصيل الاستئذان")
    # Three compact time/date fields
    columns = [(15, 183, "exit_date", "Exit Date", "تاريخ الاستئذان"), (206, 183, "from_time", "From Time", "من الساعة"), (397, 183, "to_time", "To Time", "إلى الساعة")]
    for x, width, key, en, ar in columns:
        label_cell(pdf, x, 289, width, 32, en, ar)
        input_box(pdf, key, x + 68, 296, width - 136, 18, font_size=7.5)

    label_cell(pdf, 15, 321, 145, 34, "Exit Type", "نوع الاستئذان")
    business = checkbox(pdf, 180, 333, "Business", "عمل")
    personal = checkbox(pdf, 330, 333, "Personal", "شخصي")
    emergency = checkbox(pdf, 480, 333, "Emergency", "طارئ")
    FIELD_MAP["exit_type"] = {"page": 1, "checkboxes": {"business": business, "personal": personal, "emergency": emergency}}

    label_cell(pdf, 15, 355, 145, 57, "Justification", "المبررات")
    input_box(pdf, "justification", 160, 358, 420, 51, font_size=7.2, multiline=True, max_lines=3)

    section(pdf, 424, "EMPLOYEE SIGNATURE", "توقيع الموظف")
    signature_area(pdf, "employee_signature_image", 444, "Employee Signature", "توقيع الموظف", height=62)
    date_field(pdf, "employee_signature_date", 514, source="request.created_at")

    section(pdf, 541, "MANAGER APPROVAL", "اعتماد المدير المباشر")
    label_cell(pdf, 15, 560, 95, 27, "Decision", "القرار")
    approved = checkbox(pdf, 145, 568, "Approved", "موافق")
    rejected = checkbox(pdf, 355, 568, "Rejected", "غير موافق")
    FIELD_MAP["manager_decision"] = {"page": 1, "checkboxes": {"approved": approved, "rejected": rejected}}
    labeled_row(pdf, "manager_name", 587, "Manager Name", "اسم المدير", height=24, font_size=7.6)
    signature_area(pdf, "manager_signature_image", 620, "Manager Signature", "توقيع المدير", height=54)
    date_field(pdf, "manager_signature_date", 674, source="request.manager_decision_at")

    section(pdf, 695, "HR DEPARTMENT USE", "لاستخدام إدارة الموارد البشرية")
    labeled_row(pdf, "hr_notes", 714, "Notes", "ملاحظات", height=25, font_size=7.5, multiline=True, max_lines=2)
    labeled_row(pdf, "hr_name", 739, "HR Name", "اسم مسؤول الموارد البشرية", height=24, font_size=7.5)
    signature_area(pdf, "hr_signature_image", 764, "HR Signature", "توقيع الموارد البشرية", height=48)
    date_field(pdf, "hr_signature_date", 812, source="request.hr_completed_at")

    pdf.showPage()
    pdf.save()
    MAP_PATH.write_text(json.dumps(FIELD_MAP, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate the FFI exit permission request template.")
    parser.add_argument("--logo", type=Path, default=DEFAULT_LOGO, help="Path to the exact FFI logo lockup PNG.")
    args = parser.parse_args()
    build(args.logo)
