"""Approved leave PDFs are frozen, sealed, signed and verifiable.

Covers the rules in ``core.document_integrity``: the PDF is frozen exactly once
at the last approval stage, downloads serve that copy (so later signature or
profile edits cannot change it), tampering is detected, the seal and personal
signatures validate with pyHanko, revoked certificates are reported, and only
the people involved (or HR) can see a document's integrity status.
"""

from __future__ import annotations

from datetime import date
from io import BytesIO
from unittest import mock

import pytest
from asn1crypto import x509 as asn1_x509  # noqa: F401  (pyHanko dependency sanity)
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
from pypdf import PdfReader
from rest_framework.test import APIClient

from audit.models import AuditLog
from core.document_integrity import crypto
from core.document_integrity.backends import get_signing_backend
from core.document_integrity.models import (
    DocumentApprovalSignature,
    DocumentIntegrityEvent,
    FrozenDocument,
    SigningCertificate,
)
from core.document_integrity.services import get_frozen_document, verify_attestation
from core.tests_pdf_forms import make_png
from employees.models import EmployeeProfile
from leaves.models import LeaveRequest, LeaveType
from leaves.services import (
    apply_ceo_approval,
    apply_hr_approval,
    apply_hr_completion,
    apply_manager_approval,
    record_leave_submission,
)
from organization.models import OrganizationNode, UserOrganizationAccess
from organization.services import get_default_company

pytestmark = pytest.mark.django_db

User = get_user_model()
Status = LeaveRequest.RequestStatus
FERNET_KEY = Fernet.generate_key().decode()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def signing_key_dir(tmp_path_factory):
    return tmp_path_factory.mktemp("signing_keys")


@pytest.fixture
def signing(settings, signing_key_dir):
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
        subject=crypto.build_name("Test TSA"),
        public_key=key.public_key(),
        issuer_cert=None,
        issuer_key=key,
        days=30,
        extended_usages=[ExtendedKeyUsageOID.TIME_STAMPING],
    )
    return timestamps.DummyTimeStamper(tsa_cert=crypto.to_asn1_cert(cert), tsa_key=crypto.to_asn1_key(key))


def _profile(user, company, employee_id, *, name, manager_profile=None, signed=True, is_saudi=True):
    profile = EmployeeProfile.objects.create(
        user=user,
        company=company,
        employee_id=employee_id,
        full_name=name,
        full_name_en=name,
        department="Ops",
        job_title="Staff",
        hire_date=date(2021, 1, 1),
        manager_profile=manager_profile,
        is_saudi=is_saudi,
    )
    if signed:
        profile.signature.save(f"{employee_id}.png", ContentFile(make_png()), save=False)
        profile.signature_uploaded_at = timezone.now()
        profile.save(update_fields=["signature", "signature_uploaded_at", "updated_at"])
    return profile


@pytest.fixture
def world(signing):
    company = get_default_company()
    hr_group, _ = Group.objects.get_or_create(name="HRManager")
    ceo_group, _ = Group.objects.get_or_create(name="CEO")
    leave_type, _ = LeaveType.objects.get_or_create(
        company=company, code="ANNUAL", defaults={"name": "Annual Leave", "is_active": True}
    )

    manager = User.objects.create_user(email="di-manager@ffi.test", password="pw")
    manager_profile = _profile(manager, company, "DI-MGR", name="Manager Mona")
    employee = User.objects.create_user(email="di-employee@ffi.test", password="pw")
    _profile(employee, company, "DI-EMP", name="Employee Eman", manager_profile=manager_profile)
    hr = User.objects.create_user(email="di-hr@ffi.test", password="pw")
    _profile(hr, company, "DI-HR", name="Hr Hala")
    hr.groups.add(hr_group)
    UserOrganizationAccess.objects.create(user=hr, organization=company)
    ceo = User.objects.create_user(email="di-ceo@ffi.test", password="pw")
    _profile(ceo, company, "DI-CEO", name="Ceo Camal")
    ceo.groups.add(ceo_group)
    outsider = User.objects.create_user(email="di-outsider@ffi.test", password="pw")
    _profile(outsider, company, "DI-OUT", name="Outsider Omar")
    unsigned = User.objects.create_user(email="di-unsigned@ffi.test", password="pw")
    _profile(unsigned, company, "DI-UNS", name="Unsigned Uthman", manager_profile=manager_profile, signed=False)
    return {
        "company": company,
        "leave_type": leave_type,
        "manager": manager,
        "employee": employee,
        "hr": hr,
        "ceo": ceo,
        "outsider": outsider,
        "unsigned": unsigned,
    }


