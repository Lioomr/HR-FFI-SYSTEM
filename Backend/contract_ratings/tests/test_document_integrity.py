"""The CEO's contract-rating decision copy is frozen and verifiable (option B).

Mirrors ``loans/test_document_integrity.py`` / ``assets/test_document_integrity.py``
for the one document a contract rating freezes: the decision copy HR and the
CEO download (manager rating + recommendation), frozen when the CEO's decision
makes the rating ``DECIDED``. The employee and manager copies are confidential
per-audience renders: they stay live and never reach the integrity endpoints.
Access follows ``viewer_role`` exactly - and the rated person never reaches the
decision copy, whatever role they hold.
"""

from __future__ import annotations

from io import BytesIO
from unittest import mock

import pytest
from cryptography.fernet import Fernet
from cryptography.x509.oid import ExtendedKeyUsageOID
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from pyhanko.sign import timestamps
from pypdf import PdfReader
from rest_framework.test import APIClient

from audit.models import AuditLog
from contract_ratings.models import ContractRating
from contract_ratings.pdf import build_contract_rating_pdf
from contract_ratings.serializers import RETURN_TO_MANAGER
from contract_ratings.services import (
    ensure_contract_rating,
    request_hr_comment,
    submit_ceo_decision,
    submit_hr_comment,
    submit_hr_gate_decision,
)
from core.document_integrity import crypto
from core.document_integrity.models import DocumentIntegrityEvent, FrozenDocument
from core.document_integrity.services import get_frozen_document
from employees.models import EmployeeProfile
from organization.models import UserOrganizationAccess

from .test_final_phase2 import pending_ceo

pytestmark = pytest.mark.django_db

FERNET_KEY = Fernet.generate_key().decode()
PAYLOAD_KEYS = {"status", "frozen_at", "sha256", "signing_mode", "seal", "signatures", "events"}
NAMES = {
    "employee": "Employee Eman",
    "manager": "Manager Majed",
    "hr": "Hr Hala",
    "ceo": "Ceo Camil",
    "admin": "Admin Adel",
}


# ---------------------------------------------------------------------------
# Fixtures and helpers
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def signing_key_dir(tmp_path_factory):
    return tmp_path_factory.mktemp("contract_rating_signing_keys")


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
    key = crypto.generate_key()
    cert = crypto.build_certificate(
        subject=crypto.build_name("Contract Rating Test TSA"),
        public_key=key.public_key(),
        issuer_cert=None,
        issuer_key=key,
        days=30,
        extended_usages=[ExtendedKeyUsageOID.TIME_STAMPING],
    )
    return timestamps.DummyTimeStamper(tsa_cert=crypto.to_asn1_cert(cert), tsa_key=crypto.to_asn1_key(key))


@pytest.fixture
def cr(world, signing):
    """The shared contract-rating world with readable names on the forms and trail."""

    for role, name in NAMES.items():
        user = getattr(world, role)
        user.full_name = name
        user.save(update_fields=["full_name"])
        EmployeeProfile.objects.filter(user=user).update(full_name=name, full_name_en=name)
    world.profile.refresh_from_db()
    return world


def _client(world, user):
    client = APIClient()
    client.credentials(HTTP_X_ACTIVE_COMPANY_ID=str(world.company.id))
    if user is not None:
        client.force_authenticate(user=user)
    return client


def _decide(world, capture, *, comment_requested=True, decision="TERMINATE"):
    rating = pending_ceo(world)
    if comment_requested:
        request_hr_comment(rating.pk, actor=world.ceo)
    with capture(execute=True):
        submit_ceo_decision(rating.pk, actor=world.ceo, ceo_decision=decision, comment="Decided")
    rating.refresh_from_db()
    return rating


def _pdf(world, user, rating, query=""):
    return _client(world, user).get(f"/contract-ratings/{rating.pk}/pdf/{query}")


def _integrity(world, user, rating, suffix="", method="get"):
    return getattr(_client(world, user), method)(f"/contract-ratings/{rating.pk}/integrity/{suffix}")


