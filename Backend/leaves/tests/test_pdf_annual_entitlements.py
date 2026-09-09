"""Annual entitlements disbursement PDF: mapping, signers, and download access."""

from __future__ import annotations

from datetime import date, datetime
from datetime import timezone as dt_timezone
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from pypdf import PdfReader
from rest_framework.test import APIClient

from audit.models import AuditLog
from core.pdf_forms import SIGNATURE_MISSING, SIGNATURE_PLACED, SignatureAsset, render_mapped_form
from core.tests_pdf_forms import image_boxes, make_png
from employees.models import EmployeeProfile
from leaves.models import AnnualLeavePaymentRequest
from leaves.pdf_annual_entitlements import (
    PRE_PRINTED_FIELDS,
    REQUIRED_FIELD_KEYS,
    TEMPLATE_FILENAME,
    build_annual_entitlements_pdf,
    build_annual_entitlements_signers,
    build_annual_entitlements_values,
    load_annual_entitlements_form_assets,
)
from organization.models import OrganizationNode, UserOrganizationAccess

ENDPOINT = "/api/leaves/annual-leave-payments/{}/pdf/"


def _record(**overrides):
    profile = SimpleNamespace(
        employee_id="EMP-2026-014",
        full_name_en="Mariam Abdelrahman",
        department_name_en="Project Management Office",
    )
    employee = SimpleNamespace(full_name="Mariam Abdelrahman", email="mariam@ffi.test", employee_profile=profile)
    base = {
        "id": 42,
        "employee": employee,
        "employee_profile": profile,
        "resolution": "pay",
        "status": "approved",
        "cycle_start": date(2025, 9, 1),
        "cycle_end": date(2026, 8, 31),
        "accrued_days": Decimal("30.00"),
        "used_days": Decimal("8.00"),
        "eligible_unused_days": Decimal("22.00"),
        "payment_amount": Decimal("12000.00"),
        "carry_forward_days": Decimal("0.00"),
        "is_termination_settlement": False,
        "employee_note": "",
        "submitted_at": datetime(2026, 9, 5, 8, 0, tzinfo=dt_timezone.utc),
        "hr_reviewed_by": None,
        "hr_reviewed_at": None,
        "ceo_decided_by": None,
        "ceo_decided_at": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


# --------------------------------------------------------------------------
# Template, map, and mapping
# --------------------------------------------------------------------------


def test_template_and_map_are_resolved_as_one_pair():
    assets = load_annual_entitlements_form_assets()

    assert assets is not None
    assert Path(assets.template_path).name == TEMPLATE_FILENAME
    assert (Path(assets.template_path).parent / "annual_entitlements_disbursement_blank_field_map.json").exists()
    assert REQUIRED_FIELD_KEYS <= assets.fields.keys()


def test_values_come_from_the_settlement_record():
    values = build_annual_entitlements_values(_record())

    assert values["reference_no"] == "AED-00042"
    assert values["employee_name"] == "Mariam Abdelrahman"
    assert values["employee_id"] == "EMP-2026-014"
    assert values["department"] == "Project Management Office"
    assert values["purpose"] == "Disbursement of Annual Entitlements"
    assert values["request_date"] == "2026-09-05"


def test_resolution_is_rendered_as_a_professional_label_not_a_raw_enum():
    assert build_annual_entitlements_values(_record())["purpose"] == "Disbursement of Annual Entitlements"
    assert (
        build_annual_entitlements_values(_record(resolution="carry_forward"))["purpose"]
        == "Carry Forward of Annual Entitlements"
    )


def test_pre_printed_declaration_is_never_overwritten():
    """The template already carries the bilingual declaration paragraph."""

    values = build_annual_entitlements_values(_record())

    assert PRE_PRINTED_FIELDS.isdisjoint(values)


def test_no_raw_enum_leaks_into_the_rendered_page():
    extracted = PdfReader(BytesIO(build_annual_entitlements_pdf(_record(status="pending_hr")))).pages[0].extract_text()

    assert "pending_hr" not in extracted
    assert "carry_forward" not in extracted


def test_panels_without_a_recorded_actor_stay_blank():
    values = build_annual_entitlements_values(_record())

    assert values["financial_management_signature_date"] == ""
    assert values["accounts_officer_signature_date"] == ""
    assert values["hr_department_signature_date"] == ""


def test_generated_pdf_is_one_page_and_carries_the_record_values():
    pdf_bytes = build_annual_entitlements_pdf(_record())
    reader = PdfReader(BytesIO(pdf_bytes))
    extracted = reader.pages[0].extract_text()

    assert pdf_bytes.startswith(b"%PDF")
    assert len(reader.pages) == 1
    # Template artwork survives the overlay.
    assert "Employee Declaration" in extracted
    assert "AED-00042" in extracted
    assert "Mariam Abdelrahman" in extracted


# --------------------------------------------------------------------------
# Signers
# --------------------------------------------------------------------------


def test_signers_are_the_recorded_workflow_actors():
    hr = SimpleNamespace(full_name="HR One", email="hr@ffi.test")
    record = _record(hr_reviewed_by=hr, hr_reviewed_at=datetime(2026, 9, 8, tzinfo=dt_timezone.utc))

    signers = build_annual_entitlements_signers(record)

    assert signers["applicant_signature_image"] is record.employee
    assert signers["hr_department_signature_image"] is hr
    # No workflow stage records these two actors, so they are never guessed.
    assert signers["financial_management_signature_image"] is None
    assert signers["accounts_officer_signature_image"] is None


def test_hr_review_not_yet_done_leaves_that_panel_unsigned():
    signers = build_annual_entitlements_signers(_record(hr_reviewed_by=SimpleNamespace(full_name="HR One")))

    assert signers["hr_department_signature_image"] is None


def test_applicant_signature_lands_only_in_the_applicant_panel():
    assets = load_annual_entitlements_form_assets()
    assert assets is not None
    spec = assets.fields["applicant_signature_image"]

    pdf_bytes, diagnostics = render_mapped_form(
        assets,
        build_annual_entitlements_values(_record()),
        signatures={
            "applicant_signature_image": SignatureAsset(data=make_png(), signer_label="Mariam Abdelrahman"),
            "hr_department_signature_image": None,
        },
    )

    boxes = image_boxes(pdf_bytes)
    assert len(boxes) == 1
    x0, y0, x1, y1 = boxes[0]
    assert spec["x"] <= x0 and x1 <= spec["x"] + spec["width"]
    assert spec["y"] <= y0 and y1 <= spec["y"] + spec["height"]
    states = {row["field"]: row["state"] for row in diagnostics}
    assert states["applicant_signature_image"] == SIGNATURE_PLACED
    assert states["hr_department_signature_image"] == SIGNATURE_MISSING


def test_no_stored_signature_produces_no_signature_image():
    assert image_boxes(build_annual_entitlements_pdf(_record())) == []


def test_missing_pair_takes_the_documented_fallback(monkeypatch):
    monkeypatch.setattr("leaves.pdf_annual_entitlements.load_annual_entitlements_form_assets", lambda: None)

    assert build_annual_entitlements_pdf(_record(), fallback=lambda _: b"fallback-pdf") == b"fallback-pdf"


# --------------------------------------------------------------------------
# Download access
# --------------------------------------------------------------------------


def _settlement_fixture():
    company = OrganizationNode.objects.create(code="AED-A", name="AED A", node_type="company")
    foreign = OrganizationNode.objects.create(code="AED-B", name="AED B", node_type="company")
    users = {}
    for role in ("owner", "other", "foreign_hr", "hr"):
        user = get_user_model().objects.create_user(email=f"aed-{role}@example.com")
        tenant = foreign if role.startswith("foreign") else company
        EmployeeProfile.objects.create(user=user, company=tenant, employee_id=f"AED-{role}", full_name=role)
        if role in {"hr", "foreign_hr"}:
            user.groups.add(Group.objects.get_or_create(name="HRManager")[0])
            UserOrganizationAccess.objects.create(user=user, organization=tenant)
        users[role] = user
    settlement = AnnualLeavePaymentRequest.objects.create(
        employee=users["owner"],
        employee_profile=users["owner"].employee_profile,
        company=company,
        cycle_start=date(2025, 9, 1),
        cycle_end=date(2026, 8, 31),
        eligible_unused_days=Decimal("22.00"),
        payment_amount=Decimal("12000.00"),
    )
    return settlement, users


@pytest.mark.django_db
def test_owner_can_download_and_the_export_is_audited():
    settlement, users = _settlement_fixture()
    client = APIClient()
    client.force_authenticate(users["owner"])

    response = client.get(
        ENDPOINT.format(settlement.id),
        secure=True,
        HTTP_X_ACTIVE_COMPANY_ID=str(settlement.company_id),
    )

    assert response.status_code == 200
    assert response["Cache-Control"] == "private, no-store"
    assert response["X-Content-Type-Options"] == "nosniff"
    assert response["Content-Type"] == "application/octet-stream"
    assert response.content.startswith(b"%PDF")
    audit_row = AuditLog.objects.filter(action="annual_leave_payment_exported_pdf").first()
    assert audit_row is not None
    assert audit_row.entity_id == str(settlement.id)
    # Nothing sensitive beyond the scope keys is recorded.
    assert set(audit_row.metadata) == {"company_id", "status"}


@pytest.mark.django_db
def test_another_employee_cannot_download_someone_elses_settlement():
    settlement, users = _settlement_fixture()
    client = APIClient()
    client.force_authenticate(users["other"])

    response = client.get(
        ENDPOINT.format(settlement.id),
        secure=True,
        HTTP_X_ACTIVE_COMPANY_ID=str(users["other"].employee_profile.company_id),
    )

    assert response.status_code == 404


@pytest.mark.django_db
def test_hr_from_another_company_is_denied():
    settlement, users = _settlement_fixture()
    client = APIClient()
    client.force_authenticate(users["foreign_hr"])

    response = client.get(
        ENDPOINT.format(settlement.id),
        secure=True,
        HTTP_X_ACTIVE_COMPANY_ID=str(users["foreign_hr"].employee_profile.company_id),
    )

    assert response.status_code == 404


@pytest.mark.django_db
def test_anonymous_download_is_rejected():
    settlement, _users = _settlement_fixture()

    response = APIClient().get(ENDPOINT.format(settlement.id), secure=True)

    assert response.status_code == 401