def _submit(world, employee=None, **fields):
    employee = employee or world["employee"]
    leave = LeaveRequest.objects.create(
        employee=employee,
        employee_profile=employee.employee_profile,
        company=world["company"],
        leave_type=world["leave_type"],
        start_date=date(2027, 3, 1),
        end_date=date(2027, 3, 4),
        reason="Family visit",
        status=Status.PENDING_MANAGER,
        **fields,
    )
    record_leave_submission(leave, actor=employee)
    return leave


def _approve_all(world, leave, capture):
    with capture(execute=True):
        leave = apply_manager_approval(leave, actor=world["manager"]).instance
    with capture(execute=True):
        leave = apply_hr_approval(leave, actor=world["hr"]).instance
    with capture(execute=True):
        leave = apply_ceo_approval(leave, actor=world["ceo"]).instance
    leave.refresh_from_db()
    return leave


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


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
    """Change one uncompressed byte inside the document (same length)."""

    assert b"/Producer" in data
    return data.replace(b"/Producer", b"/Producar", 1)


def _pdf_text(data: bytes) -> str:
    return "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(data)).pages)


def _download(user, leave):
    response = _client(user).get(f"/api/leaves/leave-requests/{leave.id}/pdf/")
    return response, b"".join(response.streaming_content) if response.streaming else response.content


# ---------------------------------------------------------------------------
# Phase 1: freeze + hash + verify
# ---------------------------------------------------------------------------


def test_document_is_frozen_only_when_the_last_stage_completes(world, django_capture_on_commit_callbacks):
    leave = _submit(world)
    with django_capture_on_commit_callbacks(execute=True):
        leave = apply_manager_approval(leave, actor=world["manager"]).instance
    with django_capture_on_commit_callbacks(execute=True):
        leave = apply_hr_approval(leave, actor=world["hr"]).instance
    assert get_frozen_document(leave) is None, "an in-progress request is never frozen"

    with django_capture_on_commit_callbacks(execute=True):
        leave = apply_ceo_approval(leave, actor=world["ceo"]).instance

    document = get_frozen_document(leave)
    assert leave.status == Status.APPROVED
    assert document is not None
    assert document.signing_mode == "freeze"
    assert document.seal_status == FrozenDocument.SealStatus.NONE
    data = _stored_bytes(document)
    assert crypto.sha256_hex(data) == document.sha256
    assert document.reference == (leave.reference_no or f"LR-{leave.id:05d}")
    assert DocumentIntegrityEvent.objects.filter(document=document, event="frozen").count() == 1
    assert AuditLog.objects.filter(action="document_frozen", entity_id=str(leave.id)).exists()
    assert "Approval Trail" not in _pdf_text(data), "the trail is an HR work paper, not part of the stored form"
    assert PdfReader(BytesIO(data)).metadata["/FFIDocumentRef"] == f"leave_request:{leave.id}:{document.reference}"


def test_hr_work_paper_appends_a_live_trail_in_the_viewers_timezone(world, django_capture_on_commit_callbacks):
    leave = _submit(world)
    with django_capture_on_commit_callbacks(execute=True):
        leave = apply_manager_approval(leave, actor=world["manager"]).instance
    with django_capture_on_commit_callbacks(execute=True):
        leave = apply_hr_approval(leave, actor=world["hr"]).instance
    with django_capture_on_commit_callbacks(execute=True):
        leave = apply_ceo_approval(leave, actor=world["ceo"]).instance
    document = get_frozen_document(leave)

    base = "/api/leaves/leave-requests/%d/pdf/" % leave.id
    plain = _client(world["hr"]).get(base)
    assert "Approval Trail" not in _pdf_text(plain.content)
    assert crypto.sha256_hex(plain.content) == document.sha256

    paper = _client(world["hr"]).get(base + "?workpaper=1&tz=Pacific/Auckland")
    text = _pdf_text(paper.content)
    assert "Approval Trail" in text and "Manager Mona" in text and "Ceo Camal" in text
    assert "+13" not in text and "+12" not in text and "UTC" not in text

    # The trail is HR-only: the owner asking for it gets the plain frozen form.
    owner = _client(leave.employee).get(base + "?workpaper=1")
    assert "Approval Trail" not in _pdf_text(owner.content)
    assert crypto.sha256_hex(owner.content) == document.sha256


