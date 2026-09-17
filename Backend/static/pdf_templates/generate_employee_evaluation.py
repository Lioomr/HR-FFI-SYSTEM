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
except ImportError:  # pragma: no cover - the backend requirements provide these.
    arabic_reshaper = None
    get_display = None


OUT = Path(__file__).resolve().parent
PDF_PATH = OUT / "employee_evaluation_blank.pdf"
MAP_PATH = OUT / "employee_evaluation_blank_field_map.json"
DEFAULT_LOGO = OUT / "assets" / "ffi_logo_transparent.png"
WIDTH, HEIGHT = A4

ORANGE = colors.HexColor("#FF5A00")
TEXT = colors.HexColor("#151515")
MUTED = colors.HexColor("#55585C")
BORDER = colors.HexColor("#C8CBCF")
CELL = colors.HexColor("#ECEDEF")
DATA = colors.HexColor("#FCFCFC")

FIELDS: dict[str, dict] = {}

ITEMS = [
    ("Accomplishment of the work according to the required level", "إنجاز العمل بالمستوى المطلوب"),
    ("Cooperation and helping colleagues", "التعاون ومساعدة الزملاء"),
    ("Loyalty to the company and preserving its interests", "الإخلاص للشركة والمحافظة على مصالحها"),
    ("Ability to understand work rules and procedures", "القدرة على استيعاب قواعد وأساليب العمل"),
    ("Regularity and discipline at work", "الترتيب والنظام في العمل"),
    ("Observing company policies and systems", "الالتزام بأنظمة وسياسات الشركة"),
    ("Caring of work improvement and development", "الاهتمام بتطوير وتحسين مستوى العمل"),
    ("Initiative and creativity at work", "المبادرة والابتكار في العمل"),
    ("Ability for taking sound decisions", "القدرة على اتخاذ القرارات"),
    ("Working hard and responding to work pressure", "الاجتهاد والتجاوب مع ضغط العمل"),
    ("Accomplishment the work according to the required time", "إنجاز العمل في الموعد المطلوب"),
    ("Preserving the company properties", "المحافظة على ممتلكات الشركة"),
    ("Ability to work without supervision", "القدرة على العمل دون مراقبة"),
    ("Ability to bear a larger responsibility", "القدرة على تحمل مسؤولية أكبر"),
    ("Respecting others", "احترام الغير"),
    ("Accepting directions and criticism of one's manager", "تقبل توجيهات وانتقادات الرؤساء"),
    ("Personal behavior", "التصرف الشخصي"),
    ("Appearance", "المظهر"),
]

RATING_KEYS = ("0_to_60", "61_to_69", "70_to_79", "80_to_89", "90_to_100")
RATING_LABELS = ("0 to 60", "61 to 69", "70 to 79", "80 to 89", "90 to 100")


def register_fonts() -> tuple[str, str]:
    regular = "Helvetica"
    bold = "Helvetica-Bold"
    candidates = {
        "FFIRegular": [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            r"C:\Windows\Fonts\arial.ttf",
        ],
        "FFIBold": [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            r"C:\Windows\Fonts\arialbd.ttf",
        ],
    }
    for name, paths in candidates.items():
        if name in pdfmetrics.getRegisteredFontNames():
            continue
        for path in paths:
            if Path(path).exists():
                pdfmetrics.registerFont(TTFont(name, path))
                break
    if "FFIRegular" in pdfmetrics.getRegisteredFontNames():
        regular = "FFIRegular"
    if "FFIBold" in pdfmetrics.getRegisteredFontNames():
        bold = "FFIBold"
    return regular, bold


def shape_ar(value: object) -> str:
    text = str(value or "").strip()
    if arabic_reshaper and get_display and any("\u0600" <= char <= "\u06ff" for char in text):
        try:
            return get_display(arabic_reshaper.reshape(text))
        except Exception:
            return text
    return text


def bottom_y(top: float, height: float = 0) -> float:
    return HEIGHT - top - height


