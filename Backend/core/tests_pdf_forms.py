"""Contract tests for the shared map-driven request-form renderer.

These cover the behaviour every bundled form depends on: which template/map pair
gets selected, that a broken pair fails safely, and that a signature can only
ever land inside the box the approved map declares for it.
"""

from __future__ import annotations

import json
import struct
import zlib
from io import BytesIO
from pathlib import Path

import pymupdf
import pytest
from django.conf import settings
from django.test import override_settings
from pypdf import PdfReader

from core.pdf_forms import (
    SIGNATURE_INVALID,
    SIGNATURE_MISSING,
    SIGNATURE_PLACED,
    SIGNATURE_UNMAPPED,
    SIGNATURE_UNPLACEABLE,
    FormAssets,
    SignatureAsset,
    load_form_assets,
    render_mapped_form,
    superseded_text_fields,
)

BUNDLED_DIR = Path(settings.BASE_DIR) / "static" / "pdf_templates"
LEAVE_TEMPLATE = "leave_request_blank.pdf"
LEAVE_MAP = "leave_request_blank_field_map.json"


def make_png(width: int = 240, height: int = 60) -> bytes:
    """Build a minimal opaque RGB PNG without depending on an imaging library."""

    raw = b"".join(b"\x00" + b"\x20\x20\x20" * width for _ in range(height))

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload)) + tag + payload + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def _all_image_boxes(pdf_bytes: bytes) -> list[tuple[float, float, float, float]]:
    """Every raster image bbox on page 1, in bottom-left PDF points."""

    document = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = document[0]
        page_height = page.rect.height
        return [
            (info["bbox"][0], page_height - info["bbox"][3], info["bbox"][2], page_height - info["bbox"][1])
            for info in page.get_image_info()
        ]
    finally:
        document.close()


def image_boxes(pdf_bytes: bytes) -> list[tuple[float, float, float, float]]:
    """Boxes of images the overlay added, ignoring the template's own artwork.

    Every blank form carries the company logo, so a raw image count would never
    isolate the signature. Anything at a position the blank template already
    occupies is treated as template artwork.
    """

    template_boxes = _template_artwork_boxes()
    return [box for box in _all_image_boxes(pdf_bytes) if _rounded(box) not in template_boxes]


def _rounded(box: tuple[float, float, float, float]) -> tuple[float, ...]:
    return tuple(round(value, 1) for value in box)


def _template_artwork_boxes() -> set[tuple[float, ...]]:
    boxes: set[tuple[float, ...]] = set()
    for template in BUNDLED_DIR.glob("*_blank.pdf"):
        boxes.update(_rounded(box) for box in _all_image_boxes(template.read_bytes()))
    return boxes


@pytest.fixture
def leave_assets() -> FormAssets:
    assets = load_form_assets(LEAVE_TEMPLATE, LEAVE_MAP)
    assert assets is not None
    return assets


# --------------------------------------------------------------------------
# Template and map resolution
# --------------------------------------------------------------------------


def test_production_templates_dir_wins_over_the_bundled_copy(tmp_path):
    """A deployment that mounts HR_TEMPLATES_DIR must be served from it."""

    for name in (LEAVE_TEMPLATE, LEAVE_MAP):
        (tmp_path / name).write_bytes((BUNDLED_DIR / name).read_bytes())

    with override_settings(HR_TEMPLATES_DIR=str(tmp_path)):
        assets = load_form_assets(LEAVE_TEMPLATE, LEAVE_MAP)

    assert assets is not None
    assert Path(assets.template_path).parent == tmp_path


def test_empty_production_dir_falls_back_to_the_bundled_pair(tmp_path):
    with override_settings(HR_TEMPLATES_DIR=str(tmp_path)):
        assets = load_form_assets(LEAVE_TEMPLATE, LEAVE_MAP)

    assert assets is not None
    assert Path(assets.template_path).parent == BUNDLED_DIR


def test_template_deployed_without_its_map_fails_safe(tmp_path):
    """A PDF with no colocated map must never be filled with the bundled map's
    coordinates - the caller has to take its documented fallback instead."""

    (tmp_path / LEAVE_TEMPLATE).write_bytes((BUNDLED_DIR / LEAVE_TEMPLATE).read_bytes())

    with override_settings(HR_TEMPLATES_DIR=str(tmp_path)):
        assert load_form_assets(LEAVE_TEMPLATE, LEAVE_MAP) is None