def test_hr_completion_is_the_last_stage_for_travellers(world, django_capture_on_commit_callbacks):
    traveller = world["unsigned"]
    traveller.employee_profile.is_saudi = False
    traveller.employee_profile.save(update_fields=["is_saudi", "updated_at"])
    leave = _submit(world, employee=traveller, will_travel=True)
    with django_capture_on_commit_callbacks(execute=True):
        leave = apply_manager_approval(leave, actor=world["manager"]).instance
    with django_capture_on_commit_callbacks(execute=True):
        leave = apply_hr_approval(leave, actor=world["hr"]).instance
    with django_capture_on_commit_callbacks(execute=True):
        leave = apply_ceo_approval(leave, actor=world["ceo"]).instance
    assert leave.status == Status.PENDING_HR_COMPLETION
    assert get_frozen_document(leave) is None

    visa = SimpleUploadedFile("visa.pdf", b"%PDF-1.4 visa", content_type="application/pdf")
    with mock.patch("leaves.services.extract_visa_fields", return_value=[]):
        with django_capture_on_commit_callbacks(execute=True):
            apply_hr_completion(leave, actor=world["hr"], visa_file=visa)

    assert get_frozen_document(leave) is not None


def test_hr_manual_record_is_frozen_at_creation(world, django_capture_on_commit_callbacks):
    payload = {
        "employee_id": world["employee"].employee_profile.id,
        "leave_type": world["leave_type"].id,
        "start_date": "2027-05-01",
        "end_date": "2027-05-03",
        "reason": "Paper form",
        "manual_entry_reason": "Recorded from the signed paper form.",
    }
    with django_capture_on_commit_callbacks(execute=True):
        response = _client(world["hr"]).post("/api/leaves/hr/manual-leave-requests/", payload, format="json")

    assert response.status_code == 201, response.data
    leave = LeaveRequest.objects.get(pk=response.data["data"]["id"])
    document = get_frozen_document(leave)
    assert document is not None
    paper = _client(world["hr"]).get(f"/api/leaves/leave-requests/{leave.id}/pdf/?workpaper=1")
    assert "HR (manual record)" in _pdf_text(paper.content)


def test_download_serves_the_frozen_copy_without_rendering(world, django_capture_on_commit_callbacks):
    leave = _approve_all(world, _submit(world), django_capture_on_commit_callbacks)
    stored = _stored_bytes(get_frozen_document(leave))

    with mock.patch("leaves.pdf_leave_request.build_leave_request_pdf", side_effect=AssertionError("re-rendered")):
        response, body = _download(world["employee"], leave)

    assert response.status_code == 200
    assert body == stored
    assert DocumentIntegrityEvent.objects.filter(event="downloaded", document__object_id=leave.id).count() == 1


def test_signature_change_after_approval_does_not_change_the_document(world, django_capture_on_commit_callbacks):
    leave = _approve_all(world, _submit(world), django_capture_on_commit_callbacks)
    _, before = _download(world["employee"], leave)

    profile = world["manager"].employee_profile
    profile.signature.save("replacement.png", ContentFile(make_png(width=300, height=90)), save=False)
    profile.full_name_en = "Renamed Manager"
    profile.save(update_fields=["signature", "full_name_en", "updated_at"])

    _, after = _download(world["employee"], leave)
    assert after == before
    assert "Renamed Manager" not in _pdf_text(after)


def test_in_progress_requests_still_render_live(world, django_capture_on_commit_callbacks):
    leave = _submit(world)
    with mock.patch("leaves.views._build_leave_request_pdf", return_value=b"%PDF-live") as render:
        response, body = _download(world["employee"], leave)

    assert response.status_code == 200
    assert body == b"%PDF-live"
    render.assert_called_once()


