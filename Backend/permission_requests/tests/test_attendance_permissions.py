import json
from datetime import datetime, time, timedelta
from unittest.mock import patch

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from admin_portal.models import SystemSettings
from attendance.calculation import AttendanceCalculationService
from attendance.models import AttendanceAdjustment, BioTimeRawPunch
from audit.models import AuditLog
from permission_requests.models import PermissionRequest, PermissionRequestAttachment
from permission_requests.tests.helpers import BASE_URL, field_errors, payload

pytestmark = pytest.mark.django_db
Status = PermissionRequest.Status
PermissionType = PermissionRequest.PermissionType


def _late_payload(**overrides):
    data = {
        "permission_type": PermissionType.LATE,
        "request_date": timezone.localdate().isoformat(),
        "reason": "Medical delay",
        "attachments": [SimpleUploadedFile("evidence.jpg", b"image-content", content_type="image/jpeg")],
        # Multipart clients send one JSON-text part per file.
        "attachment_metadata": [json.dumps({"source": "camera", "captured_at": "2026-09-13T09:00:00+03:00"})],
    }
    data.update(overrides)
    return data


def _during_shift_payload(**overrides):
    data = {
        "permission_type": PermissionType.DURING_SHIFT,
        "request_date": timezone.localdate().isoformat(),
        "from_time": "13:00",
        "to_time": "14:00",
        "reason": "Site appointment",
    }
    data.update(overrides)
    return data


def _post_late(client_for, user, **overrides):
    return client_for(user).post(BASE_URL, _late_payload(**overrides), format="multipart")


def _approve(client_for, team, instance):
    assert (
        client_for(team.manager).post(f"{BASE_URL}{instance.pk}/manager-approve/", {}, format="json").status_code == 200
    )
    return client_for(team.hr).post(f"{BASE_URL}{instance.pk}/hr-approve/", {}, format="json")


def test_legacy_payload_remains_an_exit_permission(team, client_for):
    response = client_for(team.employee).post(BASE_URL, payload(), format="json")

    assert response.status_code == 201
    assert response.data["data"]["permission_type"] == PermissionType.EXIT


def test_late_requires_private_evidence_and_rejects_employee_times(team, client_for):
    no_evidence = client_for(team.employee).post(
        BASE_URL,
        {"permission_type": PermissionType.LATE, "request_date": timezone.localdate().isoformat(), "reason": "Delay"},
        format="json",
    )
    assert no_evidence.status_code == 422
    assert "attachments" in field_errors(no_evidence)

    with_time = _post_late(client_for, team.employee, from_time="09:00")
    assert with_time.status_code == 422
    assert "from_time" in field_errors(with_time)


@pytest.mark.parametrize("exempt_by", ["flag", "ceo_role"])
def test_attendance_exempt_and_ceo_profiles_cannot_submit_late_permission(exempt_by, team, make_user, client_for):
    if exempt_by == "flag":
        profile = team.employee.employee_profile
        profile.attendance_exempt = True
        profile.save(update_fields=["attendance_exempt"])
        requester = team.employee
    else:
        requester = make_user("CEO", manager=team.manager)

    response = _post_late(client_for, requester)

    assert response.status_code == 422
    assert "permission_type" in field_errors(response)


def test_late_attachment_is_private_and_owner_download_is_audited(team, make_user, client_for):
    response = _post_late(client_for, team.employee)
    assert response.status_code == 201, response.data
    attachment = PermissionRequestAttachment.objects.get()
    download_url = f"{BASE_URL}{attachment.permission_request_id}/attachments/{attachment.pk}/download/"

    owner = client_for(team.employee).get(download_url)
    assert owner.status_code == 200
    assert owner["Cache-Control"] == "private, no-store"
    assert owner["X-Content-Type-Options"] == "nosniff"
    assert "attachment" in owner["Content-Disposition"]
    assert AuditLog.objects.filter(
        action="permission_request_attachment_downloaded", entity_id=str(attachment.permission_request_id)
    ).exists()
    assert client_for(make_user("Employee", manager=team.manager)).get(download_url).status_code == 404


@pytest.mark.parametrize("content_type", ["text/plain", "image/svg+xml"])
def test_late_evidence_accepts_only_safe_pdf_or_image_types(team, client_for, content_type):
    response = _post_late(
        client_for,
        team.employee,
        attachments=[SimpleUploadedFile("not-evidence.txt", b"not an image", content_type=content_type)],
    )
    assert response.status_code == 422
    assert "attachments" in field_errors(response)


def test_multipart_capture_metadata_is_stored_and_returned_as_an_object(team, client_for):
    captured = {"source": "camera", "captured_at": "2026-09-13T09:00:00+03:00"}

    response = _post_late(client_for, team.employee, attachment_metadata=[json.dumps(captured)])

    assert response.status_code == 201, response.data
    assert response.data["data"]["attachments"][0]["capture_metadata"] == captured
    assert PermissionRequestAttachment.objects.get().capture_metadata == captured