def map_field(key: str, x: float, top: float, width: float, height: float, **extra: object) -> None:
    FIELDS[key] = {
        "page": 1,
        "x": round(x, 2),
        "y": round(bottom_y(top, height), 2),
        "width": round(width, 2),
        "height": round(height, 2),
        **extra,
    }


def draw_text(
    pdf: canvas.Canvas,
    font: str,
    x: float,
    top: float,
    value: str,
    size: float = 7,
    *,
    bold: bool = False,
    right: bool = False,
    color: colors.Color = TEXT,
) -> None:
    pdf.setFillColor(color)
    pdf.setFont(font if not bold else BOLD_FONT, size)
    y = HEIGHT - top - size
    if right:
        pdf.drawRightString(x, y, shape_ar(value))
    else:
        pdf.drawString(x, y, value)


def draw_centered(pdf: canvas.Canvas, font: str, x: float, top: float, width: float, value: str, size: float) -> None:
    pdf.setFillColor(TEXT)
    pdf.setFont(font, size)
    pdf.drawCentredString(x + width / 2, HEIGHT - top - size, value)


def draw_centered_ar(pdf: canvas.Canvas, font: str, x: float, top: float, width: float, value: str, size: float) -> None:
    pdf.setFillColor(TEXT)
    pdf.setFont(font, size)
    pdf.drawCentredString(x + width / 2, HEIGHT - top - size, shape_ar(value))


def draw_box(pdf: canvas.Canvas, x: float, top: float, width: float, height: float, fill: colors.Color = DATA) -> None:
    pdf.setFillColor(fill)
    pdf.setStrokeColor(BORDER)
    pdf.setLineWidth(0.55)
    pdf.rect(x, bottom_y(top, height), width, height, fill=1, stroke=1)


def draw_section(pdf: canvas.Canvas, font: str, bold_font: str, top: float, title_en: str, title_ar: str) -> None:
    pdf.setFillColor(ORANGE)
    pdf.rect(15, bottom_y(top + 5, 6), 6, 6, fill=1, stroke=0)
    draw_text(pdf, font, 28, top, title_en, 10.5, bold=True)
    pdf.setFillColor(TEXT)
    pdf.setFont(bold_font, 10.5)
    pdf.drawRightString(WIDTH - 17, HEIGHT - top - 10.5, shape_ar(title_ar))


def draw_label_pair(
    pdf: canvas.Canvas,
    font: str,
    x: float,
    top: float,
    width: float,
    height: float,
    english: str,
    arabic: str,
) -> None:
    draw_box(pdf, x, top, width, height, CELL)
    draw_text(pdf, font, x + 7, top + (height - 6.5) / 2, english, 6.5)
    pdf.setFillColor(TEXT)
    pdf.setFont(font, 6.5)
    pdf.drawRightString(x + width - 7, HEIGHT - top - (height + 6.5) / 2, shape_ar(arabic))


def draw_label_en(
    pdf: canvas.Canvas,
    font: str,
    x: float,
    top: float,
    width: float,
    height: float,
    english: str,
) -> None:
    draw_box(pdf, x, top, width, height, CELL)
    draw_text(pdf, font, x + 7, top + (height - 6.5) / 2, english, 6.5)


def draw_label_ar(
    pdf: canvas.Canvas,
    font: str,
    x: float,
    top: float,
    width: float,
    height: float,
    arabic: str,
) -> None:
    draw_box(pdf, x, top, width, height, CELL)
    pdf.setFillColor(TEXT)
    pdf.setFont(font, 6.5)
    pdf.drawRightString(x + width - 7, HEIGHT - top - (height + 6.5) / 2, shape_ar(arabic))


def draw_input(pdf: canvas.Canvas, key: str, x: float, top: float, width: float, height: float, **extra: object) -> None:
    draw_box(pdf, x, top, width, height, DATA)
    map_field(key, x, top, width, height, **extra)


def draw_info_row(pdf: canvas.Canvas, font: str, key: str, top: float, english: str, arabic: str, height: float = 22) -> None:
    draw_label_en(pdf, font, 15, top, 75, height, english)
    draw_input(pdf, key, 90, top + 2, 425, height - 4, font_size=7.2, shrink=True)
    draw_label_ar(pdf, font, 515, top, 65, height, arabic)


