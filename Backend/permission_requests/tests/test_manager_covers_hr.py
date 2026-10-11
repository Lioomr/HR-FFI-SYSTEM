import pytest
from django.contrib.auth.models import Group
from django.contrib.contenttypes.models import ContentType

from core.models import WorkflowInstance
from permission_requests.models import PermissionRequest
from permission_requests.tests.test_workflow import _act, _submit

pytestmark = pytest.mark.django_db
Status = PermissionRequest.Status
Decision = PermissionRequest.Decision


def _history(instance):
    workflow = WorkflowInstance.objects.get(
        content_type=ContentType.objects.get_for_model(PermissionRequest), object_id=instance.pk
    )
    return [
        (a.approver_role, a.actor_id, a.metadata.get("auto_satisfied_by")) for a in workflow.actions.order_by("id")
    ]


def test_manager_who_is_an_hr_manager_approves_without_a_second_hr_step(team, client_for, notifications):
    team.manager.groups.add(Group.objects.get_or_create(name="HRManager")[0])
    instance = _submit(client_for, team.employee)

    response = _act(client_for, team.manager, instance, "manager-approve")

    assert response.status_code == 200, response.data
    data = response.data["data"]
    assert data["status"] == Status.APPROVED
    assert data["hr_decision"] == Decision.APPROVED
    assert data["hr_decision_by"]["id"] == team.manager.id
    assert ("hr", team.manager.id, "manager") in _history(instance)
    assert notifications.status.call_args.kwargs["status_label"] == "Approved"


def test_ordinary_manager_still_hands_over_to_hr(team, client_for):
    instance = _submit(client_for, team.employee)

    response = _act(client_for, team.manager, instance, "manager-approve")

    assert response.data["data"]["status"] == Status.PENDING_HR


def test_system_admin_manager_does_not_cover_the_hr_stage(team, client_for):
    team.manager.groups.add(Group.objects.get_or_create(name="SystemAdmin")[0])
    instance = _submit(client_for, team.employee)

    response = _act(client_for, team.manager, instance, "manager-approve")

    assert response.data["data"]["status"] == Status.PENDING_HR


def test_manager_rejection_never_covers_hr(team, client_for):
    team.manager.groups.add(Group.objects.get_or_create(name="HRManager")[0])
    instance = _submit(client_for, team.employee)

    response = _act(client_for, team.manager, instance, "manager-reject", "No")

    assert response.data["data"]["status"] == Status.REJECTED
    assert response.data["data"]["hr_decision"] in ("", None)