@pytest.mark.parametrize("metadata", ["not json", "[1, 2]", '"camera"'])
def test_capture_metadata_entries_must_be_json_objects(team, client_for, metadata):
    response = _post_late(client_for, team.employee, attachment_metadata=[metadata])

    assert response.status_code == 422
    assert "attachment_metadata" in field_errors(response)
    assert not PermissionRequestAttachment.objects.exists()


def test_added_evidence_metadata_is_returned_as_an_object(team, client_for):
    created = _post_late(client_for, team.employee)
    assert created.status_code == 201, created.data
    captured = {"source": "camera", "captured_at": "2026-09-13T10:15:00+03:00"}

    response = client_for(team.employee).post(
        f"{BASE_URL}{created.data['data']['id']}/attachments/",
        {
            "attachments": [SimpleUploadedFile("second.png", b"png-content", content_type="image/png")],
            "attachment_metadata": [json.dumps(captured)],
        },
        format="multipart",
    )

    assert response.status_code == 200, response.data
    metadata = [item["capture_metadata"] for item in response.data["data"]["attachments"]]
    assert captured in metadata
    assert all(isinstance(item, dict) for item in metadata)


def test_during_shift_uses_policy_date_and_duration_window(team, client_for):
    policy = SystemSettings.get_solo()
    policy.during_shift_permission_max_minutes = 45
    policy.permission_request_advance_limit_days = 2
    policy.save()

    too_long = client_for(team.employee).post(BASE_URL, _during_shift_payload(to_time="14:00"), format="json")
    assert too_long.status_code == 422
    assert "to_time" in field_errors(too_long)

    future = client_for(team.employee).post(
        BASE_URL,
        _during_shift_payload(request_date=(timezone.localdate() + timedelta(days=2)).isoformat(), to_time="13:30"),
        format="json",
    )
    assert future.status_code == 201, future.data

    outside_window = client_for(team.employee).post(
        BASE_URL,
        _during_shift_payload(request_date=(timezone.localdate() + timedelta(days=3)).isoformat(), to_time="13:30"),
        format="json",
    )
    assert outside_window.status_code == 422
    assert "request_date" in field_errors(outside_window)


def test_late_can_coexist_but_exit_and_during_shift_cannot_overlap(team, client_for):
    late = _post_late(client_for, team.employee)
    assert late.status_code == 201, late.data
    exit_request = client_for(team.employee).post(BASE_URL, payload(), format="json")
    assert exit_request.status_code == 201, exit_request.data

    conflict = client_for(team.employee).post(
        BASE_URL, _during_shift_payload(from_time="09:30", to_time="10:30"), format="json"
    )
    assert conflict.status_code == 422
    assert "from_time" in field_errors(conflict)

    non_overlapping = client_for(team.employee).post(
        BASE_URL, _during_shift_payload(from_time="11:00", to_time="12:00"), format="json"
    )
    assert non_overlapping.status_code == 201, non_overlapping.data


def test_rejected_and_cancelled_late_requests_do_not_consume_monthly_limit(team, client_for):
    policy = SystemSettings.get_solo()
    policy.approved_late_permission_limit_per_month = 1
    policy.save()
    rejected = _post_late(client_for, team.employee)
    assert rejected.status_code == 201
    instance = PermissionRequest.objects.get(pk=rejected.data["data"]["id"])
    assert (
        client_for(team.manager).post(f"{BASE_URL}{instance.pk}/manager-reject/", {}, format="json").status_code == 200
    )

    cancelled = _post_late(client_for, team.employee)
    assert cancelled.status_code == 201
    second = PermissionRequest.objects.get(pk=cancelled.data["data"]["id"])
    assert client_for(team.employee).post(f"{BASE_URL}{second.pk}/cancel/", {}, format="json").status_code == 200

    still_allowed = _post_late(client_for, team.employee)
    assert still_allowed.status_code == 201, still_allowed.data


def test_late_monthly_limit_is_rechecked_at_final_approval(team, client_for):
    policy = SystemSettings.get_solo()
    policy.approved_late_permission_limit_per_month = 1
    policy.save()
    first = _post_late(client_for, team.employee)
    second = _post_late(client_for, team.employee)
    assert first.status_code == second.status_code == 201

    first_request = PermissionRequest.objects.get(pk=first.data["data"]["id"])
    second_request = PermissionRequest.objects.get(pk=second.data["data"]["id"])
    with patch("permission_requests.services.AttendanceCalculationService.recalculate"):
        assert _approve(client_for, team, first_request).status_code == 200
        assert _approve(client_for, team, second_request).status_code == 422
    second_request.refresh_from_db()
    assert second_request.status == Status.PENDING_HR


