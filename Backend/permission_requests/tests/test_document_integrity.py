"""Approved permission-request PDFs are frozen, sealed, signed and verifiable.

Mirrors ``loans/test_document_integrity.py`` for the permission workflow
(Direct Manager -> HR -> approved): the PDF is frozen once, when the request
reaches ``approved`` (HR decision, or a manager decision with no HR stage or
covering it); the download serves that copy with its ``application/pdf`` header;
tampering is detected and never served; HR alone gets the approval-trail work
paper; the integrity endpoints answer only the people involved (or HR in the
company); verify-upload names the request.

The app conftest runs ``transaction.on_commit`` callbacks immediately, so each
transition's freeze has already happened when the API call returns.
"""

from __future__ import annotations

from io import BytesIO
from unittest import mock

import pytest
from cryptography.fernet import Fernet
from cryptography.x509.oid import ExtendedKeyUsageOID
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
from permission_requests.models import PermissionRequest
from permission_requests.tests.helpers import BASE_URL
from permission_requests.tests.test_workflow import _act, _submit

pytestmark = pytest.mark.django_db

Status = PermissionRequest.Status
FERNET_KEY = Fernet.generate_key().decode()
RENDER = "permission_requests.views.build_permission_request_pdf"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def signing_key_dir(tmp_path_factory):
    return tmp_path_factory.mktemp("permission_signing_keys")


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
        subject=crypto.build_name("Permission Test TSA"),
        public_key=key.public_key(),
        issuer_cert=None,
        issuer_key=key,
        days=30,
        extended_usages=[ExtendedKeyUsageOID.TIME_STAMPING],
    )
    return timestamps.DummyTimeStamper(tsa_cert=crypto.to_asn1_cert(cert), tsa_key=crypto.to_asn1_key(key))


def _sign(user):
    profile = user.employee_profile
    profile.signature.save(f"perm-sig-{user.pk}.png", ContentFile(make_png()), save=False)
    profile.signature_uploaded_at = timezone.now()
    profile.save(update_fields=["signature", "signature_uploaded_at", "updated_at"])


@pytest.fixture
def world(signing, team, make_user):
    for user in (team.manager, team.employee, team.hr):
        _sign(user)
    team.outsider = make_user("Employee", name="Omar Outsider")
    team.other_manager = make_user("Manager", name="Mona Othermanager")
    return team


def _approve_all(world, client_for):
    instance = _submit(client_for, world.employee)
    assert _act(client_for, world.manager, instance, "manager-approve").status_code == 200
    assert _act(client_for, world.hr, instance, "hr-approve").status_code == 200
    instance.refresh_from_db()
    assert instance.status == Status.APPROVED
    return instance


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


def _download(client_for, user, instance, query="", slash="/"):
    return client_for(user).get(f"{BASE_URL}{instance.pk}/pdf{slash}{query}")


def _integrity_url(instance):
    return f"{BASE_URL}{instance.pk}/integrity/"


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


def test_request_is_frozen_only_at_the_final_hr_approval(world, client_for):
    instance = _submit(client_for, world.employee)
    _act(client_for, world.manager, instance, "manager-approve")
    instance.refresh_from_db()
    assert instance.status == Status.PENDING_HR
    assert get_frozen_document(instance) is None, "the HR panel is still pending"

    assert _act(client_for, world.hr, instance, "hr-approve").status_code == 200

    instance.refresh_from_db()
    document = get_frozen_document(instance)
    assert instance.status == Status.APPROVED
    assert document is not None
    assert document.document_type == "permission_request"
    assert document.reference == instance.reference_no
    assert document.signing_mode == "freeze"
    data = _stored_bytes(document)
    assert crypto.sha256_hex(data) == document.sha256
    assert DocumentIntegrityEvent.objects.filter(document=document, event="frozen").count() == 1
    assert AuditLog.objects.filter(
        action="document_frozen", entity="permission_request", entity_id=str(instance.id)
    ).exists()
    assert "Approval Trail" not in _pdf_text(data)
    assert PdfReader(BytesIO(data)).metadata["/FFIDocumentRef"] == (
        f"permission_request:{instance.id}:{instance.reference_no}"
    )


def test_manager_who_covers_hr_freezes_once_at_the_manager_decision(world, client_for):
    world.manager.groups.add(Group.objects.get_or_create(name="HRManager")[0])
    instance = _submit(client_for, world.employee)

    assert _act(client_for, world.manager, instance, "manager-approve").status_code == 200

    instance.refresh_from_db()
    document = get_frozen_document(instance)
    assert instance.status == Status.APPROVED
    assert document is not None and document.version == 1
    assert DocumentIntegrityEvent.objects.filter(document=document, event="frozen").count() == 1


