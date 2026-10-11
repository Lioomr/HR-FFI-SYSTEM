"""Sent job offers and approved starting-work acknowledgements are frozen and verifiable.

Mirrors ``loans/test_document_integrity.py``:

* Job offer: v1 is frozen when HR sends it (and that frozen copy is what the
  candidate receives); the candidate's answer freezes v2. CEO approval alone
  freezes nothing. The candidate's v1 copy still verifies as a superseded version.
* Starting work: frozen at HR approval from the bytes the approval stored; the
  stored ``EmployeeDocument`` is then rewritten with the frozen copy.
"""

from __future__ import annotations

import base64
from datetime import date, timedelta
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
from pypdf import PdfReader, PdfWriter
from rest_framework.test import APIClient

from attendance.models import AttendanceRecord, BioTimeEmployeeMap
from audit.models import AuditLog
from core.document_integrity import crypto
from core.document_integrity.models import DocumentApprovalSignature, DocumentIntegrityEvent, FrozenDocument
from core.document_integrity.services import get_frozen_document
from core.services.workflow_engine import sync_workflow
from core.tests_pdf_forms import make_png
from employees.models import EmployeeProfile
from job_offers.models import JobOffer, StartingWorkAcknowledgment
from job_offers.starting_work_service import (
    approve_starting_work_acknowledgment,
    generate_starting_work_acknowledgment,
    reject_starting_work_acknowledgment,
)
from organization.models import OrganizationNode, UserOrganizationAccess

pytestmark = pytest.mark.django_db

User = get_user_model()
FERNET_KEY = Fernet.generate_key().decode()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def signing_key_dir(tmp_path_factory):
    return tmp_path_factory.mktemp("job_offer_signing_keys")


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
    settings.SECURE_SSL_REDIRECT = False
    settings.FRONTEND_URL = "https://frontend.example.test"
    return settings


@pytest.fixture(scope="session")
def dummy_tsa():
    from pyhanko.sign import timestamps

    key = crypto.generate_key()
    cert = crypto.build_certificate(
        subject=crypto.build_name("Job Offer Test TSA"),
        public_key=key.public_key(),
        issuer_cert=None,
        issuer_key=key,
        days=30,
        extended_usages=[ExtendedKeyUsageOID.TIME_STAMPING],
    )
    return timestamps.DummyTimeStamper(tsa_cert=crypto.to_asn1_cert(cert), tsa_key=crypto.to_asn1_key(key))


def _profile(user, company, employee_id, *, name, signed=True, **extra):
    profile = EmployeeProfile.objects.create(
        user=user,
        company=company,
        employee_id=employee_id,
        full_name=name,
        full_name_en=name,
        employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        **extra,
    )
    if signed:
        profile.signature.save(f"{employee_id}.png", ContentFile(make_png()), save=False)
        profile.signature_uploaded_at = timezone.now()
        profile.save(update_fields=["signature", "signature_uploaded_at", "updated_at"])
    return profile


@pytest.fixture
def world(signing):
    company = OrganizationNode.objects.get(code="FFI")
    hr_group, _ = Group.objects.get_or_create(name="HRManager")
    ceo_group, _ = Group.objects.get_or_create(name="CEO")

    def make(key, name, group=None, signed=True):
        user = User.objects.create_user(email=f"djo-{key}@ffi.test", password="pw", full_name=name)
        if group is not None:
            user.groups.add(group)
        UserOrganizationAccess.objects.create(user=user, organization=company)
        _profile(user, company, f"DJO-{key.upper()}", name=name, signed=signed)
        return user

    return {
        "company": company,
        "hr": make("hr", "Hr Hala", hr_group),
        "sender": make("sender", "Sender Sami", hr_group),
        "ceo": make("ceo", "Ceo Celine", ceo_group),
        "other_ceo": make("ceo2", "Ceo Other", ceo_group),
        "outsider": make("outsider", "Outsider Omar"),
    }


def _client(user, company=None):
    client = APIClient()
    client.force_authenticate(user=user)
    if company is not None:
        client.credentials(HTTP_X_ACTIVE_COMPANY_ID=str(company.pk))
    return client


