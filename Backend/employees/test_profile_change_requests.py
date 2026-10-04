"""Employee profile change requests: OCR-assisted uploads, one multi-field request, HR decides each item."""

from __future__ import annotations

import datetime
from datetime import timedelta
from unittest import mock

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.contenttypes.models import ContentType
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APIClient

from audit.models import AuditLog
from core.models import DelegationRule, WorkflowInstance
from core.services.workflow_engine import WORKFLOW_TEMPLATES, build_pending_approval_item
from employees import tasks
from employees.models import EmployeeDocument, EmployeeProfile, ProfileChangeAttachment, ProfileChangeRequest
from employees.ocr.engine import OcrEngineUnavailable, OcrLine
from employees.services import profile_change_requests as services
from employees.test_document_extraction import build_mrz
from in_app_notifications.integrations import _company_for_request
from organization.models import OrganizationNode, UserOrganizationAccess

pytestmark = pytest.mark.django_db

MY_URL = "/api/employees/me/profile-change-requests/"
UPLOAD_URL = f"{MY_URL}attachments/"
HR_URL = "/api/employees/profile-change-requests/"
Status = ProfileChangeRequest.Status

PDF = b"%PDF-1.4\n% test passport\n"
SAUDI_ID_TEXT = """
Kingdom of Saudi Arabia
Full Name: SAMPLE EMPLOYEE TESTCASE
Nationality: SAUDI
ID Number: 1234567897
Expiry Date: 21/11/2030
"""


def _pdf(name="passport.pdf"):
    return SimpleUploadedFile(name, PDF, content_type="application/pdf")


@pytest.fixture(autouse=True)
def private_storage(tmp_path, monkeypatch):
    for model in (ProfileChangeAttachment, EmployeeDocument):
        storage = model._meta.get_field("file").storage
        monkeypatch.setattr(storage, "base_location", str(tmp_path))
        monkeypatch.setattr(storage, "location", str(tmp_path))


@pytest.fixture(autouse=True)
def attachment_queue():
    with mock.patch.object(tasks.extract_profile_change_attachment, "apply_async") as apply_async:
        apply_async.return_value = mock.Mock(id="task-1")
        yield apply_async


@pytest.fixture
def notifications():
    with (
        mock.patch.object(services, "notify_users_for_pending_status") as pending,
        mock.patch.object(services, "notify_profile_request_status_whatsapp") as status,
    ):
        yield mock.Mock(pending=pending, status=status)


@pytest.fixture
def ocr():
    with mock.patch.object(services, "queue_document_extraction") as queue:
        yield queue


@pytest.fixture
def world():
    company = OrganizationNode.objects.create(code="PCR-A", name="Profile A", node_type="company")
    foreign = OrganizationNode.objects.create(code="PCR-B", name="Profile B", node_type="company")
    users = {}
    for key in ("employee", "colleague", "hr", "foreign_hr", "delegate"):
        user = get_user_model().objects.create_user(email=f"pcr-{key}@example.com", full_name=key)
        tenant = foreign if key == "foreign_hr" else company
        EmployeeProfile.objects.create(
            user=user,
            company=tenant,
            employee_id=f"PCR-{key}",
            full_name=f"Pcr {key}",
            full_name_en=f"Pcr {key}",
            full_name_ar="اسم",
            employee_number=f"N-{key}",
            nationality="Egypt",
            nationality_en="Egypt",
            mobile="+966500000001",
            date_of_birth=datetime.date(1990, 1, 1),
            date_of_birth_raw="1/1/1990",
            passport_no="OLD12345",
            passport_expiry=datetime.date(2027, 1, 1),
            passport_expiry_raw="01/01/2027",
            national_id="2000000001",
            id_expiry=datetime.date(2028, 1, 1),
            id_expiry_raw="01/01/2028",
        )
        if key in {"hr", "foreign_hr"}:
            user.groups.add(Group.objects.get_or_create(name="HRManager")[0])
            UserOrganizationAccess.objects.create(user=user, organization=tenant)
        users[key] = user
    return {"company": company, "foreign": foreign, **users}


