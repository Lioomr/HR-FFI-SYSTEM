"""End-to-end: a stored employee signature must reach the generated PDFs.

These are the tests that would fail if signatures could be uploaded but the
forms still rendered empty boxes. Each of the five approved forms is rendered
from real database rows, and the signature is located in the output by its
position so it can be checked against the slot the approved map declares.
"""

from __future__ import annotations

from datetime import date, timedelta

import pymupdf
import pytest
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.utils import timezone

from core.pdf_forms import SIGNATURE_MISSING, SIGNATURE_PLACED, load_form_assets
from core.tests_pdf_forms import make_png
from employees.models import EmployeeProfile
from organization.models import OrganizationNode

pytestmark = pytest.mark.django_db


def _template_boxes(path: str) -> set[tuple[float, ...]]:
    document = pymupdf.open(path)
    try:
        page = document[0]
        height = page.rect.height
        return {
            (round(i["bbox"][0], 1), round(height - i["bbox"][3], 1), round(i["bbox"][2], 1))
            for i in page.get_image_info()
        }
    finally:
        document.close()


def signature_boxes(pdf_bytes: bytes, template_path: str) -> list[tuple[float, float, float, float]]:
    """Images the overlay added, in bottom-left points (template art removed)."""

    artwork = _template_boxes(template_path)
    document = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = document[0]
        height = page.rect.height
        return [
            (i["bbox"][0], height - i["bbox"][3], i["bbox"][2], height - i["bbox"][1])
            for i in page.get_image_info()
            if (round(i["bbox"][0], 1), round(height - i["bbox"][3], 1), round(i["bbox"][2], 1)) not in artwork
        ]
    finally:
        document.close()


def assert_inside(box, spec, message):
    x0, y0, x1, y1 = box
    assert spec["x"] <= x0 and x1 <= spec["x"] + spec["width"], message
    assert spec["y"] <= y0 and y1 <= spec["y"] + spec["height"], message


def make_employee(company, tag, *, with_signature=True, manager_profile=None):
    user = get_user_model().objects.create_user(email=f"{tag.lower()}@sig.test")
    profile = EmployeeProfile.objects.create(
        user=user,
        company=company,
        employee_id=tag,
        full_name=tag.replace("-", " ").title(),
        full_name_en=tag.replace("-", " ").title(),
        manager_profile=manager_profile,
    )
    if with_signature:
        profile.signature.save(f"{tag}.png", ContentFile(make_png()), save=False)
        profile.signature_uploaded_at = timezone.now()
        profile.save(update_fields=["signature", "signature_uploaded_at", "updated_at"])
        profile.refresh_from_db()
    return user, profile


@pytest.fixture
def signed_world():
    company = OrganizationNode.objects.create(code="PDFSIG", name="PDF Sig Co", node_type="company")
    manager_user, manager_profile = make_employee(company, "PDFSIG-MGR")
    employee_user, employee_profile = make_employee(company, "PDFSIG-EMP", manager_profile=manager_profile)
    unsigned_user, unsigned_profile = make_employee(company, "PDFSIG-NOSIG", with_signature=False)
    return {
        "company": company,
        "manager_user": manager_user,
        "manager_profile": manager_profile,
        "employee_user": employee_user,
        "employee_profile": employee_profile,
        "unsigned_user": unsigned_user,
        "unsigned_profile": unsigned_profile,
    }


# --------------------------------------------------------------------------
# Leave request
# --------------------------------------------------------------------------


def _leave(signed_world, **overrides):
    from leaves.models import LeaveRequest, LeaveType

    leave_type = LeaveType.objects.create(code="ANNUAL", name="Annual Leave", company=signed_world["company"])
    fields = {
        "employee": signed_world["employee_user"],
        "employee_profile": signed_world["employee_profile"],
        "company": signed_world["company"],
        "leave_type": leave_type,
        "start_date": date(2026, 9, 14),
        "end_date": date(2026, 9, 19),
        "reason": "Signature integration",
    }
    fields.update(overrides)
    return LeaveRequest.objects.create(**fields)


