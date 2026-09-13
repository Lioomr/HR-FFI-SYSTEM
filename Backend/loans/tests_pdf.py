from datetime import datetime
from datetime import timezone as dt_timezone
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pymupdf
import pytest
from pypdf import PdfReader

from core.pdf_forms import SIGNATURE_MISSING, SIGNATURE_PLACED, SignatureAsset, render_mapped_form
from core.tests_pdf_forms import image_boxes, make_png
from loans.models import LoanRequest
from loans.pdf_loan_request import (
    REQUIRED_FIELD_KEYS,
    TEMPLATE_FILENAME,
    build_loan_request_pdf,
    build_loan_request_signers,
    build_loan_request_values,
    load_loan_field_map,
    load_loan_form_assets,
)
from loans.views import _build_loan_request_pdf


def test_build_loan_request_pdf_returns_pdf_bytes():
    profile = SimpleNamespace(
        full_name_en="John Smith",
        full_name=None,
        employee_id="E-001",
        department_name_en="Finance",
        department="Finance",
        job_title_en="Accountant",
        job_title="Accountant",
        national_id="1234567890",
        mobile="+966500000000",
    )
    employee = SimpleNamespace(full_name="John Smith", email="john@ffi.com")

    instance = SimpleNamespace(
        id=42,
        employee=employee,
        employee_profile=profile,
        status=LoanRequest.RequestStatus.PENDING_HR,
        loan_type=LoanRequest.LoanType.INSTALLMENT,
        requested_amount=Decimal("10000.00"),
        approved_amount=None,
        installment_months=10,
        target_deduction_year=2026,
        target_deduction_month=5,
        reason="Family medical expenses",
        created_at=None,
        manager_decision_by=None,
        manager_decision_at=None,
        manager_decision_note="",
        manager_recommendation=None,
        finance_decision_by=None,
        finance_decision_at=None,
        finance_decision_note="",
        hr_recommendation=None,
        cfo_decision_by=None,
        cfo_decision_at=None,
        cfo_decision_note="",
        ceo_decision_by=None,
        ceo_decision_at=None,
        ceo_decision_note="",
        disbursed_by=None,
        disbursed_at=None,
        disbursement_note="",
    )

    pdf_bytes = _build_loan_request_pdf(instance)

    assert isinstance(pdf_bytes, bytes)
    assert pdf_bytes.startswith(b"%PDF")
    assert len(pdf_bytes) > 500
    reader = PdfReader(BytesIO(pdf_bytes))
    extracted_text = "\n".join(page.extract_text() or "" for page in reader.pages)
    assert len(reader.pages) == 1
    assert "Loan Request" in extracted_text
    assert "Installment Loan" in extracted_text
    assert "pending_hr" not in extracted_text


def test_loan_field_map_contains_every_renderer_field():
    field_map = load_loan_field_map()

    assert REQUIRED_FIELD_KEYS <= field_map.keys()
    assert field_map["employee_name"]["y"] > field_map["employee_number"]["y"]
    assert field_map["basic_salary"]["y"] != field_map["requested_amount"]["y"]
    assert field_map["installment_months"]["y"] != field_map["deduction_start_date"]["y"]
    # The approved compact layout uses three roles above and two wider roles below.
    first_row = ["manager", "hr", "cfo"]
    second_row = ["ceo", "disbursement"]
    for row in (first_row, second_row):
        xs = [field_map["disbursement_name" if c == "disbursement" else f"{c}_approval_name"]["x"] for c in row]
        assert xs == sorted(xs)
    assert len({field_map[f"{c}_approval_name"]["y"] for c in first_row}) == 1
    assert field_map["ceo_approval_name"]["y"] == field_map["disbursement_name"]["y"]
    assert field_map["manager_approval_name"]["y"] > field_map["ceo_approval_name"]["y"]


