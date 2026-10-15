import re
from datetime import date
from io import BytesIO
from pathlib import Path

import pypdfium2 as pdfium
import pytest
from audit.models import AuditLog
from core.pdf import build_signature_stamp_block, font_pair
from django.contrib.auth.models import Group
from django.utils import translation
from employees.models import EmployeeProfile
from pypdf import PdfReader
from pypdf.generic import ContentStream
from rents.models import Rent, RentType
from reportlab.pdfbase import pdfmetrics

from . import dto
from .i18n import AR, EN, ENUMS, translated
from .models import AccommodationAssignment, PayrollRun, PayrollRunItem
from .pdf_report import Writer, build_payroll_report_pdf, money
from .test_legacy_presentation import legacy_run as legacy_run
from .test_phase2 import create, edit
from .test_phase2 import ctx as ctx
from .views import _build_payroll_report_pdf

pytestmark = pytest.mark.django_db

ARABIC_CHARS = re.compile(f"[{chr(0x600)}-{chr(0x6FF)}{chr(0xFB50)}-{chr(0xFDFF)}{chr(0xFE70)}-{chr(0xFEFF)}]")
BAD_GLYPHS = (chr(0x25A0), chr(0xFFFD), chr(0))  # black square, replacement character, NUL
RAW_OUTPUT = ("cost_incomplete", "accommodation_status", "carry_forward", '{"', "approximately", "numerator")
ENUM_WORDS = re.compile(r"\b(SALARY|ADDITION|DEDUCTION|PROVISION|TOTAL|DRAFT|COMPLETED|PAID)\b")
ISSUE_CODES = [entry["value"] for entry in ENUMS["validation_codes"]]


def export(ctx, run, language="en"):
    response = ctx.client.get(
        f"/payroll-runs/{run.pk}/export/", {"file_format": "pdf"}, HTTP_ACCEPT_LANGUAGE=language, **ctx.headers
    )
    assert response.status_code == 200, getattr(response, "data", None)
    return response


def pages(content):
    return [page.extract_text() for page in PdfReader(BytesIO(content)).pages]


def text_fonts(content):
    """Base fonts that draw text. Reportlab's page preamble selects Helvetica but never draws with it."""

    reader = PdfReader(BytesIO(content))
    used = set()
    for page in reader.pages:
        names = {key: str(value.get_object()["/BaseFont"]) for key, value in page["/Resources"]["/Font"].items()}
        current = None
        for operands, operator in ContentStream(page.get_contents(), reader).operations:
            if operator == b"Tf":
                current = operands[0]
            elif operator in (b"Tj", b"TJ", b"'", b'"'):
                used.add(names[current])
    return used


def shaped(text):
    """Arabic as pypdf extracts it: joined letter forms (shaped like the report) in logical order."""

    return Writer().reshaper.reshape(text)


def build(run, language):
    items = list(PayrollRunItem.objects.filter(payroll_run=run, is_active=True).order_by("employee_name", "id"))
    with translation.override(language):
        return build_payroll_report_pdf(run, items)


def assert_clean(text):
    assert not any(glyph in text for glyph in BAD_GLYPHS)
    glyphs = pdfmetrics.getFont(font_pair()[0]).face.charToGlyph
    assert not {char for char in text if not char.isspace() and ord(char) not in glyphs}
    # Shaped Arabic is drawn with joined presentation forms; plain letters mean a cell skipped shaping.
    assert not [char for char in text if 0x621 <= ord(char) <= 0x64A]
    assert not any(raw in text for raw in RAW_OUTPUT), [raw for raw in RAW_OUTPUT if raw in text]
    assert not ENUM_WORDS.search(text), ENUM_WORDS.search(text)
    assert not [code for code in ISSUE_CODES if code in text]
    assert not re.search(r"\d+\.\d{2}/\d+", text)


def unknown_costs(ctx):
    ctx.profile.payroll_accommodation_assignments.all().delete()
    ctx.settings.no_medical_insurance = False
    ctx.settings.save()


def test_arabic_names_and_markup_render_with_unicode_fonts_in_both_languages(ctx):
    ctx.profile.full_name = "محمد عبدالله & <Test>"
    ctx.profile.department = "R&D <Ops>"
    ctx.profile.save()
    unknown_costs(ctx)
    run = create(ctx)
    edit(ctx, run, {"bonus": "50.00", "other_deduction": "20.00"})
    for language in ("en", "ar"):
        content = export(ctx, run, language).content
        used = text_fonts(content)
        assert used and all("DejaVu" in name for name in used), used
        text = "\n".join(pages(content))
        assert_clean(text)
        assert "R&D <Ops>" in text
        assert shaped("محمد عبدالله") in text and chr(0xFDF2) not in text
        # pypdf drops the Latin run of a mixed right-to-left line; pdfium keeps it (in visual order).
        document = pdfium.PdfDocument(content)
        full = "\n".join(document[index].get_textpage().get_text_range() for index in range(len(document)))
        assert all(part in full for part in ("محمد", "عبدالله", "Test", "R&D <Ops>"))