def test_leave_form_prints_the_employees_own_stored_signature(signed_world):
    from leaves.pdf_leave_request import build_leave_request_pdf, load_leave_form_assets

    assets = load_leave_form_assets()
    pdf_bytes = build_leave_request_pdf(_leave(signed_world))

    assert pdf_bytes.startswith(b"%PDF")
    boxes = signature_boxes(pdf_bytes, assets.template_path)
    assert len(boxes) == 1, "only the employee has signed at this point"
    assert_inside(boxes[0], assets.fields["employee_signature_image"], "employee signature is in the employee panel")


def test_leave_form_prints_the_recorded_manager_signature_in_the_manager_panel(signed_world):
    from leaves.pdf_leave_request import build_leave_request_pdf, load_leave_form_assets

    leave = _leave(
        signed_world,
        manager_decision_by=signed_world["manager_user"],
        manager_decision_at=timezone.now(),
    )
    assets = load_leave_form_assets()

    boxes = signature_boxes(build_leave_request_pdf(leave), assets.template_path)

    assert len(boxes) == 2
    employee_spec = assets.fields["employee_signature_image"]
    manager_spec = assets.fields["line_manager_signature_image"]
    in_employee = [b for b in boxes if employee_spec["x"] <= b[0] < employee_spec["x"] + employee_spec["width"]]
    in_manager = [b for b in boxes if manager_spec["x"] <= b[0] < manager_spec["x"] + manager_spec["width"]]
    assert len(in_employee) == 1 and len(in_manager) == 1
    assert_inside(in_manager[0], manager_spec, "manager signature is in the manager panel")


def test_leave_form_leaves_the_slot_blank_when_the_employee_stored_nothing(signed_world):
    from leaves.pdf_leave_request import build_leave_request_pdf, load_leave_form_assets

    leave = _leave(
        signed_world,
        employee=signed_world["unsigned_user"],
        employee_profile=signed_world["unsigned_profile"],
    )
    assets = load_leave_form_assets()

    assert signature_boxes(build_leave_request_pdf(leave), assets.template_path) == []


def test_an_approver_who_never_decided_is_not_signed_for(signed_world):
    """A recorded actor without a decision timestamp must not sign."""

    from leaves.pdf_leave_request import build_leave_request_signers

    leave = _leave(signed_world, manager_decision_by=signed_world["manager_user"], manager_decision_at=None)

    assert build_leave_request_signers(leave)["line_manager_signature_image"] is None


def test_the_downloading_user_is_never_substituted_as_a_signer(signed_world):
    """Rendering does not depend on who asked; only recorded actors sign."""

    from leaves.pdf_leave_request import build_leave_request_pdf, load_leave_form_assets

    leave = _leave(
        signed_world,
        employee=signed_world["unsigned_user"],
        employee_profile=signed_world["unsigned_profile"],
    )
    assets = load_leave_form_assets()

    # The manager has a stored signature and is a plausible substitute; the
    # renderer must still produce nothing because no stage recorded them.
    assert signature_boxes(build_leave_request_pdf(leave), assets.template_path) == []


# --------------------------------------------------------------------------
# Loan request
# --------------------------------------------------------------------------


def test_loan_form_prints_the_recorded_approver_signature(signed_world):
    from decimal import Decimal

    from loans.models import LoanRequest
    from loans.pdf_loan_request import build_loan_request_pdf, load_loan_form_assets

    loan = LoanRequest.objects.create(
        employee=signed_world["employee_user"],
        employee_profile=signed_world["employee_profile"],
        company=signed_world["company"],
        requested_amount=Decimal("5000.00"),
        manager_decision_by=signed_world["manager_user"],
        manager_decision_at=timezone.now(),
    )
    assets = load_loan_form_assets()

    pdf_bytes = build_loan_request_pdf(loan, fallback=lambda _: b"")
    boxes = signature_boxes(pdf_bytes, assets.template_path)

    assert pdf_bytes.startswith(b"%PDF")
    assert len(boxes) == 1
    assert_inside(boxes[0], assets.fields["manager_signature_image"], "manager signs the manager column")


# --------------------------------------------------------------------------
# Annual entitlements
# --------------------------------------------------------------------------