def test_loan_values_keep_approval_rows_and_optional_values_separate():
    def actor(name):
        return SimpleNamespace(full_name=name, email=f"{name.lower()}@ffi.test")

    instance = SimpleNamespace(
        id=7,
        employee=actor("طلب عربي طويل"),
        employee_profile=SimpleNamespace(
            full_name_en="A very long employee name that must fit in the employee field",
            employee_id="EMP-AR-007",
            department_name_en="Operations",
            job_title_en="Senior Coordinator",
            mobile="+966500000007",
            basic_salary=Decimal("12000.00"),
        ),
        status="rejected",
        loan_type="installment",
        requested_amount=Decimal("9999.99"),
        installment_months=10,
        target_deduction_year=2026,
        target_deduction_month=10,
        approved_year=None,
        approved_month=None,
        deduction_payroll_run_id=None,
        reason="سبب عربي طويل " * 20,
        created_at=None,
        manager_decision_by=actor("Manager One"),
        manager_decision_at="2026-09-01",
        manager_recommendation="approve",
        finance_decision_by=actor("HR One"),
        finance_decision_at="2026-09-02",
        hr_recommendation="reject",
        cfo_decision_by=None,
        cfo_decision_at=None,
        ceo_decision_by=None,
        ceo_decision_at=None,
        disbursed_by=None,
        disbursed_at=None,
    )

    values = build_loan_request_values(instance)

    assert values["employee_name"].startswith("A very long")
    assert values["basic_salary"] == "12,000.00"
    assert values["requested_amount"] == "9,999.99"
    assert values["installment_months"] == "10"
    assert values["deduction_start_date"] == "2026-10"
    assert values["filed_date"] == values["request_date"]
    # No earlier loan exists on this detached record, so the section stays blank.
    assert values["previous_loan_status"] == ""
    assert values["previous_loan_end_date"] == ""
    assert values["manager_approval_name"] == "Manager One"
    assert values["manager_approval_decision"] == "Approved"
    assert values["hr_approval_name"] == "HR One"
    assert values["hr_approval_decision"] == "Rejected"
    assert values["cfo_approval_name"] == ""
    assert values["cfo_approval_decision"] == ""
    assert values["disbursement_signature"] == ""


def test_missing_loan_field_map_uses_the_safe_fallback(monkeypatch):
    instance = SimpleNamespace()
    monkeypatch.setattr("loans.pdf_loan_request.load_loan_form_assets", lambda *a, **k: None)

    assert build_loan_request_pdf(instance, fallback=lambda _: b"fallback-pdf") == b"fallback-pdf"


def test_template_and_map_are_resolved_as_one_pair():
    assets = load_loan_form_assets()

    assert assets is not None
    assert Path(assets.template_path).name == TEMPLATE_FILENAME
    assert (Path(assets.template_path).parent / "loan_request_blank_field_map.json").exists()
    assert assets.meta["version"] == 4


def _decided(name):
    return SimpleNamespace(full_name=name, email=f"{name.lower().replace(' ', '.')}@ffi.test")


def test_signers_are_the_actors_recorded_on_each_stage():
    manager, hr = _decided("Manager One"), _decided("HR One")
    instance = SimpleNamespace(
        manager_decision_by=manager,
        manager_decision_at=datetime(2026, 9, 1, tzinfo=dt_timezone.utc),
        finance_decision_by=hr,
        finance_decision_at=datetime(2026, 9, 2, tzinfo=dt_timezone.utc),
        cfo_decision_by=_decided("CFO One"),
        cfo_decision_at=None,
        ceo_decision_by=None,
        ceo_decision_at=None,
        disbursed_by=None,
        disbursed_at=None,
    )

    signers = build_loan_request_signers(instance)

    assert signers["manager_signature_image"] is manager
    assert signers["hr_signature_image"] is hr
    # Recorded actor but no decision timestamp: the stage is not complete.
    assert signers["cfo_signature_image"] is None
    assert signers["ceo_signature_image"] is None
    assert signers["disbursement_signature_image"] is None


def test_signature_lands_only_in_the_manager_column():
    assets = load_loan_form_assets()
    assert assets is not None
    spec = assets.fields["manager_signature_image"]

    pdf_bytes, diagnostics = render_mapped_form(
        assets,
        {"manager_approval_name": "Manager One", "manager_approval_decision": "Approved"},
        signatures={
            "manager_signature_image": SignatureAsset(data=make_png(), signer_label="Manager One"),
            "ceo_signature_image": None,
        },
    )

    boxes = image_boxes(pdf_bytes)
    assert len(boxes) == 1
    x0, y0, x1, y1 = boxes[0]
    assert spec["x"] <= x0 and x1 <= spec["x"] + spec["width"]
    assert spec["y"] <= y0 and y1 <= spec["y"] + spec["height"]
    states = {row["field"]: row["state"] for row in diagnostics}
    assert states["manager_signature_image"] == SIGNATURE_PLACED
    assert states["ceo_signature_image"] == SIGNATURE_MISSING


def test_unsigned_loan_renders_with_no_signature_image():
    instance = SimpleNamespace(
        id=7,
        employee=None,
        employee_profile=None,
        status=LoanRequest.RequestStatus.PENDING_HR,
        loan_type=LoanRequest.LoanType.INSTALLMENT,
        requested_amount=Decimal("5000.00"),
        installment_months=5,
        reason="Medical expenses",
        created_at=None,
        manager_decision_by=None,
        manager_decision_at=None,
        finance_decision_by=None,
        finance_decision_at=None,
        cfo_decision_by=None,
        cfo_decision_at=None,
        ceo_decision_by=None,
        ceo_decision_at=None,
        disbursed_by=None,
        disbursed_at=None,
    )

    pdf_bytes = _build_loan_request_pdf(instance)

    assert image_boxes(pdf_bytes) == []