def test_requests_approved_before_rollout_report_not_frozen(world):
    leave = LeaveRequest.objects.create(
        employee=world["employee"],
        employee_profile=world["employee"].employee_profile,
        company=world["company"],
        leave_type=world["leave_type"],
        start_date=date(2025, 1, 1),
        end_date=date(2025, 1, 2),
        status=Status.APPROVED,
    )

    response = _client(world["employee"]).get(f"/api/leaves/leave-requests/{leave.id}/integrity/")

    assert response.status_code == 200
    data = response.data["data"]
    assert data["status"] == "not_frozen"
    assert data["sha256"] is None and data["frozen_at"] is None
    assert data["seal"]["present"] is False
    assert data["events"] == []


def test_mode_off_keeps_rendering_live(world, signing, django_capture_on_commit_callbacks):
    signing.DOCUMENT_SIGNING_MODE = "off"
    leave = _approve_all(world, _submit(world), django_capture_on_commit_callbacks)

    assert get_frozen_document(leave) is None


def test_tampered_or_missing_file_is_detected_and_never_served(world, django_capture_on_commit_callbacks):
    leave = _approve_all(world, _submit(world), django_capture_on_commit_callbacks)
    document = get_frozen_document(leave)
    original = _stored_bytes(document)
    _overwrite_stored(document, _tamper(original))

    hr = _client(world["hr"])
    status_response = hr.get(f"/api/leaves/leave-requests/{leave.id}/integrity/")
    verify_response = hr.post(f"/api/leaves/leave-requests/{leave.id}/integrity/verify/")
    download, _ = _download(world["employee"], leave)

    assert status_response.data["data"]["status"] == "tampered"
    assert verify_response.status_code == 200
    assert verify_response.data["data"]["status"] == "tampered"
    assert [e["event"] for e in verify_response.data["data"]["events"]][0] == "verified"
    assert download.status_code == 409
    assert AuditLog.objects.filter(action="document_download_blocked", entity_id=str(leave.id)).exists()

    document.file.storage.delete(document.file.name)
    assert hr.get(f"/api/leaves/leave-requests/{leave.id}/integrity/").data["data"]["status"] == "missing_file"


def test_frozen_document_verifies_clean(world, django_capture_on_commit_callbacks):
    leave = _approve_all(world, _submit(world), django_capture_on_commit_callbacks)

    response = _client(world["employee"]).post(f"/api/leaves/leave-requests/{leave.id}/integrity/verify/")

    data = response.data["data"]
    assert data["status"] == "frozen_valid"
    assert data["sha256"] == get_frozen_document(leave).sha256
    assert data["signing_mode"] == "freeze"
    assert {e["event"] for e in data["events"]} >= {"frozen", "verified"}
    assert data["events"][0]["by"] == "Employee Eman"


# ---------------------------------------------------------------------------
# Name fallback when a signer has no stored image
# ---------------------------------------------------------------------------


def test_signer_without_an_image_gets_their_profile_name(world, django_capture_on_commit_callbacks):
    leave = _approve_all(world, _submit(world, employee=world["unsigned"]), django_capture_on_commit_callbacks)

    with mock.patch("leaves.views._build_leave_request_pdf", side_effect=AssertionError("re-rendered")):
        _, body = _download(world["hr"], leave)

    first_page = PdfReader(BytesIO(body)).pages[0].extract_text() or ""
    assert "Unsigned Uthman" in first_page
    assert "di-hr@ffi.test" not in first_page, "the downloading user is never substituted"


# ---------------------------------------------------------------------------
# Phase 2: organization seal + RFC 3161 timestamp
# ---------------------------------------------------------------------------


def _validate_with_dev_root(data: bytes):
    root = crypto.to_asn1_cert(get_signing_backend().trust_roots()[0])
    reader = PdfFileReader(BytesIO(data))
    return [
        validate_pdf_signature(sig, ValidationContext(trust_roots=[root], allow_fetching=False))
        for sig in reader.embedded_signatures
    ]