def test_hr_approvers_own_request_is_frozen_at_the_manager_decision(world, client_for, make_user):
    hr_employee = make_user("HRManager", manager=world.manager, name="Hana Hremployee")
    instance = _submit(client_for, hr_employee)

    assert _act(client_for, world.manager, instance, "manager-approve").status_code == 200

    instance.refresh_from_db()
    assert instance.status == Status.APPROVED
    assert instance.hr_decision_by_id is None, "no HR stage on an HR approver's own request"
    assert get_frozen_document(instance) is not None


def test_request_without_a_manager_is_frozen_at_the_hr_decision(world, client_for, make_user):
    loner = make_user("Employee", name="Lina Loner")
    instance = _submit(client_for, loner)
    assert instance.status == Status.PENDING_HR

    assert _act(client_for, world.hr, instance, "hr-approve").status_code == 200

    instance.refresh_from_db()
    assert get_frozen_document(instance) is not None
    paper = _download(client_for, world.hr, instance, "?workpaper=1").content
    assert "Huda HR" in _pdf_text(paper)


def test_rejections_are_never_frozen(world, client_for):
    rejected_by_manager = _submit(client_for, world.employee)
    _act(client_for, world.manager, rejected_by_manager, "manager-reject", "No")
    rejected_by_hr = _submit(client_for, world.employee, from_time="11:00", to_time="12:00")
    _act(client_for, world.manager, rejected_by_hr, "manager-approve")
    _act(client_for, world.hr, rejected_by_hr, "hr-reject", "No")

    for instance in (rejected_by_manager, rejected_by_hr):
        instance.refresh_from_db()
        assert instance.status == Status.REJECTED
        assert get_frozen_document(instance) is None


def test_finalize_failure_never_undoes_the_approval(world, client_for):
    instance = _submit(client_for, world.employee)
    _act(client_for, world.manager, instance, "manager-approve")
    with mock.patch("core.document_integrity.services.finalize_document", side_effect=RuntimeError("disk full")):
        response = _act(client_for, world.hr, instance, "hr-approve")

    assert response.status_code == 200
    instance.refresh_from_db()
    assert instance.status == Status.APPROVED
    assert get_frozen_document(instance) is None


def test_mode_off_keeps_rendering_live(world, signing, client_for):
    signing.DOCUMENT_SIGNING_MODE = "off"
    instance = _approve_all(world, client_for)

    assert get_frozen_document(instance) is None


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("slash", ["", "/"])
def test_pdf_serves_the_frozen_copy_with_its_pdf_header_without_rendering(world, client_for, slash):
    instance = _approve_all(world, client_for)
    stored = _stored_bytes(get_frozen_document(instance))

    for user in (world.employee, world.manager, world.hr):
        with mock.patch(RENDER, side_effect=AssertionError("re-rendered")):
            response = _download(client_for, user, instance, slash=slash)
        assert response.status_code == 200
        assert response.content == stored
        assert response["Content-Type"] == "application/pdf"
        assert response["Content-Disposition"] == (
            f'attachment; filename="permission_request_{instance.reference_no}.pdf"'
        )
        assert response["Cache-Control"] == "private, no-store"
        assert response["X-Content-Type-Options"] == "nosniff"
    assert DocumentIntegrityEvent.objects.filter(event="downloaded", document__object_id=instance.id).count() == 3
    assert AuditLog.objects.filter(action="permission_request_pdf_downloaded", entity_id=str(instance.id)).count() == 3


def test_signature_change_after_approval_does_not_change_the_document(world, client_for):
    instance = _approve_all(world, client_for)
    before = _download(client_for, world.employee, instance).content

    profile = world.hr.employee_profile
    profile.signature.save("replacement.png", ContentFile(make_png(width=300, height=90)), save=False)
    profile.full_name = "Renamed Hr"
    profile.full_name_en = "Renamed Hr"
    profile.save(update_fields=["signature", "full_name", "full_name_en", "updated_at"])

    after = _download(client_for, world.employee, instance).content
    assert after == before
    assert "Renamed Hr" not in _pdf_text(after)


