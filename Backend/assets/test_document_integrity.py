"""Processed asset return requests and approved damage reports are frozen and verifiable.

Mirrors ``loans/test_document_integrity.py``: the return request is frozen when
HR records the asset as received (the form's last "Processed" row), the damage
report when the CEO approves it; the PDF route serves that copy (with and
without a trailing slash); tampering is detected and never served; HR alone gets
the approval-trail work paper; the integrity endpoints answer only the people
involved (or HR in the company); verify-upload names the record.
"""

from __future__ import annotations

from datetime import date
from io import BytesIO
from unittest import mock

import pytest
from cryptography.fernet import Fernet
from cryptography.x509.oid import ExtendedKeyUsageOID
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign import timestamps
from pyhanko.sign.validation import validate_pdf_signature
from pyhanko_certvalidator import ValidationContext
from pypdf import PdfReader, PdfWriter
from rest_framework.test import APIClient

from assets.models import Asset, AssetAssignment, AssetDamageReport, AssetReturnRequest
from assets.services.damage_reports import approve_damage_report_by_ceo
from assets.services.return_requests import (
    apply_hr_decision,
    apply_manager_decision,
    mark_return_request_processed,
    record_return_request_submission,
)
from audit.models import AuditLog
from core.document_integrity import crypto
from core.document_integrity.backends import get_signing_backend
from core.document_integrity.models import DocumentIntegrityEvent, FrozenDocument
from core.document_integrity.services import get_frozen_document
from employees.models import EmployeeProfile
from organization.models import OrganizationNode, UserOrganizationAccess
from organization.services import get_default_company

pytestmark = pytest.mark.django_db

User = get_user_model()
ReturnStatus = AssetReturnRequest.RequestStatus
DamageStatus = AssetDamageReport.RequestStatus
FERNET_KEY = Fernet.generate_key().decode()
PAYLOAD_KEYS = {"status", "frozen_at", "sha256", "signing_mode", "seal", "signatures", "events"}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def signing_key_dir(tmp_path_factory):
    return tmp_path_factory.mktemp("asset_signing_keys")


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
        subject=crypto.build_name("Asset Test TSA"),
        public_key=key.public_key(),
        issuer_cert=None,
        issuer_key=key,
        days=30,
        extended_usages=[ExtendedKeyUsageOID.TIME_STAMPING],
    )
    return timestamps.DummyTimeStamper(tsa_cert=crypto.to_asn1_cert(cert), tsa_key=crypto.to_asn1_key(key))


def _profile(user, company, employee_id, *, name, manager_profile=None):
    return EmployeeProfile.objects.create(
        user=user,
        company=company,
        employee_id=employee_id,
        full_name=name,
        full_name_en=name,
        department="Operations",
        job_title="Staff",
        hire_date=date(2021, 1, 1),
        manager_profile=manager_profile,
    )


@pytest.fixture
def world(signing):
    company = get_default_company()
    hr_group, _ = Group.objects.get_or_create(name="HRManager")
    ceo_group, _ = Group.objects.get_or_create(name="CEO")

    def make(key, name, **kwargs):
        user = User.objects.create_user(email=f"da-{key}@ffi.test", password="pw", full_name=name)
        _profile(user, company, f"DAS-{key.upper()}", name=name, **kwargs)
        return user

    manager = make("manager", "Manager Maha")
    employee = make("employee", "Employee Ezz", manager_profile=manager.employee_profile)
    hr = make("hr", "Hr Huda")
    hr.groups.add(hr_group)
    UserOrganizationAccess.objects.create(user=hr, organization=company)
    ceo = make("ceo", "Ceo Celine")
    ceo.groups.add(ceo_group)
    UserOrganizationAccess.objects.create(user=ceo, organization=company)
    asset = Asset.objects.create(
        company=company,
        name_en="Integrity Laptop",
        type=Asset.AssetType.OTHER,
        status=Asset.AssetStatus.ASSIGNED,
        serial_number="SN-INT-1",
        flexible_attributes={"category": "laptop"},
    )
    AssetAssignment.objects.create(asset=asset, employee=employee.employee_profile, assigned_by=hr)
    return {
        "company": company,
        "asset": asset,
        "manager": manager,
        "employee": employee,
        "hr": hr,
        "ceo": ceo,
        "outsider": make("outsider", "Outsider Omar"),
    }


