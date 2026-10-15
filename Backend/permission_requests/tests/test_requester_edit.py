"""Employee edit of their own permission request while it waits on the manager."""

from datetime import time
from unittest.mock import patch

import pytest
from audit.models import AuditLog
from core.models import WorkflowAction, WorkflowInstance
from core.services import get_workflow_snapshot
from django.contrib.contenttypes.models import ContentType
from django.core.files.uploadedfile import SimpleUploadedFile

from permission_requests.models import PermissionRequest
from permission_requests.services import (
    NOT_REQUESTER_EDITABLE_MESSAGE,
    PermissionRequestError,
    apply_manager_decision,
    edit_permission_request,
)
from permission_requests.tests.helpers import BASE_URL, field_errors, payload

pytestmark = pytest.mark.django_db
Status = PermissionRequest.Status
Decision = PermissionRequest.Decision


def _submit(client_for, user, **overrides):
    response = client_for(user).post(BASE_URL, payload(**overrides), format="json")
    assert response.status_code == 201, response.data
    return PermissionRequest.objects.get(pk=response.data["data"]["id"])


def _edit(client_for, user, instance, body, fmt="json"):
    return client_for(user).patch(f"{BASE_URL}{instance.pk}/edit/", body, format=fmt)


def _edits(instance):
    return WorkflowAction.objects.filter(
        workflow__content_type=ContentType.objects.get_for_model(PermissionRequest),
        workflow__object_id=instance.pk,
        action=WorkflowAction.Action.EDIT,
    )


@pytest.fixture
def dispatch():
    with patch("in_app_notifications.dispatcher.dispatch_notification_channels") as mocked:
        yield mocked


def test_owner_edits_a_request_waiting_on_the_manager(team, client_for, dispatch):
    instance = _submit(client_for, team.employee)

    response = _edit(client_for, team.employee, instance, {"to_time": "10:30", "reason": "Clinic visit"})

    assert response.status_code == 200, response.data
    data = response.data["data"]
    assert (data["to_time"], data["duration_minutes"], data["status"]) == ("10:30:00", 90, Status.PENDING_MANAGER)
    assert (data["workflow"]["can_edit"], data["workflow"]["can_cancel"]) == (True, True)
    assert data["workflow"]["history"][-1]["action"] == "edit"
    instance.refresh_from_db()
    assert (instance.to_time, instance.duration_minutes, instance.reason) == (time(10, 30), 90, "Clinic visit")

    edit = _edits(instance).get()
    assert (edit.actor, edit.approver_role) == (team.employee, "")
    # Field names only; the free-text reason never enters history or the audit log.
    assert edit.note == "Edited: to_time, duration_minutes, reason"
    log = AuditLog.objects.get(action="permission_request_edited", entity_id=str(instance.pk))
    assert log.metadata["changed_fields"] == ["to_time", "duration_minutes", "reason"]
    assert log.metadata["from_status"] == Status.PENDING_MANAGER
    assert "Clinic visit" not in str(log.metadata)

    (call,) = dispatch.call_args_list
    assert (call.kwargs["recipient"], call.kwargs["event_key"]) == (team.manager, "permission.updated")
    assert call.kwargs["action_url"] == f"/manager/permission-requests/{instance.pk}"


def test_unchanged_body_records_nothing(team, client_for, dispatch):
    instance = _submit(client_for, team.employee)

    response = _edit(client_for, team.employee, instance, {"reason": "Personal appointment"})

    assert response.status_code == 200, response.data
    assert not _edits(instance).exists()
    assert not dispatch.called


@pytest.mark.parametrize("current", [Status.PENDING_HR, Status.APPROVED, Status.REJECTED, Status.CANCELLED])
def test_request_past_the_manager_stage_cannot_be_edited(team, client_for, make_request, current):
    instance = make_request(team.employee, status=current)
    assert get_workflow_snapshot(instance, actor=team.employee)["can_edit"] is False

    response = _edit(client_for, team.employee, instance, {"to_time": "10:30"})

    assert response.status_code == 422
    assert field_errors(response) == {"non_field_errors": [NOT_REQUESTER_EDITABLE_MESSAGE]}
    instance.refresh_from_db()
    assert instance.to_time == time(10, 0)
    assert not _edits(instance).exists()


def test_request_that_started_at_hr_is_not_editable(make_user, client_for):
    lone = make_user("Employee")
    make_user("HRManager")
    instance = _submit(client_for, lone)
    assert instance.status == Status.PENDING_HR

    assert _edit(client_for, lone, instance, {"to_time": "10:30"}).status_code == 422


def test_only_the_owner_can_edit(team, make_user, client_for):
    instance = _submit(client_for, team.employee)
    coworker = make_user("Employee", manager=team.manager)

    for user in (team.manager, team.hr, coworker):
        assert get_workflow_snapshot(instance, actor=user)["can_edit"] is False
        assert _edit(client_for, user, instance, {"to_time": "10:30"}).status_code == 404

    with pytest.raises(PermissionRequestError) as refused:
        edit_permission_request(instance, actor=team.manager, validate=lambda locked: {})
    assert refused.value.status == 403
    instance.refresh_from_db()
    assert instance.to_time == time(10, 0)