def test_totals_match_dto_values_after_formatting(ctx):
    unknown_costs(ctx)
    run = create(ctx)
    edit(ctx, run, {"bonus": "50.00", "other_deduction": "20.00"})
    run.refresh_from_db()
    totals = dto.run_dto(run)
    assert totals["total_additions"] == "50.00" and totals["total_deductions"] == "20.00"
    first = pages(export(ctx, run).content)[0]
    for key in ("total_gross", "total_additions", "total_deductions", "total_net", "total_company_cost"):
        assert money(totals[key]) in first, (key, totals[key])
    assert "Company cost is a known subtotal" in first
    text = "\n".join(pages(export(ctx, run).content))
    assert "Bonus: +50.00" in text and "Other Deduction: -20.00" in text


def test_legacy_run_shows_not_available_markers_never_zero(ctx, legacy_run):
    content = export(ctx, legacy_run).content
    texts = pages(content)
    first = texts[0]
    marker = translated("payroll.pdf.not_available_legacy", "en")
    assert first.count(marker) == 3  # additions, provisions, company cost
    assert translated("payroll.pdf.legacy_banner", "en") in first
    summary = dto.summary(legacy_run)
    assert money(summary["total_gross_salary"]) == "62,439.00" and "62,439.00" in first
    assert money(summary["total_net_salary"]) in first
    for label in ("Total Additions", "Company Provisions", "Total Company Cost"):
        assert re.search(label + r"\s+" + re.escape(marker), first), label
    register = "\n".join(texts[1:])
    # The stored legacy run total stays as recorded (0.00 here) while its items carry deductions:
    # the summary shows the DTO value and the register foots its own rows.
    assert money(summary["total_deductions"]) in first and "Grand total (52 employees)" in register
    assert "5,200.00" in register
    assert register.count(translated("payroll.pdf.not_available", "en")) >= 2 * 52
    assert translated("payroll.pdf.provisions_legacy", "en") in "\n".join(texts)
    assert len(texts) <= 12
    arabic = "\n".join(pages(export(ctx, legacy_run, "ar").content))
    assert shaped(translated("payroll.pdf.not_available", "ar")) in arabic
    assert_clean(arabic)


def test_zero_employee_run_renders_empty_message(ctx):
    run = PayrollRun.objects.create(company=ctx.company, year=2026, month=5, legacy_calculation=False)
    content = export(ctx, run).content
    text = "\n".join(pages(content))
    assert content.startswith(b"%PDF") and translated("payroll.pdf.no_employees", "en") in text
    assert "Page 1 of" in text
    arabic = build(run, "ar")
    assert shaped(translated("payroll.pdf.no_employees", "ar").rstrip(".")) in "\n".join(pages(arabic))


def test_fifty_employee_run_is_compact_numbered_and_signed_on_last_page(ctx):
    for index in range(49):
        EmployeeProfile.objects.create(
            company=ctx.company,
            employee_id=f"P2-B{index:02d}",
            full_name=f"Bulk Employee {index:02d}",
            department=("Projects", "Finance", "")[index % 3],
            hire_date=date(2024, 1, 1),
            basic_salary="4000.00",
            accommodation_allowance="1000.00",
            total_salary="5000.00",
        )
    run = create(ctx)
    assert run.items.filter(is_active=True).count() == 50
    content = export(ctx, run).content
    texts = pages(content)
    assert len(texts) <= 12
    for number, text in enumerate(texts, start=1):
        assert f"Page {number} of {len(texts)}" in text
    header = ("ID", "Name", "Department", "Gross", "Additions", "Deductions", "Net", "Company cost")
    register_pages = []
    for text in texts[1:]:
        register_pages.append(text)
        if "Grand total (50 employees)" in text:
            break
    assert register_pages and "Grand total (50 employees)" in register_pages[-1]
    for text in register_pages:
        assert all(label in text for label in header)
    assert "Subtotal: Projects" in "\n".join(register_pages) and "Subtotal: No department" in "\n".join(register_pages)
    last = texts[-1]
    assert "Prepared By" in last and "Company Stamp" in last
    assert translated("payroll.pdf.assumptions", "en") in last
    assert "Prepared By" not in "\n".join(texts[:-1])