def _client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _submit_return(world, capture, *, employee=None, status=ReturnStatus.PENDING_MANAGER):
    employee = employee or world["employee"]
    with capture(execute=True):
        request_obj = AssetReturnRequest.objects.create(
            asset=world["asset"], employee=employee.employee_profile, note="Project finished", status=status
        )
        record_return_request_submission(request_obj, actor=employee)
    return request_obj


def _approve_return(world, request_obj, capture):
    with capture(execute=True):
        request_obj, _ = apply_manager_decision(request_obj, actor=world["manager"], approve=True, comment="OK")
    with capture(execute=True):
        request_obj = apply_hr_decision(request_obj, actor=world["hr"], approve=True)
    return request_obj


def _receive_asset(world, capture):
    """HR records the asset as returned: every open request for it is processed."""

    with capture(execute=True):
        response = _client(world["hr"]).post(f"/api/assets/{world['asset'].id}/return/", {}, format="json")
    assert response.status_code == 200, response.content


def _processed_return(world, capture):
    request_obj = _approve_return(world, _submit_return(world, capture), capture)
    _receive_asset(world, capture)
    request_obj.refresh_from_db()
    return request_obj


def _pending_ceo_damage(world, capture):
    with capture(execute=True):
        return AssetDamageReport.objects.create(
            asset=world["asset"],
            employee=world["employee"].employee_profile,
            description="Cracked screen",
            status=DamageStatus.PENDING_CEO,
        )


def _approved_damage(world, capture):
    report = _pending_ceo_damage(world, capture)
    with capture(execute=True):
        response = _client(world["ceo"]).post(f"/api/ceo/assets/damage-reports/{report.id}/approve/", {})
    assert response.status_code == 200, response.content
    report.refresh_from_db()
    return report


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


def _return_pdf(user, request_obj, query="", slash="/"):
    return _client(user).get(f"/api/assets/return-requests/{request_obj.id}/pdf{slash}{query}")


def _damage_pdf(user, report, query="", slash="/"):
    return _client(user).get(f"/api/assets/damage-reports/{report.id}/pdf{slash}{query}")


def _upload(user, data: bytes):
    return _client(user).post(
        "/api/documents/verify-upload/",
        {"file": SimpleUploadedFile("asset.pdf", data, content_type="application/pdf")},
        format="multipart",
    )


def _validate_with_dev_root(data: bytes):
    root = crypto.to_asn1_cert(get_signing_backend().trust_roots()[0])
    reader = PdfFileReader(BytesIO(data))
    return [
        validate_pdf_signature(sig, ValidationContext(trust_roots=[root], allow_fetching=False))
        for sig in reader.embedded_signatures
    ]


# ---------------------------------------------------------------------------
# Return request: freeze
# ---------------------------------------------------------------------------


def test_return_request_is_frozen_only_when_hr_receives_the_asset(world, django_capture_on_commit_callbacks):
    capture = django_capture_on_commit_callbacks
    request_obj = _approve_return(world, _submit_return(world, capture), capture)
    assert request_obj.status == ReturnStatus.APPROVED
    assert get_frozen_document(request_obj) is None, "approved, but the Processed row is still empty"

    _receive_asset(world, capture)
    request_obj.refresh_from_db()

    document = get_frozen_document(request_obj)
    assert request_obj.status == ReturnStatus.PROCESSED
    assert document is not None
    assert document.document_type == "asset_return_request"
    assert document.company_id == world["company"].id
    data = _stored_bytes(document)
    assert crypto.sha256_hex(data) == document.sha256
    assert DocumentIntegrityEvent.objects.filter(document=document, event="frozen").count() == 1
    assert AuditLog.objects.filter(
        action="document_frozen", entity="asset_return_request", entity_id=str(request_obj.id)
    ).exists()
    text = _pdf_text(data)
    assert "Approval Trail" not in text
    assert "Hr Huda" in text, "the Processed row names the HR receiver"
    token = PdfReader(BytesIO(data)).metadata["/FFIDocumentRef"]
    assert token == f"asset_return_request:{request_obj.id}:{document.reference}"