def _stored_bytes(field_file):
    field_file.open("rb")
    try:
        return field_file.read()
    finally:
        field_file.close()


def _overwrite_stored(document, data: bytes):
    with open(document.file.path, "wb") as handle:
        handle.write(data)


def _tamper(data: bytes) -> bytes:
    assert b"/Producer" in data
    return data.replace(b"/Producer", b"/Producar", 1)


def _pdf_text(data: bytes) -> str:
    return "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(data)).pages)


def _upload(user, data: bytes):
    return _client(user).post(
        "/api/documents/verify-upload/",
        {"file": SimpleUploadedFile("copy.pdf", data, content_type="application/pdf")},
        format="multipart",
    )


# ---------------------------------------------------------------------------
# Job offer helpers
# ---------------------------------------------------------------------------


def _draft_offer(world) -> JobOffer:
    hr = world["hr"]
    offer = JobOffer(
        company=world["company"],
        created_by=hr,
        updated_by=hr,
        hr_signer_user=hr,
        hr_signer_name="Hr Hala",
        hr_signer_title="HR Manager",
        candidate_full_name="Candidate Carla",
        candidate_email="carla@candidate.test",
        candidate_phone_number="+201001112223",
        nationality="Egyptian",
        id_passport_iqama_number="P-778899",
        position_title="Site Engineer",
        department="Projects",
        location="Riyadh",
        basic_salary=Decimal("10000.00"),
        housing_allowance=Decimal("2500.00"),
        transportation_allowance=Decimal("1000.00"),
        other_allowance=Decimal("0.00"),
        total_salary_package=Decimal("13500.00"),
        offer_date=timezone.localdate(),
        expiry_date=timezone.localdate() + timedelta(days=10),
        reference_number=f"JO-DJO-{JobOffer.objects.count() + 1:04d}",
    )
    offer.cv_file.save("carla.pdf", ContentFile(b"%PDF-1.4\n%%EOF"), save=False)
    offer.save()
    sync_workflow(offer, actor=hr, new_request=True)
    return offer


def _approve(world, offer, capture):
    company = world["company"]
    submitted = _client(world["hr"], company).post(f"/job-offers/{offer.id}/submit/", {}, format="json")
    assert submitted.status_code == 200, submitted.data
    with mock.patch("job_offers.views.notify_job_offer_decided", return_value=[]):
        with capture(execute=True):
            approved = _client(world["ceo"], company).post(f"/job-offers/{offer.id}/approve/", {}, format="json")
    assert approved.status_code == 200, approved.data
    offer.refresh_from_db()
    return offer


class _Delivery:
    """Records the PDF bytes sent to the candidate / CEO (no network)."""

    def __init__(self):
        self.whatsapp_pdfs: list[bytes] = []
        self.uploaded_pdfs: list[bytes] = []

    def patches(self):
        whatsapp = mock.MagicMock()
        whatsapp.return_value.send_template_message.return_value = {"success": True}

        def send_document_message(**kwargs):
            self.whatsapp_pdfs.append(base64.b64decode(kwargs["document_base64"]))
            return {"success": True}

        whatsapp.return_value.send_document_message.side_effect = send_document_message
        email = mock.MagicMock()

        def upload_media(**kwargs):
            self.uploaded_pdfs.append(kwargs["content"])
            return {"success": True, "media_url": "https://media.test/offer.pdf"}

        email.return_value.upload_media.side_effect = upload_media
        email.return_value.send_html_email.return_value = {"success": True}
        return (
            mock.patch("job_offers.services.WhatsAppService", whatsapp),
            mock.patch("job_offers.services.EmailService", email),
        )


def _send(world, offer, capture, delivery=None, sender=None):
    delivery = delivery or _Delivery()
    whatsapp_patch, email_patch = delivery.patches()
    with whatsapp_patch, email_patch:
        with capture(execute=True):
            response = _client(sender or world["sender"], world["company"]).post(
                f"/job-offers/{offer.id}/send/", {}, format="json"
            )
    assert response.status_code == 200, response.data
    offer.refresh_from_db()
    return offer, response