def _upload(world, user, data: bytes):
    return _client(world, user).post(
        "/api/documents/verify-upload/",
        {"file": SimpleUploadedFile("rating.pdf", data, content_type="application/pdf")},
        format="multipart",
    )


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


def _make_hr_approver(user):
    user.groups.add(Group.objects.get_or_create(name="HRManager")[0])


# ---------------------------------------------------------------------------
# Freeze
# ---------------------------------------------------------------------------


def test_decision_copy_is_frozen_only_when_the_ceo_decides(cr, django_capture_on_commit_callbacks):
    capture = django_capture_on_commit_callbacks
    rating = pending_ceo(cr)
    with capture(execute=True):
        request_hr_comment(rating.pk, actor=cr.ceo)
    with capture(execute=True):
        submit_hr_comment(rating.pk, actor=cr.hr, comment="Advisory")
    assert get_frozen_document(rating) is None, "pending CEO: still live"

    with capture(execute=True):
        submit_ceo_decision(rating.pk, actor=cr.ceo, ceo_decision="RENEW", comment="Proceed")
    rating.refresh_from_db()

    assert rating.status == ContractRating.Status.DECIDED
    document = get_frozen_document(rating)
    assert document is not None and document.version == 1
    assert document.document_type == "contract_rating"
    assert document.company_id == cr.company.id
    assert document.reference.startswith("CR-")
    data = _stored_bytes(document)
    assert crypto.sha256_hex(data) == document.sha256
    assert PdfReader(BytesIO(data)).metadata["/FFIDocumentRef"] == f"contract_rating:{rating.pk}:{document.reference}"
    assert DocumentIntegrityEvent.objects.filter(document=document, event="frozen").count() == 1
    assert AuditLog.objects.filter(
        action="document_frozen", entity="contract_rating", entity_id=str(rating.pk)
    ).exists()
    text = _pdf_text(data)
    assert "Approval Trail" not in text
    for name in ("Employee Eman", "Manager Majed", "Hr Hala", "Ceo Camil"):
        assert name in text, name


def test_the_frozen_copy_is_the_decision_render(cr, django_capture_on_commit_callbacks):
    with mock.patch("contract_ratings.views.build_contract_rating_pdf", wraps=build_contract_rating_pdf) as build:
        rating = _decide(cr, django_capture_on_commit_callbacks)

    freeze_calls = [call for call in build.call_args_list if call.kwargs.get("include_decision")]
    assert len(freeze_calls) == 1
    assert freeze_calls[0].kwargs["response"] == rating.manager_response
    assert all(call.kwargs.get("include_decision") for call in build.call_args_list), "never a rater copy"


def test_returns_and_pending_states_never_freeze(cr, django_capture_on_commit_callbacks):
    rating = pending_ceo(cr)
    with django_capture_on_commit_callbacks(execute=True):
        submit_ceo_decision(rating.pk, actor=cr.ceo, ceo_decision=RETURN_TO_MANAGER, comment="Redo")
    rating.refresh_from_db()
    assert rating.status == ContractRating.Status.WAITING_MANAGER
    assert get_frozen_document(rating) is None


def test_skip_to_ceo_decision_is_frozen_without_a_manager_stage(cr, django_capture_on_commit_callbacks):
    rating, _ = ensure_contract_rating(cr.profile)
    submit_hr_gate_decision(rating.pk, actor=cr.hr, rating_mode=ContractRating.RatingMode.SKIP_TO_CEO)
    with django_capture_on_commit_callbacks(execute=True):
        submit_ceo_decision(rating.pk, actor=cr.ceo, ceo_decision="TERMINATE", comment="End")
    rating.refresh_from_db()

    assert get_frozen_document(rating) is not None
    paper = _pdf_text(_pdf(cr, cr.ceo, rating).content)
    assert "Approval Trail" not in paper, "the CEO gets the plain copy"


def test_finalize_failure_never_undoes_the_decision(cr, django_capture_on_commit_callbacks):
    with mock.patch("core.document_integrity.services.finalize_document", side_effect=RuntimeError("disk full")):
        rating = _decide(cr, django_capture_on_commit_callbacks)

    assert rating.status == ContractRating.Status.DECIDED
    assert get_frozen_document(rating) is None
    assert _pdf(cr, cr.ceo, rating).status_code == 200, "renders live"