def test_pending_request_processed_on_receipt_is_frozen_with_the_stages_that_happened(
    world, django_capture_on_commit_callbacks
):
    capture = django_capture_on_commit_callbacks
    request_obj = _submit_return(world, capture)
    _receive_asset(world, capture)
    request_obj.refresh_from_db()

    assert request_obj.status == ReturnStatus.PROCESSED
    assert get_frozen_document(request_obj) is not None
    text = _pdf_text(_return_pdf(world["hr"], request_obj, "?workpaper=1").content)
    assert "Employee Ezz" in text and "Processed" in text
    assert "Manager Maha" not in text


def test_finalize_failure_never_undoes_the_processing(world, django_capture_on_commit_callbacks):
    capture = django_capture_on_commit_callbacks
    request_obj = _approve_return(world, _submit_return(world, capture), capture)
    with mock.patch("core.document_integrity.services.finalize_document", side_effect=RuntimeError("disk full")):
        _receive_asset(world, capture)

    request_obj.refresh_from_db()
    world["asset"].refresh_from_db()
    assert request_obj.status == ReturnStatus.PROCESSED
    assert world["asset"].status == Asset.AssetStatus.AVAILABLE
    assert get_frozen_document(request_obj) is None


def test_mode_off_keeps_rendering_live(world, signing, django_capture_on_commit_callbacks):
    signing.DOCUMENT_SIGNING_MODE = "off"
    request_obj = _processed_return(world, django_capture_on_commit_callbacks)

    assert get_frozen_document(request_obj) is None
    response = _return_pdf(world["employee"], request_obj)
    assert response.status_code == 200 and response.content.startswith(b"%PDF")


# ---------------------------------------------------------------------------
# Return request: download
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("slash", ["", "/"])
def test_return_pdf_serves_the_frozen_copy_without_rendering(world, django_capture_on_commit_callbacks, slash):
    request_obj = _processed_return(world, django_capture_on_commit_callbacks)
    stored = _stored_bytes(get_frozen_document(request_obj))

    for user in (world["employee"], world["hr"]):
        with mock.patch("assets.views._build_return_request_pdf", side_effect=AssertionError("re-rendered")):
            response = _return_pdf(user, request_obj, slash=slash)
        assert response.status_code == 200
        assert response.content == stored
        assert response["Content-Disposition"] == f'attachment; filename="asset_return_request_{request_obj.id}.pdf"'
        assert response["Cache-Control"] == "private, no-store"
    assert DocumentIntegrityEvent.objects.filter(event="downloaded", document__object_id=request_obj.id).count() == 2
    assert (
        AuditLog.objects.filter(action="asset_return_request_exported_pdf", entity_id=str(request_obj.id)).count() == 2
    )


def test_packet_without_an_invoice_is_the_plain_frozen_copy(world, django_capture_on_commit_callbacks):
    request_obj = _processed_return(world, django_capture_on_commit_callbacks)

    response = _return_pdf(world["employee"], request_obj, "?packet=1")

    assert response.status_code == 200
    assert response.content == _stored_bytes(get_frozen_document(request_obj))
    assert AuditLog.objects.filter(action="asset_return_request_exported_pdf", entity_id=str(request_obj.id)).exists()


def test_name_and_asset_changes_after_processing_do_not_change_the_document(world, django_capture_on_commit_callbacks):
    request_obj = _processed_return(world, django_capture_on_commit_callbacks)
    before = _return_pdf(world["employee"], request_obj).content

    # The generic asset form prints the user's full_name; the trail uses the profile name.
    hr = world["hr"]
    hr.full_name = "Renamed Hr"
    hr.save(update_fields=["full_name"])
    profile = hr.employee_profile
    profile.full_name_en = "Renamed Hr"
    profile.full_name = "Renamed Hr"
    profile.save(update_fields=["full_name_en", "full_name", "updated_at"])
    asset = world["asset"]
    asset.name_en = "Renamed Laptop"
    asset.save()

    after = _return_pdf(world["employee"], request_obj).content
    assert after == before
    assert "Renamed Hr" not in _pdf_text(after)
    assert "Renamed Laptop" not in _pdf_text(after)