def test_seal_mode_applies_a_timestamped_organization_seal(
    world, signing, dummy_tsa, django_capture_on_commit_callbacks
):
    signing.DOCUMENT_SIGNING_MODE = "seal"
    with mock.patch("core.document_integrity.pdf_signing.build_timestamper", return_value=dummy_tsa):
        leave = _approve_all(world, _submit(world), django_capture_on_commit_callbacks)

    document = get_frozen_document(leave)
    assert document.seal_status == FrozenDocument.SealStatus.SEALED
    assert document.timestamped is True
    sealed = _stored_bytes(document)
    assert crypto.sha256_hex(sealed) == document.sha256
    assert document.unsigned_sha256 and document.unsigned_sha256 != document.sha256

    statuses = _validate_with_dev_root(sealed)
    assert len(statuses) == 1
    assert statuses[0].intact and statuses[0].valid and statuses[0].trusted
    assert statuses[0].timestamp_validity is not None and statuses[0].timestamp_validity.intact

    data = _client(world["employee"]).get(f"/api/leaves/leave-requests/{leave.id}/integrity/").data["data"]
    assert data["status"] == "sealed_valid"
    assert data["seal"]["present"] and data["seal"]["valid"] and data["seal"]["timestamped"]
    assert data["seal"]["trust"] == "untrusted_root"
    assert data["seal"]["signer"] == "FFI HR Document Seal"
    assert data["signatures"] == []
    assert "sealed" in {e["event"] for e in data["events"]}


def test_sealed_bytes_changed_with_a_matching_hash_still_fail_signature_validation(
    world, signing, dummy_tsa, django_capture_on_commit_callbacks
):
    """An attacker who also rewrites the stored hash is caught by the seal."""

    signing.DOCUMENT_SIGNING_MODE = "seal"
    with mock.patch("core.document_integrity.pdf_signing.build_timestamper", return_value=dummy_tsa):
        leave = _approve_all(world, _submit(world), django_capture_on_commit_callbacks)
    document = get_frozen_document(leave)
    forged = _tamper(_stored_bytes(document))
    _overwrite_stored(document, forged)
    FrozenDocument.objects.filter(pk=document.pk).update(sha256=crypto.sha256_hex(forged))

    data = _client(world["hr"]).post(f"/api/leaves/leave-requests/{leave.id}/integrity/verify/").data["data"]

    assert data["status"] == "tampered"
    assert data["seal"]["valid"] is False


def test_unreachable_tsa_leaves_the_seal_pending_until_retried(
    world, signing, dummy_tsa, django_capture_on_commit_callbacks
):
    signing.DOCUMENT_SIGNING_MODE = "seal"
    broken = timestamps.HTTPTimeStamper("http://127.0.0.1:9/tsa", timeout=2)
    with mock.patch("core.document_integrity.pdf_signing.build_timestamper", return_value=broken):
        leave = _approve_all(world, _submit(world), django_capture_on_commit_callbacks)

    document = get_frozen_document(leave)
    assert document.seal_status == FrozenDocument.SealStatus.PENDING
    assert "Timestamp authority unavailable" in document.seal_error
    hr = _client(world["hr"])
    assert hr.get(f"/api/leaves/leave-requests/{leave.id}/integrity/").data["data"]["status"] == "seal_pending"
    _, body = _download(world["employee"], leave)
    assert crypto.sha256_hex(body) == document.sha256, "the frozen copy is still served while the seal is pending"

    assert (
        _client(world["employee"]).post(f"/api/leaves/leave-requests/{leave.id}/integrity/retry-seal/").status_code
        == 403
    )
    with mock.patch("core.document_integrity.pdf_signing.build_timestamper", return_value=dummy_tsa):
        response = hr.post(f"/api/leaves/leave-requests/{leave.id}/integrity/retry-seal/")

    assert response.status_code == 200, response.data
    assert response.data["data"]["status"] == "sealed_valid"
    assert {"seal_retry", "sealed"} <= {e["event"] for e in response.data["data"]["events"]}
    assert hr.post(f"/api/leaves/leave-requests/{leave.id}/integrity/retry-seal/").status_code == 422


# ---------------------------------------------------------------------------
# Phase 3: per-person certificates + incremental signatures
# ---------------------------------------------------------------------------