def test_detail_flags_follow_the_viewer(team, client_for):
    instance = _submit(client_for, team.employee)

    def can_edit(user):
        return client_for(user).get(f"{BASE_URL}{instance.pk}/").data["data"]["workflow"]["can_edit"]

    assert (can_edit(team.employee), can_edit(team.manager), can_edit(team.hr)) == (True, False, False)
    listed = client_for(team.employee).get(BASE_URL).data["data"]["items"]
    assert listed[0]["workflow"]["can_edit"] is True


def test_invalid_times_are_refused_with_the_create_rules(team, client_for):
    instance = _submit(client_for, team.employee)

    backwards = _edit(client_for, team.employee, instance, {"to_time": "08:30"})
    too_long = _edit(client_for, team.employee, instance, {"to_time": "12:00"})
    late_with_times = _edit(client_for, team.employee, instance, {"permission_type": "late", "from_time": "09:00"})
    late_without_evidence = _edit(client_for, team.employee, instance, {"permission_type": "late"})

    assert backwards.status_code == 422 and "to_time" in field_errors(backwards)
    assert too_long.status_code == 422 and "to_time" in field_errors(too_long)
    assert late_with_times.status_code == 422 and "from_time" in field_errors(late_with_times)
    assert late_without_evidence.status_code == 422 and "attachments" in field_errors(late_without_evidence)
    assert field_errors(_edit(client_for, team.employee, instance, {"status": "approved"})) == {
        "status": ["This field is assigned by the server and cannot be submitted."]
    }
    instance.refresh_from_db()
    assert (instance.permission_type, instance.to_time, instance.status) == ("exit", time(10, 0), "pending_manager")


def test_switching_type_keeps_the_database_shape_valid(team, client_for):
    instance = _submit(client_for, team.employee)
    evidence = SimpleUploadedFile("late.pdf", b"%PDF-1.4 late", content_type="application/pdf")

    response = _edit(
        client_for, team.employee, instance, {"permission_type": "late", "attachments": [evidence]}, fmt="multipart"
    )

    assert response.status_code == 200, response.data
    instance.refresh_from_db()
    assert (instance.permission_type, instance.from_time, instance.to_time, instance.duration_minutes) == (
        "late",
        None,
        None,
        0,
    )
    assert instance.exit_type == ""
    assert instance.attachments.count() == 1

    # Back to Exit: stored evidence stays, but the times and exit type must be given again.
    missing = _edit(client_for, team.employee, instance, {"permission_type": "exit"})
    assert missing.status_code == 422
    assert {"from_time", "to_time"} <= set(field_errors(missing))
    restored = _edit(
        client_for,
        team.employee,
        instance,
        {"permission_type": "exit", "from_time": "11:00", "to_time": "11:45", "exit_type": "personal"},
    )
    assert restored.status_code == 200, restored.data
    instance.refresh_from_db()
    assert (instance.permission_type, instance.duration_minutes) == ("exit", 45)


def test_conflict_check_ignores_the_request_itself_but_not_others(team, client_for):
    instance = _submit(client_for, team.employee)
    assert _edit(client_for, team.employee, instance, {"from_time": "09:30", "to_time": "10:30"}).status_code == 200

    _submit(client_for, team.employee, from_time="11:00", to_time="12:00")
    response = _edit(client_for, team.employee, instance, {"to_time": "11:15"})

    assert response.status_code == 422
    assert "from_time" in field_errors(response)
    instance.refresh_from_db()
    assert instance.to_time == time(10, 30)


def test_notification_failure_never_breaks_the_edit(team, client_for):
    instance = _submit(client_for, team.employee)

    with patch("in_app_notifications.dispatcher.dispatch_notification_channels", side_effect=RuntimeError("down")):
        response = _edit(client_for, team.employee, instance, {"to_time": "10:30"})

    assert response.status_code == 200, response.data
    instance.refresh_from_db()
    assert instance.to_time == time(10, 30)


def test_edit_racing_an_approval_is_refused_under_the_lock(team, client_for):
    instance = _submit(client_for, team.employee)
    stale = PermissionRequest.objects.get(pk=instance.pk)  # read before the manager decides

    apply_manager_decision(instance, actor=team.manager, decision=Decision.APPROVED)

    def validate(locked):
        raise AssertionError("a decided request must be refused before validation")

    with pytest.raises(PermissionRequestError) as refused:
        edit_permission_request(stale, actor=team.employee, validate=validate)
    assert refused.value.status == 422
    stale.refresh_from_db()
    assert (stale.status, stale.to_time) == (Status.PENDING_HR, time(10, 0))
    workflow = WorkflowInstance.objects.get(
        content_type=ContentType.objects.get_for_model(PermissionRequest), object_id=instance.pk
    )
    assert not workflow.actions.filter(action=WorkflowAction.Action.EDIT).exists()