def test_in_progress_requests_still_render_live(world, client_for):
    instance = _submit(client_for, world.employee)
    _act(client_for, world.manager, instance, "manager-approve")
    with mock.patch(RENDER, return_value=b"%PDF-live") as render:
        response = _download(client_for, world.hr, instance, "?workpaper=1")

    assert response.status_code == 200
    assert response.content == b"%PDF-live"
    assert response["Content-Type"] == "application/pdf"
    render.assert_called_once()


def test_hr_work_paper_appends_a_live_trail_in_the_viewers_timezone(world, client_for):
    instance = _approve_all(world, client_for)
    document = get_frozen_document(instance)

    paper = _download(client_for, world.hr, instance, "?workpaper=1&tz=Pacific/Auckland")
    text = _pdf_text(paper.content)
    assert paper["Content-Disposition"] == (
        f'attachment; filename="permission_request_{instance.reference_no}_workpaper.pdf"'
    )
    assert paper["Content-Type"] == "application/pdf"
    assert "Approval Trail" in text
    for name in ("Eyad Employee", "Maha Manager", "Huda HR"):
        assert name in text
    assert "+13" not in text and "+12" not in text and "UTC" not in text

    for viewer in (world.employee, world.manager):
        plain = _download(client_for, viewer, instance, "?workpaper=1")
        assert "Approval Trail" not in _pdf_text(plain.content)
        assert crypto.sha256_hex(plain.content) == document.sha256


def test_tampered_or_missing_file_is_detected_and_never_served(world, client_for):
    instance = _approve_all(world, client_for)
    document = get_frozen_document(instance)
    _overwrite_stored(document, _tamper(_stored_bytes(document)))

    hr = client_for(world.hr)
    url = _integrity_url(instance)
    assert hr.get(url).data["data"]["status"] == "tampered"
    verify = hr.post(f"{url}verify/")
    assert verify.status_code == 200
    assert verify.data["data"]["status"] == "tampered"
    assert verify.data["data"]["events"][0]["event"] == "verified"
    for slash in ("", "/"):
        with mock.patch(RENDER, side_effect=AssertionError("re-rendered")):
            assert _download(client_for, world.employee, instance, slash=slash).status_code == 409
    assert AuditLog.objects.filter(
        action="document_download_blocked", entity="permission_request", entity_id=str(instance.id)
    ).exists()
    assert not AuditLog.objects.filter(action="permission_request_pdf_downloaded", entity_id=str(instance.id)).exists()

    document.file.storage.delete(document.file.name)
    assert hr.get(url).data["data"]["status"] == "missing_file"


def test_requests_approved_before_rollout_report_not_frozen(world, client_for, make_request):
    instance = make_request(world.employee, status=Status.APPROVED)

    data = client_for(world.employee).get(_integrity_url(instance)).data["data"]

    assert data["status"] == "not_frozen"
    assert data["sha256"] is None and data["frozen_at"] is None
    assert data["events"] == []
    assert set(data) == {"status", "frozen_at", "sha256", "signing_mode", "seal", "signatures", "events"}


def test_frozen_request_verifies_clean(world, client_for):
    instance = _approve_all(world, client_for)

    data = client_for(world.employee).post(f"{_integrity_url(instance)}verify/").data["data"]

    assert data["status"] == "frozen_valid"
    assert data["sha256"] == get_frozen_document(instance).sha256
    assert {e["event"] for e in data["events"]} >= {"frozen", "verified"}
    assert data["events"][0]["by"] == "Eyad Employee"
    assert all("by_profile_id" not in e for e in data["events"]), "profile ids are for HR only"


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------


def test_integrity_is_visible_to_owner_approvers_and_hr_only(world, client_for):
    instance = _approve_all(world, client_for)
    url = _integrity_url(instance)

    for user in (world.employee, world.manager, world.hr):
        assert client_for(user).get(url).status_code == 200, user
    assert client_for(world.other_manager).get(url).status_code == 404
    assert client_for(world.outsider).get(url).status_code == 404
    assert client_for(world.outsider).post(f"{url}verify/").status_code == 404
    assert APIClient().get(url).status_code == 401
    assert client_for(world.manager).post(f"{url}retry-seal/").status_code == 403
    assert client_for(world.employee).post(f"{url}retry-seal/").status_code == 403
    assert client_for(world.hr).post(f"{url}retry-seal/").status_code == 422, "frozen, not sealing"

    hr_events = client_for(world.hr).get(url).data["data"]["events"]
    assert hr_events and "by_profile_id" in hr_events[0]