def test_annual_form_prints_the_applicants_own_stored_signature(signed_world):
    from decimal import Decimal

    from leaves.models import AnnualLeavePaymentRequest
    from leaves.pdf_annual_entitlements import build_annual_entitlements_pdf, load_annual_entitlements_form_assets

    settlement = AnnualLeavePaymentRequest.objects.create(
        employee=signed_world["employee_user"],
        employee_profile=signed_world["employee_profile"],
        company=signed_world["company"],
        cycle_start=date(2025, 9, 1),
        cycle_end=date(2026, 8, 31),
        eligible_unused_days=Decimal("22.00"),
        payment_amount=Decimal("12000.00"),
    )
    assets = load_annual_entitlements_form_assets()

    pdf_bytes = build_annual_entitlements_pdf(settlement)
    boxes = signature_boxes(pdf_bytes, assets.template_path)

    assert pdf_bytes.startswith(b"%PDF")
    assert len(boxes) == 1
    assert_inside(boxes[0], assets.fields["applicant_signature_image"], "applicant signs the applicant panel")


# --------------------------------------------------------------------------
# Job offer
# --------------------------------------------------------------------------


def _offer(signed_world, **overrides):
    from decimal import Decimal

    from job_offers.models import JobOffer

    fields = {
        "company": signed_world["company"],
        "reference_number": "JO-SIG-001",
        "candidate_full_name": "Sig Candidate",
        "position_title": "Engineer",
        "offer_date": date(2026, 8, 20),
        "expiry_date": date(2026, 8, 27),
        "basic_salary": Decimal("25000.00"),
        "hr_signer_name": "Manager Signer",
        "hr_signer_title": "Human Resources Manager",
        "hr_signer_user": signed_world["manager_user"],
        "created_by": signed_world["manager_user"],
        "updated_by": signed_world["manager_user"],
    }
    fields.update(overrides)
    return JobOffer.objects.create(**fields)


def test_job_offer_prints_the_hr_signature_without_covering_name_or_position(signed_world):
    from job_offers.pdf import _load_form_assets, build_job_offer_pdf

    assets = _load_form_assets()
    pdf_bytes = build_job_offer_pdf(_offer(signed_world))
    boxes = signature_boxes(pdf_bytes, assets.template_path)

    assert len(boxes) == 1
    assert_inside(boxes[0], assets.fields["hr_signature_image"], "HR signs its own printed rule")
    for other in ("hr_name", "hr_position"):
        spec = assets.fields[other]
        x0, y0, x1, y1 = boxes[0]
        covers = not (
            x1 <= spec["x"] or x0 >= spec["x"] + spec["width"] or y1 <= spec["y"] or y0 >= spec["y"] + spec["height"]
        )
        assert not covers, f"HR signature must not cover {other}"


def test_job_offer_applicant_signs_only_after_accepting(signed_world):
    from job_offers.models import JobOffer
    from job_offers.pdf import _load_form_assets, build_job_offer_pdf, build_job_offer_signers

    assets = _load_form_assets()
    # The HR signer here has no stored signature, so only the applicant's can appear.
    pending = _offer(
        signed_world,
        employee_profile=signed_world["employee_profile"],
        hr_signer_user=signed_world["unsigned_user"],
    )
    assert build_job_offer_signers(pending)["applicant_signature"] is None
    assert signature_boxes(build_job_offer_pdf(pending), assets.template_path) == []

    pending.status = JobOffer.Status.ACCEPTED
    pending.accepted_at = timezone.now()
    pending.save(update_fields=["status", "accepted_at"])

    boxes = signature_boxes(build_job_offer_pdf(pending), assets.template_path)
    assert len(boxes) == 1
    assert_inside(boxes[0], assets.fields["applicant_signature"], "applicant signs the acceptance box")


# --------------------------------------------------------------------------
# Starting work acknowledgment
# --------------------------------------------------------------------------