def test_map_missing_a_required_field_fails_safe(tmp_path):
    (tmp_path / LEAVE_TEMPLATE).write_bytes((BUNDLED_DIR / LEAVE_TEMPLATE).read_bytes())
    (tmp_path / LEAVE_MAP).write_text(json.dumps({"reference_no": {"page": 1, "x": 1, "y": 1}}), encoding="utf-8")

    with override_settings(HR_TEMPLATES_DIR=str(tmp_path)):
        assert load_form_assets(LEAVE_TEMPLATE, LEAVE_MAP, required_keys={"employee_name"}) is None


def test_unreadable_map_fails_safe(tmp_path):
    (tmp_path / LEAVE_TEMPLATE).write_bytes((BUNDLED_DIR / LEAVE_TEMPLATE).read_bytes())
    (tmp_path / LEAVE_MAP).write_text("{ not json", encoding="utf-8")

    with override_settings(HR_TEMPLATES_DIR=str(tmp_path)):
        assert load_form_assets(LEAVE_TEMPLATE, LEAVE_MAP) is None


def test_versioned_and_flat_map_schemas_both_load():
    flat = load_form_assets(LEAVE_TEMPLATE, LEAVE_MAP)
    versioned = load_form_assets("loan_request_blank.pdf", "loan_request_blank_field_map.json")

    assert flat is not None and "employee_name" in flat.fields
    assert versioned is not None and "employee_name" in versioned.fields
    assert versioned.meta["coordinate_origin"] == "bottom_left"


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------


def test_template_pages_are_preserved_and_values_are_written(leave_assets):
    pdf_bytes, _ = render_mapped_form(leave_assets, {"reference_no": "LR-00042", "employee_name": "Mariam A."})
    reader = PdfReader(BytesIO(pdf_bytes))
    extracted = reader.pages[0].extract_text()

    assert pdf_bytes.startswith(b"%PDF")
    assert len(reader.pages) == 1
    # Original artwork survives the overlay.
    assert "Employee Information" in extracted
    assert "LR-00042" in extracted
    assert "Mariam A." in extracted


def test_absent_optional_values_stay_blank(leave_assets):
    pdf_bytes, _ = render_mapped_form(
        leave_assets,
        {"reference_no": "LR-00043", "substitute_employee_name": "", "substitute_notes": None},
    )
    extracted = PdfReader(BytesIO(pdf_bytes)).pages[0].extract_text()

    assert "LR-00043" in extracted
    # No placeholder dash or "None" leaks into an empty professional form field.
    assert "None" not in extracted


def _tick_positions(pdf_bytes: bytes) -> list[float]:
    """x centres of every "X" mark drawn on page 1."""

    document = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        return sorted(round((rect.x0 + rect.x1) / 2, 1) for rect in document[0].search_for("X"))
    finally:
        document.close()


def test_checkboxes_are_ticked_at_the_anchor_the_map_declares(leave_assets):
    anchors = leave_assets.fields["will_travel"]["checkboxes"]
    yes, _ = render_mapped_form(leave_assets, {"will_travel": True})
    no, _ = render_mapped_form(leave_assets, {"will_travel": False})
    blank, _ = render_mapped_form(leave_assets, {})

    assert _tick_positions(blank) == []
    assert _tick_positions(yes) == [round(anchors["yes"][0], 1)]
    assert _tick_positions(no) == [round(anchors["no"][0], 1)]


def test_an_empty_value_set_still_renders_the_blank_form(leave_assets):
    pdf_bytes, _ = render_mapped_form(leave_assets, {})
    reader = PdfReader(BytesIO(pdf_bytes))

    assert len(reader.pages) == 1
    assert "Leave Request" in reader.pages[0].extract_text()


# --------------------------------------------------------------------------
# Signatures
# --------------------------------------------------------------------------


def test_signature_is_placed_only_inside_its_mapped_box(leave_assets):
    spec = leave_assets.fields["employee_signature_image"]
    asset = SignatureAsset(data=make_png(), signer_label="Mariam A.")

    pdf_bytes, diagnostics = render_mapped_form(
        leave_assets, {"reference_no": "LR-00044"}, signatures={"employee_signature_image": asset}
    )

    boxes = image_boxes(pdf_bytes)
    assert len(boxes) == 1
    x0, y0, x1, y1 = boxes[0]
    assert spec["x"] <= x0 and x1 <= spec["x"] + spec["width"]
    assert spec["y"] <= y0 and y1 <= spec["y"] + spec["height"]
    assert diagnostics == [{"field": "employee_signature_image", "state": SIGNATURE_PLACED, "signer": "Mariam A."}]