def draw_rating_header(pdf: canvas.Canvas, font: str, x: float, top: float, width: float, label: str) -> None:
    draw_box(pdf, x, top, width, 34, CELL)
    parts = label.split()
    start = top + 8 if len(parts) == 3 else top + 12
    for index, part in enumerate(parts):
        draw_centered(pdf, font, x, start + index * 8, width, part, 6.1)


def draw_approval_card(
    pdf: canvas.Canvas,
    regular: str,
    bold_font: str,
    x: float,
    top: float,
    width: float,
    key_prefix: str,
    title_en: str,
    title_ar: str,
) -> None:
    pdf.setFillColor(ORANGE)
    pdf.rect(x, bottom_y(top - 12, 6), 6, 6, fill=1, stroke=0)
    draw_text(pdf, regular, x + 13, top - 12, title_en, 7.1, bold=True)
    pdf.setFillColor(TEXT)
    pdf.setFont(bold_font, 6.9)
    pdf.drawRightString(x + width, HEIGHT - (top - 12) - 6.9, shape_ar(title_ar))

    card_top = top
    card_height = 58
    draw_box(pdf, x, card_top, width, card_height, DATA)

    draw_box(pdf, x + 4, card_top + 3, width - 8, 13, DATA)
    draw_text(pdf, regular, x + 8, card_top + 6, "Name:", 6.3)
    pdf.setFillColor(TEXT)
    pdf.setFont(regular, 6.1)
    pdf.drawRightString(x + width - 8, HEIGHT - card_top - 6 - 6.1, shape_ar("الاسم:"))
    map_field(
        f"{key_prefix}_name",
        x + 43,
        card_top + 4,
        width - 51,
        11,
        font_size=6.3,
        shrink=True,
    )

    draw_box(pdf, x + 4, card_top + 18, width - 8, 25, DATA)
    draw_text(pdf, regular, x + 8, card_top + 21, "Signature:", 6.3)
    pdf.setFillColor(TEXT)
    pdf.setFont(regular, 6.1)
    pdf.drawRightString(x + width - 8, HEIGHT - card_top - 21 - 6.1, shape_ar("التوقيع:"))
    map_field(
        f"{key_prefix}_signature_image",
        x + 43,
        card_top + 20,
        width - 51,
        21,
        kind="image",
        padding=2,
        source=f"evaluation.signers.{key_prefix}.signature",
    )

    draw_box(pdf, x + 4, card_top + 45, width - 8, 10, DATA)
    draw_text(pdf, regular, x + 8, card_top + 47, "Date:", 5.8)
    pdf.setFillColor(TEXT)
    pdf.setFont(regular, 5.6)
    pdf.drawRightString(x + width - 8, HEIGHT - card_top - 47 - 5.6, shape_ar("التاريخ:"))
    map_field(
        f"{key_prefix}_date",
        x + 43,
        card_top + 46,
        width - 51,
        8,
        font_size=5.8,
        shrink=True,
    )