def test_third_late_hr_final_approval_succeeds_and_fourth_is_rejected(team, client_for):
    policy = SystemSettings.get_solo()
    policy.approved_late_permission_limit_per_month = 3
    policy.save()
    responses = [_post_late(client_for, team.employee) for _ in range(4)]
    assert all(response.status_code == 201 for response in responses)
    requests = [PermissionRequest.objects.get(pk=response.data["data"]["id"]) for response in responses]

    with patch("permission_requests.services.AttendanceCalculationService.recalculate"):
        for instance in requests[:3]:
            assert _approve(client_for, team, instance).status_code == 200
        assert (
            client_for(team.manager).post(f"{BASE_URL}{requests[3].pk}/manager-approve/", {}, format="json").status_code
            == 200
        )
        assert client_for(team.hr).post(f"{BASE_URL}{requests[3].pk}/hr-approve/", {}, format="json").status_code == 422

    assert (
        PermissionRequest.objects.filter(
            employee=team.employee,
            permission_type=PermissionType.LATE,
            status=Status.APPROVED,
        ).count()
        == 3
    )
    requests[3].refresh_from_db()
    assert requests[3].status == Status.PENDING_HR


def test_third_late_manager_final_approval_for_hr_requester_succeeds_and_fourth_is_rejected(
    team, make_user, client_for
):
    policy = SystemSettings.get_solo()
    policy.approved_late_permission_limit_per_month = 3
    policy.save()
    requester = make_user("HRManager", manager=team.manager)
    responses = [_post_late(client_for, requester) for _ in range(4)]
    assert all(response.status_code == 201 for response in responses)
    requests = [PermissionRequest.objects.get(pk=response.data["data"]["id"]) for response in responses]

    with patch("permission_requests.services.AttendanceCalculationService.recalculate"):
        for instance in requests[:3]:
            response = client_for(team.manager).post(f"{BASE_URL}{instance.pk}/manager-approve/", {}, format="json")
            assert response.status_code == 200
            assert response.data["data"]["status"] == Status.APPROVED
        fourth = client_for(team.manager).post(f"{BASE_URL}{requests[3].pk}/manager-approve/", {}, format="json")

    assert fourth.status_code == 422
    assert (
        PermissionRequest.objects.filter(
            employee=requester,
            permission_type=PermissionType.LATE,
            status=Status.APPROVED,
        ).count()
        == 3
    )
    requests[3].refresh_from_db()
    assert requests[3].status == Status.PENDING_MANAGER


def test_future_late_marker_remains_zero_after_later_raw_punch_recalculation(team, client_for):
    future_date = timezone.localdate() + timedelta(days=1)
    response = _post_late(client_for, team.employee, request_date=future_date.isoformat())
    assert response.status_code == 201, response.data
    instance = PermissionRequest.objects.get(pk=response.data["data"]["id"])
    assert _approve(client_for, team, instance).status_code == 200

    marker = AttendanceAdjustment.objects.get(source_key=str(instance.pk))
    assert marker.kind == AttendanceAdjustment.Kind.LATE_PERMISSION
    assert marker.approved_minutes == 0
    occurred_at = timezone.make_aware(datetime.combine(future_date, time(9, 30)))
    raw = BioTimeRawPunch.objects.create(
        company=team.employee.employee_profile.company,
        employee_profile=team.employee.employee_profile,
        attendance_date=future_date,
        occurred_at=occurred_at,
        biotime_emp_code=team.employee.employee_profile.employee_id,
        provider_punch_id="future-late-marker-raw",
        deduplication_key="f" * 64,
        raw_punch_type="0",
        terminal_sn="TEST-TERM",
        provider_payload={"test": True},
    )

    AttendanceCalculationService.recalculate(team.employee.employee_profile, future_date)

    marker.refresh_from_db()
    raw.refresh_from_db()
    assert marker.approved_minutes == 0
    assert raw.raw_punch_type == "0"


def test_final_during_shift_approval_upserts_one_adjustment_without_touching_raw_punches(team, client_for):
    response = client_for(team.employee).post(BASE_URL, _during_shift_payload(), format="json")
    instance = PermissionRequest.objects.get(pk=response.data["data"]["id"])
    before_raw = BioTimeRawPunch.objects.count()

    with patch("permission_requests.services.AttendanceCalculationService.recalculate") as recalculate:
        assert _approve(client_for, team, instance).status_code == 200

    adjustment = AttendanceAdjustment.objects.get(source_key=str(instance.pk))
    assert adjustment.kind == AttendanceAdjustment.Kind.DURING_SHIFT_PERMISSION
    assert adjustment.approved_minutes == 60
    assert adjustment.effective_date == instance.request_date
    assert BioTimeRawPunch.objects.count() == before_raw
    recalculate.assert_called_once_with(instance.employee_profile, instance.request_date)