def test_in_progress_return_requests_still_render_live(world, django_capture_on_commit_callbacks):
    request_obj = _approve_return(
        world, _submit_return(world, django_capture_on_commit_callbacks), django_capture_on_commit_callbacks
    )
    with mock.patch("assets.views._build_return_request_pdf", return_value=b"%PDF-live") as render:
        response = _return_pdf(world["hr"], request_obj, "?workpaper=1")

    assert response.status_code == 200
    assert response.content == b"%PDF-live"
    render.assert_called_once()


def test_hr_work_paper_appends_a_live_trail_in_the_viewers_timezone(world, django_capture_on_commit_callbacks):
    request_obj = _processed_return(world, django_capture_on_commit_callbacks)
    document = get_frozen_document(request_obj)

    paper = _return_pdf(world["hr"], request_obj, "?workpaper=1&tz=Pacific/Auckland")
    text = _pdf_text(paper.content)
    assert paper["Content-Disposition"] == f'attachment; filename="asset_return_request_{request_obj.id}_workpaper.pdf"'
    assert "Approval Trail" in text
    for name in ("Employee Ezz", "Manager Maha", "Hr Huda", "Asset received", "Processed"):
        assert name in text
    assert "+13" not in text and "+12" not in text and "UTC" not in text

    owner = _return_pdf(world["employee"], request_obj, "?workpaper=1")
    assert "Approval Trail" not in _pdf_text(owner.content)
    assert crypto.sha256_hex(owner.content) == document.sha256


def test_tampered_or_missing_file_is_detected_and_never_served(world, django_capture_on_commit_callbacks):
    request_obj = _processed_return(world, django_capture_on_commit_callbacks)
    document = get_frozen_document(request_obj)
    _overwrite_stored(document, _tamper(_stored_bytes(document)))

    hr = _client(world["hr"])
    base = f"/api/assets/return-requests/{request_obj.id}/integrity/"
    assert hr.get(base).data["data"]["status"] == "tampered"
    verify = hr.post(f"{base}verify/")
    assert verify.status_code == 200
    assert verify.data["data"]["status"] == "tampered"
    assert verify.data["data"]["events"][0]["event"] == "verified"
    for slash in ("", "/"):
        with mock.patch("assets.views._build_return_request_pdf", side_effect=AssertionError("re-rendered")):
            assert _return_pdf(world["employee"], request_obj, slash=slash).status_code == 409
    assert AuditLog.objects.filter(
        action="document_download_blocked", entity="asset_return_request", entity_id=str(request_obj.id)
    ).exists()
    assert not AuditLog.objects.filter(
        action="asset_return_request_exported_pdf", entity_id=str(request_obj.id)
    ).exists()

    document.file.storage.delete(document.file.name)
    assert hr.get(base).data["data"]["status"] == "missing_file"


def test_return_requests_processed_before_rollout_report_not_frozen(world):
    request_obj = AssetReturnRequest.objects.create(
        asset=world["asset"],
        employee=world["employee"].employee_profile,
        note="Old",
        status=ReturnStatus.PROCESSED,
    )

    data = _client(world["employee"]).get(f"/api/assets/return-requests/{request_obj.id}/integrity/").data["data"]

    assert data["status"] == "not_frozen"
    assert data["sha256"] is None and data["frozen_at"] is None
    assert data["events"] == []
    assert set(data) == PAYLOAD_KEYS