def build(logo_path: Path, pdf_path: Path = PDF_PATH, map_path: Path = MAP_PATH) -> None:
    if not logo_path.exists():
        raise FileNotFoundError(logo_path)

    global BOLD_FONT
    regular, BOLD_FONT = register_fonts()
    FIELDS.clear()
    pdf = canvas.Canvas(str(pdf_path), pagesize=A4, pageCompression=1)
    pdf.setTitle("FFI Employee Performance Evaluation Blank Template")

    logo = ImageReader(str(logo_path))
    logo_width = 220
    logo_height = logo_width * logo.getSize()[1] / logo.getSize()[0]
    pdf.drawImage(logo, 15, bottom_y(14, logo_height), logo_width, logo_height, mask="auto")
    draw_text(pdf, regular, WIDTH - 15, 14, "Employee Performance Evaluation Form", 15, bold=True, right=True)
    pdf.setFillColor(TEXT)
    pdf.setFont(BOLD_FONT, 15)
    pdf.drawRightString(WIDTH - 15, HEIGHT - 42 - 15, shape_ar("نموذج تقييم موظف"))
    pdf.setStrokeColor(ORANGE)
    pdf.setLineWidth(0.8)
    pdf.line(15, bottom_y(73), WIDTH - 15, bottom_y(73))

    draw_label_pair(pdf, regular, 15, 81, 273, 28, "Reference No.", "رقم المرجع :")
    draw_input(pdf, "reference_no", 89, 86, 78, 18, font_size=8)
    draw_label_pair(pdf, regular, 297, 81, 283, 28, "Date", "التاريخ :")
    draw_input(pdf, "document_date", 390, 86, 120, 18, font_size=7.4)

    draw_section(pdf, regular, BOLD_FONT, 122, "Employee Information", "بيانات الموظف")
    draw_info_row(pdf, regular, "employee_name", 141, "Employee Name:", "اسم الموظف:")
    draw_info_row(pdf, regular, "position", 163, "Position:", "المسمى الوظيفي:")
    draw_info_row(pdf, regular, "employee_no", 185, "Employee No.:", "الرقم الوظيفي:")
    draw_info_row(pdf, regular, "department", 207, "Department:", "الإدارة:")
    draw_info_row(pdf, regular, "section", 229, "Section:", "القسم:")

    period_top = 251
    draw_label_en(pdf, regular, 15, period_top, 100, 24, "Evaluation Period:")
    draw_label_en(pdf, regular, 115, period_top, 35, 24, "To:")
    draw_input(pdf, "evaluation_to", 150, period_top + 2, 105, 20, font_size=6.5, shrink=True)
    draw_label_ar(pdf, regular, 255, period_top, 35, 24, "إلى:")
    draw_label_en(pdf, regular, 290, period_top, 45, 24, "From:")
    draw_input(pdf, "evaluation_from", 335, period_top + 2, 105, 20, font_size=6.5, shrink=True)
    draw_label_ar(pdf, regular, 440, period_top, 35, 24, "من:")
    draw_label_ar(pdf, regular, 475, period_top, 105, 24, "فترة التقييم:")

    draw_section(pdf, regular, BOLD_FONT, 288, "Performance Evaluation", "عناصر التقييم")
    table_top = 307
    header_height = 34
    row_height = 16.5
    average_height = 20
    col_x = [15, 39, 259, 299, 339, 379, 419, 459, 580]

    draw_box(pdf, col_x[0], table_top, 24, header_height, CELL)
    draw_centered(pdf, BOLD_FONT, col_x[0], table_top + 13, 24, "#", 7)
    draw_box(pdf, col_x[1], table_top, 220, header_height, CELL)
    draw_centered_ar(pdf, BOLD_FONT, col_x[1], table_top + 6, 220, "عناصر التقييم", 7.2)
    draw_centered(pdf, BOLD_FONT, col_x[1], table_top + 20, 220, "Evaluation Items", 7.1)
    for index, label in enumerate(RATING_LABELS):
        draw_rating_header(pdf, BOLD_FONT, col_x[2 + index], table_top, 40, label)
    draw_box(pdf, col_x[7], table_top, 121, header_height, CELL)
    draw_centered(pdf, BOLD_FONT, col_x[7], table_top + 7, 121, "Remarks", 7.1)
    draw_centered_ar(pdf, BOLD_FONT, col_x[7], table_top + 20, 121, "ملاحظات", 7.1)

    rows_top = table_top + header_height
    for index, (english, arabic) in enumerate(ITEMS, start=1):
        top = rows_top + (index - 1) * row_height
        for left, right in zip(col_x[:-1], col_x[1:]):
            draw_box(pdf, left, top, right - left, row_height, DATA)
        draw_centered(pdf, regular, col_x[0], top + 5, 24, str(index), 5.8)
        item_size = 5.1 if len(english) > 42 else 5.5
        draw_text(pdf, regular, col_x[1] + 5, top + 4, english, item_size)
        pdf.setFillColor(TEXT)
        pdf.setFont(regular, item_size)
        pdf.drawRightString(col_x[2] - 5, HEIGHT - top - 4 - item_size, shape_ar(arabic))

        checkbox_spec = {"page": 1, "checkboxes": {}}
        for rating_index, rating_key in enumerate(RATING_KEYS):
            center_x = col_x[2 + rating_index] + 20
            center_y = HEIGHT - top - row_height / 2
            checkbox_spec["checkboxes"][rating_key] = [round(center_x, 2), round(center_y, 2)]
        FIELDS[f"rating_{index}"] = checkbox_spec
        map_field(
            f"remark_{index}",
            col_x[7] + 3,
            top + 2,
            115,
            row_height - 4,
            font_size=5.5,
            shrink=True,
        )

    average_top = rows_top + len(ITEMS) * row_height
    draw_box(pdf, 15, average_top, 244, average_height, CELL)
    draw_text(pdf, BOLD_FONT, 160, average_top + 6, "Average", 7.1, bold=True)
    pdf.setFillColor(TEXT)
    pdf.setFont(BOLD_FONT, 7.1)
    pdf.drawRightString(250, HEIGHT - average_top - 6 - 7.1, shape_ar("معدل الدرجات"))
    draw_box(pdf, 259, average_top, 200, average_height, CELL)
    draw_box(pdf, 459, average_top, 121, average_height, CELL)
    map_field("average", 259, average_top + 2, 200, average_height - 4, font_size=7.2)

    draw_section(pdf, regular, BOLD_FONT, 676, "Recommendations", "التوصيات")
    draw_box(pdf, 15, 695, 565, 44, DATA)
    draw_text(pdf, regular, 27, 703, "Does the department desire to continue the contract with the employee?", 6.5)
    pdf.setFillColor(TEXT)
    pdf.setFont(regular, 6.2)
    pdf.drawRightString(WIDTH - 27, HEIGHT - 703 - 6.2, shape_ar("هل لدى الإدارة الرغبة في استمرار التعاقد مع الموظف؟"))
    recommendation_anchors = {
        "terminate": [60, HEIGHT - 728],
        "proceed": [250, HEIGHT - 728],
        "renew_with_salary_increase": [440, HEIGHT - 728],
    }
    FIELDS["recommendation"] = {"page": 1, "checkboxes": recommendation_anchors}
    for x in (55, 245, 435):
        draw_box(pdf, x, 723, 10, 10, colors.white)
    draw_text(pdf, regular, 72, 723, "Terminate the contract", 5.7)
    draw_text(pdf, regular, 258, 723, "Proceed the contract", 5.7)
    draw_text(pdf, regular, 448, 723, "Renew with salary increase", 5.2)
    pdf.setFillColor(TEXT)
    pdf.setFont(regular, 5.4)
    pdf.drawRightString(235, HEIGHT - 723 - 5.4, shape_ar("عدم الرغبة في تجديد"))
    pdf.drawRightString(425, HEIGHT - 723 - 5.4, shape_ar("استمرار العقد"))
    pdf.drawRightString(573, HEIGHT - 723 - 5.2, shape_ar("التجديد مع زيادة في الراتب"))

    card_width = 177
    draw_approval_card(pdf, regular, BOLD_FONT, 15, 770, card_width, "direct_manager", "Direct Manager", "المدير المباشر")
    draw_approval_card(pdf, regular, BOLD_FONT, 209, 770, card_width, "hr", "HR", "الموارد البشرية")
    draw_approval_card(pdf, regular, BOLD_FONT, 403, 770, card_width, "ceo", "CEO", "الرئيس التنفيذي")

    pdf.showPage()
    pdf.save()
    map_path.write_text(json.dumps(FIELDS, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build the FFI employee evaluation blank template and field map.")
    parser.add_argument("--logo", type=Path, default=DEFAULT_LOGO)
    parser.add_argument("--pdf", type=Path, default=PDF_PATH)
    parser.add_argument("--map", type=Path, default=MAP_PATH)
    args = parser.parse_args()
    build(args.logo, args.pdf, args.map)