def test_missing_template_is_logged_never_raised(cr, django_capture_on_commit_callbacks):
    unavailable = ValueError("The approved employee evaluation PDF template is unavailable.")
    with mock.patch("contract_ratings.views.build_contract_rating_pdf", side_effect=unavailable):
        rating = _decide(cr, django_capture_on_commit_callbacks)
        assert rating.status == ContractRating.Status.DECIDED
        assert get_frozen_document(rating) is None
        response = _pdf(cr, cr.ceo, rating)
    assert response.status_code == 503, "the existing live-render error, unchanged"


def test_mode_off_keeps_rendering_live(cr, signing, django_capture_on_commit_callbacks):
    signing.DOCUMENT_SIGNING_MODE = "off"
    rating = _decide(cr, django_capture_on_commit_callbacks)

    assert get_frozen_document(rating) is None
    response = _pdf(cr, cr.hr, rating)
    assert response.status_code == 200 and response.content.startswith(b"%PDF")


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------


def test_hr_and_ceo_get_the_frozen_copy_without_rendering(cr, django_capture_on_commit_callbacks):
    rating = _decide(cr, django_capture_on_commit_callbacks)
    stored = _stored_bytes(get_frozen_document(rating))

    for user in (cr.hr, cr.ceo, cr.admin):
        with mock.patch("contract_ratings.views.build_contract_rating_pdf", side_effect=AssertionError("re-rendered")):
            response = _pdf(cr, user, rating)
        assert response.status_code == 200, user
        assert response.content == stored
        assert response["Content-Type"] == "application/pdf"
        assert response["Content-Disposition"].startswith('attachment; filename="contract_rating_CR-')
        assert response["Cache-Control"] == "private, no-store"
    assert DocumentIntegrityEvent.objects.filter(event="downloaded", document__object_id=rating.pk).count() == 3


def test_employee_and_manager_copies_stay_live_and_unfrozen(cr, django_capture_on_commit_callbacks):
    rating = _decide(cr, django_capture_on_commit_callbacks)
    stored = _stored_bytes(get_frozen_document(rating))

    for user, response_row in ((cr.employee, rating.employee_response), (cr.manager, rating.manager_response)):
        with mock.patch("contract_ratings.views.build_contract_rating_pdf", return_value=b"%PDF-live") as build:
            response = _pdf(cr, user, rating)
        assert response.status_code == 200
        assert response.content == b"%PDF-live"
        assert build.call_args.kwargs == {"response": response_row, "include_decision": False}
        real = _pdf(cr, user, rating).content
        assert real != stored and "/FFIDocumentRef" not in str(PdfReader(BytesIO(real)).metadata or {})
    assert not DocumentIntegrityEvent.objects.filter(event="downloaded").exists()

    # A later name change alters the live rater copies, never the decision copy.
    before_employee = _pdf(cr, cr.employee, rating).content
    cr.manager.full_name = "Renamed Manager"
    cr.manager.save(update_fields=["full_name"])
    assert "Renamed Manager" in _pdf_text(_pdf(cr, cr.employee, rating).content)
    assert _pdf(cr, cr.employee, rating).content != before_employee
    assert _pdf(cr, cr.ceo, rating).content == stored


def test_in_progress_ratings_still_render_live_for_the_ceo(cr):
    rating = pending_ceo(cr)
    with mock.patch("contract_ratings.views.build_contract_rating_pdf", return_value=b"%PDF-live") as build:
        response = _pdf(cr, cr.ceo, rating, "?workpaper=1")
    assert response.status_code == 200 and response.content == b"%PDF-live"
    assert build.call_args.kwargs["include_decision"] is True