def test_arabic_output_is_shaped_and_english_output_has_no_arabic(ctx):
    unknown_costs(ctx)
    run = create(ctx)
    arabic = "\n".join(pages(export(ctx, run, "ar").content))
    assert any(0xFE70 <= ord(char) <= 0xFEFF for char in arabic)  # joined (shaped) Arabic letter forms
    for key in ("payroll.pdf.employee_register", "payroll.pdf.key_figures", "payroll.pdf.exceptions"):
        assert shaped(AR[key]) in arabic, key
    assert_clean(arabic)
    english = "\n".join(pages(export(ctx, run, "en").content))
    assert not ARABIC_CHARS.search(english)
    assert EN["payroll.pdf.employee_register"] in english
    assert_clean(english)


def test_unknown_provision_is_words_and_rent_shares_are_decimals(ctx):
    unknown_costs(ctx)
    run = create(ctx)
    text = "\n".join(pages(export(ctx, run).content))
    assert re.search(r"Medical\s+Not available\s+Not available for 1 employees", text)
    assert not re.search(r"Medical\s+0\.00", text)

    ctx.profile.payroll_accommodation_assignments.all().delete()
    type_ = RentType.objects.create(company=ctx.company, code="HOUSING", name_en="Housing")
    rent = Rent.objects.create(
        company=ctx.company,
        rent_type=type_,
        property_name_en="Shared home",
        annual_rent_value="12000.00",
        recurrence="MONTHLY",
        amount="1000.00",
        start_date=date(2026, 1, 1),
        due_day=1,
    )
    others = [
        EmployeeProfile.objects.create(
            company=ctx.company,
            employee_id=f"P2-R{i}",
            hire_date=date(2024, 1, 1),
            basic_salary="1000.00",
            total_salary="1000.00",
            employment_status="PREHIRE" if i == 2 else "ACTIVE",
        )
        for i in (1, 2)
    ]
    for profile in [ctx.profile, *others]:
        AccommodationAssignment.objects.create(
            company=ctx.company,
            employee_profile=profile,
            status="assigned",
            rent=rent,
            start_date=date(2026, 10, 1),
            end_date=date(2026, 10, 31),
        )
    rent_run = create(ctx, month=10)
    assert rent_run.rent_allocations.get().rounding_difference["numerator"] == "1.00"
    for language in ("en", "ar"):
        text = "\n".join(pages(export(ctx, rent_run, language).content))
        assert "≈ 333.33" in text and "1,000.00" in text and "666.00" in text
        assert "1000/3" not in text and "1000.00/3" not in text
        assert_clean(text)


def test_export_headers_audit_and_permissions_unchanged(ctx):
    run = create(ctx)
    response = export(ctx, run)
    assert response["Content-Type"] == "application/octet-stream"
    assert response["Content-Disposition"] == f'attachment; filename="payroll_run_{run.pk}.pdf"'
    assert response["Cache-Control"] == "private, no-store"
    assert response["X-Content-Type-Options"] == "nosniff"
    assert response["Content-Length"] == str(len(response.content))
    assert AuditLog.objects.filter(action="payroll_exported_pdf", entity_id=str(run.pk)).exists()
    ctx.user.groups.clear()
    ctx.user.groups.add(Group.objects.get_or_create(name="CFO")[0])
    assert export(ctx, run).status_code == 200
    ctx.client.force_authenticate(ctx.employee)
    denied = ctx.client.get(f"/payroll-runs/{run.pk}/export/", {"file_format": "pdf"}, **ctx.headers)
    assert denied.status_code == 403


def test_views_wrapper_and_report_keys_exist_in_both_catalogs(ctx):
    run = create(ctx)
    items = list(run.items.filter(is_active=True))
    assert _build_payroll_report_pdf(run, items).startswith(b"%PDF")
    source = Path(__file__).with_name("pdf_report.py").read_text(encoding="utf-8")
    keys = set(re.findall(r'"(payroll\.pdf\.[a-z_]+)"', source))
    assert keys and all(key in EN and key in AR for key in keys)
    assert all(f"payroll.month.{month}" in EN and f"payroll.month.{month}" in AR for month in range(1, 13))


def test_signature_block_defaults_are_unchanged():
    table = build_signature_stamp_block(total_width=200)
    signer = "Name: ____________________\nDate: ____________________\nSignature: _______________"
    assert table._cellvalues == [
        ["Prepared By", "Reviewed By", "Approved By", "Company Stamp"],
        [signer, signer, signer, "\n\n\n"],
    ]
    assert table._argW == [46.0, 46.0, 46.0, 62.0]
    commands = [command[:3] for command in table._bkgrndcmds]
    assert ("BACKGROUND", (0, 1), (-2, 1)) in commands and ("BACKGROUND", (-1, 1), (-1, 1)) in commands
