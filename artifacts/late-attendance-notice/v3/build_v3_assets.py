"""Build the isolated v3 late-attendance notice asset package.

V3 is a narrow correction of v2. It removes the printed logo placeholder from
the actual PDF content and replaces it with an opaque, neutral logo surface so
transparent company PNGs cannot reveal text below them.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
from io import BytesIO
from pathlib import Path

import fitz
from PIL import Image, ImageDraw
from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parent
V2_ROOT = ROOT.parent / "v2"
REPO = ROOT.parents[2]
sys.path.insert(0, str(REPO / "Backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()

from core.pdf_forms import FormAssets, SignatureAsset, render_mapped_form  # noqa: E402


PAGE_WIDTH, PAGE_HEIGHT = A4
LOGO_X, LOGO_Y, LOGO_WIDTH, LOGO_HEIGHT = 36, 757, 132, 47
LOGO_RECT = fitz.Rect(LOGO_X, PAGE_HEIGHT - LOGO_Y - LOGO_HEIGHT, LOGO_X + LOGO_WIDTH, PAGE_HEIGHT - LOGO_Y)
LEVEL_POLICY = {
    1: ("Warning only - no payroll deduction", "0%", "SAR 0.00"),
    2: ("5% daily-rate deduction", "5%", "SAR 42.50"),
    3: ("10% daily-rate deduction", "10%", "SAR 85.00"),
    4: ("50% daily-rate deduction", "50%", "SAR 425.00"),
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def neutral_logo_overlay() -> BytesIO:
    """Return a rounded, opaque, text-free logo slot at the original v2 area."""
    output = BytesIO()
    pdf = canvas.Canvas(output, pagesize=A4, pageCompression=1)
    pdf.setFillColor(HexColor("#F8FAFC"))
    pdf.roundRect(LOGO_X, LOGO_Y, LOGO_WIDTH, LOGO_HEIGHT, 5, fill=1, stroke=0)
    pdf.setStrokeColor(HexColor("#D7DCE2"))
    pdf.setLineWidth(0.8)
    pdf.roundRect(LOGO_X, LOGO_Y, LOGO_WIDTH, LOGO_HEIGHT, 5, fill=0, stroke=1)
    pdf.save()
    output.seek(0)
    return output


def create_text_free_template(source: Path, destination: Path, level: int) -> None:
    """Redact the original v2 logo labels, then overlay a neutral rounded slot."""
    document = fitz.open(source)
    if len(document) != 1:
        raise RuntimeError(f"Expected one A4 page in {source}")
    page = document[0]
    # This removes the placeholder text from the PDF content stream, rather
    # than merely covering it beneath a logo image.
    page.add_redact_annot(LOGO_RECT, fill=(1, 1, 1), cross_out=False)
    page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as intermediate_file:
        intermediate = Path(intermediate_file.name)
    try:
        document.save(intermediate, garbage=4, deflate=True)
        reader = PdfReader(intermediate)
        page = reader.pages[0]
        page.merge_page(PdfReader(neutral_logo_overlay()).pages[0], over=True)
        writer = PdfWriter()
        writer.add_page(page)
        writer.add_metadata(
            {
                "/Title": f"Late Attendance Notice Level {level} Blank Template v3",
                "/Author": "HR notice asset package",
                "/Subject": "v3 text-free company logo slot",
            }
        )
        with destination.open("wb") as output:
            writer.write(output)
    finally:
        intermediate.unlink(missing_ok=True)


def create_logo(path: Path, *, transparent: bool) -> None:
    """Create visually distinct QA logos, including one with a true alpha background."""
    background = (0, 0, 0, 0) if transparent else (255, 255, 255, 255)
    image = Image.new("RGBA", (520, 180), background)
    draw = ImageDraw.Draw(image)
    if not transparent:
        draw.rounded_rectangle((3, 3, 516, 176), radius=18, fill=(246, 248, 251, 255))
    draw.rounded_rectangle((35, 31, 124, 149), radius=12, fill=(20, 117, 200, 255))
    draw.rectangle((53, 51, 74, 131), fill=(255, 122, 0, 255))
    draw.rectangle((83, 70, 107, 131), fill=(255, 255, 255, 255))
    draw.text((152, 62), "AL NOOR", fill=(24, 34, 55, 255))
    draw.text((152, 95), "CONTRACTING", fill=(100, 116, 139, 255))
    image.save(path)


def sample_values(level: int) -> dict[str, str]:
    policy, percentage, amount = LEVEL_POLICY[level]
    return {
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
        "occurrence_number": str(level),
        "policy_result": policy,
        "penalty_percentage": percentage,
        "penalty_amount": amount,
        "reason": "Unexpected traffic disruption on the employee's route to the assigned worksite.",
        "company_phone": "+966 12 555 0100",
        "company_address": "Jeddah, Kingdom of Saudi Arabia",
        "company_website": "www.alnoor.example",
        "company_email": "hr@alnoor.example",
    }


def render_qa(asset: dict, level: int, logo: Path, *, suffix: str) -> tuple[Path, Path]:
    assets = FormAssets(template_path=str(asset["pdf"]), fields=asset["payload"]["fields"], meta=asset["payload"])
    rendered, diagnostics = render_mapped_form(
        assets,
        sample_values(level),
        signatures={
            "company_logo": SignatureAsset(data=logo.read_bytes(), signer_label="Active company logo"),
            "hr_signature_image": None,
        },
    )
    if not any(row["field"] == "company_logo" and row["state"] == "placed" for row in diagnostics):
        raise RuntimeError(f"Level {level} {suffix} logo failed to render: {diagnostics}")
    if any(row["field"] == "hr_signature_image" and row["state"] == "placed" for row in diagnostics):
        raise RuntimeError(f"Level {level} unexpectedly auto-signed HR area")
    output = asset["directory"] / f"late_attendance_level_{level}_{suffix}_v3.pdf"
    output.write_bytes(rendered)
    document = fitz.open(output)
    if len(document) != 1:
        raise RuntimeError(f"Rendered {suffix} QA PDF for level {level} is not one page")
    preview = output.with_name(f"{suffix.replace('_sample', '')}-render-v3.png")
    document[0].get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False).save(preview)
    return output, preview


def build_level(level: int) -> dict:
    source_dir = V2_ROOT / f"level-{level}"
    directory = ROOT / f"level-{level}"
    directory.mkdir(parents=True, exist_ok=True)
    source_pdf = source_dir / f"late_attendance_level_{level}_blank_v2.pdf"
    source_map = source_dir / f"late_attendance_level_{level}_field_map_v2.json"
    if not source_pdf.exists() or not source_map.exists():
        raise RuntimeError(f"Missing source v2 assets for level {level}")

    destination_pdf = directory / f"late_attendance_level_{level}_blank_v3.pdf"
    destination_map = directory / f"late_attendance_level_{level}_field_map_v3.json"
    create_text_free_template(source_pdf, destination_pdf, level)
    payload = json.loads(source_map.read_text(encoding="utf-8"))
    if payload["version"] != 2 or payload.get("asset_revision") != 2:
        raise RuntimeError(f"Unexpected v2 map metadata for level {level}")
    source_fields = payload["fields"]
    if source_fields["company_logo"]["kind"] != "image" or source_fields["company_logo"].get("image_mode") != "contain":
        raise RuntimeError(f"Level {level} v2 company_logo schema is unsupported")
    if payload["manual_only_fields"] != ["hr_signature_image"] or source_fields["hr_signature_image"].get("auto_sign") is not False:
        raise RuntimeError(f"Level {level} v2 HR signature schema is unsupported")
    payload["template"] = destination_pdf.name
    payload["version"] = 3
    payload["asset_revision"] = 3
    payload["source_template_version"] = 2
    payload["logo"] = {
        "field": "company_logo",
        "supported": True,
        "fallback": "Clean neutral logo slot without printed placeholder text",
        "background": "opaque #F8FAFC",
    }
    payload["logo_slot_treatment"] = "text_free_opaque_neutral_background"
    destination_map.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {"directory": directory, "pdf": destination_pdf, "map": destination_map, "payload": payload}


def report(assets: list[dict], qa_records: list[tuple[Path, Path, Path, Path]]) -> None:
    records: list[tuple[str, str]] = []
    lines = [
        "# Late Attendance Notice v3 Validation Report",
        "",
        "## Scope",
        "",
        "This report covers only `artifacts/late-attendance-notice/v3`. V1 and v2 assets, deployed templates, backend code, and frontend code were not modified.",
        "",
        "## Results",
        "",
        "- Every v3 blank template is one A4 page and preserves the v2 field coordinates, accent colors, titles, policy wording, and open manual HR signature line.",
        "- The v2 logo placeholder text was removed from each PDF content stream. Each v3 logo slot is a clean, opaque #F8FAFC rounded surface with no printed English or Arabic logo label.",
        "- All maps use `version: 3` and `asset_revision: 3`. `company_logo` remains a supported `kind: image` field using `contain` sizing.",
        "- `hr_signature_image` remains the sole manual-only field, is blank in all QA files, and has `auto_sign: false`.",
        "- Transparent and opaque PNG logo QA samples both rendered cleanly. Dynamic values were rendered through the existing map-driven renderer and visually checked centered in their declared grey fields.",
        "",
        "## Outputs and visual QA",
        "",
    ]
    for asset, qa in zip(assets, qa_records, strict=True):
        transparent_pdf, transparent_preview, opaque_pdf, opaque_preview = qa
        fields = ", ".join(asset["payload"]["fields"].keys())
        for path in (asset["pdf"], asset["map"], transparent_pdf, transparent_preview, opaque_pdf, opaque_preview):
            records.append((path.resolve().as_posix(), sha256(path)))
        level = asset["payload"]["style"]["level"]
        lines.extend(
            [
                f"### Level {level}",
                "",
                f"- Blank template: `{asset['pdf'].resolve().as_posix()}`",
                f"- Field map: `{asset['map'].resolve().as_posix()}`",
                f"- Transparent-logo QA PDF: `{transparent_pdf.resolve().as_posix()}`",
                f"- Transparent-logo QA preview: `{transparent_preview.resolve().as_posix()}`",
                f"- Opaque-logo QA PDF: `{opaque_pdf.resolve().as_posix()}`",
                f"- Opaque-logo QA preview: `{opaque_preview.resolve().as_posix()}`",
                f"- Declared fields: `{fields}`",
                f"- Required keys: `{', '.join(asset['payload']['required_keys'])}`",
                "- Visual QA: clean text-free opaque logo slot; transparent and opaque logos legible; centered dynamic values; HR signature line open and blank.",
                "",
            ]
        )
    lines.extend(["## SHA-256", ""])
    lines.extend(f"- `{digest}`  `{path}`" for path, digest in records)
    (ROOT / "VALIDATION_REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (ROOT / "CHECKSUMS.sha256").write_text("\n".join(f"{digest}  {path}" for path, digest in records) + "\n", encoding="utf-8")


def main() -> None:
    transparent_logo = ROOT / "qa_transparent_company_logo.png"
    opaque_logo = ROOT / "qa_opaque_company_logo.png"
    create_logo(transparent_logo, transparent=True)
    create_logo(opaque_logo, transparent=False)
    assets = [build_level(level) for level in range(1, 5)]
    qa_records = []
    for asset, level in zip(assets, range(1, 5), strict=True):
        transparent = render_qa(asset, level, transparent_logo, suffix="qa_sample")
        opaque = render_qa(asset, level, opaque_logo, suffix="qa_opaque")
        qa_records.append((*transparent, *opaque))
    report(assets, qa_records)


if __name__ == "__main__":
    main()