def _answer(offer, capture, decision="accepted", reason=""):
    with (
        mock.patch("job_offers.views.create_and_send_employee_invite", return_value=(None, {"created": False})),
        mock.patch("job_offers.views.notify_job_offer_biotime_mapping_missing", return_value=[]),
    ):
        with capture(execute=True):
            response = APIClient().post(
                "/job-offers/respond/",
                {"token": offer.response_token, "decision": decision, "reason": reason},
                format="json",
            )
    assert response.status_code == 200, response.data
    offer.refresh_from_db()
    return offer


def _sent_offer(world, capture, delivery=None):
    offer = _approve(world, _draft_offer(world), capture)
    offer, _ = _send(world, offer, capture, delivery)
    return offer


# ---------------------------------------------------------------------------
# Job offer: freeze points and versions
# ---------------------------------------------------------------------------


def test_ceo_approval_does_not_freeze_send_freezes_v1_and_the_candidate_gets_it(
    world, django_capture_on_commit_callbacks
):
    capture = django_capture_on_commit_callbacks
    offer = _approve(world, _draft_offer(world), capture)
    assert offer.approval_status == JobOffer.ApprovalStatus.APPROVED
    assert get_frozen_document(offer) is None, "approved but unsent: send date and HR signer still change"

    delivery = _Delivery()
    offer, response = _send(world, offer, capture, delivery)

    document = get_frozen_document(offer)
    assert document is not None and document.version == 1
    assert document.document_type == "job_offer"
    assert document.reference == offer.reference_number
    stored = _stored_bytes(document.file)
    assert crypto.sha256_hex(stored) == document.sha256
    assert PdfReader(BytesIO(stored)).metadata["/FFIDocumentRef"] == f"job_offer:{offer.id}:{offer.reference_number}"
    # Candidate WhatsApp + email upload are the frozen bytes, not a live render.
    assert delivery.whatsapp_pdfs and all(pdf == stored for pdf in delivery.whatsapp_pdfs)
    assert delivery.uploaded_pdfs == [stored]
    assert response.data["data"]["delivery"]["pdf"] == {"frozen": True, "version": 1, "sha256": document.sha256}
    assert AuditLog.objects.filter(action="document_frozen", entity="job_offer", entity_id=str(offer.id)).exists()


@pytest.mark.parametrize(
    ("decision", "label"),
    [("accepted", "Accepted"), ("rejected", "Declined")],
)
def test_candidate_answer_refreezes_v2_and_keeps_v1_hash(world, django_capture_on_commit_callbacks, decision, label):
    capture = django_capture_on_commit_callbacks
    offer = _sent_offer(world, capture)
    v1 = get_frozen_document(offer)
    v1_sha = v1.sha256

    offer = _answer(offer, capture, decision, reason="Relocating" if decision == "rejected" else "")

    document = get_frozen_document(offer)
    assert document.version == 2
    assert document.sha256 != v1_sha
    refreeze = DocumentIntegrityEvent.objects.filter(document=document, event="frozen").order_by("-id").first()
    assert refreeze.metadata["previous_sha256"] == v1_sha
    assert refreeze.metadata["previous_version"] == 1
    assert refreeze.actor is None, "the candidate is external"
    paper = _client(world["hr"], world["company"]).get(f"/job-offers/{offer.id}/pdf/?workpaper=1").content
    text = _pdf_text(paper)
    assert "Candidate" in text and label in text and "Sent" in text and "Ceo Celine" in text


def test_finalize_failure_never_undoes_send_or_answer(world, django_capture_on_commit_callbacks):
    capture = django_capture_on_commit_callbacks
    offer = _approve(world, _draft_offer(world), capture)
    delivery = _Delivery()
    with mock.patch("core.document_integrity.services.finalize_document", side_effect=RuntimeError("disk full")):
        offer, response = _send(world, offer, capture, delivery)
        assert offer.status == JobOffer.Status.SENT
        assert get_frozen_document(offer) is None
        # Nothing frozen: the candidate still receives a (live) PDF.
        assert delivery.whatsapp_pdfs and response.data["data"]["delivery"]["pdf"]["frozen"] is False
        offer = _answer(offer, capture)
    assert offer.status == JobOffer.Status.ACCEPTED
    assert get_frozen_document(offer) is None