def test_missing_signature_draws_nothing_and_is_reported(leave_assets):
    pdf_bytes, diagnostics = render_mapped_form(
        leave_assets, {"reference_no": "LR-00045"}, signatures={"hr_signature_image": None}
    )

    assert image_boxes(pdf_bytes) == []
    assert diagnostics == [{"field": "hr_signature_image", "state": SIGNATURE_MISSING, "signer": ""}]


def test_unsupported_signature_bytes_are_refused_not_drawn(leave_assets):
    _, diagnostics = render_mapped_form(
        leave_assets,
        {"reference_no": "LR-00046"},
        signatures={"hr_signature_image": SignatureAsset(data=b"<svg/>", signer_label="HR")},
    )

    assert diagnostics[0]["state"] == SIGNATURE_INVALID


def test_signature_for_a_field_absent_from_the_map_is_never_drawn(leave_assets):
    pdf_bytes, diagnostics = render_mapped_form(
        leave_assets,
        {"reference_no": "LR-00047"},
        signatures={"ceo_signature_image": SignatureAsset(data=make_png(), signer_label="CEO")},
    )

    assert image_boxes(pdf_bytes) == []
    assert diagnostics == [{"field": "ceo_signature_image", "state": SIGNATURE_UNMAPPED, "signer": ""}]


def test_signature_never_covers_a_neighbouring_value_it_overlaps():
    """The loan approval cell stacks the decision above the signature box.

    The image must shrink into the free part of its own box rather than paint
    over the decision the form has to show.
    """

    assets = load_form_assets("loan_request_blank.pdf", "loan_request_blank_field_map.json")
    assert assets is not None
    decision = assets.fields["manager_approval_decision"]
    asset = SignatureAsset(data=make_png(), signer_label="Manager One")

    pdf_bytes, diagnostics = render_mapped_form(
        assets,
        {"manager_approval_name": "Manager One", "manager_approval_decision": "Approved"},
        signatures={"manager_signature_image": asset},
    )

    assert diagnostics[0]["state"] == SIGNATURE_PLACED
    boxes = image_boxes(pdf_bytes)
    assert len(boxes) == 1
    assert boxes[0][3] <= decision["y"], "signature must stay below the decision row it would otherwise cover"


def test_a_real_signature_supersedes_only_its_own_typed_twin():
    assets = load_form_assets("loan_request_blank.pdf", "loan_request_blank_field_map.json")
    assert assets is not None
    signatures = {"manager_signature_image": SignatureAsset(data=make_png(), signer_label="Manager One")}

    superseded = superseded_text_fields(assets.fields, signatures)

    assert superseded == {"manager_signature"}
    assert "manager_approval_name" not in superseded
    assert "manager_approval_decision" not in superseded


def test_job_offer_hr_signature_sits_on_its_printed_rule_not_the_name_boxes():
    """Regression: the HR signature must never cover the signer's name or title.

    The job offer prints a dedicated ``Signature`` rule beneath the HR name and
    position boxes; the map targets that rule, so both text values survive.
    """

    assets = load_form_assets("job_offer_blank.pdf", "job_offer_blank_field_map.json")
    assert assets is not None
    signature_spec = assets.fields["hr_signature_image"]
    name_spec = assets.fields["hr_name"]
    position_spec = assets.fields["hr_position"]

    pdf_bytes, diagnostics = render_mapped_form(
        assets,
        {"hr_name": "Nour Hassan", "hr_position": "Human Resources Manager"},
        signatures={"hr_signature_image": SignatureAsset(data=make_png(), signer_label="Nour Hassan")},
    )

    assert diagnostics[0]["state"] == SIGNATURE_PLACED
    boxes = image_boxes(pdf_bytes)
    assert len(boxes) == 1
    x0, y0, x1, y1 = boxes[0]
    # Inside the box the approved map declares...
    assert signature_spec["x"] <= x0 and x1 <= signature_spec["x"] + signature_spec["width"]
    assert signature_spec["y"] <= y0 and y1 <= signature_spec["y"] + signature_spec["height"]
    # ...and clear of both text fields it used to sit on top of.
    for other in (name_spec, position_spec):
        covers = not (
            x1 <= other["x"]
            or x0 >= other["x"] + other["width"]
            or y1 <= other["y"]
            or y0 >= other["y"] + other["height"]
        )
        assert not covers, "the HR signature must not overlap the name or position box"

    extracted = PdfReader(BytesIO(pdf_bytes)).pages[0].extract_text()
    assert "Nour Hassan" in extracted
    assert "Human Resources Manager" in extracted


