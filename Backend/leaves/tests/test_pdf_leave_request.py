from datetime import date, datetime
from datetime import timezone as dt_timezone
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

from django.conf import settings
from pypdf import PdfReader

from core.pdf_forms import SIGNATURE_MISSING, SIGNATURE_PLACED, SignatureAsset, load_form_assets, render_mapped_form
from core.tests_pdf_forms import image_boxes, make_png
from leaves.pdf_leave_request import (
    REQUIRED_FIELD_KEYS,
    TEMPLATE_FILENAME,
    build_leave_request_pdf,
    build_leave_request_signers,
    build_leave_request_values,
    load_field_map,
    load_leave_form_assets,
    render_leave_request_pdf,
)

TEMPLATE = Path(settings.BASE_DIR) / "static" / "pdf_templates" / TEMPLATE_FILENAME


def _instance(**overrides):
    """A leave request stand-in carrying only the attributes the form reads."""

    profile = SimpleNamespace(
        full_name_en="Mariam Abdelrahman",
        full_name="Mariam Abdelrahman",
        employee_number="EMP-2026-014",
        employee_id="EMP-2026-014",
        department_name_en="Project Management Office",
        job_title_en="Senior Project Controls Engineer",
        mobile="+966500000014",
        manager_profile=None,
        manager=None,
        company=SimpleNamespace(name="FFI Contracting"),
        task_group_ref=None,
    )
    employee = SimpleNamespace(full_name="Mariam Abdelrahman", email="mariam@ffi.test", employee_profile=profile)
    base = {
        "id": 42,
        "employee": employee,
        "employee_profile": profile,
        "leave_type": SimpleNamespace(name="Annual Leave", code="ANNUAL"),
        "leave_type_id": 1,
        "start_date": date(2026, 9, 14),
        "end_date": date(2026, 9, 19),
        "created_at": datetime(2026, 9, 5, 8, 0, tzinfo=dt_timezone.utc),
        "reason": "Family travel during the approved leave window.",
        "status": "approved",
        "delegated_to": None,
        "manager_decision_by": None,
        "manager_decision_at": None,
        "ceo_decision_by": None,
        "ceo_decision_at": None,
        "hr_completed_by": None,
        "hr_completed_at": None,
        "decided_by": None,
        "decided_at": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def test_field_map_uses_one_page_rtl_date_flow():
    field_map = load_field_map()

    assert field_map["start_date"]["page"] == 1
    assert field_map["end_date"]["page"] == 1
    assert field_map["start_date"]["x"] > field_map["end_date"]["x"]


def test_supplied_map_declares_every_field_the_renderer_fills():
    """The renderer's contract and the deployed map must agree exactly."""

    field_map = load_field_map()
    retired = {
        "cost_center",
        "employment_type",
        "is_half_day",
        "half_day_type",
        "hr_received_date",
        "processed_by",
        "hr_remarks",
        "hr_use_only",
        "leave_balance_after_approval",
        "date_approved",
        # Superseded by the signature image/date pairs the approved map declares.
        "employee_signature",
        "line_manager_signature",
        "department_head_signature",
        "hr_signature",
        "manager_recommended",
        "approval_date",
        "approval_comments",
    }

    assert REQUIRED_FIELD_KEYS <= field_map.keys()
    assert retired.isdisjoint(field_map)


def test_map_declares_a_signature_box_for_each_of_the_four_panels():
    field_map = load_field_map()

    for panel in ("employee", "line_manager", "department_head", "hr"):
        spec = field_map[f"{panel}_signature_image"]
        assert spec["kind"] == "image"
        assert spec["page"] == 1


def test_template_and_map_are_resolved_as_one_pair():
    assets = load_leave_form_assets()

    assert assets is not None
    assert Path(assets.template_path).name == TEMPLATE_FILENAME
    assert (Path(assets.template_path).parent / "leave_request_blank_field_map.json").exists()


def test_rendered_leave_request_is_one_page_and_contains_overlay_values():
    values = {
        "reference_no": "LR-01234",
        "employee_name": "A Very Long Employee Name for PDF Layout Verification",
        "department": "إدارة المشاريع والعمليات",
        "end_date": "2026-09-19",
        "start_date": "2026-09-14",
        "reason": "ظرف عائلي يتطلب السفر خلال فترة الإجازة",
        "ticket_required": False,
    }

    rendered = render_leave_request_pdf(TEMPLATE, values)
    reader = PdfReader(BytesIO(rendered))
    extracted = "\n".join(page.extract_text() or "" for page in reader.pages)

    assert len(reader.pages) == 1
    assert "LR-01234" in extracted
    assert "2026-09-14" in extracted
    assert "2026-09-19" in extracted


def test_values_come_from_the_record_and_absent_optionals_stay_blank():
    values = build_leave_request_values(_instance())

    assert values["reference_no"] == "LR-00042"
    assert values["employee_name"] == "Mariam Abdelrahman"
    assert values["employee_id"] == "EMP-2026-014"
    assert values["department"] == "Project Management Office"
    assert values["leave_type"] == "Annual Leave / إجازة سنوية"
    assert values["total_days_requested"] == "6"
    # No substitute was delegated, so those boxes must stay empty.
    assert values["substitute_employee_name"] == ""
    assert values["substitute_department"] == ""
    # No approval has happened yet.
    assert values["line_manager_signature_date"] == ""
    assert values["hr_signature_date"] == ""


def test_signers_are_the_recorded_workflow_actors():
    manager = SimpleNamespace(full_name="Manager One", email="manager@ffi.test")
    hr = SimpleNamespace(full_name="HR One", email="hr@ffi.test")
    instance = _instance(
        manager_decision_by=manager,
        manager_decision_at=datetime(2026, 9, 6, tzinfo=dt_timezone.utc),
        hr_completed_by=hr,
        hr_completed_at=datetime(2026, 9, 8, tzinfo=dt_timezone.utc),
    )

    signers = build_leave_request_signers(instance)

    assert signers["employee_signature_image"] is instance.employee
    assert signers["line_manager_signature_image"] is manager
    assert signers["hr_signature_image"] is hr
    # CEO never decided, so that panel has no signer.
    assert signers["department_head_signature_image"] is None


def test_an_undecided_stage_never_borrows_another_signer():
    signers = build_leave_request_signers(_instance(manager_decision_by=SimpleNamespace(full_name="Manager One")))

    assert signers["line_manager_signature_image"] is None


def test_employee_signature_lands_only_in_the_employee_panel():
    assets = load_leave_form_assets()
    assert assets is not None
    spec = assets.fields["employee_signature_image"]

    pdf_bytes, diagnostics = render_mapped_form(
        assets,
        build_leave_request_values(_instance()),
        signatures={
            "employee_signature_image": SignatureAsset(data=make_png(), signer_label="Mariam Abdelrahman"),
            "hr_signature_image": None,
        },
    )

    boxes = image_boxes(pdf_bytes)
    assert len(boxes) == 1
    x0, y0, x1, y1 = boxes[0]
    assert spec["x"] <= x0 and x1 <= spec["x"] + spec["width"]
    assert spec["y"] <= y0 and y1 <= spec["y"] + spec["height"]
    states = {row["field"]: row["state"] for row in diagnostics}
    assert states["employee_signature_image"] == SIGNATURE_PLACED
    assert states["hr_signature_image"] == SIGNATURE_MISSING


def test_real_record_renders_without_any_signature_when_none_is_stored():
    pdf_bytes = build_leave_request_pdf(_instance())
    reader = PdfReader(BytesIO(pdf_bytes))

    assert pdf_bytes.startswith(b"%PDF")
    assert len(reader.pages) == 1
    assert image_boxes(pdf_bytes) == [], "no employee signature is stored, so nothing may be drawn"
    assert "LR-00042" in reader.pages[0].extract_text()


def test_missing_pair_takes_the_documented_fallback(monkeypatch):
    monkeypatch.setattr("leaves.pdf_leave_request.load_leave_form_assets", lambda *a, **k: None)

    assert build_leave_request_pdf(_instance(), fallback=lambda _: b"fallback-pdf") == b"fallback-pdf"


def test_map_pair_is_validated_against_the_renderer_contract():
    assert load_form_assets(TEMPLATE_FILENAME, "does_not_exist_field_map.json") is None