def test_mode_off_freezes_nothing(world, signing, django_capture_on_commit_callbacks):
    signing.DOCUMENT_SIGNING_MODE = "off"
    offer = _answer(_sent_offer(world, django_capture_on_commit_callbacks), django_capture_on_commit_callbacks)
    assert get_frozen_document(offer) is None


def test_cancelling_a_sent_offer_keeps_the_frozen_copy(world, django_capture_on_commit_callbacks):
    offer = _sent_offer(world, django_capture_on_commit_callbacks)
    stored = _stored_bytes(get_frozen_document(offer).file)
    hr = _client(world["hr"], world["company"])
    assert hr.post(f"/job-offers/{offer.id}/cancel/", {}, format="json").status_code == 200
    with mock.patch("job_offers.views.build_job_offer_pdf", side_effect=AssertionError("re-rendered")):
        assert hr.get(f"/job-offers/{offer.id}/pdf/").content == stored


# ---------------------------------------------------------------------------
# Job offer: download
# ---------------------------------------------------------------------------


def test_pdf_serves_the_frozen_copy_without_rendering(world, django_capture_on_commit_callbacks):
    offer = _sent_offer(world, django_capture_on_commit_callbacks)
    stored = _stored_bytes(get_frozen_document(offer).file)

    for user in ("hr", "ceo"):
        with mock.patch("job_offers.views.build_job_offer_pdf", side_effect=AssertionError("re-rendered")):
            response = _client(world[user], world["company"]).get(f"/job-offers/{offer.id}/pdf/")
        assert response.status_code == 200, user
        assert response.content == stored
        assert response["Content-Disposition"] == f'attachment; filename="job-offer-{offer.reference_number}.pdf"'
        assert response["Cache-Control"] == "private, no-store"
    assert AuditLog.objects.filter(action="job_offer_pdf_downloaded", entity_id=str(offer.id)).count() == 2
    assert DocumentIntegrityEvent.objects.filter(event="downloaded", document__object_id=offer.id).count() == 2


def test_signature_change_after_send_does_not_change_the_document(world, django_capture_on_commit_callbacks):
    offer = _sent_offer(world, django_capture_on_commit_callbacks)
    hr = _client(world["hr"], world["company"])
    before = hr.get(f"/job-offers/{offer.id}/pdf/").content

    profile = world["ceo"].employee_profile
    profile.signature.save("replacement.png", ContentFile(make_png(width=300, height=90)), save=False)
    profile.full_name_en = "Renamed Ceo"
    profile.save(update_fields=["signature", "full_name_en", "updated_at"])
    world["ceo"].full_name = "Renamed Ceo"
    world["ceo"].save(update_fields=["full_name"])

    after = hr.get(f"/job-offers/{offer.id}/pdf/").content
    assert after == before
    assert "Renamed Ceo" not in _pdf_text(after)


def test_unsent_offers_still_render_live(world, django_capture_on_commit_callbacks):
    offer = _approve(world, _draft_offer(world), django_capture_on_commit_callbacks)
    with mock.patch("job_offers.views.build_job_offer_pdf", return_value=b"%PDF-live") as render:
        response = _client(world["hr"], world["company"]).get(f"/job-offers/{offer.id}/pdf/?workpaper=1")
    assert response.status_code == 200
    assert response.content == b"%PDF-live"
    render.assert_called_once()


def test_hr_work_paper_in_the_viewers_timezone_and_ceo_gets_the_plain_copy(world, django_capture_on_commit_callbacks):
    offer = _sent_offer(world, django_capture_on_commit_callbacks)
    document = get_frozen_document(offer)

    paper = _client(world["hr"], world["company"]).get(f"/job-offers/{offer.id}/pdf/?workpaper=1&tz=Pacific/Auckland")
    text = _pdf_text(paper.content)
    assert paper["Content-Disposition"] == f'attachment; filename="job-offer-{offer.reference_number}_workpaper.pdf"'
    assert "Approval Trail" in text and "Ceo Celine" in text and "Sender Sami" in text
    assert "+13" not in text and "+12" not in text and "UTC" not in text

    ceo = _client(world["ceo"], world["company"]).get(f"/job-offers/{offer.id}/pdf/?workpaper=1")
    assert "Approval Trail" not in _pdf_text(ceo.content)
    assert crypto.sha256_hex(ceo.content) == document.sha256