def test_frozen_return_request_verifies_clean(world, django_capture_on_commit_callbacks):
    request_obj = _processed_return(world, django_capture_on_commit_callbacks)

    url = f"/api/assets/return-requests/{request_obj.id}/integrity/verify"
    data = _client(world["employee"]).post(url).data["data"]

    assert data["status"] == "frozen_valid"
    assert data["sha256"] == get_frozen_document(request_obj).sha256
    assert {e["event"] for e in data["events"]} >= {"frozen", "verified"}
    assert data["events"][0]["by"] == "Employee Ezz"
    assert all("by_profile_id" not in e for e in data["events"]), "profile ids are for HR only"


# ---------------------------------------------------------------------------
# Return request: permissions
# ---------------------------------------------------------------------------


def test_return_integrity_is_visible_to_owner_approvers_and_hr_only(world, django_capture_on_commit_callbacks):
    request_obj = _processed_return(world, django_capture_on_commit_callbacks)
    url = f"/api/assets/return-requests/{request_obj.id}/integrity/"

    for user in ("employee", "manager", "hr"):
        assert _client(world[user]).get(url).status_code == 200, user
    assert _client(world["ceo"]).get(url).status_code == 404, "the CEO did not decide this request"
    assert _client(world["outsider"]).get(url).status_code == 404
    assert _client(world["outsider"]).post(f"{url}verify/").status_code == 404
    assert APIClient().get(url).status_code == 401
    assert _client(world["manager"]).post(f"{url}retry-seal/").status_code == 403
    assert _client(world["employee"]).post(f"{url}retry-seal/").status_code == 403
    assert _client(world["hr"]).post(f"{url}retry-seal/").status_code == 422, "frozen, not sealing"
    assert _client(world["hr"]).get("/api/assets/return-requests/999999/integrity/").status_code == 404

    hr_events = _client(world["hr"]).get(url).data["data"]["events"]
    assert hr_events and "by_profile_id" in hr_events[0]
    # The PDF itself stays owner/HR only, as before.
    assert _return_pdf(world["manager"], request_obj).status_code == 404


def test_hr_of_another_company_gets_404(world, django_capture_on_commit_callbacks):
    request_obj = _processed_return(world, django_capture_on_commit_callbacks)
    report = _approved_damage(world, django_capture_on_commit_callbacks)
    other = OrganizationNode.objects.create(code="DA-OTHER", name="Other Co", node_type="company")
    foreign_hr = User.objects.create_user(email="da-foreign-hr@ffi.test", password="pw")
    _profile(foreign_hr, other, "DAS-FHR", name="Foreign Hr")
    foreign_hr.groups.add(Group.objects.get(name="HRManager"))
    UserOrganizationAccess.objects.create(user=foreign_hr, organization=other)
    client = _client(foreign_hr)
    headers = {"HTTP_X_ACTIVE_COMPANY_ID": str(other.pk)}

    assert client.get(f"/api/assets/return-requests/{request_obj.id}/integrity/", **headers).status_code == 404
    assert client.get(f"/api/assets/return-requests/{request_obj.id}/pdf/", **headers).status_code == 404
    assert client.get(f"/api/assets/damage-reports/{report.id}/integrity/", **headers).status_code == 404
    stored = _stored_bytes(get_frozen_document(request_obj))
    assert _upload(foreign_hr, stored).data["data"]["matched_record"] is None


# ---------------------------------------------------------------------------
# Return request: upload verification and signatures
# ---------------------------------------------------------------------------


def test_verify_upload_matches_and_flags_a_return_request(world, django_capture_on_commit_callbacks):
    request_obj = _processed_return(world, django_capture_on_commit_callbacks)
    document = get_frozen_document(request_obj)
    stored = _stored_bytes(document)

    data = _upload(world["hr"], stored).data["data"]
    assert data["matched_record"] == {"type": "asset_return", "id": request_obj.id, "reference": document.reference}
    assert data["integrity"]["status"] == "frozen_valid"

    modified = _upload(world["hr"], _tamper(stored)).data["data"]
    assert modified["matched_record"]["type"] == "asset_return"
    assert modified["integrity"]["status"] == "tampered"

    assert _upload(world["employee"], stored).status_code == 403


