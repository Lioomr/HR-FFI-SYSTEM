"""Approved loan PDFs are frozen, sealed, signed and verifiable.

Mirrors ``leaves/tests/test_document_integrity.py`` for the loan workflow: the
PDF is frozen once, when the disbursement (the last column on the form) moves
the loan to ``approved``; every PDF alias serves that copy; tampering is
detected and never served; HR alone gets the approval-trail work paper; the
integrity endpoints answer only the people involved (or HR in the company);
verify-upload names the loan.
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
from pypdf import PdfReader
from rest_framework.test import APIClient

from audit.models import AuditLog
from core.document_integrity import crypto
from core.document_integrity.backends import get_signing_backend
from core.document_integrity.models import DocumentIntegrityEvent, FrozenDocument
from core.document_integrity.services import get_frozen_document
from core.tests_pdf_forms import make_png
from employees.models import EmployeeProfile
from loans.models import LoanRequest
from loans.services import (
    apply_ceo_approval,
    apply_ceo_referral,
    apply_cfo_approval,
    apply_disbursement,
    apply_hr_recommendation,
    apply_manager_recommendation,
    record_loan_submission,
)
from organization.models import OrganizationNode, UserOrganizationAccess
from organization.services import get_default_company

pytestmark = pytest.mark.django_db

User = get_user_model()
Status = LoanRequest.RequestStatus
Recommendation = LoanRequest.Recommendation
FERNET_KEY = Fernet.generate_key().decode()
PDF_ALIASES = ("loan-requests", "hr/loan-requests")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def signing_key_dir(tmp_path_factory):
    return tmp_path_factory.mktemp("loan_signing_keys")


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
        subject=crypto.build_name("Loan Test TSA"),
        public_key=key.public_key(),
        issuer_cert=None,
        issuer_key=key,
        days=30,
        extended_usages=[ExtendedKeyUsageOID.TIME_STAMPING],
    )
    return timestamps.DummyTimeStamper(tsa_cert=crypto.to_asn1_cert(cert), tsa_key=crypto.to_asn1_key(key))


def _profile(user, company, employee_id, *, name, manager_profile=None, signed=True):
    profile = EmployeeProfile.objects.create(
        user=user,
        company=company,
        employee_id=employee_id,
        full_name=name,
        full_name_en=name,
        department="Finance",
        job_title="Staff",
        hire_date=date(2021, 1, 1),
        manager_profile=manager_profile,
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

    def make(key, name, **kwargs):
        user = User.objects.create_user(email=f"dl-{key}@ffi.test", password="pw")
        _profile(user, company, f"DL-{key.upper()}", name=name, **kwargs)
        return user

    manager = make("manager", "Manager Maha")
    employee = make("employee", "Employee Ezz", manager_profile=manager.employee_profile)
    hr = make("hr", "Hr Huda")
    hr.groups.add(hr_group)
    UserOrganizationAccess.objects.create(user=hr, organization=company)
    return {
        "company": company,
        "manager": manager,
        "employee": employee,
        "hr": hr,
        "cfo": make("cfo", "Cfo Cyrus"),
        "ceo": make("ceo", "Ceo Celine"),
        "accountant": make("accountant", "Accountant Adel"),
        "outsider": make("outsider", "Outsider Omar"),
    }


def _submit(world, capture):
    with capture(execute=True):
        loan = LoanRequest.objects.create(
            employee=world["employee"],
            employee_profile=world["employee"].employee_profile,
            company=world["company"],
            requested_amount=Decimal("2400.00"),
            loan_type=LoanRequest.LoanType.INSTALLMENT,
            installment_months=6,
            reason="Car repair",
            status=Status.PENDING_MANAGER,
        )
        record_loan_submission(loan, actor=world["employee"])
    return loan


def _approve_to_disbursement(world, loan, capture):
    with capture(execute=True):
        loan, _ = apply_manager_recommendation(loan, actor=world["manager"], recommendation=Recommendation.APPROVE)
    with capture(execute=True):
        loan = apply_hr_recommendation(loan, actor=world["hr"], recommendation=Recommendation.APPROVE)
    with capture(execute=True):
        loan = apply_cfo_approval(loan, actor=world["cfo"])
    return loan


def _approve_all(world, loan, capture):
    loan = _approve_to_disbursement(world, loan, capture)
    with capture(execute=True):
        loan = apply_disbursement(loan, actor=world["accountant"], note="Paid")
    loan.refresh_from_db()
    return loan


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
    assert b"/Producer" in data
    return data.replace(b"/Producer", b"/Producar", 1)


def _pdf_text(data: bytes) -> str:
    return "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(data)).pages)


def _download(user, loan, prefix="loan-requests", query=""):
    return _client(user).get(f"/api/loans/{prefix}/{loan.id}/pdf/{query}")


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


def test_loan_is_frozen_only_when_disbursement_completes_the_form(world, django_capture_on_commit_callbacks):
    loan = _approve_to_disbursement(
        world, _submit(world, django_capture_on_commit_callbacks), django_capture_on_commit_callbacks
    )
    assert loan.status == Status.PENDING_DISBURSEMENT
    assert get_frozen_document(loan) is None, "approved but not disbursed: the form still has a pending column"

    with django_capture_on_commit_callbacks(execute=True):
        loan = apply_disbursement(loan, actor=world["accountant"])

    document = get_frozen_document(loan)
    assert loan.status == Status.APPROVED
    assert document is not None
    assert document.document_type == "loan_request"
    assert document.signing_mode == "freeze"
    data = _stored_bytes(document)
    assert crypto.sha256_hex(data) == document.sha256
    assert DocumentIntegrityEvent.objects.filter(document=document, event="frozen").count() == 1
    assert AuditLog.objects.filter(action="document_frozen", entity="loan_request", entity_id=str(loan.id)).exists()
    assert "Approval Trail" not in _pdf_text(data)
    assert PdfReader(BytesIO(data)).metadata["/FFIDocumentRef"] == f"loan_request:{loan.id}:{document.reference}"


def test_ceo_referral_route_is_frozen_at_disbursement(world, django_capture_on_commit_callbacks):
    capture = django_capture_on_commit_callbacks
    loan = _submit(world, capture)
    with capture(execute=True):
        loan, _ = apply_manager_recommendation(loan, actor=world["manager"], recommendation=Recommendation.REJECT)
    with capture(execute=True):
        loan = apply_hr_recommendation(loan, actor=world["hr"], recommendation=Recommendation.APPROVE)
    with capture(execute=True):
        loan = apply_ceo_referral(loan, actor=world["cfo"], comment="Above my limit")
    with capture(execute=True):
        loan = apply_ceo_approval(loan, actor=world["ceo"])
    assert get_frozen_document(loan) is None
    with capture(execute=True):
        loan = apply_disbursement(loan, actor=world["accountant"])

    assert get_frozen_document(loan) is not None
    paper = _download(world["hr"], loan, query="?workpaper=1").content
    text = _pdf_text(paper)
    assert "Referred" in text and "Rejected" in text and "Disbursed" in text and "Ceo Celine" in text


def test_finalize_failure_never_undoes_the_disbursement(world, django_capture_on_commit_callbacks):
    loan = _approve_to_disbursement(
        world, _submit(world, django_capture_on_commit_callbacks), django_capture_on_commit_callbacks
    )
    with mock.patch("core.document_integrity.services.finalize_document", side_effect=RuntimeError("disk full")):
        with django_capture_on_commit_callbacks(execute=True):
            apply_disbursement(loan, actor=world["accountant"])

    loan.refresh_from_db()
    assert loan.status == Status.APPROVED
    assert get_frozen_document(loan) is None


def test_mode_off_keeps_rendering_live(world, signing, django_capture_on_commit_callbacks):
    signing.DOCUMENT_SIGNING_MODE = "off"
    loan = _approve_all(world, _submit(world, django_capture_on_commit_callbacks), django_capture_on_commit_callbacks)

    assert get_frozen_document(loan) is None


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("prefix", PDF_ALIASES)
@pytest.mark.parametrize("trailing_slash", ["", "/"])
def test_every_pdf_alias_serves_the_frozen_copy_without_rendering(
    world, django_capture_on_commit_callbacks, prefix, trailing_slash
):
    loan = _approve_all(world, _submit(world, django_capture_on_commit_callbacks), django_capture_on_commit_callbacks)
    stored = _stored_bytes(get_frozen_document(loan))

    for user in (world["employee"], world["hr"]):
        with mock.patch("loans.views._build_loan_request_pdf", side_effect=AssertionError("re-rendered")):
            response = _client(user).get(f"/api/loans/{prefix}/{loan.id}/pdf{trailing_slash}")
        assert response.status_code == 200
        assert response.content == stored
        assert response["Content-Disposition"] == f'attachment; filename="loan_request_{loan.id}.pdf"'
        assert response["Cache-Control"] == "private, no-store"
    assert DocumentIntegrityEvent.objects.filter(event="downloaded", document__object_id=loan.id).count() == 2
    assert AuditLog.objects.filter(action="loan_request_exported_pdf", entity_id=str(loan.id)).count() == 2


def test_signature_change_after_approval_does_not_change_the_document(world, django_capture_on_commit_callbacks):
    loan = _approve_all(world, _submit(world, django_capture_on_commit_callbacks), django_capture_on_commit_callbacks)
    before = _download(world["employee"], loan).content

    profile = world["cfo"].employee_profile
    profile.signature.save("replacement.png", ContentFile(make_png(width=300, height=90)), save=False)
    profile.full_name_en = "Renamed Cfo"
    profile.save(update_fields=["signature", "full_name_en", "updated_at"])

    after = _download(world["employee"], loan).content
    assert after == before
    assert "Renamed Cfo" not in _pdf_text(after)


def test_in_progress_loans_still_render_live(world, django_capture_on_commit_callbacks):
    loan = _approve_to_disbursement(
        world, _submit(world, django_capture_on_commit_callbacks), django_capture_on_commit_callbacks
    )
    with mock.patch("loans.views._build_loan_request_pdf", return_value=b"%PDF-live") as render:
        response = _download(world["employee"], loan, query="?workpaper=1")

    assert response.status_code == 200
    assert response.content == b"%PDF-live"
    render.assert_called_once()


def test_hr_work_paper_appends_a_live_trail_in_the_viewers_timezone(world, django_capture_on_commit_callbacks):
    loan = _approve_all(world, _submit(world, django_capture_on_commit_callbacks), django_capture_on_commit_callbacks)
    document = get_frozen_document(loan)

    for prefix in PDF_ALIASES:
        paper = _download(world["hr"], loan, prefix, "?workpaper=1&tz=Pacific/Auckland")
        text = _pdf_text(paper.content)
        assert paper["Content-Disposition"] == f'attachment; filename="loan_request_{loan.id}_workpaper.pdf"'
        assert "Approval Trail" in text
        for name in ("Employee Ezz", "Manager Maha", "Hr Huda", "Cfo Cyrus", "Accountant Adel"):
            assert name in text
        assert "+13" not in text and "+12" not in text and "UTC" not in text

    owner = _download(world["employee"], loan, query="?workpaper=1")
    assert "Approval Trail" not in _pdf_text(owner.content)
    assert crypto.sha256_hex(owner.content) == document.sha256


def test_tampered_or_missing_file_is_detected_and_never_served(world, django_capture_on_commit_callbacks):
    loan = _approve_all(world, _submit(world, django_capture_on_commit_callbacks), django_capture_on_commit_callbacks)
    document = get_frozen_document(loan)
    _overwrite_stored(document, _tamper(_stored_bytes(document)))

    hr = _client(world["hr"])
    base = f"/api/loans/loan-requests/{loan.id}/integrity/"
    assert hr.get(base).data["data"]["status"] == "tampered"
    verify = hr.post(f"{base}verify/")
    assert verify.status_code == 200
    assert verify.data["data"]["status"] == "tampered"
    assert verify.data["data"]["events"][0]["event"] == "verified"
    for prefix in PDF_ALIASES:
        with mock.patch("loans.views._build_loan_request_pdf", side_effect=AssertionError("re-rendered")):
            assert _download(world["employee"], loan, prefix).status_code == 409
    assert AuditLog.objects.filter(
        action="document_download_blocked", entity="loan_request", entity_id=str(loan.id)
    ).exists()
    assert not AuditLog.objects.filter(action="loan_request_exported_pdf", entity_id=str(loan.id)).exists()

    document.file.storage.delete(document.file.name)
    assert hr.get(base).data["data"]["status"] == "missing_file"


def test_loans_approved_before_rollout_report_not_frozen(world):
    loan = LoanRequest.objects.create(
        employee=world["employee"],
        employee_profile=world["employee"].employee_profile,
        company=world["company"],
        requested_amount=Decimal("500.00"),
        status=Status.APPROVED,
    )

    data = _client(world["employee"]).get(f"/api/loans/loan-requests/{loan.id}/integrity/").data["data"]

    assert data["status"] == "not_frozen"
    assert data["sha256"] is None and data["frozen_at"] is None
    assert data["events"] == []
    assert set(data) == {"status", "frozen_at", "sha256", "signing_mode", "seal", "signatures", "events"}


def test_frozen_loan_verifies_clean(world, django_capture_on_commit_callbacks):
    loan = _approve_all(world, _submit(world, django_capture_on_commit_callbacks), django_capture_on_commit_callbacks)

    data = _client(world["employee"]).post(f"/api/loans/loan-requests/{loan.id}/integrity/verify/").data["data"]

    assert data["status"] == "frozen_valid"
    assert data["sha256"] == get_frozen_document(loan).sha256
    assert {e["event"] for e in data["events"]} >= {"frozen", "verified"}
    assert data["events"][0]["by"] == "Employee Ezz"
    assert all("by_profile_id" not in e for e in data["events"]), "profile ids are for HR only"


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("prefix", PDF_ALIASES)
def test_integrity_is_visible_to_owner_approvers_and_hr_only(world, django_capture_on_commit_callbacks, prefix):
    loan = _approve_all(world, _submit(world, django_capture_on_commit_callbacks), django_capture_on_commit_callbacks)
    url = f"/api/loans/{prefix}/{loan.id}/integrity/"

    for user in ("employee", "manager", "hr", "cfo", "accountant"):
        assert _client(world[user]).get(url).status_code == 200, user
    assert _client(world["ceo"]).get(url).status_code == 404, "not on this loan's route"
    assert _client(world["outsider"]).get(url).status_code == 404
    assert _client(world["outsider"]).post(f"{url}verify/").status_code == 404
    assert APIClient().get(url).status_code == 401
    assert _client(world["cfo"]).post(f"{url}retry-seal/").status_code == 403
    assert _client(world["employee"]).post(f"{url}retry-seal/").status_code == 403
    assert _client(world["hr"]).post(f"{url}retry-seal/").status_code == 422, "frozen, not sealing"

    hr_events = _client(world["hr"]).get(url).data["data"]["events"]
    assert hr_events and "by_profile_id" in hr_events[0]


def test_hr_of_another_company_gets_404(world, django_capture_on_commit_callbacks):
    loan = _approve_all(world, _submit(world, django_capture_on_commit_callbacks), django_capture_on_commit_callbacks)
    other = OrganizationNode.objects.create(code="DL-OTHER", name="Other Co", node_type="company")
    foreign_hr = User.objects.create_user(email="dl-foreign-hr@ffi.test", password="pw")
    _profile(foreign_hr, other, "DL-FHR", name="Foreign Hr", signed=False)
    foreign_hr.groups.add(Group.objects.get(name="HRManager"))
    UserOrganizationAccess.objects.create(user=foreign_hr, organization=other)
    client = _client(foreign_hr)
    headers = {"HTTP_X_ACTIVE_COMPANY_ID": str(other.pk)}

    assert client.get(f"/api/loans/loan-requests/{loan.id}/integrity/", **headers).status_code == 404
    assert client.get(f"/api/loans/loan-requests/{loan.id}/pdf/", **headers).status_code == 404


# ---------------------------------------------------------------------------
# Upload verification
# ---------------------------------------------------------------------------


def _upload(user, data: bytes):
    return _client(user).post(
        "/api/documents/verify-upload/",
        {"file": SimpleUploadedFile("loan.pdf", data, content_type="application/pdf")},
        format="multipart",
    )


def test_verify_upload_matches_and_flags_a_loan(world, django_capture_on_commit_callbacks):
    loan = _approve_all(world, _submit(world, django_capture_on_commit_callbacks), django_capture_on_commit_callbacks)
    document = get_frozen_document(loan)
    stored = _stored_bytes(document)

    data = _upload(world["hr"], stored).data["data"]
    assert data["matched_record"] == {"type": "loan", "id": loan.id, "reference": document.reference}
    assert data["integrity"]["status"] == "frozen_valid"

    modified = _upload(world["hr"], _tamper(stored)).data["data"]
    assert modified["matched_record"]["type"] == "loan"
    assert modified["integrity"]["status"] == "tampered"


# ---------------------------------------------------------------------------
# Seal and personal signatures
# ---------------------------------------------------------------------------


def test_seal_mode_applies_a_timestamped_organization_seal(
    world, signing, dummy_tsa, django_capture_on_commit_callbacks
):
    signing.DOCUMENT_SIGNING_MODE = "seal"
    with mock.patch("core.document_integrity.pdf_signing.build_timestamper", return_value=dummy_tsa):
        loan = _approve_all(
            world, _submit(world, django_capture_on_commit_callbacks), django_capture_on_commit_callbacks
        )

    document = get_frozen_document(loan)
    assert document.seal_status == FrozenDocument.SealStatus.SEALED
    statuses = _validate_with_dev_root(_stored_bytes(document))
    assert len(statuses) == 1 and statuses[0].intact and statuses[0].valid
    data = _client(world["employee"]).get(f"/api/loans/loan-requests/{loan.id}/integrity/").data["data"]
    assert data["status"] == "sealed_valid"
    assert data["seal"]["timestamped"] is True


def test_personal_mode_signs_each_stage_in_order_then_seals(
    world, signing, dummy_tsa, django_capture_on_commit_callbacks
):
    signing.DOCUMENT_SIGNING_MODE = "personal"
    with mock.patch("core.document_integrity.pdf_signing.build_timestamper", return_value=dummy_tsa):
        loan = _approve_all(
            world, _submit(world, django_capture_on_commit_callbacks), django_capture_on_commit_callbacks
        )

    document = get_frozen_document(loan)
    assert document.seal_status == FrozenDocument.SealStatus.SEALED
    statuses = _validate_with_dev_root(_stored_bytes(document))
    assert len(statuses) == 6, "employee, manager, HR, CFO, disbursement, then the seal"
    assert all(s.intact and s.valid for s in statuses)

    data = _client(world["hr"]).get(f"/api/loans/loan-requests/{loan.id}/integrity/").data["data"]
    assert data["status"] == "signed_valid"
    assert [s["role"] for s in data["signatures"]] == ["employee", "line_manager", "hr", "cfo", "disbursement"]
    assert [s["signer_name"] for s in data["signatures"]] == [
        "Employee Ezz",
        "Manager Maha",
        "Hr Huda",
        "Cfo Cyrus",
        "Accountant Adel",
    ]
    assert all(s.get("profile_id") for s in data["signatures"]), "HR sees profile ids"


def test_verify_upload_matches_an_edited_copy_by_its_visible_public_reference(
    world, django_capture_on_commit_callbacks
):
    """Editors such as Canva drop the hidden metadata; the printed reference still names the loan."""

    capture = django_capture_on_commit_callbacks
    requester = User.objects.create_user(email="dl-sequential@ffi.test", password="pw")
    _profile(
        requester,
        world["company"],
        "DLV-0001",
        name="Sequential Sara",
        manager_profile=world["manager"].employee_profile,
    )
    with capture(execute=True):
        loan = LoanRequest.objects.create(
            employee=requester,
            employee_profile=requester.employee_profile,
            company=world["company"],
            requested_amount=Decimal("900.00"),
            status=Status.PENDING_MANAGER,
        )
        record_loan_submission(loan, actor=requester)
    loan = _approve_all(world, loan, capture)
    document = get_frozen_document(loan)
    assert document.reference.startswith("LN-DLV-0001"), document.reference

    from pypdf import PdfWriter

    edited = PdfWriter()
    for page in PdfReader(BytesIO(_stored_bytes(document))).pages:
        edited.add_page(page)
    edited.add_metadata({"/Producer": "Canva"})
    buffer = BytesIO()
    edited.write(buffer)

    data = _upload(world["hr"], buffer.getvalue()).data["data"]
    assert data["matched_record"] == {"type": "loan", "id": loan.id, "reference": document.reference}
    assert data["integrity"]["status"] == "tampered"