def test_tampered_or_missing_offer_is_detected_and_never_served_or_sent(world, django_capture_on_commit_callbacks):
    from job_offers.services import deliver_job_offer

    offer = _sent_offer(world, django_capture_on_commit_callbacks)
    document = get_frozen_document(offer)
    _overwrite_stored(document, _tamper(_stored_bytes(document.file)))
    hr = _client(world["hr"], world["company"])
    base = f"/job-offers/{offer.id}/integrity/"

    assert hr.get(base).data["data"]["status"] == "tampered"
    verify = hr.post(f"{base}verify/")
    assert verify.status_code == 200 and verify.data["data"]["status"] == "tampered"
    with mock.patch("job_offers.views.build_job_offer_pdf", side_effect=AssertionError("re-rendered")):
        assert hr.get(f"/job-offers/{offer.id}/pdf/").status_code == 409
    assert AuditLog.objects.filter(action="document_download_blocked", entity="job_offer").exists()
    assert not AuditLog.objects.filter(action="job_offer_pdf_downloaded", entity_id=str(offer.id)).exists()

    delivery = _Delivery()
    whatsapp_patch, email_patch = delivery.patches()
    with whatsapp_patch, email_patch, mock.patch("job_offers.pdf.build_job_offer_pdf", side_effect=AssertionError):
        metadata = deliver_job_offer(offer)
    assert delivery.whatsapp_pdfs == [] and delivery.uploaded_pdfs == []
    assert metadata["candidate"]["whatsapp_pdf"]["sent"] is False

    document.file.storage.delete(document.file.name)
    assert hr.get(base).data["data"]["status"] == "missing_file"


def test_offers_sent_before_rollout_report_not_frozen(world):
    offer = _draft_offer(world)
    JobOffer.objects.filter(pk=offer.pk).update(status=JobOffer.Status.SENT, sent_at=timezone.now())

    data = _client(world["hr"], world["company"]).get(f"/job-offers/{offer.id}/integrity/").data["data"]

    assert data["status"] == "not_frozen"
    assert data["sha256"] is None and data["frozen_at"] is None and data["events"] == []
    assert set(data) == {"status", "frozen_at", "sha256", "signing_mode", "seal", "signatures", "events"}


# ---------------------------------------------------------------------------
# Job offer: permissions
# ---------------------------------------------------------------------------


def test_job_offer_integrity_access(world, django_capture_on_commit_callbacks):
    offer = _sent_offer(world, django_capture_on_commit_callbacks)
    url = f"/job-offers/{offer.id}/integrity/"

    for user in ("hr", "ceo", "sender"):
        assert _client(world[user]).get(url).status_code == 200, user
    assert _client(world["sender"]).post(f"{url}verify/").status_code == 200
    assert _client(world["other_ceo"]).get(url).status_code == 404, "a CEO who did not decide it"
    assert _client(world["outsider"]).get(url).status_code == 404
    assert _client(world["outsider"]).post(f"{url}verify/").status_code == 404
    anonymous = APIClient()
    assert anonymous.get(url).status_code == 401
    assert anonymous.post(f"{url}verify/").status_code == 401
    assert anonymous.get(url, {"token": offer.response_token}).status_code == 401, "the candidate token opens nothing"
    assert _client(world["ceo"]).post(f"{url}retry-seal/").status_code == 403
    assert _client(world["hr"]).post(f"{url}retry-seal/").status_code == 422, "frozen, not sealing"

    hr_events = _client(world["hr"]).get(url).data["data"]["events"]
    assert hr_events and "by_profile_id" in hr_events[0]
    ceo_events = _client(world["ceo"]).get(url).data["data"]["events"]
    assert all("by_profile_id" not in event for event in ceo_events), "profile ids are for HR only"