def test_personal_mode_signs_each_stage_then_seals(world, signing, dummy_tsa, django_capture_on_commit_callbacks):
    signing.DOCUMENT_SIGNING_MODE = "personal"
    with django_capture_on_commit_callbacks(execute=True):
        leave = _submit(world)
    with django_capture_on_commit_callbacks(execute=True):
        leave = apply_manager_approval(leave, actor=world["manager"]).instance
    manager_cert = SigningCertificate.objects.get(user=world["manager"])
    assert manager_cert.subject_name == "Manager Mona"
    assert manager_cert.employee_id == "DI-MGR"
    assert not SigningCertificate.objects.filter(user=world["ceo"]).exists(), "issued lazily on first approval"
    attestation = DocumentApprovalSignature.objects.get(object_id=leave.id, role="line_manager")
    assert verify_attestation(attestation)

    with django_capture_on_commit_callbacks(execute=True):
        leave = apply_hr_approval(leave, actor=world["hr"]).instance
    with mock.patch("core.document_integrity.pdf_signing.build_timestamper", return_value=dummy_tsa):
        with django_capture_on_commit_callbacks(execute=True):
            leave = apply_ceo_approval(leave, actor=world["ceo"]).instance

    document = get_frozen_document(leave)
    assert document.seal_status == FrozenDocument.SealStatus.SEALED
    statuses = _validate_with_dev_root(_stored_bytes(document))
    assert len(statuses) == 5, "employee, manager, HR, CEO, then the seal"
    assert all(s.intact and s.valid and s.trusted for s in statuses)
    assert statuses[-1].coverage.name == "ENTIRE_FILE"

    data = _client(world["manager"]).get(f"/api/leaves/leave-requests/{leave.id}/integrity/").data["data"]
    assert data["status"] == "signed_valid"
    assert [s["role"] for s in data["signatures"]] == ["employee", "line_manager", "hr", "ceo"]
    assert [s["signer_name"] for s in data["signatures"]] == ["Employee Eman", "Manager Mona", "Hr Hala", "Ceo Camal"]
    assert data["signatures"][1]["certificate_serial"] == manager_cert.serial
    assert all(s["valid"] and s["trust"] == "untrusted_root" for s in data["signatures"])
    assert "Manager Mona" in _pdf_text(_stored_bytes(document))


def test_revocation_after_signing_is_reported_and_offboarding_revokes(
    world, signing, dummy_tsa, django_capture_on_commit_callbacks
):
    signing.DOCUMENT_SIGNING_MODE = "personal"
    with mock.patch("core.document_integrity.pdf_signing.build_timestamper", return_value=dummy_tsa):
        with django_capture_on_commit_callbacks(execute=True):
            leave = _submit(world)
        leave = _approve_all(world, leave, django_capture_on_commit_callbacks)

    manager = world["manager"]
    manager.is_active = False
    manager.save(update_fields=["is_active"])
    assert SigningCertificate.objects.get(user=manager).revoked_at is not None

    data = _client(world["hr"]).post(f"/api/leaves/leave-requests/{leave.id}/integrity/verify/").data["data"]
    manager_row = next(s for s in data["signatures"] if s["role"] == "line_manager")
    assert manager_row["revoked"] is True
    assert manager_row["valid"] is True, "revoked after it signed: the signature still stands"
    assert data["status"] == "signed_valid"


def test_a_revoked_certificate_is_not_used_to_sign(world, signing, dummy_tsa, django_capture_on_commit_callbacks):
    signing.DOCUMENT_SIGNING_MODE = "personal"
    with django_capture_on_commit_callbacks(execute=True):
        leave = _submit(world)
    with django_capture_on_commit_callbacks(execute=True):
        leave = apply_manager_approval(leave, actor=world["manager"]).instance
    with django_capture_on_commit_callbacks(execute=True):
        leave = apply_hr_approval(leave, actor=world["hr"]).instance
    SigningCertificate.objects.filter(user=world["manager"]).update(revoked_at=timezone.now(), revocation_reason="test")
    world["manager"].is_active = False
    world["manager"].save(update_fields=["is_active"])

    with mock.patch("core.document_integrity.pdf_signing.build_timestamper", return_value=dummy_tsa):
        with django_capture_on_commit_callbacks(execute=True):
            apply_ceo_approval(leave, actor=world["ceo"])

    roles = [
        s["role"]
        for s in _client(world["hr"])
        .get(f"/api/leaves/leave-requests/{leave.id}/integrity/")
        .data["data"]["signatures"]
    ]
    assert "line_manager" not in roles
    assert roles == ["employee", "hr", "ceo"]


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------