def test_hr_work_paper_appends_a_live_trail_in_the_viewers_timezone(cr, django_capture_on_commit_callbacks):
    capture = django_capture_on_commit_callbacks
    rating = pending_ceo(cr)
    request_hr_comment(rating.pk, actor=cr.ceo)
    submit_hr_comment(rating.pk, actor=cr.hr, comment="Advisory")
    with capture(execute=True):
        submit_ceo_decision(rating.pk, actor=cr.ceo, ceo_decision="TERMINATE", comment="End")
    document = get_frozen_document(rating)

    paper = _pdf(cr, cr.hr, rating, "?workpaper=1&tz=Pacific/Auckland")
    text = _pdf_text(paper.content)
    assert paper["Content-Disposition"].endswith('_workpaper.pdf"')
    assert "Approval Trail" in text
    for value in ("Manager Majed", "Hr Hala", "Ceo Camil", "Rated", "Commented", "Decided"):
        assert value in text, value
    assert "+13" not in text and "+12" not in text and "UTC" not in text

    ceo_copy = _pdf(cr, cr.ceo, rating, "?workpaper=1")
    assert "Approval Trail" not in _pdf_text(ceo_copy.content), "work paper is HR only"
    assert crypto.sha256_hex(ceo_copy.content) == document.sha256


def test_tampered_or_missing_file_is_detected_and_never_served(cr, django_capture_on_commit_callbacks):
    rating = _decide(cr, django_capture_on_commit_callbacks)
    document = get_frozen_document(rating)
    _overwrite_stored(document, _tamper(_stored_bytes(document)))

    assert _integrity(cr, cr.hr, rating).data["data"]["status"] == "tampered"
    verify = _integrity(cr, cr.ceo, rating, "verify/", "post")
    assert verify.status_code == 200 and verify.data["data"]["status"] == "tampered"
    assert verify.data["data"]["events"][0]["event"] == "verified"
    for user in (cr.hr, cr.ceo):
        with mock.patch("contract_ratings.views.build_contract_rating_pdf", side_effect=AssertionError("re-rendered")):
            assert _pdf(cr, user, rating).status_code == 409
    assert AuditLog.objects.filter(
        action="document_download_blocked", entity="contract_rating", entity_id=str(rating.pk)
    ).exists()
    # The raters' live copies are not the frozen document and keep working.
    assert _pdf(cr, cr.employee, rating).status_code == 200
    assert _pdf(cr, cr.manager, rating).status_code == 200

    document.file.storage.delete(document.file.name)
    assert _integrity(cr, cr.hr, rating).data["data"]["status"] == "missing_file"


def test_ratings_decided_before_rollout_report_not_frozen(cr):
    rating = pending_ceo(cr)
    submit_ceo_decision(rating.pk, actor=cr.ceo, ceo_decision="TERMINATE", comment="Old")  # on_commit never runs

    data = _integrity(cr, cr.ceo, rating).data["data"]
    assert data["status"] == "not_frozen"
    assert data["sha256"] is None and data["frozen_at"] is None and data["events"] == []
    assert set(data) == PAYLOAD_KEYS


def test_frozen_decision_copy_verifies_clean(cr, django_capture_on_commit_callbacks):
    rating = _decide(cr, django_capture_on_commit_callbacks)

    data = _integrity(cr, cr.ceo, rating, "verify/", "post").data["data"]
    assert data["status"] == "frozen_valid"
    assert data["sha256"] == get_frozen_document(rating).sha256
    assert {event["event"] for event in data["events"]} >= {"frozen", "verified"}
    assert data["events"][0]["by"] == "Ceo Camil"
    assert all("by_profile_id" not in event for event in data["events"]), "profile ids are for HR only"
    hr_events = _integrity(cr, cr.hr, rating).data["data"]["events"]
    assert hr_events and "by_profile_id" in hr_events[0]


# ---------------------------------------------------------------------------
# Access (privacy)
# ---------------------------------------------------------------------------


