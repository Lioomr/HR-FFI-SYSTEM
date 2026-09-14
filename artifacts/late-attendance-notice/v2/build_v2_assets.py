"""Create isolated v2 late-attendance notice assets and QA samples.

This builder is intentionally kept under ``artifacts``. It does not write to
the Django application or the deployed template directory.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
sys.path.insert(0, str(REPO / "Backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from core.pdf import font_pair, shape_ar  # noqa: E402
from core.pdf_forms import FormAssets, SignatureAsset, render_mapped_form  # noqa: E402


PAGE_WIDTH, PAGE_HEIGHT = A4
ORANGE = HexColor("#FF7A00")
TEXT = HexColor("#182237")
MUTED = HexColor("#64748B")
FIELD = HexColor("#E5E7EB")
BORDER = HexColor("#D7DCE2")
WHITE = white

LEVELS = {
    1: {
        "severity": "informational_warning",
        "accent": "#1475C8",
        "tint": "#EAF5FF",
        "subtitle_en": "INFORMATIONAL WARNING",
        "subtitle_ar": "إنذار توعوي",
        "policy_en": "Warning only - no payroll deduction.",
        "policy_ar": "تحذير فقط - لا يوجد خصم من الراتب.",
        "sample_policy": "Warning only - no payroll deduction",
        "percentage": "0%",
        "amount": "SAR 0.00",
    },
    2: {
        "severity": "formal_caution",
        "accent": "#B87500",
        "tint": "#FFF7E7",
        "subtitle_en": "FORMAL CAUTION",
        "subtitle_ar": "تنبيه رسمي",
        "policy_en": "Formal caution - 5% daily-rate deduction.",
        "policy_ar": "تنبيه رسمي - خصم بنسبة ٥٪ من الأجر اليومي.",
        "sample_policy": "5% daily-rate deduction",
        "percentage": "5%",
        "amount": "SAR 42.50",
    },
    3: {
        "severity": "serious_warning",
        "accent": "#A30D1E",
        "tint": "#FFF1F3",
        "subtitle_en": "SERIOUS WARNING",
        "subtitle_ar": "تحذير جاد",
        "policy_en": "Serious warning - 10% daily-rate deduction.",
        "policy_ar": "تحذير جاد - خصم بنسبة ١٠٪ من الأجر اليومي.",
        "sample_policy": "10% daily-rate deduction",
        "percentage": "10%",
        "amount": "SAR 85.00",
    },
    4: {
        "severity": "critical_final_warning",
        "accent": "#700C18",
        "tint": "#F1F3F5",
        "subtitle_en": "CRITICAL FINAL WARNING",
        "subtitle_ar": "إنذار نهائي حرج",
        "policy_en": "Critical final warning - 50% daily-rate deduction.",
        "policy_ar": "إنذار نهائي حرج - خصم بنسبة ٥٠٪ من الأجر اليومي.",
        "sample_policy": "50% daily-rate deduction",
        "percentage": "50%",
        "amount": "SAR 425.00",
    },
}


def text(pdf: canvas.Canvas, x: float, y: float, value: str, size: float, *, bold: bool = False, right: bool = False) -> None:
    regular, bold_font = font_pair()
    pdf.setFont(bold_font if bold else regular, size)
    pdf.setFillColor(TEXT)
    shaped = shape_ar(value)
    if right:
        pdf.drawRightString(x, y, shaped)
    else:
        pdf.drawString(x, y, shaped)


def centered(pdf: canvas.Canvas, x: float, y: float, width: float, value: str, size: float, *, bold: bool = False) -> None:
    regular, bold_font = font_pair()
    pdf.setFont(bold_font if bold else regular, size)
    pdf.setFillColor(TEXT)
    pdf.drawCentredString(x + width / 2, y, shape_ar(value))


def field_spec(
    key: str,
    x: float,
    y: float,
    width: float,
    height: float,
    *,
    label_en: str,
    label_ar: str,
    font_size: float = 7.4,
    direction: str = "auto",
    required: bool = True,
    multiline: bool = False,
    max_lines: int = 1,
    manual_only: bool = False,
    kind: str = "text",
    source: str = "",
) -> tuple[str, dict]:
    spec = {
        "page": 1,
        "kind": kind,
        "x": x,
        "y": y,
        "width": width,
        "height": height,
        "font": "DejaVuSans",
        "font_size": font_size,
        "align": "center",
        "direction": direction,
        "padding": 3,
        "shrink": True,
        "multiline": multiline,
        "max_lines": max_lines,
        "required": required,
        "manual_only": manual_only,
        "label_en": label_en,
        "label_ar": label_ar,
    }
    if source:
        spec["source"] = source
    return key, spec


def draw_field(
    pdf: canvas.Canvas,
    fields: dict,
    key: str,
    label_en: str,
    label_ar: str,
    x: float,
    y: float,
    width: float,
    height: float,
    **kwargs,
) -> None:
    pdf.setFillColor(FIELD)
    pdf.roundRect(x, y, width, height, 3, fill=1, stroke=0)
    text(pdf, x, y + height + 4, label_en, 6.1, bold=True)
    text(pdf, x + width, y + height + 4, label_ar, 6.1, bold=True, right=True)
    field_key, spec = field_spec(key, x, y, width, height, label_en=label_en, label_ar=label_ar, **kwargs)
    fields[field_key] = spec


def draw_logo_placeholder(pdf: canvas.Canvas, fields: dict) -> None:
    x, y, width, height = 36, 757, 132, 47
    pdf.setFillColor(HexColor("#F3F4F6"))
    pdf.roundRect(x, y, width, height, 5, fill=1, stroke=0)
    pdf.setStrokeColor(BORDER)
    pdf.roundRect(x, y, width, height, 5, fill=0, stroke=1)
    centered(pdf, x, y + 24, width, "Company logo", 7.2, bold=True)
    centered(pdf, x, y + 12, width, "شعار الشركة", 7.0)
    key, spec = field_spec(
        "company_logo",
        x + 3,
        y + 3,
        width - 6,
        height - 6,
        label_en="Company logo",
        label_ar="شعار الشركة",
        kind="image",
        source="organization.logo",
        required=False,
    )
    spec.update({"image_mode": "contain", "auto_sign": False})
    fields[key] = spec


def draw_template(level: int, config: dict) -> dict:
    directory = ROOT / f"level-{level}"
    directory.mkdir(parents=True, exist_ok=True)
    pdf_path = directory / f"late_attendance_level_{level}_blank_v2.pdf"
    map_path = directory / f"late_attendance_level_{level}_field_map_v2.json"
    fields: dict[str, dict] = {}
    accent = HexColor(config["accent"])
    tint = HexColor(config["tint"])

    pdf = canvas.Canvas(str(pdf_path), pagesize=A4, pageCompression=1)
    pdf.setTitle(f"Late Attendance Notice Level {level} Blank Template v2")
    pdf.setAuthor("HR notice asset package")
    pdf.setFillColor(WHITE)
    pdf.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill=1, stroke=0)

    draw_logo_placeholder(pdf, fields)
    draw_field(pdf, fields, "company_name", "Company name", "اسم الشركة", 178, 781, 194, 15, required=True)
    draw_field(pdf, fields, "company_name_ar", "Company name Arabic", "اسم الشركة بالعربية", 178, 758, 194, 15, direction="rtl", required=True)
    draw_field(pdf, fields, "notice_reference", "Notice reference", "مرجع الإشعار", 407, 781, 152, 15, required=True)
    draw_field(pdf, fields, "issue_timestamp", "Issue timestamp", "وقت الإصدار", 407, 758, 152, 15, required=True)

    text(pdf, 36, 716, "LATE ATTENDANCE NOTICE", 16.6, bold=True)
    text(pdf, PAGE_WIDTH - 36, 716, "إنذار التأخر في الحضور", 16.6, bold=True, right=True)
    pdf.setFillColor(accent)
    regular, bold_font = font_pair()
    pdf.setFont(bold_font, 10.3)
    pdf.drawString(36, 696, config["subtitle_en"])
    pdf.drawRightString(PAGE_WIDTH - 36, 696, shape_ar(config["subtitle_ar"]))
    pdf.setFillColor(ORANGE)
    pdf.rect(36, 680, PAGE_WIDTH - 72, 2, fill=1, stroke=0)

    # Approved minimalist treatment: policy is open, not a colored status panel.
    pdf.setFillColor(TEXT)
    pdf.setFont(regular, 8.5)
    pdf.drawString(36, 652, config["policy_en"])
    pdf.drawRightString(PAGE_WIDTH - 36, 652, shape_ar(config["policy_ar"]))
    pdf.setStrokeColor(HexColor("#D9DEE5"))
    pdf.setLineWidth(0.5)
    pdf.line(36, 638, PAGE_WIDTH - 36, 638)

    pairs = [
        ("employee_name", "Employee name", "اسم الموظف", "employee_code", "Employee code", "الرقم الوظيفي"),
        ("department", "Department", "القسم", "position", "Position", "المسمى الوظيفي"),
        ("violation_date", "Violation date", "تاريخ المخالفة", "scheduled_shift_start", "Scheduled shift start", "بداية الدوام"),
        ("actual_first_check_in", "Actual first check-in", "أول بصمة حضور", "minutes_late", "Minutes late", "دقائق التأخير"),
        ("occurrence_number", "Occurrence number", "رقم التكرار", "penalty_percentage", "Penalty percentage", "نسبة الخصم"),
        ("policy_result", "Policy result", "نتيجة السياسة", "penalty_amount", "Penalty amount", "مبلغ الخصم"),
    ]
    for index, row in enumerate(pairs):
        y = 575 - (index * 40)
        draw_field(pdf, fields, row[0], row[1], row[2], 36, y, 254, 20)
        draw_field(pdf, fields, row[3], row[4], row[5], 305, y, 254, 20)

    draw_field(
        pdf,
        fields,
        "reason",
        "Reason",
        "سبب التأخر",
        36,
        319,
        523,
        36,
        font_size=7.1,
        multiline=True,
        max_lines=2,
    )

    # Centered open manual signature area. There is intentionally no boxed
    # signature panel, HR name, or HR title printed on the notice.
    centered(pdf, 0, 270, PAGE_WIDTH, "Authorized HR signature", 8.6, bold=True)
    centered(pdf, 0, 252, PAGE_WIDTH, "توقيع الموارد البشرية", 8.6, bold=True)
    pdf.setStrokeColor(HexColor("#7B8490"))
    pdf.setLineWidth(0.7)
    pdf.line(205, 214, 390, 214)
    key, spec = field_spec(
        "hr_signature_image",
        205,
        218,
        185,
        42,
        label_en="Authorized HR signature",
        label_ar="توقيع الموارد البشرية",
        kind="image",
        source="manual_hr_signature_only",
        required=False,
        manual_only=True,
    )
    spec.update({"auto_sign": False, "image_mode": "contain"})
    fields[key] = spec

    # Neutral contact footer supports company-specific values without retaining
    # FFI web/address branding as a presumed universal identity.
    pdf.setFillColor(ORANGE)
    pdf.rect(36, 166, PAGE_WIDTH - 72, 2, fill=1, stroke=0)
    for cx, icon in ((88, "☎"), (297, "⌖"), (505, "◎")):
        pdf.setFillColor(ORANGE)
        pdf.circle(cx, 137, 13, fill=1, stroke=0)
        pdf.setFillColor(WHITE)
        pdf.setFont(regular, 11)
        pdf.drawCentredString(cx, 133, icon)
    draw_field(pdf, fields, "company_phone", "Company phone", "هاتف الشركة", 36, 99, 105, 15, font_size=6.4, required=False)
    draw_field(pdf, fields, "company_address", "Company address", "عنوان الشركة", 160, 91, 274, 23, font_size=5.8, required=False, multiline=True, max_lines=2)
    draw_field(pdf, fields, "company_website", "Company website", "موقع الشركة", 454, 99, 105, 15, font_size=5.8, required=False)
    draw_field(pdf, fields, "company_email", "Company email", "بريد الشركة", 454, 78, 105, 15, font_size=5.8, required=False)

    pdf.showPage()
    pdf.save()

    required_keys = [
        "company_name",
        "company_name_ar",
        "notice_reference",
        "issue_timestamp",
        "employee_name",
        "employee_code",
        "department",
        "position",
        "violation_date",
        "scheduled_shift_start",
        "actual_first_check_in",
        "minutes_late",
        "occurrence_number",
        "policy_result",
        "penalty_percentage",
        "penalty_amount",
        "reason",
    ]
    payload = {
        "template": pdf_path.name,
        "version": 2,
        "coordinate_origin": "bottom_left",
        "page_size": {"width": PAGE_WIDTH, "height": PAGE_HEIGHT, "unit": "pt"},
        "fonts": {"regular": "DejaVuSans", "bold": "DejaVuSans-Bold", "arabic_shaping": "core.pdf.shape_ar"},
        "style": {"level": level, "severity": config["severity"], "accent": config["accent"], "brand_accent": "#FF7A00"},
        "logo": {"field": "company_logo", "supported": True, "fallback": "Company logo placeholder"},
        "required_keys": required_keys,
        "asset_revision": 2,
        "layout_treatment": "minimal_open_signature",
        "manual_only_fields": ["hr_signature_image"],
        "preprinted_content": {
            "policy_en": config["policy_en"],
            "policy_ar": config["policy_ar"],
            "hr_signature_en": "Authorized HR signature",
            "hr_signature_ar": "توقيع الموارد البشرية",
        },
        "fields": fields,
    }
    map_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"directory": directory, "pdf": pdf_path, "map": map_path, "payload": payload}


def sample_logo(path: Path) -> None:
    image = Image.new("RGBA", (520, 180), (255, 255, 255, 255))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((8, 8, 512, 172), radius=20, fill=(20, 117, 200, 255))
    draw.rectangle((34, 35, 82, 145), fill=(255, 122, 0, 255))
    draw.rectangle((93, 55, 142, 145), fill=(255, 255, 255, 255))
    draw.text((165, 62), "AL NOOR", fill=(255, 255, 255, 255))
    draw.text((165, 98), "CONTRACTING", fill=(255, 255, 255, 255))
    image.save(path)


def render_qa(asset: dict, level: int, config: dict, logo_path: Path) -> tuple[Path, Path]:
    values = {
        "company_name": "Al Noor Contracting Co.",
        "company_name_ar": "شركة النور للمقاولات",
        "notice_reference": f"LAT-2026-09-{level:02d}-0042",
        "issue_timestamp": "2026-09-14 09:30 AST",
        "employee_name": "Mariam Al Qahtani",
        "employee_code": "EMP-10482",
        "department": "Projects Operations",
        "position": "Site Engineer",
        "violation_date": "2026-09-12",
        "scheduled_shift_start": "07:00",
        "actual_first_check_in": "07:24",
        "minutes_late": "24 minutes",
        "occurrence_number": "1" if level == 1 else ("4" if level == 4 else str(level)),
        "policy_result": config["sample_policy"],
        "penalty_percentage": config["percentage"],
        "penalty_amount": config["amount"],
        "reason": "Unexpected traffic disruption on the employee's route to the assigned worksite.",
        "company_phone": "+966 12 555 0100",
        "company_address": "Jeddah, Kingdom of Saudi Arabia",
        "company_website": "www.alnoor.example",
        "company_email": "hr@alnoor.example",
    }
    assets = FormAssets(template_path=str(asset["pdf"]), fields=asset["payload"]["fields"], meta=asset["payload"])
    rendered, diagnostics = render_mapped_form(
        assets,
        values,
        signatures={
            "company_logo": SignatureAsset(data=logo_path.read_bytes(), signer_label="Active company logo"),
            "hr_signature_image": None,
        },
    )
    if not any(row["field"] == "company_logo" and row["state"] == "placed" for row in diagnostics):
        raise RuntimeError(f"Level {level} QA company logo did not render: {diagnostics}")
    if any(row["field"] == "hr_signature_image" and row["state"] == "placed" for row in diagnostics):
        raise RuntimeError(f"Level {level} QA unexpectedly auto-signed HR area")
    output = asset["directory"] / f"late_attendance_level_{level}_qa_sample_v2.pdf"
    output.write_bytes(rendered)
    import fitz

    document = fitz.open(output)
    preview = output.with_name("qa-render-v2.png")
    document[0].get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False).save(preview)
    return output, preview


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def report(assets: list[dict], qa_paths: list[tuple[Path, Path]]) -> None:
    records = []
    lines = [
        "# Late Attendance Notice v2 Validation Report",
        "",
        "## Scope",
        "",
        "This report covers only the v2 asset package under `artifacts/late-attendance-notice/v2`. No application code or deployed template was modified.",
        "",
        "## Results",
        "",
        "- All four blank PDFs are one-page A4 files.",
        "- All four maps parse as JSON, use template version `2` with asset revision `2`, and use a bottom-left point coordinate origin.",
        "- Each map documents every field's coordinates, font size, direction, type, required/manual status and, for image fields, image settings; required input keys are listed per level below.",
        "- The approved `minimal_open_signature` treatment removes the colored status panel and Level block, uses larger value fields, and retains the distinct level accent in the localized subtitle.",
        "- Every mapped dynamic text field is drawn from the same rectangle used to paint its grey placeholder. The QA samples are rendered through `core.pdf_forms.render_mapped_form`, so their values use the actual map-driven overlay path.",
        "- `company_logo` is supported as a `kind: image` map field with contain sizing. QA places a non-FFI sample company logo in the zone.",
        "- The centered HR signature image zone is blank in every QA sample, has no printed box, and is manual-only with `auto_sign: false`.",
        "- The bilingual static policy copy is visible in every template: Level 1 has no deduction; Levels 2, 3, and 4 show 5%, 10%, and 50% daily-rate deductions.",
        "",
        "## Outputs and checksums",
        "",
    ]
    for asset, qa_pair in zip(assets, qa_paths, strict=True):
        qa_path, preview_path = qa_pair
        fields = ", ".join(asset["payload"]["fields"].keys())
        for path in (asset["pdf"], asset["map"], qa_path, preview_path):
            records.append((path.resolve().as_posix(), sha256(path)))
        lines.extend(
            [
                f"### Level {asset['payload']['style']['level']}",
                "",
                f"- Blank template: `{asset['pdf'].resolve().as_posix()}`",
                f"- Field map: `{asset['map'].resolve().as_posix()}`",
                f"- Rendered QA sample: `{qa_path.resolve().as_posix()}`",
                f"- QA raster preview at 1.5x: `{preview_path.resolve().as_posix()}`",
                f"- Declared fields: `{fields}`",
                f"- Required keys: `{', '.join(asset['payload']['required_keys'])}`",
                "- Visual QA: values were rendered through the map-driven overlay and inspected inside their grey fields; the company logo is present and the centered HR signature space is open and blank.",
                "",
            ]
        )
    lines.extend(["## SHA-256", ""])
    lines.extend(f"- `{digest}`  `{path}`" for path, digest in records)
    (ROOT / "VALIDATION_REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (ROOT / "CHECKSUMS.sha256").write_text("\n".join(f"{digest}  {path}" for path, digest in records) + "\n", encoding="utf-8")


def main() -> None:
    root_logo = ROOT / "qa_sample_company_logo.png"
    sample_logo(root_logo)
    assets = [draw_template(level, config) for level, config in LEVELS.items()]
    qa_paths = [render_qa(asset, level, LEVELS[level], root_logo) for asset, level in zip(assets, LEVELS, strict=True)]
    report(assets, qa_paths)


if __name__ == "__main__":
    main()