def test_integrity_is_visible_to_owner_approvers_and_hr_only(world, django_capture_on_commit_callbacks):
    leave = _approve_all(world, _submit(world), django_capture_on_commit_callbacks)
    url = f"/api/leaves/leave-requests/{leave.id}/integrity/"

    for user in ("employee", "manager", "ceo", "hr"):
        assert _client(world[user]).get(url).status_code == 200, user
    assert _client(world["outsider"]).get(url).status_code == 404
    assert _client(world["outsider"]).post(f"{url}verify/").status_code == 404
    assert APIClient().get(url).status_code == 401
    assert _client(world["manager"]).post(f"{url}retry-seal/").status_code == 403


# ---------------------------------------------------------------------------
# Upload verification
# ---------------------------------------------------------------------------


def _upload(user, data: bytes, name="copy.pdf"):
    return _client(user).post(
        "/api/documents/verify-upload/",
        {"file": SimpleUploadedFile(name, data, content_type="application/pdf")},
        format="multipart",
    )


def test_verify_upload_matches_the_stored_document(world, django_capture_on_commit_callbacks):
    leave = _approve_all(world, _submit(world), django_capture_on_commit_callbacks)
    stored = _stored_bytes(get_frozen_document(leave))

    response = _upload(world["hr"], stored)

    assert response.status_code == 200
    data = response.data["data"]
    reference = get_frozen_document(leave).reference
    assert data["matched_record"] == {"type": "leave", "id": leave.id, "reference": reference}
    assert data["integrity"]["status"] == "frozen_valid"
    assert "events" not in data["integrity"]
    assert data["summary"]
    assert AuditLog.objects.filter(action="document_upload_verified").exists()


def test_verify_upload_flags_a_modified_copy(world, django_capture_on_commit_callbacks):
    leave = _approve_all(world, _submit(world), django_capture_on_commit_callbacks)
    modified = _tamper(_stored_bytes(get_frozen_document(leave)))

    data = _upload(world["hr"], modified).data["data"]

    assert data["matched_record"]["id"] == leave.id
    assert data["integrity"]["status"] == "tampered"


def test_verify_upload_of_a_sealed_copy(world, signing, dummy_tsa, django_capture_on_commit_callbacks):
    signing.DOCUMENT_SIGNING_MODE = "seal"
    with mock.patch("core.document_integrity.pdf_signing.build_timestamper", return_value=dummy_tsa):
        leave = _approve_all(world, _submit(world), django_capture_on_commit_callbacks)

    data = _upload(world["hr"], _stored_bytes(get_frozen_document(leave))).data["data"]

    assert data["integrity"]["status"] == "sealed_valid"
    assert data["integrity"]["seal"]["valid"] is True


def test_verify_upload_is_hr_only_and_never_leaks_other_companies(world, django_capture_on_commit_callbacks):
    leave = _approve_all(world, _submit(world), django_capture_on_commit_callbacks)
    stored = _stored_bytes(get_frozen_document(leave))

    assert _upload(world["employee"], stored).status_code == 403
    assert _upload(world["hr"], b"not a pdf").status_code == 422

    other_company = OrganizationNode.objects.exclude(pk=world["company"].pk).filter(is_active=True).first()
    if other_company is None:
        pytest.skip("needs a second company")
    other_hr = User.objects.create_user(email="di-other-hr@ffi.test", password="pw")
    other_hr.groups.add(Group.objects.get(name="HRManager"))
    UserOrganizationAccess.objects.create(user=other_hr, organization=other_company)
    data = (
        _client(other_hr)
        .post(
            "/api/documents/verify-upload/",
            {"file": SimpleUploadedFile("copy.pdf", stored, content_type="application/pdf")},
            format="multipart",
            HTTP_X_ACTIVE_COMPANY_ID=str(other_company.pk),
        )
        .data["data"]
    )
    assert data["matched_record"] is None
    assert data["integrity"]["status"] == "not_frozen"