def client_for(user, company):
    client = APIClient()
    client.force_authenticate(user)
    client.credentials(HTTP_X_ACTIVE_COMPANY_ID=str(company.id))
    return client


def _upload(world, user=None, document_type="PASSPORT", file=None):
    client = client_for(user or world["employee"], world["company"])
    return client.post(UPLOAD_URL, {"document_type": document_type, "file": file or _pdf()}, format="multipart")


def _attachment(world, user=None, document_type="PASSPORT"):
    response = _upload(world, user=user, document_type=document_type)
    assert response.status_code == 201, response.data
    return ProfileChangeAttachment.objects.get(pk=response.data["data"]["id"])


def _run_ocr(attachment, text, confidence=0.95):
    lines = [OcrLine(text=line, confidence=confidence) for line in text.splitlines() if line.strip()]
    with mock.patch("employees.ocr.pipeline._document_lines", return_value=(lines, {"source": "image", "pages": 1})):
        return tasks.extract_profile_change_attachment.apply(args=[attachment.pk]).get()


def _submit(world, user=None, items=None, attachment_ids=None, **extra):
    body = {"items": {"mobile": "+966511111111"} if items is None else items, **extra}
    if attachment_ids is not None:
        body["attachment_ids"] = attachment_ids
    return client_for(user or world["employee"], world["company"]).post(MY_URL, body, format="json")


def _submitted(world, **kwargs):
    response = _submit(world, **kwargs)
    assert response.status_code == 201, response.data
    return ProfileChangeRequest.objects.get(pk=response.data["data"]["id"])


def _decide(world, instance, decisions, user=None, company=None, note=None):
    body = {"decisions": decisions}
    if note is not None:
        body["note"] = note
    client = client_for(user or world["hr"], company or world["company"])
    return client.post(f"{HR_URL}{instance.pk}/decide/", body, format="json")


def _approve_all(instance):
    return [{"field": item["field"], "decision": "approve"} for item in instance.items]


def _profile(user):
    return EmployeeProfile.objects.select_related("user").get(user=user)


def _error_fields(response):
    return {item.get("field") for item in response.data["errors"]}


# -- attachments and OCR suggestions ---------------------------------------------------


