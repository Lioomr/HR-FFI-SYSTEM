"""Approved annual-entitlements (settlement) PDFs are frozen, sealed, signed and verifiable.

Mirrors ``loans/test_document_integrity.py`` for ``AnnualLeavePaymentRequest``
(employee or HR files -> HR review -> CEO): the PDF is frozen once, at the CEO
approval, for both final statuses (``approved`` and ``carried_forward``); the
download serves that copy; tampering is detected and never served; HR alone gets
the approval-trail work paper; the integrity endpoints answer only the people
involved (or HR in the company); verify-upload names the settlement.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from io import BytesIO
from unittest import mock

import pytest
from cryptography.fernet import Fernet
from cryptography.x509.oid import ExtendedKeyUsageOID
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign import timestamps
from pyhanko.sign.validation import validate_pdf_signature
from pyhanko_certvalidator import ValidationContext
from pypdf import PdfReader, PdfWriter
from rest_framework.test import APIClient

from audit.models import AuditLog
from core.document_integrity import crypto
from core.document_integrity.backends import get_signing_backend
from core.document_integrity.models import DocumentApprovalSignature, DocumentIntegrityEvent, FrozenDocument
from core.document_integrity.services import get_frozen_document
from core.tests_pdf_forms import make_png
from employees.models import EmployeeProfile
from leaves.annual_document_integrity import annual_payment_stage_signers
from leaves.annual_payment_services import (
    apply_annual_payment_ceo_approval,
    apply_annual_payment_ceo_rejection,
    apply_annual_payment_hr_review,
    record_annual_payment_submission,
)
from leaves.models import AnnualLeavePaymentRequest
from organization.models import OrganizationNode, UserOrganizationAccess
from organization.services import get_default_company

pytestmark = pytest.mark.django_db

User = get_user_model()
Status = AnnualLeavePaymentRequest.Status
FERNET_KEY = Fernet.generate_key().decode()
RENDER = "leaves.views._build_annual_entitlements_pdf"
BASE = "/api/leaves/annual-leave-payments"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def signing_key_dir(tmp_path_factory):
    return tmp_path_factory.mktemp("annual_signing_keys")


@pytest.fixture
def signing(settings, signing_key_dir):
    settings.SECURE_SSL_REDIRECT = False
    settings.DOCUMENT_SIGNING_MODE = "freeze"
    settings.DOCUMENT_SIGNING_BACKEND = "local"
    settings.DOCUMENT_SIGNING_KEY_DIR = str(signing_key_dir)
    settings.DOCUMENT_SIGNING_DEV_AUTOGENERATE = True
    settings.DOCUMENT_SIGNING_KEY_ENCRYPTION_KEY = FERNET_KEY
    settings.DOCUMENT_SIGNING_SEAL_ASYNC = False
    settings.DOCUMENT_SIGNING_TSA_URL = ""
    settings.DOCUMENT_SIGNING_SEAL_PKCS12_PATH = ""
    settings.DOCUMENT_SIGNING_CA_CERT_PATH = ""
    return settings


@pytest.fixture(scope="session")
def dummy_tsa():
    """An in-process RFC 3161 TSA so no test touches the network."""

    key = crypto.generate_key()
    cert = crypto.build_certificate(
        subject=crypto.build_name("Annual Test TSA"),
        public_key=key.public_key(),
        issuer_cert=None,
        issuer_key=key,
        days=30,
        extended_usages=[ExtendedKeyUsageOID.TIME_STAMPING],
    )
    return timestamps.DummyTimeStamper(tsa_cert=crypto.to_asn1_cert(cert), tsa_key=crypto.to_asn1_key(key))


def _profile(user, company, employee_id, *, name, signed=True):
    profile = EmployeeProfile.objects.create(
        user=user,
        company=company,
        employee_id=employee_id,
        full_name=name,
        full_name_en=name,
        department="Operations",
        job_title="Staff",
        hire_date=date(2021, 1, 1),
    )
    if signed:
        profile.signature.save(f"{employee_id}.png", ContentFile(make_png()), save=False)
        profile.signature_uploaded_at = timezone.now()
        profile.save(update_fields=["signature", "signature_uploaded_at", "updated_at"])
    return profile


@pytest.fixture
def world(signing):
    company = get_default_company()
    groups = {name: Group.objects.get_or_create(name=name)[0] for name in ("HRManager", "CEO")}

    def make(key, number, name, group=None):
        user = User.objects.create_user(email=f"ae-{key}@ffi.test", password="pw")
        _profile(user, company, f"AEI-{number:04d}", name=name)
        if group:
            user.groups.add(groups[group])
        if group == "HRManager":
            UserOrganizationAccess.objects.create(user=user, organization=company)
        return user

    return {
        "company": company,
        "employee": make("employee", 1, "Employee Essa"),
        "hr": make("hr", 2, "Hr Hala", "HRManager"),
        "ceo": make("ceo", 3, "Ceo Camil", "CEO"),
        "other_ceo": make("other-ceo", 4, "Ceo Other", "CEO"),
        "outsider": make("outsider", 5, "Outsider Olfa"),
    }


def _create(world, *, filed_by=None, status=Status.PENDING_HR, **fields):
    employee = world["employee"]
    return AnnualLeavePaymentRequest.objects.create(
        employee=employee,
        employee_profile=employee.employee_profile,
        company=world["company"],
        cycle_start=date(2025, 9, 1),
        cycle_end=date(2026, 8, 31),
        eligible_unused_days=Decimal("10.00"),
        payment_amount=Decimal("1000.00"),
        submitted_by=filed_by or employee,
        status=status,
        **fields,
    )


def _submit(world, capture):
    with capture(execute=True):
        payment = _create(world)
        record_annual_payment_submission(payment, actor=world["employee"])
    return payment


def _review(world, payment, capture, decision="forward"):
    with capture(execute=True):
        return apply_annual_payment_hr_review(payment, actor=world["hr"], decision=decision, comment="Checked")


def _ceo_approve(world, payment, capture):
    with capture(execute=True):
        payment = apply_annual_payment_ceo_approval(payment, actor=world["ceo"], note="OK")
    payment.refresh_from_db()
    return payment


def _approve_all(world, capture, decision="forward"):
    payment = _review(world, _submit(world, capture), capture, decision)
    return _ceo_approve(world, payment, capture)


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _get(user, url, company=None, **kwargs):
    company_id = company.pk if company is not None else get_default_company().pk
    return _client(user).get(url, HTTP_X_ACTIVE_COMPANY_ID=str(company_id), **kwargs)


def _post(user, url):
    return _client(user).post(url, HTTP_X_ACTIVE_COMPANY_ID=str(get_default_company().pk))


def _download(user, payment, query=""):
    return _get(user, f"{BASE}/{payment.id}/pdf/{query}")


def _integrity_url(payment):
    return f"{BASE}/{payment.id}/integrity/"


def _stored_bytes(document):
    document.file.open("rb")
    try:
        return document.file.read()
    finally:
        document.file.close()


def _overwrite_stored(document, data: bytes):
    with open(document.file.path, "wb") as handle:
        handle.write(data)


def _tamper(data: bytes) -> bytes:
    assert b"/Producer" in data
    return data.replace(b"/Producer", b"/Producar", 1)


def _pdf_text(data: bytes) -> str:
    return "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(data)).pages)


def _validate_with_dev_root(data: bytes):
    root = crypto.to_asn1_cert(get_signing_backend().trust_roots()[0])
    reader = PdfFileReader(BytesIO(data))
    return [
        validate_pdf_signature(sig, ValidationContext(trust_roots=[root], allow_fetching=False))
        for sig in reader.embedded_signatures
    ]


# ---------------------------------------------------------------------------
# Freeze
# ---------------------------------------------------------------------------


def test_settlement_is_frozen_only_at_the_ceo_approval(world, django_capture_on_commit_callbacks):
    capture = django_capture_on_commit_callbacks
    payment = _review(world, _submit(world, capture), capture)
    assert payment.status == Status.PENDING_CEO
    assert get_frozen_document(payment) is None, "pending CEO: not final yet"

    payment = _ceo_approve(world, payment, capture)

    document = get_frozen_document(payment)
    assert payment.status == Status.APPROVED
    assert document is not None
    assert document.document_type == "annual_leave_payment_request"
    assert document.reference.startswith("AED-AEI-0001"), document.reference
    assert document.signing_mode == "freeze"
    data = _stored_bytes(document)
    assert crypto.sha256_hex(data) == document.sha256
    assert DocumentIntegrityEvent.objects.filter(document=document, event="frozen").count() == 1
    assert AuditLog.objects.filter(
        action="document_frozen", entity="annual_leave_payment_request", entity_id=str(payment.id)
    ).exists()
    assert "Approval Trail" not in _pdf_text(data)
    assert PdfReader(BytesIO(data)).metadata["/FFIDocumentRef"] == (
        f"annual_leave_payment_request:{payment.id}:{document.reference}"
    )


def test_carried_forward_settlement_is_frozen_too(world, django_capture_on_commit_callbacks):
    payment = _approve_all(world, django_capture_on_commit_callbacks, decision="carry_forward")

    assert payment.status == Status.CARRIED_FORWARD
    assert get_frozen_document(payment) is not None


def test_ceo_rejection_is_never_frozen(world, django_capture_on_commit_callbacks):
    capture = django_capture_on_commit_callbacks
    payment = _review(world, _submit(world, capture), capture)
    with capture(execute=True):
        payment = apply_annual_payment_ceo_rejection(payment, actor=world["ceo"], comment="No budget")

    assert payment.status == Status.REJECTED
    assert get_frozen_document(payment) is None


def test_hr_filed_settlement_is_attributed_to_the_hr_filer(world, django_capture_on_commit_callbacks):
    capture = django_capture_on_commit_callbacks
    with capture(execute=True):
        payment = _create(
            world,
            filed_by=world["hr"],
            status=Status.PENDING_CEO,
            hr_reviewed_by=world["hr"],
            hr_reviewed_at=timezone.now(),
            hr_review_note="HR settlement decision",
        )
        record_annual_payment_submission(payment, actor=world["hr"])
    payment = _ceo_approve(world, payment, capture)

    assert get_frozen_document(payment) is not None
    assert [(s.role, s.actor) for s in annual_payment_stage_signers(payment)] == [
        ("hr_manual", world["hr"]),
        ("hr", world["hr"]),
        ("ceo", world["ceo"]),
    ]
    text = _pdf_text(_download(world["hr"], payment, "?workpaper=1").content)
    assert "HR (for employee)" in text and "Ceo Camil" in text, text[-1500:]


def test_finalize_failure_never_undoes_the_approval(world, django_capture_on_commit_callbacks):
    capture = django_capture_on_commit_callbacks
    payment = _review(world, _submit(world, capture), capture)
    with mock.patch("core.document_integrity.services.finalize_document", side_effect=RuntimeError("disk full")):
        payment = _ceo_approve(world, payment, capture)

    assert payment.status == Status.APPROVED
    assert payment.settled_at is not None
    assert get_frozen_document(payment) is None


def test_mode_off_keeps_rendering_live(world, signing, django_capture_on_commit_callbacks):
    signing.DOCUMENT_SIGNING_MODE = "off"
    payment = _approve_all(world, django_capture_on_commit_callbacks)

    assert get_frozen_document(payment) is None


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------


def test_pdf_serves_the_frozen_copy_without_rendering(world, django_capture_on_commit_callbacks):
    payment = _approve_all(world, django_capture_on_commit_callbacks)
    stored = _stored_bytes(get_frozen_document(payment))

    for user in (world["employee"], world["hr"], world["ceo"]):
        with mock.patch(RENDER, side_effect=AssertionError("re-rendered")):
            response = _download(user, payment)
        assert response.status_code == 200
        assert response.content == stored
        assert response["Content-Type"] == "application/octet-stream"
        assert response["Content-Disposition"] == f'attachment; filename="annual_entitlements_{payment.id}.pdf"'
        assert response["Cache-Control"] == "private, no-store"
        assert response["X-Content-Type-Options"] == "nosniff"
    assert DocumentIntegrityEvent.objects.filter(event="downloaded", document__object_id=payment.id).count() == 3
    assert AuditLog.objects.filter(action="annual_leave_payment_exported_pdf", entity_id=str(payment.id)).count() == 3


def test_signature_change_after_approval_does_not_change_the_document(world, django_capture_on_commit_callbacks):
    payment = _approve_all(world, django_capture_on_commit_callbacks)
    before = _download(world["employee"], payment).content

    profile = world["hr"].employee_profile
    profile.signature.save("replacement.png", ContentFile(make_png(width=300, height=90)), save=False)
    employee_profile = world["employee"].employee_profile
    employee_profile.full_name_en = "Renamed Employee"
    employee_profile.full_name = "Renamed Employee"
    profile.save(update_fields=["signature", "updated_at"])
    employee_profile.save(update_fields=["full_name", "full_name_en", "updated_at"])

    after = _download(world["employee"], payment).content
    assert after == before
    assert "Renamed Employee" not in _pdf_text(after)


def test_in_progress_settlements_still_render_live(world, django_capture_on_commit_callbacks):
    capture = django_capture_on_commit_callbacks
    payment = _review(world, _submit(world, capture), capture)
    with mock.patch(RENDER, return_value=b"%PDF-live") as render:
        response = _download(world["hr"], payment, "?workpaper=1")

    assert response.status_code == 200
    assert response.content == b"%PDF-live"
    render.assert_called_once()


def test_hr_work_paper_appends_a_live_trail_in_the_viewers_timezone(world, django_capture_on_commit_callbacks):
    payment = _approve_all(world, django_capture_on_commit_callbacks)
    document = get_frozen_document(payment)

    paper = _download(world["hr"], payment, "?workpaper=1&tz=Pacific/Auckland")
    text = _pdf_text(paper.content)
    assert paper["Content-Disposition"] == f'attachment; filename="annual_entitlements_{payment.id}_workpaper.pdf"'
    assert "Approval Trail" in text
    for name in ("Employee Essa", "Hr Hala", "Ceo Camil"):
        assert name in text
    assert "+13" not in text and "+12" not in text and "UTC" not in text

    for viewer in (world["employee"], world["ceo"]):
        plain = _download(viewer, payment, "?workpaper=1")
        assert "Approval Trail" not in _pdf_text(plain.content)
        assert crypto.sha256_hex(plain.content) == document.sha256


def test_tampered_or_missing_file_is_detected_and_never_served(world, django_capture_on_commit_callbacks):
    payment = _approve_all(world, django_capture_on_commit_callbacks)
    document = get_frozen_document(payment)
    _overwrite_stored(document, _tamper(_stored_bytes(document)))

    url = _integrity_url(payment)
    assert _get(world["hr"], url).data["data"]["status"] == "tampered"
    verify = _post(world["hr"], f"{url}verify/")
    assert verify.status_code == 200
    assert verify.data["data"]["status"] == "tampered"
    assert verify.data["data"]["events"][0]["event"] == "verified"
    with mock.patch(RENDER, side_effect=AssertionError("re-rendered")):
        assert _download(world["employee"], payment).status_code == 409
    assert AuditLog.objects.filter(
        action="document_download_blocked", entity="annual_leave_payment_request", entity_id=str(payment.id)
    ).exists()
    assert not AuditLog.objects.filter(action="annual_leave_payment_exported_pdf", entity_id=str(payment.id)).exists()

    document.file.storage.delete(document.file.name)
    assert _get(world["hr"], url).data["data"]["status"] == "missing_file"


def test_settlements_approved_before_rollout_report_not_frozen(world):
    payment = _create(world, status=Status.APPROVED)

    data = _get(world["employee"], _integrity_url(payment)).data["data"]

    assert data["status"] == "not_frozen"
    assert data["sha256"] is None and data["frozen_at"] is None
    assert data["events"] == []
    assert set(data) == {"status", "frozen_at", "sha256", "signing_mode", "seal", "signatures", "events"}


def test_frozen_settlement_verifies_clean(world, django_capture_on_commit_callbacks):
    payment = _approve_all(world, django_capture_on_commit_callbacks)

    data = _post(world["employee"], f"{_integrity_url(payment)}verify/").data["data"]

    assert data["status"] == "frozen_valid"
    assert data["sha256"] == get_frozen_document(payment).sha256
    assert {e["event"] for e in data["events"]} >= {"frozen", "verified"}
    assert data["events"][0]["by"] == "Employee Essa"
    assert all("by_profile_id" not in e for e in data["events"]), "profile ids are for HR only"


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------


def test_integrity_is_visible_to_owner_approvers_and_hr_only(world, django_capture_on_commit_callbacks):
    payment = _approve_all(world, django_capture_on_commit_callbacks)
    url = _integrity_url(payment)

    for key in ("employee", "hr", "ceo"):
        assert _get(world[key], url).status_code == 200, key
    assert _get(world["other_ceo"], url).status_code == 404, "a CEO who did not decide it"
    assert _get(world["outsider"], url).status_code == 404
    assert _post(world["outsider"], f"{url}verify/").status_code == 404
    assert APIClient().get(url).status_code == 401
    assert _post(world["ceo"], f"{url}retry-seal/").status_code == 403
    assert _post(world["employee"], f"{url}retry-seal/").status_code == 403
    assert _post(world["hr"], f"{url}retry-seal/").status_code == 422, "frozen, not sealing"

    hr_events = _get(world["hr"], url).data["data"]["events"]
    assert hr_events and "by_profile_id" in hr_events[0]


def test_hr_of_another_company_gets_404(world, django_capture_on_commit_callbacks):
    payment = _approve_all(world, django_capture_on_commit_callbacks)
    other = OrganizationNode.objects.create(code="AE-OTHER", name="Other Co", node_type="company")
    foreign_hr = User.objects.create_user(email="ae-foreign-hr@ffi.test", password="pw")
    _profile(foreign_hr, other, "AEO-0001", name="Foreign Hr", signed=False)
    foreign_hr.groups.add(Group.objects.get(name="HRManager"))
    UserOrganizationAccess.objects.create(user=foreign_hr, organization=other)

    assert _get(foreign_hr, _integrity_url(payment), company=other).status_code == 404
    assert _get(foreign_hr, f"{BASE}/{payment.id}/pdf/", company=other).status_code == 404


# ---------------------------------------------------------------------------
# Upload verification
# ---------------------------------------------------------------------------


def _upload(user, data: bytes):
    return _client(user).post(
        "/api/documents/verify-upload/",
        {"file": SimpleUploadedFile("annual.pdf", data, content_type="application/pdf")},
        format="multipart",
        HTTP_X_ACTIVE_COMPANY_ID=str(get_default_company().pk),
    )


def test_verify_upload_matches_and_flags_a_settlement(world, django_capture_on_commit_callbacks):
    payment = _approve_all(world, django_capture_on_commit_callbacks)
    document = get_frozen_document(payment)
    stored = _stored_bytes(document)

    data = _upload(world["hr"], stored).data["data"]
    assert data["matched_record"] == {"type": "annual_entitlement", "id": payment.id, "reference": document.reference}
    assert data["integrity"]["status"] == "frozen_valid"

    modified = _upload(world["hr"], _tamper(stored)).data["data"]
    assert modified["matched_record"]["type"] == "annual_entitlement"
    assert modified["integrity"]["status"] == "tampered"


def test_verify_upload_matches_an_edited_copy_by_its_visible_reference(world, django_capture_on_commit_callbacks):
    payment = _approve_all(world, django_capture_on_commit_callbacks)
    document = get_frozen_document(payment)
    edited = PdfWriter()
    for page in PdfReader(BytesIO(_stored_bytes(document))).pages:
        edited.add_page(page)
    edited.add_metadata({"/Producer": "Canva"})
    buffer = BytesIO()
    edited.write(buffer)

    data = _upload(world["hr"], buffer.getvalue()).data["data"]
    assert data["matched_record"] == {"type": "annual_entitlement", "id": payment.id, "reference": document.reference}
    assert data["integrity"]["status"] == "tampered"


# ---------------------------------------------------------------------------
# Seal and personal signatures
# ---------------------------------------------------------------------------


def test_seal_mode_applies_a_timestamped_organization_seal(
    world, signing, dummy_tsa, django_capture_on_commit_callbacks
):
    signing.DOCUMENT_SIGNING_MODE = "seal"
    with mock.patch("core.document_integrity.pdf_signing.build_timestamper", return_value=dummy_tsa):
        payment = _approve_all(world, django_capture_on_commit_callbacks)

    document = get_frozen_document(payment)
    assert document.seal_status == FrozenDocument.SealStatus.SEALED
    statuses = _validate_with_dev_root(_stored_bytes(document))
    assert len(statuses) == 1 and statuses[0].intact and statuses[0].valid
    data = _get(world["employee"], _integrity_url(payment)).data["data"]
    assert data["status"] == "sealed_valid"
    assert data["seal"]["timestamped"] is True


def test_personal_mode_signs_each_stage_in_order_then_seals(
    world, signing, dummy_tsa, django_capture_on_commit_callbacks
):
    signing.DOCUMENT_SIGNING_MODE = "personal"
    with mock.patch("core.document_integrity.pdf_signing.build_timestamper", return_value=dummy_tsa):
        payment = _approve_all(world, django_capture_on_commit_callbacks)

    document = get_frozen_document(payment)
    assert document.seal_status == FrozenDocument.SealStatus.SEALED
    statuses = _validate_with_dev_root(_stored_bytes(document))
    assert len(statuses) == 4, "employee, HR, CEO, then the seal"
    assert all(s.intact and s.valid for s in statuses)

    attestations = DocumentApprovalSignature.objects.filter(
        document_type="annual_leave_payment_request", object_id=payment.id
    ).order_by("id")
    assert [(a.role, a.actor_id) for a in attestations] == [
        ("employee", world["employee"].id),
        ("hr", world["hr"].id),
        ("ceo", world["ceo"].id),
    ]

    data = _get(world["hr"], _integrity_url(payment)).data["data"]
    assert data["status"] == "signed_valid"
    assert [s["role"] for s in data["signatures"]] == ["employee", "hr", "ceo"]
    assert [s["signer_name"] for s in data["signatures"]] == ["Employee Essa", "Hr Hala", "Ceo Camil"]
    assert all(s.get("profile_id") for s in data["signatures"]), "HR sees profile ids"
    owner_view = _get(world["employee"], _integrity_url(payment)).data["data"]
    assert all("profile_id" not in s for s in owner_view["signatures"]), "profile ids are for HR only"