def test_integrity_follows_viewer_role_exactly(cr, django_capture_on_commit_callbacks):
    rating = _decide(cr, django_capture_on_commit_callbacks)

    for user in (cr.hr, cr.ceo, cr.admin):
        assert _integrity(cr, user, rating).status_code == 200, user.email
    for user in (cr.employee, cr.manager, cr.outsider):
        assert _integrity(cr, user, rating).status_code == 404, user.email
        assert _integrity(cr, user, rating, "verify/", "post").status_code == 404, user.email
    assert _integrity(cr, None, rating).status_code == 401
    assert _integrity(cr, cr.ceo, rating, "retry-seal/", "post").status_code == 403
    assert _integrity(cr, cr.manager, rating, "retry-seal/", "post").status_code == 403
    assert _integrity(cr, cr.hr, rating, "retry-seal/", "post").status_code == 422, "frozen, not sealing"
    assert _client(cr, cr.hr).get("/contract-ratings/999999/integrity/").status_code == 404

    other_ceo = get_user_model().objects.create_user(email="rating-ceo2@example.com", full_name="Other Ceo")
    EmployeeProfile.objects.create(user=other_ceo, company=cr.company, employee_id="RATING-ceo2", full_name="x")
    other_ceo.groups.add(Group.objects.get(name="CEO"))
    UserOrganizationAccess.objects.create(user=other_ceo, organization=cr.company)
    assert _integrity(cr, other_ceo, rating).status_code == 404, "only the deciding CEO"

    foreign = APIClient()
    foreign.credentials(HTTP_X_ACTIVE_COMPANY_ID=str(cr.foreign.id))
    foreign.force_authenticate(cr.foreign_hr)
    assert foreign.get(f"/contract-ratings/{rating.pk}/integrity/").status_code == 404


def test_hr_without_a_ceo_comment_request_has_no_decision_copy(cr, django_capture_on_commit_callbacks):
    rating = _decide(cr, django_capture_on_commit_callbacks, comment_requested=False)
    assert get_frozen_document(rating) is not None

    assert _pdf(cr, cr.hr, rating).status_code == 403, "unchanged gate"
    assert _integrity(cr, cr.hr, rating).status_code == 404
    assert _integrity(cr, cr.hr, rating, "retry-seal/", "post").status_code == 404
    assert _upload(cr, cr.hr, _stored_bytes(get_frozen_document(rating))).data["data"]["matched_record"] is None
    assert _integrity(cr, cr.ceo, rating).status_code == 200


def test_rated_person_with_hr_role_never_reaches_the_decision_copy(cr, django_capture_on_commit_callbacks):
    """Regression: an HR manager rated themselves gets only their own live employee copy."""

    _make_hr_approver(cr.employee)
    rating = _decide(cr, django_capture_on_commit_callbacks)
    stored = _stored_bytes(get_frozen_document(rating))

    with mock.patch("contract_ratings.views.build_contract_rating_pdf", return_value=b"%PDF-own") as build:
        response = _pdf(cr, cr.employee, rating, "?workpaper=1")
    assert response.content == b"%PDF-own"
    assert build.call_args.kwargs == {"response": rating.employee_response, "include_decision": False}
    assert _pdf(cr, cr.employee, rating).content != stored
    for suffix, method in (("", "get"), ("verify/", "post"), ("retry-seal/", "post")):
        assert _integrity(cr, cr.employee, rating, suffix, method).status_code == 404, suffix
    upload = _upload(cr, cr.employee, stored).data["data"]
    assert upload["matched_record"] is None, "verify-upload never names their own rating"
    assert not DocumentIntegrityEvent.objects.filter(event="downloaded").exists()


def test_rated_hr_approver_in_skip_to_ceo_mode_gets_nothing(cr, django_capture_on_commit_callbacks):
    rating, _ = ensure_contract_rating(cr.profile)
    submit_hr_gate_decision(rating.pk, actor=cr.hr, rating_mode=ContractRating.RatingMode.SKIP_TO_CEO)
    request_hr_comment(rating.pk, actor=cr.ceo)
    with django_capture_on_commit_callbacks(execute=True):
        submit_ceo_decision(rating.pk, actor=cr.ceo, ceo_decision="RENEW", comment="Renew")
    _make_hr_approver(cr.employee)

    assert _pdf(cr, cr.employee, rating).status_code == 404
    assert _integrity(cr, cr.employee, rating).status_code == 404
    assert _integrity(cr, cr.hr, rating).status_code == 200


# ---------------------------------------------------------------------------
# Upload verification, late HR comment, signatures
# ---------------------------------------------------------------------------


