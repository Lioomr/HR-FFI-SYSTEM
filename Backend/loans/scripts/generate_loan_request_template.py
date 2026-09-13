"""Regenerate the mapped, bilingual loan-request blank form.

Run from ``Backend`` after changing the companion field-map JSON.  The script
reads the map rather than duplicating its fill coordinates.
"""

from __future__ import annotations

import argparse
import json
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
    payload["version"] = 4
    section_positions = {
        "employee_information": 722,
        "loan_details": 560,
        "previous_loan": 398,
        "reason": 280,
        "approvals": 195,
    }
    for key, y in section_positions.items():
        payload["sections"][key]["y"] = y
    for keys, start in (
        (("employee_name", "employee_number", "department", "job_title", "mobile_number", "basic_salary"), 692),
        (("loan_type", "requested_amount", "installment_months", "monthly_deduction", "deduction_start_date", "payroll_reference"), 530),
        (("previous_loan_status", "previous_loan_type", "previous_loan_value", "previous_loan_end_date"), 368),
    ):
        for index, key in enumerate(keys):
            fields[key]["y"] = start - index * 21
            fields[key]["height"] = 19
            fields[key]["font_size"] = 8.4
    fields["reason_details"].update({"y": 212, "height": 55, "font_size": 8.2})

    role_layout = {
        "manager": (24, 182.33, 154, 142, 108, 32, 89, 168),
        "hr": (206.33, 182.33, 154, 142, 108, 32, 89, 168),
        "cfo": (388.66, 182.34, 154, 142, 108, 32, 89, 168),
        "ceo": (24, 273.5, 71, 59, 30, 26, 12, 82),
        "disbursement": (297.5, 273.5, 71, 59, 30, 26, 12, 82),
    }
    payload["signing_area"].update({"x": 24, "y": 9, "width": 547, "height": 179})
    role_meta = {role["key"]: role for role in payload["signing_area"]["roles"]}
    updated_roles = []
    for key, (x, role_width, name_y, decision_y, signature_y, signature_height, date_y, label_y) in role_layout.items():
        role = role_meta[key]
        role.update({"x": x, "width": role_width, "label_y": label_y})
        updated_roles.append(role)
        name_key = f"{key}_approval_name" if key != "disbursement" else "disbursement_name"
        decision_key = f"{key}_approval_decision" if key != "disbursement" else "disbursement_status"
        date_key = f"{key}_approval_date" if key != "disbursement" else "disbursement_date"
        signature_key = f"{key}_signature"
        fields[name_key].update({"x": x + 8, "y": name_y, "width": role_width - 16, "height": 10, "font_size": 6.2})
        fields[decision_key].update({"x": x + 8, "y": decision_y, "width": role_width - 16, "height": 9, "font_size": 6.0})
        fields[signature_key].update({"x": x + 8, "y": signature_y, "width": role_width - 16, "height": signature_height, "font_size": 6.2})
        fields[date_key].update({"x": x + 48, "y": date_y, "width": role_width - 96, "height": 14, "font_size": 6.4})
        fields[f"{key}_signature_image"].update(
            {"x": x + 8, "y": signature_y, "width": role_width - 16, "height": signature_height, "padding": 4}
        )
    payload["signing_area"]["roles"] = updated_roles
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
    for x, value in ((183, "الرقم المرجعي"), (370, "تاريخ الطلب"), (565, "تاريخ التقديم")):
        pdf.setFillColor(NAVY)
        pdf.setFont(bold, 7.1)
        pdf.drawRightString(x, 743, _ar(value))

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
    pdf.line(float(signing_area["x"]), 180, float(signing_area["x"]) + float(signing_area["width"]), 180)
    for role in signing_area["roles"]:
        x = float(role["x"])
        role_width = float(role["width"])
        label_y = float(role["label_y"])
        pdf.setFillColor(NAVY)
        pdf.setFont(bold, 6.8)
        pdf.drawString(x + 8, label_y, role["label_en"])
        pdf.setFont(regular, 6.4)
        pdf.drawRightString(x + role_width - 8, label_y, _ar(role["label_ar"]))
        date_key = f"{role['key']}_approval_date" if role["key"] != "disbursement" else "disbursement_date"
        date_spec = fields[date_key]
        pdf.setFillColor(LABEL)
        pdf.setStrokeColor(GRID)
        pdf.rect(x + 3, float(date_spec["y"]) - 3, role_width - 6, 20, fill=1, stroke=1)
        pdf.setFillColor(NAVY)
        pdf.setFont(bold, 6.2)
        pdf.drawString(x + 9, float(date_spec["y"]) + 3, "Date")
        pdf.drawRightString(x + role_width - 9, float(date_spec["y"]) + 3, _ar("التاريخ"))
        pdf.setFillColor(white)
        pdf.rect(float(date_spec["x"]), float(date_spec["y"]), float(date_spec["width"]), float(date_spec["height"]), fill=1, stroke=1)

    pdf.setStrokeColor(GRID)
    pdf.setLineWidth(0.45)
    for x in (206.33, 388.66):
        pdf.line(x, 88, x, 176)
    pdf.line(297.5, 9, 297.5, 86)
    pdf.line(24, 87, 571, 87)

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

    MAP_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    pdf.rect(float(reason["x"]), float(reason["y"]), float(reason["width"]), float(reason["height"]), fill=0, stroke=1)
    pdf.save()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate the FFI Loan Request template.")
    parser.add_argument("--logo", type=Path, default=Path("output_logo_transparent.png"))
    args = parser.parse_args()
    build(args.logo)
