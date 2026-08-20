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
PDF_PATH = OUT_DIR / "leave_request_blank.pdf"
MAP_PATH = OUT_DIR / "leave_request_blank_field_map.json"
DEFAULT_LOGO = Path(r"C:\Users\PC\Downloads\FFI LOGO.png")
PAGE_W, PAGE_H = A4

ORANGE = colors.HexColor("#FF5A00")
TEXT = colors.HexColor("#151515")
MUTED = colors.HexColor("#55585C")
BORDER = colors.HexColor("#C8CBCF")
CELL = colors.HexColor("#ECEDEF")
DATA = colors.HexColor("#FCFCFC")
WHITE = colors.white
ARABIC_FONT_SCALE = 1.20

FIELD_MAP: dict[str, dict] = {}


def register_fonts() -> tuple[str, str]:
    candidates = {
        "FFIRegular": [
            Path(r"C:\Windows\Fonts\arial.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        ],
        "FFIBold": [
            Path(r"C:\Windows\Fonts\arialbd.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
        ],
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


def draw_text(
    pdf: canvas.Canvas,
    x: float,
    top: float,
    value: str,
    *,
    size: float = 7,
    bold: bool = False,
    right: bool = False,
    color=TEXT,
) -> None:
    pdf.setFillColor(color)
    pdf.setFont(BOLD if bold else REGULAR, size)
    y = PAGE_H - top - size
    if right:
        pdf.drawRightString(x, y, value)
    else:
        pdf.drawString(x, y, value)


def draw_arabic(pdf: canvas.Canvas, x: float, top: float, value: str, **kwargs) -> None:
    size = float(kwargs.pop("size", 7)) * ARABIC_FONT_SCALE
    draw_text(pdf, x, top, shape_arabic(value), size=size, right=True, **kwargs)


def rect(pdf: canvas.Canvas, x: float, top: float, width: float, height: float, *, fill, stroke=BORDER) -> None:
    pdf.setFillColor(fill)
    pdf.setStrokeColor(stroke)
    pdf.setLineWidth(0.55)
    pdf.rect(x, bottom(top, height), width, height, fill=1, stroke=1)


def section(pdf: canvas.Canvas, top: float, en: str, ar: str) -> None:
    pdf.setFillColor(ORANGE)
    pdf.rect(15, bottom(top + 5, 6), 6, 6, fill=1, stroke=0)
    draw_text(pdf, 28, top, en, size=10.5, bold=True)
    draw_arabic(pdf, PAGE_W - 17, top, ar, size=10.5, bold=True)


def field(key: str, x: float, top: float, width: float, height: float, **extra) -> None:
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
    field(key, x, top, width, height, **extra)


def label_pair(
    pdf: canvas.Canvas,
    top: float,
    height: float,
    en: str,
    ar: str,
    *,
    left_width: float = 87,
    right_width: float = 70,
) -> None:
    rect(pdf, 15, top, left_width, height, fill=CELL)
    rect(pdf, PAGE_W - 15 - right_width, top, right_width, height, fill=CELL)
    draw_text(pdf, 23, top + (height - 7) / 2, en, size=6.6)
    draw_arabic(pdf, PAGE_W - 22, top + (height - 7) / 2, ar, size=6.6)


def checkbox(pdf: canvas.Canvas, x: float, top: float, label: str) -> tuple[float, float]:
    size = 10
    rect(pdf, x, top, size, size, fill=WHITE, stroke=MUTED)
    draw_text(pdf, x + 15, top + 0.5, label, size=6.8)
    return x + size / 2, bottom(top, size) + size / 2


def build(logo_path: Path) -> None:
    if not logo_path.exists():
        raise FileNotFoundError(f"FFI logo was not found: {logo_path}")

    FIELD_MAP.clear()
    pdf = canvas.Canvas(str(PDF_PATH), pagesize=A4, pageCompression=1)
    pdf.setTitle("FFI Leave Request Blank Template")

    logo = ImageReader(str(logo_path))
    logo_width = 236
    logo_height = logo_width * logo.getSize()[1] / logo.getSize()[0]
    pdf.drawImage(logo, 15, bottom(14, logo_height), logo_width, logo_height, mask="auto")
    draw_text(pdf, PAGE_W - 15, 14, "Leave Request", size=18, bold=True, right=True)
    draw_arabic(pdf, PAGE_W - 15, 41, "طلب إجازة", size=18, bold=True)
    pdf.setStrokeColor(ORANGE)
    pdf.setLineWidth(0.8)
    pdf.line(15, bottom(73), PAGE_W - 15, bottom(73))

    # Header row
    rect(pdf, 15, 81, 276, 28, fill=CELL)
    rect(pdf, 304, 81, 276, 28, fill=CELL)
    draw_text(pdf, 23, 91, "Reference No.", size=7.3, bold=True)
    draw_arabic(pdf, 282, 91, "رقم المرجع", size=7)
    input_box(pdf, "reference_no", 92, 86, 150, 18, font_size=8.2)
    draw_text(pdf, 312, 91, "Request Date", size=7.3, bold=True)
    draw_arabic(pdf, 572, 91, "تاريخ الطلب", size=7)
    input_box(pdf, "request_date", 390, 86, 132, 18, font_size=8.2)

    # Employee information
    section(pdf, 118, "Employee Information", "بيانات الموظف")
    employee_rows = [
        ("employee_name", "Employee Name", "اسم الموظف"),
        ("employee_id", "Employee ID", "رقم الموظف"),
        ("department", "Department", "الإدارة"),
        ("job_title", "Job Title", "المسمى الوظيفي"),
        ("line_manager", "Line Manager", "المدير المباشر"),
        ("work_location", "Work Location", "موقع العمل"),
        ("contact_no", "Contact No.", "رقم التواصل"),
        ("email", "Email", "البريد الإلكتروني"),
    ]
    for index, (key, en, ar) in enumerate(employee_rows):
        top = 137 + index * 25
        label_pair(pdf, top, 25, en, ar)
        input_box(pdf, key, 102, top + 3, 406, 19, font_size=7.8, shrink=True)

    # Leave details
    section(pdf, 345, "Leave Details", "تفاصيل الإجازة")
    rect(pdf, 15, 364, 274, 30, fill=CELL)
    rect(pdf, 297, 364, 283, 30, fill=CELL)
    draw_text(pdf, 23, 374, "Leave Type", size=6.4)
    draw_arabic(pdf, 102, 374, "نوع الإجازة", size=6.4)
    input_box(pdf, "leave_type", 111, 367, 171, 24, font_size=7.4, shrink=True)
    draw_text(pdf, 305, 374, "Leave Balance (Days)", size=6.1)
    draw_arabic(pdf, 572, 374, "رصيد الإجازة (أيام)", size=6.1)
    input_box(pdf, "leave_balance_days", 390, 367, 182, 24, font_size=7.4)

    rect(pdf, 15, 394, 274, 25, fill=CELL)
    rect(pdf, 297, 394, 283, 25, fill=CELL)
    draw_text(pdf, 23, 403, "End Date", size=6.5)
    draw_arabic(pdf, 282, 403, "تاريخ النهاية", size=6.5)
    input_box(pdf, "end_date", 102, 397, 116, 19, font_size=7.8)
    draw_text(pdf, 305, 403, "Start Date", size=6.5)
    draw_arabic(pdf, 572, 403, "تاريخ البداية", size=6.5)
    input_box(pdf, "start_date", 390, 397, 120, 19, font_size=7.8)

    rect(pdf, 15, 419, 274, 25, fill=CELL)
    rect(pdf, 297, 419, 283, 25, fill=CELL)
    draw_text(pdf, 23, 428, "Total Days Requested", size=6.3)
    draw_arabic(pdf, 282, 428, "إجمالي الأيام المطلوبة", size=6.1)
    input_box(pdf, "total_days_requested", 102, 422, 116, 19, font_size=7.8)
    draw_text(pdf, 305, 428, "Will You Travel?", size=6.3)
    draw_arabic(pdf, 572, 428, "هل ستكون مسافراً؟", size=6.2)
    yes = checkbox(pdf, 397, 426, "Yes")
    no = checkbox(pdf, 450, 426, "No")
    FIELD_MAP["will_travel"] = {"page": 1, "checkboxes": {"yes": yes, "no": no}}

    label_pair(pdf, 444, 32, "Reason", "سبب الإجازة")
    input_box(pdf, "reason", 102, 447, 406, 26, font_size=7.2, multiline=True, max_lines=2)
    label_pair(pdf, 476, 25, "Address During Leave", "العنوان أثناء الإجازة")
    input_box(pdf, "address_during_leave", 102, 479, 406, 19, font_size=7.2, shrink=True)
    label_pair(pdf, 501, 25, "Contact No. During Leave", "رقم التواصل أثناء الإجازة", left_width=97, right_width=80)
    input_box(pdf, "contact_no_during_leave", 112, 504, 388, 19, font_size=7.5)

    # Substitute employee and travel/ticket columns
    pdf.setFillColor(ORANGE)
    pdf.rect(15, bottom(539, 6), 6, 6, fill=1, stroke=0)
    draw_text(pdf, 28, 534, "Substitute Employee", size=10.5, bold=True)
    draw_arabic(pdf, 282, 534, "موظف بديل", size=10.5, bold=True)
    pdf.setFillColor(ORANGE)
    pdf.rect(305, bottom(539, 6), 6, 6, fill=1, stroke=0)
    draw_text(pdf, 318, 534, "Travel / Ticket", size=10.5, bold=True)
    draw_arabic(pdf, 578, 534, "السفر / التذكرة", size=10.5, bold=True)

    left_rows = [
        ("substitute_employee_id", "Employee ID", "رقم الموظف", 23),
        ("substitute_employee_name", "Employee Name", "اسم الموظف", 23),
        ("substitute_department", "Department", "الإدارة", 23),
        ("substitute_notes", "Notes", "ملاحظات", 33),
    ]
    current = 553
    for key, en, ar, height in left_rows:
        rect(pdf, 15, current, 274, height, fill=CELL)
        draw_text(pdf, 23, current + (height - 7) / 2, en, size=6.4)
        draw_arabic(pdf, 282, current + (height - 7) / 2, ar, size=6.4)
        input_box(
            pdf,
            key,
            102,
            current + 3,
            116 if height == 23 else 150,
            height - 6,
            font_size=7.0,
            multiline=height > 23,
            max_lines=2 if height > 23 else 1,
            shrink=True,
        )
        current += height

    travel_rows = [
        ("destination", "Destination", "الوجهة"),
        ("travel_date", "Travel Date", "تاريخ السفر"),
        ("return_date", "Return Date", "تاريخ العودة"),
    ]
    for index, (key, en, ar) in enumerate(travel_rows):
        top = 553 + index * 23
        rect(pdf, 307, top, 273, 23, fill=CELL)
        draw_text(pdf, 315, top + 8, en, size=6.4)
        draw_arabic(pdf, 572, top + 8, ar, size=6.4)
        input_box(pdf, key, 390, top + 3, 120, 17, font_size=7.3, shrink=True)
    rect(pdf, 307, 622, 273, 33, fill=CELL)
    draw_text(pdf, 315, 634, "Ticket Required?", size=6.4)
    draw_arabic(pdf, 572, 634, "هل تحتاج تذكرة؟", size=6.4)
    yes = checkbox(pdf, 401, 633, "Yes")
    no = checkbox(pdf, 458, 633, "No")
    FIELD_MAP["ticket_required"] = {"page": 1, "checkboxes": {"yes": yes, "no": no}}

    # Approval
    section(pdf, 663, "Approval", "الاعتماد")
    rect(pdf, 15, 682, 565, 25, fill=CELL)
    draw_text(pdf, 23, 691, "Recommended by Line Manager", size=6.2)
    yes = checkbox(pdf, 170, 689, "Yes")
    no = checkbox(pdf, 221, 689, "No")
    FIELD_MAP["manager_recommended"] = {"page": 1, "checkboxes": {"yes": yes, "no": no}}
    draw_text(pdf, 307, 691, "Date", size=6.4)
    draw_arabic(pdf, 572, 691, "التاريخ", size=6.4)
    input_box(pdf, "approval_date", 390, 685, 120, 19, font_size=7.4)
    label_pair(pdf, 707, 36, "Comments", "التعليقات")
    input_box(pdf, "approval_comments", 102, 710, 406, 30, font_size=7.0, multiline=True, max_lines=2)

    # Signatures
    section(pdf, 751, "Signature", "التوقيع")
    signature_fields = [
        ("employee", "Employee Signature", "توقيع الموظف"),
        ("line_manager", "Line Manager Signature", "توقيع المدير المباشر"),
        ("department_head", "Department Head Signature", "توقيع رئيس الإدارة"),
        ("hr", "HR Signature", "توقيع الموارد البشرية"),
    ]
    col_width = 565 / 4
    for index, (key, en, ar) in enumerate(signature_fields):
        x = 15 + index * col_width
        rect(pdf, x, 770, col_width, 59, fill=CELL)
        draw_text(pdf, x + 7, 777, en, size=5.3)
        draw_arabic(pdf, x + col_width - 7, 777, ar, size=5.3)
        input_box(pdf, f"{key}_signature", x + 7, 790, col_width - 14, 23, font_size=6.6, shrink=True)
        draw_text(pdf, x + 7, 818, "Date", size=5.6)
        input_box(pdf, f"{key}_signature_date", x + 42, 815, col_width - 49, 11, font_size=6.0, shrink=True)

    pdf.showPage()
    pdf.save()
    MAP_PATH.write_text(json.dumps(FIELD_MAP, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate the final one-page FFI leave request template.")
    parser.add_argument("--logo", type=Path, default=DEFAULT_LOGO, help="Path to the exact FFI logo lockup PNG.")
    args = parser.parse_args()
    build(args.logo)