def test_verify_upload_matches_an_edited_copy_by_its_visible_public_reference(
    world, django_capture_on_commit_callbacks
):
    """Editors such as Canva drop the hidden metadata; the printed AR- reference still names the request."""

    capture = django_capture_on_commit_callbacks
    requester = User.objects.create_user(email="da-sequential@ffi.test", password="pw")
    _profile(
        requester,
        world["company"],
        "DAV-0001",
        name="Sequential Sara",
        manager_profile=world["manager"].employee_profile,
    )
    AssetAssignment.objects.filter(asset=world["asset"]).update(employee=requester.employee_profile)
    request_obj = _approve_return(world, _submit_return(world, capture, employee=requester), capture)
    _receive_asset(world, capture)
    document = get_frozen_document(request_obj)
    assert document.reference.startswith("AR-DAV-0001"), document.reference

    edited = PdfWriter()
    for page in PdfReader(BytesIO(_stored_bytes(document))).pages:
        edited.add_page(page)
    edited.add_metadata({"/Producer": "Canva"})
    buffer = BytesIO()
    edited.write(buffer)

    data = _upload(world["hr"], buffer.getvalue()).data["data"]
    assert data["matched_record"] == {"type": "asset_return", "id": request_obj.id, "reference": document.reference}
    assert data["integrity"]["status"] == "tampered"


def test_personal_mode_signs_each_return_stage_in_order_then_seals(
    world, signing, dummy_tsa, django_capture_on_commit_callbacks
):
    signing.DOCUMENT_SIGNING_MODE = "personal"
    with mock.patch("core.document_integrity.pdf_signing.build_timestamper", return_value=dummy_tsa):
        request_obj = _processed_return(world, django_capture_on_commit_callbacks)

    document = get_frozen_document(request_obj)
    assert document.seal_status == FrozenDocument.SealStatus.SEALED
    statuses = _validate_with_dev_root(_stored_bytes(document))
    assert len(statuses) == 5, "employee, manager, HR, HR receipt, then the seal"
    assert all(s.intact and s.valid for s in statuses)

    url = f"/api/assets/return-requests/{request_obj.id}/integrity/"
    data = _client(world["hr"]).get(url).data["data"]
    assert data["status"] == "signed_valid"
    assert [s["role"] for s in data["signatures"]] == ["employee", "line_manager", "hr", "asset_received"]
    assert [s["signer_name"] for s in data["signatures"]] == ["Employee Ezz", "Manager Maha", "Hr Huda", "Hr Huda"]
    assert all(s.get("profile_id") for s in data["signatures"]), "HR sees profile ids"
    owner = _client(world["employee"]).get(url).data["data"]
    assert all("profile_id" not in s for s in owner["signatures"])


def test_service_level_processing_freezes_once(world, django_capture_on_commit_callbacks):
    capture = django_capture_on_commit_callbacks
    request_obj = _approve_return(world, _submit_return(world, capture), capture)
    with capture(execute=True):
        mark_return_request_processed(request_obj, actor=world["hr"])

    document = get_frozen_document(request_obj)
    assert document is not None and document.version == 1


# ---------------------------------------------------------------------------
# Damage report
# ---------------------------------------------------------------------------


def test_damage_report_is_frozen_when_the_ceo_approves(world, django_capture_on_commit_callbacks):
    capture = django_capture_on_commit_callbacks
    report = _pending_ceo_damage(world, capture)
    assert get_frozen_document(report) is None

    with capture(execute=True):
        response = _client(world["ceo"]).post(
            f"/api/ceo/assets/damage-reports/{report.id}/approve/", {"comment": "Repair it"}
        )
    assert response.status_code == 200
    assert response.data["data"]["status"] == DamageStatus.APPROVED
    report.refresh_from_db()
    assert report.ceo_decision_by_id == world["ceo"].id and report.ceo_decision_note == "Repair it"
    assert AuditLog.objects.filter(action="asset_damage_report_approved_ceo", entity_id=str(report.id)).exists()

    document = get_frozen_document(report)
    assert document is not None
    assert document.document_type == "asset_damage_report"
    assert document.reference == str(report.id)
    stored = _stored_bytes(document)
    with mock.patch("assets.views._build_damage_report_pdf", side_effect=AssertionError("re-rendered")):
        for slash in ("", "/"):
            for user in (world["employee"], world["hr"]):
                assert _damage_pdf(user, report, slash=slash).content == stored
    assert AuditLog.objects.filter(action="asset_damage_report_exported_pdf", entity_id=str(report.id)).count() == 4

    paper = _pdf_text(_damage_pdf(world["hr"], report, "?workpaper=1&tz=Asia/Riyadh").content)
    assert "Approval Trail" in paper and "Employee Ezz" in paper and "Ceo Celine" in paper and "Reported" in paper