def test_hr_of_another_company_gets_404(world, django_capture_on_commit_callbacks):
    offer = _sent_offer(world, django_capture_on_commit_callbacks)
    other = OrganizationNode.objects.create(code="DJO-OTHER", name="Other Co", node_type="company")
    foreign_hr = User.objects.create_user(email="djo-foreign-hr@ffi.test", password="pw")
    _profile(foreign_hr, other, "DJO-FHR", name="Foreign Hr", signed=False)
    foreign_hr.groups.add(Group.objects.get(name="HRManager"))
    UserOrganizationAccess.objects.create(user=foreign_hr, organization=other)
    client = _client(foreign_hr, other)

    assert client.get(f"/job-offers/{offer.id}/integrity/").status_code == 404
    assert client.get(f"/job-offers/{offer.id}/pdf/").status_code == 404
    assert _upload(foreign_hr, _stored_bytes(get_frozen_document(offer).file)).data["data"]["matched_record"] is None


# ---------------------------------------------------------------------------
# Job offer: upload verification
# ---------------------------------------------------------------------------


def test_verify_upload_matches_offer_versions(world, django_capture_on_commit_callbacks):
    capture = django_capture_on_commit_callbacks
    delivery = _Delivery()
    offer = _sent_offer(world, capture, delivery)
    candidate_copy = delivery.whatsapp_pdfs[0]

    data = _upload(world["hr"], candidate_copy).data["data"]
    assert data["matched_record"] == {"type": "job_offer", "id": offer.id, "reference": offer.reference_number}
    assert data["integrity"]["status"] == "frozen_valid"

    offer = _answer(offer, capture)
    current = _stored_bytes(get_frozen_document(offer).file)
    assert _upload(world["hr"], current).data["data"]["matched_record"] == {
        "type": "job_offer",
        "id": offer.id,
        "reference": offer.reference_number,
    }

    # The candidate's v1 copy is genuine but superseded - not "tampered".
    old = _upload(world["hr"], candidate_copy).data["data"]
    assert old["matched_record"] == {
        "type": "job_offer",
        "id": offer.id,
        "reference": offer.reference_number,
        "superseded_version": 1,
    }
    assert old["integrity"]["status"] == "frozen_valid"
    assert "earlier approved version" in old["summary"]

    modified = _upload(world["hr"], _tamper(candidate_copy)).data["data"]
    assert modified["matched_record"]["type"] == "job_offer"
    assert modified["integrity"]["status"] == "tampered"


# ---------------------------------------------------------------------------
# Job offer: seal and personal signatures
# ---------------------------------------------------------------------------


def test_personal_mode_signs_ceo_and_sender_and_skips_the_candidate(
    world, signing, dummy_tsa, django_capture_on_commit_callbacks
):
    capture = django_capture_on_commit_callbacks
    signing.DOCUMENT_SIGNING_MODE = "personal"
    delivery = _Delivery()
    with mock.patch("core.document_integrity.pdf_signing.build_timestamper", return_value=dummy_tsa):
        offer = _sent_offer(world, capture, delivery)
        v1 = get_frozen_document(offer)
        assert v1.seal_status == FrozenDocument.SealStatus.SEALED
        # The candidate gets the v1 frozen copy: sealed in production (the seal runs inline right
        # after the freeze); here the test transaction defers the seal until after delivery.
        assert delivery.whatsapp_pdfs[0] in {_stored_bytes(v1.file), _stored_bytes(v1.unsigned_file)}
        offer = _answer(offer, capture)

    roles = list(
        DocumentApprovalSignature.objects.filter(object_id=offer.id, document_type="job_offer").values_list(
            "role", flat=True
        )
    )
    assert sorted(roles) == ["ceo", "hr"]
    data = _client(world["hr"]).get(f"/job-offers/{offer.id}/integrity/").data["data"]
    assert data["status"] == "signed_valid"
    assert [s["role"] for s in data["signatures"]] == ["ceo", "hr"]
    assert [s["signer_name"] for s in data["signatures"]] == ["Ceo Celine", "Sender Sami"]
    assert data["seal"]["timestamped"] is True

    old = _upload(world["hr"], delivery.whatsapp_pdfs[0]).data["data"]
    assert old["matched_record"]["superseded_version"] == 1
    assert old["integrity"]["status"] in {"frozen_valid", "signed_valid"}


# ---------------------------------------------------------------------------
# Starting work
# ---------------------------------------------------------------------------