def test_upload_queues_ocr_after_commit_and_is_owner_only(world, attachment_queue, django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        response = _upload(world)

    assert response.status_code == 201, response.data
    data = response.data["data"]
    assert data == {
        "id": data["id"],
        "document_type": "PASSPORT",
        "original_filename": "passport.pdf",
        "extraction_status": "pending",
        "suggested": {},
        "warnings": [],
        "confidence": None,
    }
    attachment_queue.assert_called_once_with(args=[data["id"]], retry=False)
    assert ProfileChangeAttachment.objects.get(pk=data["id"]).extraction_task_id == "task-1"
    assert AuditLog.objects.filter(action="employee_profile_change_attachment_uploaded").exists()

    mine = client_for(world["employee"], world["company"]).get(f"{UPLOAD_URL}{data['id']}/")
    assert mine.status_code == 200 and mine.data["data"]["id"] == data["id"]
    other = client_for(world["colleague"], world["company"]).get(f"{UPLOAD_URL}{data['id']}/")
    assert other.status_code == 404


def test_queue_failure_marks_attachment_failed(world, attachment_queue, django_capture_on_commit_callbacks):
    attachment_queue.side_effect = RuntimeError("broker down")
    with django_capture_on_commit_callbacks(execute=True):
        response = _upload(world)
    attachment = ProfileChangeAttachment.objects.get(pk=response.data["data"]["id"])
    assert attachment.extraction_status == "failed"
    assert attachment.extraction_warnings == [services.QUEUE_FAILED_WARNING]


@pytest.mark.parametrize(
    ("name", "content", "content_type", "document_type"),
    [
        ("passport.exe", PDF, "application/pdf", "PASSPORT"),
        ("passport.pdf", b"MZ not a pdf", "application/pdf", "PASSPORT"),
        ("passport.pdf", PDF, "image/png", "PASSPORT"),
        ("passport.pdf", PDF, "application/pdf", "IQAMA"),
    ],
)
def test_upload_validation(world, name, content, content_type, document_type):
    response = _upload(world, document_type=document_type, file=SimpleUploadedFile(name, content, content_type))
    assert response.status_code == 422, response.data
    assert not ProfileChangeAttachment.objects.exists()


def test_upload_requires_own_company_and_caps_unused_uploads(world, monkeypatch):
    client = client_for(world["employee"], world["foreign"])
    assert client.post(UPLOAD_URL, {"document_type": "PASSPORT", "file": _pdf()}, format="multipart").status_code == 403
    monkeypatch.setattr(services, "MAX_UNUSED_ATTACHMENTS", 1)
    _attachment(world)
    response = _upload(world)
    assert response.status_code == 422 and _error_fields(response) == {"file"}


def test_passport_ocr_suggests_only_changed_whitelist_fields(world):
    attachment = _attachment(world)
    result = _run_ocr(attachment, build_mrz())
    assert result["status"] == "success"

    data = client_for(world["employee"], world["company"]).get(f"{UPLOAD_URL}{attachment.pk}/").data["data"]
    assert data["extraction_status"] == "success"
    assert data["suggested"]["passport_no"] == "X12345678"
    assert data["suggested"]["passport_expiry"] == "2030-01-01"
    assert data["suggested"]["full_name"]
    # The profile already holds this date of birth, so it is not suggested.
    assert "date_of_birth" not in data["suggested"]
    assert set(data["suggested"]) <= set(services.FIELD_KINDS)
    assert "extraction_raw_text" not in data and "TESTCASE<<" not in str(data)
    assert isinstance(data["confidence"], float)


def test_national_id_ocr_maps_number_and_expiry(world):
    attachment = _attachment(world, document_type="SAUDI_ID")
    _run_ocr(attachment, SAUDI_ID_TEXT)
    data = client_for(world["employee"], world["company"]).get(f"{UPLOAD_URL}{attachment.pk}/").data["data"]
    assert data["suggested"] == {"national_id": "1234567897", "id_expiry": "2030-11-21"}


def test_low_confidence_ocr_is_partial_with_a_warning(world):
    attachment = _attachment(world)
    _run_ocr(attachment, build_mrz(), confidence=0.2)
    data = client_for(world["employee"], world["company"]).get(f"{UPLOAD_URL}{attachment.pk}/").data["data"]
    assert data["extraction_status"] == "partial"
    assert any("confidence" in warning for warning in data["warnings"])
    assert data["suggested"]["passport_no"] == "X12345678"


def test_failed_ocr_suggests_nothing(world):
    attachment = _attachment(world)
    with mock.patch("employees.ocr.pipeline._document_lines", side_effect=OcrEngineUnavailable("missing")):
        tasks.extract_profile_change_attachment.apply(args=[attachment.pk]).get()
    data = client_for(world["employee"], world["company"]).get(f"{UPLOAD_URL}{attachment.pk}/").data["data"]
    assert data["extraction_status"] == "failed"
    assert data["suggested"] == {} and data["warnings"]


# -- submission ---------------------------------------------------------------------------


def test_submit_many_changes_with_ocr_source_and_profile_untouched(
    world, notifications, django_capture_on_commit_callbacks
):
    attachment = _attachment(world)
    _run_ocr(attachment, build_mrz())
    items = {
        "email": "New.Address@Example.com",
        "mobile": "+966 522 222 222",
        "passport_no": "x12345678",
        "passport_expiry": "2030-01-01",
        "nationality": "Egypt",  # unchanged: dropped
    }
    with django_capture_on_commit_callbacks(execute=True):
        response = _submit(world, items=items, attachment_ids=[attachment.pk])

    assert response.status_code == 201, response.data
    data = response.data["data"]
    assert data["status"] == Status.PENDING_HR
    assert data["employee"] == {
        "id": _profile(world["employee"]).pk,
        "full_name": "Pcr employee",
        "employee_number": "N-employee",
    }
    assert data["items"] == [
        {
            "field": "email",
            "old": "pcr-employee@example.com",
            "new": "New.Address@example.com",
            "source": "manual",
            "decision": "pending",
            "note": "",
        },
        {
            "field": "mobile",
            "old": "+966500000001",
            "new": "+966 522 222 222",
            "source": "manual",
            "decision": "pending",
            "note": "",
        },
        {
            "field": "passport_no",
            "old": "OLD12345",
            "new": "X12345678",
            "source": "ocr",
            "decision": "pending",
            "note": "",
        },
        {
            "field": "passport_expiry",
            "old": "2027-01-01",
            "new": "2030-01-01",
            "source": "ocr",
            "decision": "pending",
            "note": "",
        },
        {
            "field": "passport_file",
            "old": None,
            "new": "passport.pdf",
            "source": "manual",
            "decision": "pending",
            "note": "",
        },
    ]
    assert data["attachments"] == [
        {
            "id": attachment.pk,
            "document_type": "PASSPORT",
            "original_filename": "passport.pdf",
            "field": "passport_file",
        }
    ]
    assert data["can_act"] is False and data["workflow"]["can_cancel"] is True
    assert data["workflow"]["current_stage"] == "hr"
    assert [row["action"] for row in data["workflow"]["history"]] == ["submit"]

    profile = _profile(world["employee"])
    assert (profile.mobile, profile.passport_no, profile.user.email) == (
        "+966500000001",
        "OLD12345",
        "pcr-employee@example.com",
    )
    assert not EmployeeDocument.objects.exists()

    notified = notifications.pending.call_args.kwargs
    assert world["hr"] in notified["users"] and world["employee"] not in notified["users"]
    assert world["foreign_hr"] not in notified["users"]
    assert (notified["action_path"], notified["request_type"]) == (
        "/hr/employees/profile-change-requests",
        "Profile Change Request",
    )
    log = AuditLog.objects.get(action="employee_profile_change_submitted")
    assert log.metadata["fields"] == ["email", "mobile", "passport_no", "passport_expiry", "passport_file"]
    assert "X12345678" not in str(log.metadata) and "new.address" not in str(log.metadata).lower()


@pytest.mark.parametrize(
    ("items", "field"),
    [
        ({"hire_date": "2020-01-01"}, "hire_date"),
        ({"passport_file": "x.pdf"}, "passport_file"),
        ({"email": "not-an-email"}, "email"),
        ({"date_of_birth": "01/02/1990"}, "date_of_birth"),
        ({"date_of_birth": "2999-01-01"}, "date_of_birth"),
        ({"passport_issue_date": "2999-01-01"}, "passport_issue_date"),
        ({"national_id": "12345"}, "national_id"),
        ({"passport_no": "AB"}, "passport_no"),
        ({"mobile": "call me"}, "mobile"),
        ({"full_name": "A"}, "full_name"),
        ({"mobile": 966500000002}, "mobile"),
        ({"mobile": ""}, "mobile"),
    ],
)
def test_whitelist_and_value_validation(world, items, field):
    response = _submit(world, items=items)
    assert response.status_code == 422, response.data
    assert field in _error_fields(response)
    assert not ProfileChangeRequest.objects.exists()


def test_unknown_top_level_keys_and_bad_shapes_are_refused(world):
    assert "employee_profile" in _error_fields(_submit(world, employee_profile=99))
    assert _error_fields(_submit(world, items=["mobile"])) == {"items"}
    response = _submit(world, attachment_ids=["1"])
    assert response.status_code == 422 and _error_fields(response) == {"attachment_ids"}


def test_submission_needs_a_real_change(world):
    response = _submit(world, items={"mobile": "+966500000001", "email": "PCR-EMPLOYEE@example.com"})
    assert response.status_code == 422 and _error_fields(response) == {"items"}
    assert _submit(world, items={}).status_code == 422


def test_email_must_be_unique_case_insensitively(world):
    response = _submit(world, items={"email": "PCR-Colleague@Example.com"})
    assert response.status_code == 422 and _error_fields(response) == {"email"}


def test_only_one_pending_request_per_employee(world):
    _submitted(world)
    duplicate = _submit(world, items={"mobile": "+966533333333"})
    assert duplicate.status_code == 422 and _error_fields(duplicate) == {"non_field_errors"}
    assert _submit(world, user=world["colleague"]).status_code == 201


def test_attachments_must_be_own_unused_and_one_per_type(world):
    foreign = _attachment(world, user=world["colleague"])
    assert _error_fields(_submit(world, attachment_ids=[foreign.pk])) == {"attachment_ids"}

    first, second = _attachment(world), _attachment(world)
    assert _error_fields(_submit(world, items={}, attachment_ids=[first.pk, second.pk])) == {"attachment_ids"}

    instance = _submitted(world, items={}, attachment_ids=[first.pk])
    assert [item["field"] for item in instance.items] == ["passport_file"]
    instance.status = Status.CANCELLED
    instance.save()
    assert _error_fields(_submit(world, attachment_ids=[first.pk])) == {"attachment_ids"}


def test_submission_requires_the_employees_own_company(world):
    client = client_for(world["employee"], world["foreign"])
    assert client.post(MY_URL, {"items": {"mobile": "+966544444444"}}, format="json").status_code == 403


# -- employee visibility and cancel ----------------------------------------------------------


def test_employee_lists_only_their_own_requests(world):
    mine = _submitted(world)
    _submitted(world, user=world["colleague"])
    response = client_for(world["employee"], world["company"]).get(MY_URL)
    assert response.status_code == 200
    assert [item["id"] for item in response.data["data"]["items"]] == [mine.pk]
    assert response.data["data"]["count"] == 1


def test_employee_can_cancel_and_download_only_their_own(world):
    attachment = _attachment(world)
    instance = _submitted(world, attachment_ids=[attachment.pk])
    other = _submitted(world, user=world["colleague"])
    client = client_for(world["employee"], world["company"])

    assert client.post(f"{MY_URL}{other.pk}/cancel/").status_code == 404
    assert client.get(f"{MY_URL}{other.pk}/attachments/{attachment.pk}/file/").status_code == 404
    download = client.get(f"{MY_URL}{instance.pk}/attachments/{attachment.pk}/file/")
    assert download.status_code == 200
    assert b"".join(download.streaming_content) == PDF
    assert download["X-Content-Type-Options"] == "nosniff"

    response = client.post(f"{MY_URL}{instance.pk}/cancel/")
    assert response.status_code == 200, response.data
    assert response.data["data"]["status"] == Status.CANCELLED
    assert [row["action"] for row in response.data["data"]["workflow"]["history"]] == ["submit", "cancel"]
    assert client.post(f"{MY_URL}{instance.pk}/cancel/").status_code == 422


def test_employee_cannot_use_the_hr_queue(world):
    instance = _submitted(world)
    client = client_for(world["colleague"], world["company"])
    assert client.get(HR_URL).status_code == 403
    assert client.post(f"{HR_URL}{instance.pk}/decide/", {"decisions": []}, format="json").status_code == 403


# -- HR decisions -------------------------------------------------------------------------------


def test_approving_everything_applies_all_items(world, notifications, ocr, django_capture_on_commit_callbacks):
    attachment = _attachment(world, document_type="SAUDI_ID")
    items = {
        "full_name": "Sara  Ali",
        "date_of_birth": "1991-02-03",
        "nationality": "Jordan",
        "email": "sara.new@example.com",
        "passport_issue_date": "2020-05-05",
        "id_expiry": "2033-03-03",
    }
    instance = _submitted(world, items=items, attachment_ids=[attachment.pk])

    with django_capture_on_commit_callbacks(execute=True):
        response = _decide(world, instance, _approve_all(instance), note="Checked")

    assert response.status_code == 200, response.data
    data = response.data["data"]
    assert data["status"] == Status.APPROVED
    assert {item["decision"] for item in data["items"]} == {"approved"}
    assert (data["decided_by_name"], data["decision_note"], data["can_act"]) == ("hr", "Checked", False)
    assert (data["workflow"]["status"], data["workflow"]["current_stage"]) == ("approved", "")
    assert [row["action"] for row in data["workflow"]["history"]] == ["submit", "approve"]

    profile = _profile(world["employee"])
    assert (profile.full_name, profile.full_name_en, profile.full_name_ar) == ("Sara Ali", "Sara Ali", "اسم")
    assert (profile.date_of_birth, profile.date_of_birth_raw) == (datetime.date(1991, 2, 3), None)
    assert (profile.nationality, profile.nationality_en) == ("Jordan", "Jordan")
    assert profile.user.email == "sara.new@example.com"
    assert profile.passport_issue_date == datetime.date(2020, 5, 5)
    assert (profile.id_expiry, profile.id_expiry_raw) == (datetime.date(2033, 3, 3), None)
    assert profile.passport_no == "OLD12345"

    document = EmployeeDocument.objects.get(employee_profile=profile)
    assert (document.document_type, document.exit_before) == ("SAUDI_ID", datetime.date(2033, 3, 3))
    assert document.uploaded_by == world["employee"]
    with document.file.open("rb") as handle:
        assert handle.read() == PDF
    ocr.assert_called_once_with(document)
    assert ProfileChangeAttachment.objects.get(pk=attachment.pk).applied_document == document

    notified = notifications.status.call_args.kwargs
    assert (notified["status_label"], notified["action_path"], notified["reason"]) == (
        "Approved",
        "/employee/profile",
        None,
    )
    assert notified["details"] == [
        "Approved: Full name, Date of birth, Nationality, Email, Passport issue date, National ID expiry, "
        "National ID copy"
    ]
    log = AuditLog.objects.get(action="employee_profile_change_decided")
    assert log.metadata["rejected_fields"] == [] and "email" in log.metadata["approved_fields"]
    assert "sara" not in str(log.metadata).lower() and "Checked" not in str(log.metadata)

    profile_data = client_for(world["employee"], world["company"]).get("/api/employees/me/").data["data"]
    assert profile_data["passport_issue_date"] == "2020-05-05"


def test_partial_decision_applies_only_approved_items(world, notifications, ocr, django_capture_on_commit_callbacks):
    attachment = _attachment(world)
    instance = _submitted(
        world, items={"mobile": "+966555555555", "passport_no": "NEW99999"}, attachment_ids=[attachment.pk]
    )
    decisions = [
        {"field": "mobile", "decision": "approve"},
        {"field": "passport_no", "decision": "reject", "note": "Does not match the scan"},
        {"field": "passport_file", "decision": "reject", "note": "Blurry"},
    ]
    with django_capture_on_commit_callbacks(execute=True):
        response = _decide(world, instance, decisions)

    assert response.status_code == 200, response.data
    data = response.data["data"]
    assert data["status"] == Status.PARTIALLY_APPROVED
    assert [(item["field"], item["decision"], item["note"]) for item in data["items"]] == [
        ("mobile", "approved", ""),
        ("passport_no", "rejected", "Does not match the scan"),
        ("passport_file", "rejected", "Blurry"),
    ]
    assert [row["action"] for row in data["workflow"]["history"]] == ["submit", "approve"]
    profile = _profile(world["employee"])
    assert (profile.mobile, profile.passport_no) == ("+966555555555", "OLD12345")
    assert not EmployeeDocument.objects.exists()
    ocr.assert_not_called()
    notified = notifications.status.call_args.kwargs
    assert notified["status_label"] == "Partially approved"
    assert notified["details"] == ["Approved: Mobile", "Rejected: Passport number, Passport copy"]
    assert notified["reason"] == "Passport number: Does not match the scan; Passport copy: Blurry"


def test_rejecting_everything_changes_nothing(world, notifications):
    instance = _submitted(world, items={"mobile": "+966566666666"})
    response = _decide(world, instance, [{"field": "mobile", "decision": "reject", "note": "Wrong"}])
    assert response.status_code == 200, response.data
    assert response.data["data"]["status"] == Status.REJECTED
    assert [row["action"] for row in response.data["data"]["workflow"]["history"]] == ["submit", "reject"]
    assert _profile(world["employee"]).mobile == "+966500000001"


@pytest.mark.parametrize(
    ("decisions", "field"),
    [
        ([], "decisions"),
        ([{"field": "mobile", "decision": "approve"}], "decisions"),
        ([{"field": "mobile", "decision": "approve"}] * 2 + [{"field": "email", "decision": "approve"}], "decisions"),
        (
            [
                {"field": "mobile", "decision": "approve"},
                {"field": "email", "decision": "approve"},
                {"field": "x", "decision": "approve"},
            ],
            "decisions",
        ),
        ([{"field": "mobile", "decision": "reject"}, {"field": "email", "decision": "approve"}], "decisions.mobile"),
        ([{"field": "mobile", "decision": "maybe"}, {"field": "email", "decision": "approve"}], "decisions.mobile"),
    ],
)
def test_every_item_must_be_decided_exactly_once(world, decisions, field):
    instance = _submitted(world, items={"mobile": "+966577777777", "email": "fresh@example.com"})
    response = _decide(world, instance, decisions)
    assert response.status_code == 422, response.data
    assert field in _error_fields(response)
    assert ProfileChangeRequest.objects.get(pk=instance.pk).status == Status.PENDING_HR


def test_decision_refusals(world, ocr):
    own = _submitted(world, user=world["hr"])
    assert _decide(world, own, _approve_all(own)).status_code == 403
    listed = client_for(world["hr"], world["company"]).get(HR_URL).data["data"]["items"]
    assert listed[0]["can_act"] is False

    instance = _submitted(world)
    assert _decide(world, instance, _approve_all(instance)).status_code == 200
    again = _decide(world, instance, _approve_all(instance))
    assert again.status_code == 422 and _error_fields(again) == {"non_field_errors"}


def test_email_taken_before_approval_refuses_the_whole_decision(world):
    instance = _submitted(world, items={"email": "wanted@example.com", "mobile": "+966588888888"})
    get_user_model().objects.filter(pk=world["colleague"].pk).update(email="WANTED@example.com")
    response = _decide(world, instance, _approve_all(instance))
    assert response.status_code == 422 and _error_fields(response) == {"decisions.email"}
    profile = _profile(world["employee"])
    assert (profile.mobile, profile.user.email) == ("+966500000001", "pcr-employee@example.com")
    assert ProfileChangeRequest.objects.get(pk=instance.pk).status == Status.PENDING_HR


def test_hr_queue_is_scoped_to_the_active_company(world):
    attachment = _attachment(world)
    instance = _submitted(world, attachment_ids=[attachment.pk])
    foreign_client = client_for(world["foreign_hr"], world["foreign"])
    assert foreign_client.get(HR_URL).data["data"]["items"] == []
    assert foreign_client.get(f"{HR_URL}{instance.pk}/").status_code == 404
    assert (
        _decide(world, instance, _approve_all(instance), user=world["foreign_hr"], company=world["foreign"]).status_code
        == 404
    )
    assert foreign_client.get(f"{HR_URL}{instance.pk}/attachments/{attachment.pk}/file/").status_code == 404


def test_hr_queue_filters_by_status_and_exposes_files(world):
    attachment = _attachment(world)
    pending = _submitted(world, attachment_ids=[attachment.pk])
    other = _submitted(world, user=world["colleague"])
    _decide(world, other, [{"field": "mobile", "decision": "reject", "note": "no"}])
    client = client_for(world["hr"], world["company"])

    items = client.get(HR_URL, {"status": "PENDING_HR"}).data["data"]["items"]
    assert [item["id"] for item in items] == [pending.pk]
    assert items[0]["can_act"] is True and items[0]["workflow"]["can_approve"] is True
    assert [item["id"] for item in client.get(HR_URL, {"status": "REJECTED"}).data["data"]["items"]] == [other.pk]
    assert client.get(HR_URL, {"status": "BOGUS"}).status_code == 422
    assert client.get(f"{HR_URL}{pending.pk}/").data["data"]["id"] == pending.pk
    download = client.get(f"{HR_URL}{pending.pk}/attachments/{attachment.pk}/file/")
    assert download.status_code == 200 and download["Cache-Control"] == "private, no-store"
    assert client.get(f"{HR_URL}{other.pk}/attachments/{attachment.pk}/file/").status_code == 404
    assert AuditLog.objects.filter(action="employee_profile_change_file_downloaded").exists()


def test_active_hr_delegate_can_decide(world):
    DelegationRule.objects.create(
        from_user=world["hr"],
        to_user=world["delegate"],
        start_at=timezone.now() - timedelta(minutes=1),
        end_at=timezone.now() + timedelta(hours=1),
        capabilities=[DelegationRule.Capability.WORKFLOW_APPROVE],
        created_by=world["hr"],
    )
    instance = _submitted(world)
    response = _decide(world, instance, _approve_all(instance), user=world["delegate"])
    assert response.status_code == 200, response.data


def test_notification_failure_never_undoes_a_decision(world, notifications, django_capture_on_commit_callbacks):
    instance = _submitted(world)
    notifications.status.side_effect = RuntimeError("provider down")
    with django_capture_on_commit_callbacks(execute=True):
        response = _decide(world, instance, _approve_all(instance))
    assert response.status_code == 200
    assert ProfileChangeRequest.objects.get(pk=instance.pk).status == Status.APPROVED


# -- workflow engine, inbox, notification scope, cleanup ---------------------------------------------


def test_workflow_template_and_pending_inbox_item(world):
    assert [stage["key"] for stage in WORKFLOW_TEMPLATES["employee_profile_change"]["stages"]] == ["hr"]
    instance = _submitted(world)
    workflow = WorkflowInstance.objects.get(
        content_type=ContentType.objects.get_for_model(ProfileChangeRequest), object_id=instance.pk
    )
    item = build_pending_approval_item(workflow)
    assert item["request_type"] == "EMPLOYEE_PROFILE_CHANGE"
    assert item["review_path"] == "/hr/employees/profile-change-requests"
    assert item["name"] == "Pcr employee"

    response = client_for(world["hr"], world["company"]).get("/api/core/pending-requests/")
    assert response.status_code == 200
    assert "EMPLOYEE_PROFILE_CHANGE" in [entry["request_type"] for entry in response.data["data"]["items"]]


def test_notification_company_resolution(world):
    instance = _submitted(world)
    assert _company_for_request("Profile Change Request", instance.pk) == world["company"].id


def test_cleanup_deletes_only_old_unused_attachments(world):
    old_unused, recent_unused, old_used = _attachment(world), _attachment(world), _attachment(world)
    _submitted(world, attachment_ids=[old_used.pk])
    stale = timezone.now() - timedelta(hours=25)
    ProfileChangeAttachment.objects.filter(pk__in=[old_unused.pk, old_used.pk]).update(created_at=stale)
    storage = old_unused.file.storage
    old_name = old_unused.file.name

    assert tasks.cleanup_unattached_profile_change_attachments() == {"deleted": 1}
    assert set(ProfileChangeAttachment.objects.values_list("pk", flat=True)) == {recent_unused.pk, old_used.pk}
    assert not storage.exists(old_name)
