import re
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import pytest
from django.utils import timezone
from pypdf import PdfReader

from audit.models import AuditLog
from core.pdf_forms import SIGNATURE_MISSING, SIGNATURE_PLACED, SignatureAsset, render_mapped_form
from core.tests_pdf_forms import image_boxes, make_png
from permission_requests.models import PermissionRequest
from permission_requests.pdf_permission_request import (
    FIELD_MAP_FILENAME,
    REQUIRED_FIELD_KEYS,
    TEMPLATE_FILENAME,
    build_permission_request_pdf,
    build_permission_request_signers,
    build_permission_request_values,
    load_permission_form_assets,
)
from permission_requests.tests.helpers import BASE_URL

Status = PermissionRequest.Status
Decision = PermissionRequest.Decision
CEO_PATTERN = re.compile(r"\bCEO\b|الرئيس التنفيذي", re.IGNORECASE)


def _text(pdf_bytes):
    return "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(pdf_bytes)).pages)


@pytest.fixture
def approved_request(team, make_request):
    decided_at = timezone.now()
    return make_request(
        team.employee,
        status=Status.APPROVED,
        reason="Clinic appointment",
        manager_decision=Decision.APPROVED,
        manager_decision_by=team.manager,
        manager_decision_at=decided_at,
        hr_decision=Decision.APPROVED,
        hr_decision_by=team.hr,
        hr_decision_at=decided_at,
        hr_decision_note="Recorded in attendance",
    )


# -- the template/map pair -------------------------------------------------------------


def test_template_and_colocated_map_resolve_as_one_pair():
    assets = load_permission_form_assets()

    assert assets is not None
    template = Path(assets.template_path)
    assert template.name == TEMPLATE_FILENAME
    assert (template.parent / FIELD_MAP_FILENAME).is_file()
    assert set(assets.fields) == REQUIRED_FIELD_KEYS


def test_form_has_employee_manager_and_hr_panels_only():
    fields = load_permission_form_assets().fields

    panels = sorted(key.removesuffix("_signature_image") for key, spec in fields.items() if spec.get("kind") == "image")
    assert panels == ["employee", "hr", "manager"]
    assert set(fields["manager_decision"]["checkboxes"]) == {"approved", "rejected"}
    assert set(fields["exit_type"]["checkboxes"]) == {"business", "personal", "emergency"}
    assert not [key for key in fields if "ceo" in key.lower()]
    assert not [key for key in REQUIRED_FIELD_KEYS if "ceo" in key]


def test_blank_template_prints_no_ceo_section():
    text = _text(Path(load_permission_form_assets().template_path).read_bytes())

    assert text.strip()
    assert not CEO_PATTERN.search(text)


# -- values and signers ----------------------------------------------------------------


@pytest.mark.django_db
def test_values_fill_both_decided_stages(approved_request):
    values = build_permission_request_values(approved_request)
    today = timezone.localdate().isoformat()

    assert values["request_date"] == values["exit_date"] == today
    assert (values["from_time"], values["to_time"], values["exit_type"]) == ("09:00", "10:00", "personal")
    assert (values["employee_name"], values["direct_manager"]) == ("Eyad Employee", "Maha Manager")
    assert (values["manager_decision"], values["manager_name"]) == ("approved", "Maha Manager")
    assert (values["hr_name"], values["hr_notes"]) == ("Huda HR", "Recorded in attendance")
    assert values["hr_signature_date"] == timezone.localtime(approved_request.hr_decision_at).date().isoformat()
    assert values["justification"] == "Clinic appointment"
    assert not [key for key in values if "ceo" in key]


@pytest.mark.django_db
def test_undecided_and_rejected_stages_render_honestly(team, make_request):
    rejected = make_request(
        team.employee,
        status=Status.REJECTED,
        manager_decision=Decision.REJECTED,
        manager_decision_by=team.manager,
        manager_decision_at=timezone.now(),
        hr_decision_note="never printed without an HR decision",
    )
    pending = make_request(team.employee, status=Status.PENDING_MANAGER)

    rejected_values = build_permission_request_values(rejected)
    assert rejected_values["manager_decision"] == "rejected"
    assert (rejected_values["hr_name"], rejected_values["hr_notes"], rejected_values["hr_signature_date"]) == (
        "",
        "",
        "",
    )

    pending_values = build_permission_request_values(pending)
    assert (pending_values["manager_decision"], pending_values["manager_name"]) == (None, "")
    # Before any decision the form names the currently valid direct manager.
    assert pending_values["direct_manager"] == "Maha Manager"