@pytest.fixture
def starting(world):
    company = world["company"]
    employee = User.objects.create_user(email="djo-starter@ffi.test", password="pw", full_name="Starter Sana")
    profile = _profile(
        employee,
        company,
        "DJO-STARTER",
        name="Starter Sana",
        signed=False,
        department="Operations",
        job_title="Operator",
        hire_date=date(2026, 8, 1),
    )
    mapping = BioTimeEmployeeMap.objects.create(employee_profile=profile, biotime_emp_code="DJO100")
    JobOffer.objects.create(
        company=company,
        employee_profile=profile,
        candidate_full_name="Starter Sana",
        position_title="Operator",
        offer_date=date(2026, 7, 1),
        expiry_date=date(2026, 7, 8),
        reference_number="JO-DJO-SW-0001",
        hr_signer_user=world["hr"],
        hr_signer_name="Hr Hala",
        status=JobOffer.Status.ACCEPTED,
        accepted_at=timezone.now(),
        created_by=world["hr"],
        updated_by=world["hr"],
    )
    record = AttendanceRecord.objects.create(
        employee_profile=profile,
        date=date(2026, 8, 1),
        source=AttendanceRecord.Source.SYSTEM,
        status=AttendanceRecord.Status.PRESENT,
        biotime_emp_code=mapping.biotime_emp_code,
    )
    with mock.patch("job_offers.starting_work_service.notify_starting_work_acknowledgment_ready", return_value=[]):
        acknowledgment = generate_starting_work_acknowledgment(record)
    assert acknowledgment is not None
    return {"employee": employee, "acknowledgment": acknowledgment}


def _approve_ack(world, acknowledgment, capture, approver=None):
    with capture(execute=True):
        response = _client(approver or world["hr"], world["company"]).post(
            f"/starting-work-acknowledgments/{acknowledgment.id}/approve/", {}, format="json"
        )
    assert response.status_code == 200, response.data
    acknowledgment.refresh_from_db()
    return acknowledgment


def test_starting_work_is_frozen_at_hr_approval_and_the_stored_document_matches(
    world, starting, django_capture_on_commit_callbacks
):
    acknowledgment = starting["acknowledgment"]
    assert get_frozen_document(acknowledgment) is None, "pending HR"

    with mock.patch(
        "job_offers.starting_work_pdf.build_starting_work_acknowledgment_pdf", side_effect=AssertionError("rebuilt")
    ):
        acknowledgment = _approve_ack(world, acknowledgment, django_capture_on_commit_callbacks)

    document = get_frozen_document(acknowledgment)
    assert document is not None and document.document_type == "starting_work_acknowledgment"
    assert document.reference == acknowledgment.reference_number
    frozen = _stored_bytes(document.file)
    assert "Hr Hala" in _pdf_text(frozen), "the approval rendered the approver into the form"
    employee_document = acknowledgment.document
    employee_document.refresh_from_db()
    assert _stored_bytes(employee_document.file) == frozen
    assert employee_document.extracted_fields["frozen_sha256"] == document.sha256
    assert employee_document.extracted_fields["hr_only"] is True

    response = _client(world["hr"], world["company"]).get(f"/starting-work-acknowledgments/{acknowledgment.id}/pdf/")
    assert response.status_code == 200
    assert response.content == frozen
    assert response["Content-Type"] == "application/pdf"
    assert AuditLog.objects.filter(
        action="starting_work_acknowledgment_pdf_downloaded", entity_id=str(acknowledgment.id)
    ).exists()

    data = _upload(world["hr"], frozen).data["data"]
    assert data["matched_record"] == {
        "type": "starting_work",
        "id": acknowledgment.id,
        "reference": acknowledgment.reference_number,
    }
    assert data["integrity"]["status"] == "frozen_valid"


def test_rejected_then_approved_is_frozen_only_at_approval(world, starting, django_capture_on_commit_callbacks):
    acknowledgment = starting["acknowledgment"]
    with django_capture_on_commit_callbacks(execute=True):
        reject_starting_work_acknowledgment(acknowledgment, world["hr"], "Check punches")
    assert get_frozen_document(acknowledgment) is None
    with django_capture_on_commit_callbacks(execute=True):
        acknowledgment = approve_starting_work_acknowledgment(acknowledgment, world["hr"])
    assert get_frozen_document(acknowledgment) is not None