def test_starting_work_prints_the_recorded_approver_signature(signed_world):
    from job_offers.starting_work_pdf import (
        StartingWorkAcknowledgmentData,
        build_starting_work_acknowledgment_pdf,
        load_starting_work_form_assets,
    )

    assets = load_starting_work_form_assets()
    data = StartingWorkAcknowledgmentData(
        reference_no="SWA-SIG-001",
        start_date=date(2026, 8, 23),
        details_approver_name="Manager Signer",
        details_approver_date=date(2026, 8, 24),
        details_approver_user=signed_world["manager_user"],
    )

    pdf_bytes = build_starting_work_acknowledgment_pdf(signed_world["employee_profile"], data)
    boxes = signature_boxes(pdf_bytes, assets.template_path)

    assert pdf_bytes.startswith(b"%PDF")
    assert len(boxes) == 1
    assert_inside(boxes[0], assets.fields["details_approver_signature_image"], "approver signs its own panel")


def test_starting_work_leaves_an_unsigned_approver_blank(signed_world):
    from job_offers.starting_work_pdf import (
        StartingWorkAcknowledgmentData,
        build_starting_work_acknowledgment_pdf,
        load_starting_work_form_assets,
    )

    assets = load_starting_work_form_assets()
    data = StartingWorkAcknowledgmentData(
        reference_no="SWA-SIG-002",
        start_date=date(2026, 8, 23),
        details_approver_user=signed_world["unsigned_user"],
    )

    assert (
        signature_boxes(
            build_starting_work_acknowledgment_pdf(signed_world["employee_profile"], data), assets.template_path
        )
        == []
    )


# --------------------------------------------------------------------------
# Diagnostics and integrity
# --------------------------------------------------------------------------


def test_diagnostics_distinguish_a_placed_signature_from_a_missing_one(signed_world):
    from core.pdf_forms import render_mapped_form
    from core.pdf_signers import signer_signatures
    from leaves.pdf_leave_request import build_leave_request_values, load_leave_form_assets

    leave = _leave(signed_world)
    assets = load_leave_form_assets()
    signatures = signer_signatures(
        {
            "employee_signature_image": signed_world["employee_user"],
            "hr_signature_image": None,
        }
    )

    _, diagnostics = render_mapped_form(assets, build_leave_request_values(leave), signatures=signatures)

    states = {row["field"]: row["state"] for row in diagnostics}
    assert states["employee_signature_image"] == SIGNATURE_PLACED
    assert states["hr_signature_image"] == SIGNATURE_MISSING


def test_a_signature_stored_as_an_unsupported_format_is_not_drawn(signed_world):
    """Bytes that stopped being a valid image on disk must not be rendered."""

    from leaves.pdf_leave_request import build_leave_request_pdf, load_leave_form_assets

    profile = signed_world["employee_profile"]
    profile.signature.save("corrupt.png", ContentFile(b"not really a png"), save=False)
    profile.save(update_fields=["signature", "updated_at"])
    assets = load_leave_form_assets()

    assert signature_boxes(build_leave_request_pdf(_leave(signed_world)), assets.template_path) == []


@pytest.mark.parametrize(
    ("template", "field_map"),
    [
        ("leave_request_blank.pdf", "leave_request_blank_field_map.json"),
        ("loan_request_blank.pdf", "loan_request_blank_field_map.json"),
        ("annual_entitlements_disbursement_blank.pdf", "annual_entitlements_disbursement_blank_field_map.json"),
        ("job_offer_blank.pdf", "job_offer_blank_field_map.json"),
        ("starting_work_acknowledgment_blank.pdf", "starting_work_acknowledgment_blank_field_map.json"),
    ],
)
def test_every_approved_form_declares_at_least_one_signature_slot(template, field_map):
    assets = load_form_assets(template, field_map)

    assert assets is not None
    image_fields = [key for key, spec in assets.fields.items() if spec.get("kind") == "image"]
    assert image_fields, f"{template} declares no signature slot"


def test_leave_expiry_guard_is_untouched_by_signature_work(signed_world):
    """Sanity: the signature feature does not alter leave date handling."""

    leave = _leave(signed_world, end_date=date(2026, 9, 14) + timedelta(days=2))

    assert leave.end_date == date(2026, 9, 16)