def test_hr_of_another_company_gets_404(world, client_for, make_user, other_company):
    instance = _approve_all(world, client_for)
    foreign_hr = make_user("HRManager", tenant=other_company, name="Foreign Hr")
    client = client_for(foreign_hr, other_company)

    assert client.get(_integrity_url(instance)).status_code == 404
    assert client.get(f"{BASE_URL}{instance.pk}/pdf/").status_code == 404


# ---------------------------------------------------------------------------
# Upload verification
# ---------------------------------------------------------------------------


def _upload(client_for, user, data: bytes):
    return client_for(user).post(
        "/api/documents/verify-upload/",
        {"file": SimpleUploadedFile("permission.pdf", data, content_type="application/pdf")},
        format="multipart",
    )


def test_verify_upload_matches_and_flags_a_permission_request(world, client_for):
    instance = _approve_all(world, client_for)
    document = get_frozen_document(instance)
    stored = _stored_bytes(document)

    data = _upload(client_for, world.hr, stored).data["data"]
    assert data["matched_record"] == {"type": "permission", "id": instance.id, "reference": instance.reference_no}
    assert data["integrity"]["status"] == "frozen_valid"

    modified = _upload(client_for, world.hr, _tamper(stored)).data["data"]
    assert modified["matched_record"]["type"] == "permission"
    assert modified["integrity"]["status"] == "tampered"


def test_verify_upload_matches_an_edited_copy_by_its_visible_reference(world, client_for):
    """Editors such as Canva drop the hidden metadata; the printed reference still names the request."""

    instance = _approve_all(world, client_for)
    document = get_frozen_document(instance)
    edited = PdfWriter()
    for page in PdfReader(BytesIO(_stored_bytes(document))).pages:
        edited.add_page(page)
    edited.add_metadata({"/Producer": "Canva"})
    buffer = BytesIO()
    edited.write(buffer)

    data = _upload(client_for, world.hr, buffer.getvalue()).data["data"]
    assert data["matched_record"] == {"type": "permission", "id": instance.id, "reference": instance.reference_no}
    assert data["integrity"]["status"] == "tampered"


# ---------------------------------------------------------------------------
# Seal and personal signatures
# ---------------------------------------------------------------------------


def test_seal_mode_applies_a_timestamped_organization_seal(world, signing, dummy_tsa, client_for):
    signing.DOCUMENT_SIGNING_MODE = "seal"
    with mock.patch("core.document_integrity.pdf_signing.build_timestamper", return_value=dummy_tsa):
        instance = _approve_all(world, client_for)

    document = get_frozen_document(instance)
    assert document.seal_status == FrozenDocument.SealStatus.SEALED
    statuses = _validate_with_dev_root(_stored_bytes(document))
    assert len(statuses) == 1 and statuses[0].intact and statuses[0].valid
    data = client_for(world.employee).get(_integrity_url(instance)).data["data"]
    assert data["status"] == "sealed_valid"
    assert data["seal"]["timestamped"] is True


def test_personal_mode_signs_each_stage_in_order_then_seals(world, signing, dummy_tsa, client_for):
    signing.DOCUMENT_SIGNING_MODE = "personal"
    with mock.patch("core.document_integrity.pdf_signing.build_timestamper", return_value=dummy_tsa):
        instance = _approve_all(world, client_for)

    document = get_frozen_document(instance)
    assert document.seal_status == FrozenDocument.SealStatus.SEALED
    statuses = _validate_with_dev_root(_stored_bytes(document))
    assert len(statuses) == 4, "employee, manager, HR, then the seal"
    assert all(s.intact and s.valid for s in statuses)

    attestations = DocumentApprovalSignature.objects.filter(
        document_type="permission_request", object_id=instance.id
    ).order_by("id")
    assert [(a.role, a.actor_id) for a in attestations] == [
        ("employee", world.employee.id),
        ("line_manager", world.manager.id),
        ("hr", world.hr.id),
    ]

    data = client_for(world.hr).get(_integrity_url(instance)).data["data"]
    assert data["status"] == "signed_valid"
    assert [s["role"] for s in data["signatures"]] == ["employee", "line_manager", "hr"]
    assert [s["signer_name"] for s in data["signatures"]] == ["Eyad Employee", "Maha Manager", "Huda HR"]
    assert all(s.get("profile_id") for s in data["signatures"]), "HR sees profile ids"
    owner_view = client_for(world.employee).get(_integrity_url(instance)).data["data"]
    assert all("profile_id" not in s for s in owner_view["signatures"]), "profile ids are for HR only"