def test_pending_starting_work_serves_the_stored_file(world, starting):
    acknowledgment = starting["acknowledgment"]
    stored = _stored_bytes(acknowledgment.document.file)
    response = _client(world["hr"], world["company"]).get(f"/starting-work-acknowledgments/{acknowledgment.id}/pdf/")
    assert response.status_code == 200 and response.content == stored


def test_starting_work_finalize_failure_never_undoes_the_approval(world, starting, django_capture_on_commit_callbacks):
    acknowledgment = starting["acknowledgment"]
    with mock.patch("core.document_integrity.services.finalize_document", side_effect=RuntimeError("disk full")):
        acknowledgment = _approve_ack(world, acknowledgment, django_capture_on_commit_callbacks)
    assert acknowledgment.status == StartingWorkAcknowledgment.Status.APPROVED
    assert get_frozen_document(acknowledgment) is None


def test_starting_work_tamper_access_and_work_paper(world, starting, django_capture_on_commit_callbacks):
    acknowledgment = _approve_ack(world, starting["acknowledgment"], django_capture_on_commit_callbacks)
    url = f"/starting-work-acknowledgments/{acknowledgment.id}/integrity/"
    hr = _client(world["hr"], world["company"])

    assert hr.get(url).data["data"]["status"] == "frozen_valid"
    assert _client(world["sender"]).get(url).status_code == 200, "any HR in the company"
    assert _client(starting["employee"]).get(url).status_code == 404, "HR-only document"
    assert _client(world["ceo"]).get(url).status_code == 404
    assert APIClient().get(url).status_code == 401
    assert _client(world["ceo"]).post(f"{url}retry-seal/").status_code == 403

    paper = hr.get(f"/starting-work-acknowledgments/{acknowledgment.id}/pdf/?workpaper=1&tz=Pacific/Auckland")
    text = _pdf_text(paper.content)
    assert "Approval Trail" in text and "Generated" in text and "Hr Hala" in text
    assert "+13" not in text and "UTC" not in text
    assert paper["Content-Disposition"].endswith('_workpaper.pdf"')

    document = get_frozen_document(acknowledgment)
    _overwrite_stored(document, _tamper(_stored_bytes(document.file)))
    assert hr.get(url).data["data"]["status"] == "tampered"
    assert hr.get(f"/starting-work-acknowledgments/{acknowledgment.id}/pdf/").status_code == 409


def test_starting_work_seal_mode_stores_the_sealed_copy_in_employee_documents(
    world, signing, dummy_tsa, starting, django_capture_on_commit_callbacks
):
    signing.DOCUMENT_SIGNING_MODE = "personal"
    with mock.patch("core.document_integrity.pdf_signing.build_timestamper", return_value=dummy_tsa):
        acknowledgment = _approve_ack(world, starting["acknowledgment"], django_capture_on_commit_callbacks)

    document = get_frozen_document(acknowledgment)
    assert document.seal_status == FrozenDocument.SealStatus.SEALED
    acknowledgment.document.refresh_from_db()
    assert _stored_bytes(acknowledgment.document.file) == _stored_bytes(document.file)
    data = (
        _client(world["hr"], world["company"])
        .get(f"/starting-work-acknowledgments/{acknowledgment.id}/integrity/")
        .data["data"]
    )
    assert data["status"] == "signed_valid"
    assert [s["role"] for s in data["signatures"]] == ["hr"], "the system generation row is not a signer"


def test_edited_copy_without_metadata_is_matched_by_reference_or_unmatched(
    world, starting, django_capture_on_commit_callbacks
):
    acknowledgment = _approve_ack(world, starting["acknowledgment"], django_capture_on_commit_callbacks)
    edited = PdfWriter()
    for page in PdfReader(BytesIO(_stored_bytes(get_frozen_document(acknowledgment).file))).pages:
        edited.add_page(page)
    edited.add_metadata({"/Producer": "Canva"})
    buffer = BytesIO()
    edited.write(buffer)

    data = _upload(world["hr"], buffer.getvalue()).data["data"]
    # Never reported as the genuine document.
    assert data["integrity"]["status"] in {"tampered", "not_frozen"}