@pytest.mark.django_db
def test_signers_are_the_recorded_approvers_never_the_downloader(approved_request, team, client_for):
    assert build_permission_request_signers(approved_request) == {
        "employee_signature_image": team.employee.employee_profile,
        "manager_signature_image": team.manager,
        "hr_signature_image": team.hr,
    }

    with patch("permission_requests.pdf_permission_request.signer_signatures", return_value={}) as resolve:
        response = client_for(team.hr).get(f"{BASE_URL}{approved_request.pk}/pdf/")

    assert response.status_code == 200
    slots = resolve.call_args.args[0]
    assert (slots["manager_signature_image"], slots["hr_signature_image"]) == (team.manager, team.hr)


@pytest.mark.django_db
def test_undecided_stage_has_no_signer(team, make_request):
    pending_hr = make_request(
        team.employee,
        status=Status.PENDING_HR,
        manager_decision=Decision.APPROVED,
        manager_decision_by=team.manager,
        manager_decision_at=timezone.now(),
    )

    signers = build_permission_request_signers(pending_hr)

    assert (signers["manager_signature_image"], signers["hr_signature_image"]) == (team.manager, None)


def test_signature_is_drawn_only_inside_its_mapped_box():
    assets = load_permission_form_assets()

    pdf_bytes, diagnostics = render_mapped_form(
        assets,
        {"reference_no": "PERM-20260910-0001", "manager_name": "Maha Manager", "manager_decision": "approved"},
        signatures={"manager_signature_image": SignatureAsset(make_png(), "Maha Manager"), "hr_signature_image": None},
    )

    assert {row["field"]: row["state"] for row in diagnostics} == {
        "manager_signature_image": SIGNATURE_PLACED,
        "hr_signature_image": SIGNATURE_MISSING,
    }
    spec = assets.fields["manager_signature_image"]
    [(x0, y0, x1, y1)] = image_boxes(pdf_bytes)
    assert spec["x"] - 0.5 <= x0 and x1 <= spec["x"] + spec["width"] + 0.5
    assert spec["y"] - 0.5 <= y0 and y1 <= spec["y"] + spec["height"] + 0.5


# -- rendering and download ------------------------------------------------------------


@pytest.mark.django_db
def test_rendered_form_carries_the_request_and_no_ceo_data(approved_request):
    pdf_bytes = build_permission_request_pdf(approved_request)

    assert pdf_bytes.startswith(b"%PDF")
    assert len(PdfReader(BytesIO(pdf_bytes)).pages) == 1
    text = _text(pdf_bytes)
    for expected in (approved_request.reference_no, "Eyad Employee", "Maha Manager", "Huda HR", "09:00", "10:00"):
        assert expected in text
    assert not CEO_PATTERN.search(text)


@pytest.mark.django_db
def test_missing_template_pair_falls_back_to_the_generic_document(approved_request):
    with patch("permission_requests.pdf_permission_request.load_permission_form_assets", return_value=None):
        pdf_bytes = build_permission_request_pdf(approved_request)

    assert pdf_bytes.startswith(b"%PDF")


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("who", "expected"),
    [("owner", 200), ("manager", 200), ("hr", 200), ("admin", 200), ("ceo", 404), ("coworker", 404)],
)
def test_pdf_download_is_private_audited_and_limited(who, expected, team, make_user, client_for, approved_request):
    users = {"owner": team.employee, "manager": team.manager, "hr": team.hr}
    if who == "admin":
        users[who] = make_user("SystemAdmin")
    elif who == "ceo":
        users[who] = make_user("CEO")
    elif who == "coworker":
        users[who] = make_user("Employee", manager=team.manager)

    with patch("permission_requests.views.build_permission_request_pdf", return_value=b"%PDF-1.4 test") as render:
        response = client_for(users[who]).get(f"{BASE_URL}{approved_request.pk}/pdf")

    assert response.status_code == expected
    assert render.call_count == int(expected == 200)
    logs = AuditLog.objects.filter(action="permission_request_pdf_downloaded", entity_id=str(approved_request.pk))
    if expected != 200:
        assert not logs.exists()
        return
    assert response["Content-Type"] == "application/pdf"
    assert response["Content-Disposition"] == (
        f'attachment; filename="permission_request_{approved_request.reference_no}.pdf"'
    )
    assert response["Cache-Control"] == "private, no-store"
    assert response["X-Content-Type-Options"] == "nosniff"
    log = logs.get()
    assert log.actor == users[who]
    assert log.metadata["company_id"] == approved_request.company_id
    assert "Clinic appointment" not in str(log.metadata)