def test_signature_box_fully_blocked_by_values_is_reported_not_overpainted():
    """A synthetic map whose image box is entirely occupied must stay blank."""

    assets = load_form_assets(LEAVE_TEMPLATE, LEAVE_MAP)
    assert assets is not None
    blocked = dict(assets.fields)
    covered = dict(blocked["employee_signature_date"])
    blocked["blocking_text"] = covered
    blocked["blocked_signature_image"] = {**covered, "kind": "image", "padding": 1}
    assets = FormAssets(template_path=assets.template_path, fields=blocked, meta=assets.meta)

    pdf_bytes, diagnostics = render_mapped_form(
        assets,
        {"blocking_text": "2026-09-05"},
        signatures={"blocked_signature_image": SignatureAsset(data=make_png(), signer_label="X")},
    )

    assert image_boxes(pdf_bytes) == []
    assert diagnostics[0]["state"] == SIGNATURE_UNPLACEABLE


def test_oversized_signature_payload_is_refused():
    asset = SignatureAsset(data=b"\x89PNG\r\n\x1a\n" + b"0" * (2 * 1024 * 1024), signer_label="X")

    assert asset.is_supported_image() is False


# --------------------------------------------------------------------------
# Deployment consistency
# --------------------------------------------------------------------------

#: Every form a renderer fills, and the map that must travel with its template.
RENDERED_FORM_PAIRS = (
    ("leave_request_blank.pdf", "leave_request_blank_field_map.json"),
    ("loan_request_blank.pdf", "loan_request_blank_field_map.json"),
    (
        "annual_entitlements_disbursement_blank.pdf",
        "annual_entitlements_disbursement_blank_field_map.json",
    ),
    ("job_offer_blank.pdf", "job_offer_blank_field_map.json"),
    (
        "starting_work_acknowledgment_blank.pdf",
        "starting_work_acknowledgment_blank_field_map.json",
    ),
)

#: Blank forms the template library serves but no renderer fills. They are
#: allowed to ship without a map precisely because nothing maps them.
UNMAPPED_TEMPLATES = frozenset(
    {
        "asset_damage_report_blank.pdf",
        "asset_return_request_blank.pdf",
        "rent_agreement_blank.pdf",
        "employment_certificate_blank.pdf",
        "salary_certificate_blank.pdf",
        "termination_letter_blank.pdf",
    }
)


@pytest.mark.parametrize(("template", "field_map"), RENDERED_FORM_PAIRS)
def test_every_rendered_template_ships_with_its_map(template, field_map):
    assert (BUNDLED_DIR / template).exists(), f"{template} is missing from the bundled defaults"
    assert (BUNDLED_DIR / field_map).exists(), f"{template} would deploy without {field_map}"
    assert load_form_assets(template, field_map) is not None


def test_no_bundled_template_is_left_without_a_map_by_accident():
    """A new blank PDF must either be mapped or listed as deliberately unmapped."""

    mapped = {template for template, _ in RENDERED_FORM_PAIRS}
    present = {path.name for path in BUNDLED_DIR.glob("*_blank.pdf")}

    assert present - mapped - UNMAPPED_TEMPLATES == set()


@pytest.mark.parametrize(("template", "field_map"), RENDERED_FORM_PAIRS)
def test_every_mapped_box_lies_inside_its_page(template, field_map):
    """A box outside the page would silently drop its value off the sheet."""

    assets = load_form_assets(template, field_map)
    assert assets is not None
    document = pymupdf.open(assets.template_path)
    try:
        page_rects = [(page.rect.width, page.rect.height) for page in document]
    finally:
        document.close()

    for key, spec in assets.fields.items():
        page_index = min(int(spec.get("page", 1)), len(page_rects)) - 1
        width, height = page_rects[page_index]
        if "checkboxes" in spec:
            for label, (cx, cy) in spec["checkboxes"].items():
                assert 0 <= cx <= width and 0 <= cy <= height, f"{template}:{key}.{label} is off the page"
            continue
        if "x" not in spec:
            continue
        assert spec["x"] >= 0 and spec["y"] >= 0, f"{template}:{key} starts off the page"
        assert spec["x"] + spec["width"] <= width, f"{template}:{key} runs past the page width"
        assert spec["y"] + spec["height"] <= height, f"{template}:{key} runs past the page height"