def test_verify_upload_matches_and_flags_the_decision_copy(cr, django_capture_on_commit_callbacks):
    rating = _decide(cr, django_capture_on_commit_callbacks)
    document = get_frozen_document(rating)
    stored = _stored_bytes(document)

    data = _upload(cr, cr.hr, stored).data["data"]
    assert data["matched_record"] == {"type": "contract_rating", "id": rating.pk, "reference": document.reference}
    assert data["integrity"]["status"] == "frozen_valid"
    modified = _upload(cr, cr.hr, _tamper(stored)).data["data"]
    assert modified["matched_record"]["type"] == "contract_rating"
    assert modified["integrity"]["status"] == "tampered"
    assert _upload(cr, cr.manager, stored).status_code == 403

    foreign = APIClient()
    foreign.credentials(HTTP_X_ACTIVE_COMPANY_ID=str(cr.foreign.id))
    foreign.force_authenticate(cr.foreign_hr)
    upload = foreign.post(
        "/api/documents/verify-upload/",
        {"file": SimpleUploadedFile("rating.pdf", stored, content_type="application/pdf")},
        format="multipart",
    )
    assert upload.data["data"]["matched_record"] is None


def test_late_hr_comment_refreezes_with_the_hr_signer(cr, django_capture_on_commit_callbacks):
    capture = django_capture_on_commit_callbacks
    rating = _decide(cr, capture)
    v1 = _stored_bytes(get_frozen_document(rating))
    assert "Hr Hala" not in _pdf_text(v1)

    with capture(execute=True):
        submit_hr_comment(rating.pk, actor=cr.hr, comment="Late advisory note")
    document = get_frozen_document(rating)
    assert document.version == 2
    assert "Hr Hala" in _pdf_text(_pdf(cr, cr.ceo, rating).content)
    old = _upload(cr, cr.hr, v1).data["data"]
    assert old["matched_record"]["superseded_version"] == 1

    with capture(execute=True):
        submit_hr_comment(rating.pk, actor=cr.hr, comment="Same HR, edited text")
    assert get_frozen_document(rating).version == 2, "same signer: the printed form is unchanged"


def test_personal_mode_signs_manager_hr_and_ceo_in_order_then_seals(
    cr, signing, dummy_tsa, django_capture_on_commit_callbacks
):
    signing.DOCUMENT_SIGNING_MODE = "personal"
    capture = django_capture_on_commit_callbacks
    with mock.patch("core.document_integrity.pdf_signing.build_timestamper", return_value=dummy_tsa):
        with capture(execute=True):
            rating = pending_ceo(cr)
        request_hr_comment(rating.pk, actor=cr.ceo)
        with capture(execute=True):
            submit_hr_comment(rating.pk, actor=cr.hr, comment="Advisory")
        with capture(execute=True):
            submit_ceo_decision(rating.pk, actor=cr.ceo, ceo_decision="TERMINATE", comment="End")

    document = get_frozen_document(rating)
    assert document.seal_status == FrozenDocument.SealStatus.SEALED
    data = _integrity(cr, cr.hr, rating).data["data"]
    assert data["status"] == "signed_valid"
    assert data["seal"]["present"] is True
    assert [row["role"] for row in data["signatures"]] == ["line_manager", "hr", "ceo"]
    assert [row["signer_name"] for row in data["signatures"]] == ["Manager Majed", "Hr Hala", "Ceo Camil"]


def test_recovery_command_freezes_a_decided_rating_only(cr):
    from django.core.management import CommandError, call_command

    rating = pending_ceo(cr)
    with pytest.raises(CommandError, match="final status"):
        call_command("freeze_approved_document", "--type", "contract_rating", "--id", str(rating.pk))

    submit_ceo_decision(rating.pk, actor=cr.ceo, ceo_decision="TERMINATE", comment="End")  # freeze "failed"
    assert get_frozen_document(rating) is None
    call_command("freeze_approved_document", "--type", "contract_rating", "--id", str(rating.pk))
    document = get_frozen_document(rating)
    assert document is not None and document.version == 1
    with pytest.raises(CommandError, match="Already frozen"):
        call_command("freeze_approved_document", "--type", "contract_rating", "--id", str(rating.pk))