def test_damage_report_rejection_and_second_approval_do_not_freeze(world, django_capture_on_commit_callbacks):
    capture = django_capture_on_commit_callbacks
    report = _pending_ceo_damage(world, capture)
    with capture(execute=True):
        response = _client(world["ceo"]).post(
            f"/api/ceo/assets/damage-reports/{report.id}/reject/", {"comment": "Wear and tear"}
        )
    assert response.status_code == 200
    report.refresh_from_db()
    assert report.status == DamageStatus.REJECTED
    assert get_frozen_document(report) is None

    from assets.services.damage_reports import AssetDamageTransitionError

    with pytest.raises(AssetDamageTransitionError):
        approve_damage_report_by_ceo(report, actor=world["ceo"])
    report.refresh_from_db()
    assert report.status == DamageStatus.REJECTED


def test_damage_finalize_failure_never_undoes_the_approval(world, django_capture_on_commit_callbacks):
    capture = django_capture_on_commit_callbacks
    report = _pending_ceo_damage(world, capture)
    with mock.patch("core.document_integrity.services.finalize_document", side_effect=RuntimeError("disk full")):
        with capture(execute=True):
            approve_damage_report_by_ceo(report, actor=world["ceo"])

    report.refresh_from_db()
    assert report.status == DamageStatus.APPROVED
    assert get_frozen_document(report) is None
    assert _damage_pdf(world["employee"], report).status_code == 200, "renders live"


def test_damage_integrity_permissions_and_verify_upload(world, django_capture_on_commit_callbacks):
    report = _approved_damage(world, django_capture_on_commit_callbacks)
    url = f"/api/assets/damage-reports/{report.id}/integrity/"

    for user in ("employee", "ceo", "hr"):
        assert _client(world[user]).get(url).status_code == 200, user
    assert _client(world["manager"]).get(url).status_code == 404
    assert _client(world["outsider"]).get(url).status_code == 404
    assert APIClient().get(url).status_code == 401
    assert _client(world["ceo"]).post(f"{url}retry-seal/").status_code == 403
    assert _client(world["hr"]).post(f"{url}retry-seal").status_code == 422
    assert _client(world["ceo"]).post(f"{url}verify/").data["data"]["status"] == "frozen_valid"

    document = get_frozen_document(report)
    stored = _stored_bytes(document)
    data = _upload(world["hr"], stored).data["data"]
    assert data["matched_record"] == {"type": "asset_damage", "id": report.id, "reference": str(report.id)}
    assert data["integrity"]["status"] == "frozen_valid"
    assert _upload(world["hr"], _tamper(stored)).data["data"]["integrity"]["status"] == "tampered"


def test_damage_seal_mode_applies_a_timestamped_organization_seal(
    world, signing, dummy_tsa, django_capture_on_commit_callbacks
):
    signing.DOCUMENT_SIGNING_MODE = "personal"
    with mock.patch("core.document_integrity.pdf_signing.build_timestamper", return_value=dummy_tsa):
        report = _approved_damage(world, django_capture_on_commit_callbacks)

    document = get_frozen_document(report)
    assert document.seal_status == FrozenDocument.SealStatus.SEALED
    data = _client(world["employee"]).get(f"/api/assets/damage-reports/{report.id}/integrity/").data["data"]
    assert data["status"] == "signed_valid"
    assert data["seal"]["timestamped"] is True
    assert [s["role"] for s in data["signatures"]] == ["employee", "ceo"]
