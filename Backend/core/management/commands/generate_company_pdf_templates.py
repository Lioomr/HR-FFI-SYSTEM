"""Generate company-branded variants of the HR template library."""

from __future__ import annotations

import importlib.util
import shutil
from io import BytesIO
from pathlib import Path

from django.core.management.base import BaseCommand
from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from core import pdf as core_pdf
from core.management.commands import generate_blank_templates

BACKEND = Path(__file__).resolve().parents[3]
TEMPLATE_ROOT = BACKEND / "static" / "pdf_templates"
BRANDS = {
    "ATHROYA": {
        "logo": TEMPLATE_ROOT / "company_logos" / "athroya.png",
        "accent": "#01424D",
        "pale": "#EAF2F3",
    },
    "ASECO_PRO": {
        "logo": TEMPLATE_ROOT / "company_logos" / "aseco_pro.png",
        "accent": "#123B82",
        "pale": "#EDF2FA",
    },
}
GENERATORS = (
    ("leaves", TEMPLATE_ROOT / "generate_leave_request_final.py", "build", "PDF_PATH", "MAP_PATH"),
    ("loans", BACKEND / "loans" / "scripts" / "generate_loan_request_template.py", "build", "OUTPUT_PATH", "MAP_PATH"),
    ("exit_permission", TEMPLATE_ROOT / "generate_exit_permission_request.py", "build", "PDF_PATH", "MAP_PATH"),
    ("annual_entitlements", TEMPLATE_ROOT / "generate_annual_entitlements_final.py", "build", "PDF_PATH", "MAP_PATH"),
    ("job_offer", TEMPLATE_ROOT / "generate_job_offer_final.py", "build", "PDF", "MAP"),
    ("starting_work", TEMPLATE_ROOT / "generate_starting_work_final.py", "build", "PDF", "MAP"),
)


def _load_generator(path: Path, module_name: str):
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not load PDF generator: {path.name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _generate(company_code: str, brand: dict[str, str | Path]) -> None:
    output_dir = TEMPLATE_ROOT / "company_templates" / company_code
    output_dir.mkdir(parents=True, exist_ok=True)
    accent = HexColor(str(brand["accent"]))
    pale = HexColor(str(brand["pale"]))

    for slug, path, builder_name, pdf_attr, map_attr in GENERATORS:
        module = _load_generator(path, f"_company_pdf_{slug}_{company_code.lower()}")
        output_map = output_dir / Path(getattr(module, map_attr)).name
        if slug == "loans":
            shutil.copyfile(getattr(module, map_attr), output_map)
        setattr(module, pdf_attr, output_dir / Path(getattr(module, pdf_attr)).name)
        setattr(module, map_attr, output_map)
        for color_name in ("ORANGE", "O"):
            if hasattr(module, color_name):
                setattr(module, color_name, accent)
        if hasattr(module, "PALE"):
            module.PALE = pale
        if slug == "job_offer":
            getattr(module, builder_name)(Path(brand["logo"]), company_specific=True)
        else:
            getattr(module, builder_name)(Path(brand["logo"]))
        _finalize_company_pdf(
            output_dir / Path(getattr(module, pdf_attr)).name,
            company_code=company_code,
            company_name="Athroya" if company_code == "ATHROYA" else "Aseco Pro",
            color=accent,
        )

    _generate_library_only_templates(company_code, brand, output_dir, accent)


def _generate_library_only_templates(company_code: str, brand: dict[str, str | Path], output_dir: Path, accent) -> None:
    """Render catalog forms without field maps using the shared FFI layouts and company brand."""
    company_name = "Athroya" if company_code == "ATHROYA" else "Aseco Pro"
    logo_path = Path(brand["logo"])
    palette = core_pdf.PALETTE_RGB
    original_palette = palette.copy()
    original_logo = core_pdf.get_logo_path
    original_pdf_company_name = core_pdf.PDF_COMPANY_NAME
    original_writer_logo = generate_blank_templates.get_logo_path
    original_company_name = generate_blank_templates.COMPANY_NAME
    try:

        def rgb(value: str) -> tuple[float, float, float]:
            return tuple(int(value[index : index + 2], 16) / 255 for index in (1, 3, 5))

        palette.update(
            primary_orange=rgb(str(brand["accent"])),
            soft_orange=rgb(str(brand["pale"])),
            light_orange=rgb(str(brand["pale"])),
            border_orange=rgb(str(brand["accent"])),
            grid_orange=rgb(str(brand["accent"])),
        )
        core_pdf.get_logo_path = lambda: str(logo_path)
        core_pdf.PDF_COMPANY_NAME = company_name
        generate_blank_templates.get_logo_path = lambda: str(logo_path)
        generate_blank_templates.COMPANY_NAME = company_name
        for filename in (
            "asset_damage_report_blank.pdf",
            "asset_return_request_blank.pdf",
            "rent_agreement_blank.pdf",
            "employment_certificate_blank.pdf",
            "salary_certificate_blank.pdf",
            "termination_letter_blank.pdf",
        ):
            writer = generate_blank_templates.TEMPLATE_WRITERS[filename]
            target = output_dir / filename
            target.write_bytes(writer())
            _finalize_company_pdf(target, company_code=company_code, company_name=company_name, color=accent)
    finally:
        palette.clear()
        palette.update(original_palette)
        core_pdf.get_logo_path = original_logo
        core_pdf.PDF_COMPANY_NAME = original_pdf_company_name
        generate_blank_templates.get_logo_path = original_writer_logo
        generate_blank_templates.COMPANY_NAME = original_company_name


def _finalize_company_pdf(pdf_path: Path, *, company_code: str, company_name: str, color) -> None:
    """Add the missing English wordmark and remove stale FFI PDF metadata."""
    buffer = BytesIO()
    overlay = canvas.Canvas(buffer, pagesize=A4, pageCompression=1)
    if company_code == "ATHROYA":
        overlay.setFillColor(color)
        overlay.setFont("Helvetica-Bold", 10)
        overlay.drawString(82, A4[1] - 48, "ATHROYA")
    overlay.save()
    buffer.seek(0)

    reader = PdfReader(str(pdf_path))
    if company_code == "ATHROYA":
        reader.pages[0].merge_page(PdfReader(buffer).pages[0])
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    form_title = pdf_path.stem.removesuffix("_blank").replace("_", " ").title()
    writer.add_metadata({"/Title": f"{company_name} {form_title} Form", "/Author": company_name})
    output = BytesIO()
    writer.write(output)
    pdf_path.write_bytes(output.getvalue())


class Command(BaseCommand):
    help = "Generate company-branded HR PDF templates for Athroya and Aseco Pro."

    def handle(self, *args, **options):
        for company_code, brand in BRANDS.items():
            if not Path(brand["logo"]).is_file():
                raise FileNotFoundError(f"Brand logo is missing for {company_code}.")
            _generate(company_code, brand)
            self.stdout.write(self.style.SUCCESS(f"Generated HR PDF templates for {company_code}."))