# --------------------------------------------------------------------------
# Approval date positioning
#
# Regression for LOAN-PDF-DATE-POSITION: the five date boxes spanned y 47..59,
# straddling the printed rule at y=54, so the renderer centred each baseline at
# 51.2 - below the line, with the glyphs crossing it.
# --------------------------------------------------------------------------

#: The y of every printed date rule in the approval band, measured from the
#: template rather than assumed.
APPROVAL_DATE_FIELDS = (
    "manager_approval_date",
    "hr_approval_date",
    "cfo_approval_date",
    "ceo_approval_date",
    "disbursement_date",
)


def printed_date_rules(template_path):
    """Return the horizontal date rules in the approval band, left to right."""

    document = pymupdf.open(template_path)
    try:
        page = document[0]
        height = page.rect.height
        rules = set()
        for drawing in page.get_drawings():
            for item in drawing["items"]:
                if item[0] != "l":
                    continue
                start, end = item[1], item[2]
                if abs(start.y - end.y) >= 0.6:
                    continue
                y = round(height - start.y, 2)
                if 50 <= y <= 60:
                    rules.add((y, round(min(start.x, end.x), 2), round(max(start.x, end.x), 2)))
        return sorted(rules, key=lambda rule: rule[1])
    finally:
        document.close()


def text_boxes(pdf_bytes, needle):
    """Bottom-left bounding boxes of every occurrence of ``needle`` on page 1."""

    document = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = document[0]
        height = page.rect.height
        return [(rect.x0, height - rect.y1, rect.x1, height - rect.y0) for rect in page.search_for(needle)]
    finally:
        document.close()


def test_each_approval_date_has_a_visible_box_clear_of_its_signature_space():
    assets = load_loan_form_assets()
    assert assets is not None
    assert printed_date_rules(assets.template_path) == []

    for field in APPROVAL_DATE_FIELDS:
        spec = assets.fields[field]
        signature_field = field.replace("_approval_date", "_signature_image").replace(
            "disbursement_date", "disbursement_signature_image"
        )
        signature = assets.fields[signature_field]
        assert spec["height"] >= 14
        assert spec["y"] + spec["height"] <= signature["y"]


def test_each_approval_date_baseline_stays_inside_its_box():
    """The renderer's centred baseline remains inside each boxed date field."""

    assets = load_loan_form_assets()

    for field in APPROVAL_DATE_FIELDS:
        spec = assets.fields[field]
        baseline = spec["y"] + (spec["height"] - spec["font_size"]) / 2 + 1
        assert spec["y"] < baseline < spec["y"] + spec["height"]


def test_rendered_dates_stay_inside_their_boxes():
    assets = load_loan_form_assets()
    dates = {
        "manager_approval_date": "2026-09-01",
        "hr_approval_date": "2026-09-08",
        "cfo_approval_date": "2026-09-03",
        "ceo_approval_date": "2026-09-04",
        "disbursement_date": "2026-09-05",
    }

    pdf_bytes, _ = render_mapped_form(assets, dates)

    for field, value in dates.items():
        spec = assets.fields[field]
        boxes = [
            box
            for box in text_boxes(pdf_bytes, value)
            if spec["x"] - 1 <= box[0] and box[2] <= spec["x"] + spec["width"] + 1
        ]
        assert len(boxes) == 1, f"{field} should render {value} once inside its own column"
        x0, y0, x1, y1 = boxes[0]
        assert y0 >= spec["y"] - 1.5, f"{field} text must stay within its mapped box"
        assert y1 <= spec["y"] + spec["height"] + 1.5, f"{field} text must stay within its mapped box"
        # Centred in the approved visible date box.
        assert (x0 + x1) / 2 == pytest.approx(spec["x"] + spec["width"] / 2, abs=1.0)


def test_hr_approval_date_does_not_collide_with_its_signature_space():
    """The HR date box remains below the blank signature region."""

    assets = load_loan_form_assets()
    spec = assets.fields["hr_approval_date"]
    signature = assets.fields["hr_signature_image"]

    assert spec["height"] >= 14
    assert spec["y"] + spec["height"] <= signature["y"]


def test_repositioned_dates_do_not_displace_the_signature():
    """Populated text boxes constrain signature placement; dates must not."""

    assets = load_loan_form_assets()
    signature_spec = assets.fields["hr_signature_image"]

    pdf_bytes, diagnostics = render_mapped_form(
        assets,
        {"hr_approval_name": "Nour Hassan", "hr_approval_decision": "Approved", "hr_approval_date": "2026-09-08"},
        signatures={"hr_signature_image": SignatureAsset(data=make_png(), signer_label="Nour Hassan")},
    )

    assert diagnostics[0]["state"] == SIGNATURE_PLACED
    boxes = image_boxes(pdf_bytes)
    assert len(boxes) == 1
    x0, y0, x1, y1 = boxes[0]
    assert signature_spec["y"] <= y0 and y1 <= signature_spec["y"] + signature_spec["height"]
