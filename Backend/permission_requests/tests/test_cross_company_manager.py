"""An employee's manager from another company decides their permission requests."""

import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from audit.models import AuditLog
from core.models import CrossCompanyManagerAssignment
from core.services.pending_approval_email import notify_users_for_pending_status
from employees.services.manager_relationships import fallback_invalid_manager_stage, set_employee_manager
from in_app_notifications.models import Notification
from permission_requests.models import PermissionRequest
from permission_requests.services import NO_APPROVER_MESSAGE

from .helpers import BASE_URL, payload

pytestmark = pytest.mark.django_db

Status = PermissionRequest.Status
CAPABILITY = "permission_requests.approve"


@pytest.fixture
def cross(make_user, company, other_company):
    """Employee in ``company`` whose one manager works for ``other_company``."""

    hr = make_user("HRManager", name="Hala HR")
    manager = make_user("Manager", tenant=other_company, name="Omar Other Company Manager")
    employee = make_user("Employee", name="Eman Employee")
    change = set_employee_manager(employee.employee_profile, manager.employee_profile, actor=hr)
    other_manager = make_user("Manager", tenant=other_company, name="Other Unrelated Manager")
    make_user("Employee", tenant=other_company, manager=other_manager, name="Their Own Report")
    colleague = make_user("Employee", tenant=other_company, name="Manager Colleague")
    return SimpleNamespace(
        hr=hr,
        manager=manager,
        employee=employee,
        assignment=change.assignment,
        other_manager=other_manager,
        colleague=colleague,
    )


def _drop_capability(assignment, capability=CAPABILITY):
    CrossCompanyManagerAssignment.objects.filter(pk=assignment.pk).update(
        capabilities=[value for value in CrossCompanyManagerAssignment.Capability.values if value != capability]
    )


def _manager_client(client_for, cross, other_company):
    return client_for(cross.manager, other_company)


def test_assignment_carries_the_permission_request_capability(cross):
    assert CAPABILITY in cross.assignment.capabilities


def test_submission_routes_to_the_cross_company_manager_and_notifies_them(cross, client_for, notifications):
    response = client_for(cross.employee).post(BASE_URL, payload(), format="json")

    assert response.status_code == 201, response.data
    data = response.data["data"]
    assert data["status"] == Status.PENDING_MANAGER
    # The employee sees their manager's name only, never a company.
    assert data["direct_manager"] == {
        "id": cross.manager.id,
        "employee_profile_id": cross.manager.employee_profile.id,
        "full_name": "Omar Other Company Manager",
    }
    notifications.pending.assert_called_once()
    kwargs = notifications.pending.call_args.kwargs
    assert kwargs["users"] == [cross.manager]
    assert kwargs["action_path"] == f"/manager/permission-requests/{data['id']}"


def test_cross_company_manager_queue_detail_and_approval_move_the_request_to_hr(
    cross, client_for, make_request, other_company, notifications
):
    instance = make_request(cross.employee)
    client = _manager_client(client_for, cross, other_company)

    queue = client.get(f"{BASE_URL}manager/")
    assert queue.status_code == 200, queue.data
    assert [item["id"] for item in queue.data["data"]["items"]] == [instance.id]

    detail = client.get(f"{BASE_URL}{instance.id}/")
    assert detail.status_code == 200
    assert detail.data["data"]["workflow"]["can_approve"] is True
    # The employee's own view never names the manager's company.
    own_view = client_for(cross.employee).get(f"{BASE_URL}{instance.id}/").data["data"]
    assert own_view["direct_manager"]["full_name"] == "Omar Other Company Manager"
    assert other_company.name not in json.dumps(own_view, default=str)

    approved = client.post(f"{BASE_URL}{instance.id}/manager-approve/", {"comment": "ok"}, format="json")
    assert approved.status_code == 200, approved.data
    instance.refresh_from_db()
    assert instance.status == Status.PENDING_HR
    assert instance.manager_decision_by == cross.manager
    log = AuditLog.objects.get(action="permission_request_manager_approved", entity_id=str(instance.id))
    assert log.metadata["actor_source"] == "cross_company_assignment"
    # HR in the employee's company is asked next.
    hr_call = notifications.pending.call_args.kwargs
    assert hr_call["action_path"] == f"/hr/permission-requests/{instance.id}"
    assert cross.hr in list(hr_call["users"])


def test_cross_company_manager_can_reject(cross, client_for, make_request, other_company):
    instance = make_request(cross.employee)
    response = _manager_client(client_for, cross, other_company).post(
        f"{BASE_URL}{instance.id}/manager-reject/", {"comment": "no"}, format="json"
    )
    assert response.status_code == 200, response.data
    instance.refresh_from_db()
    assert instance.status == Status.REJECTED


@pytest.mark.parametrize("who", ["other_manager", "colleague"])
def test_unrelated_users_of_the_managers_company_get_nothing(cross, client_for, make_request, other_company, who):
    instance = make_request(cross.employee)
    client = client_for(getattr(cross, who), other_company)

    queue = client.get(f"{BASE_URL}manager/")
    if who == "colleague":
        assert queue.status_code == 403
    else:
        assert queue.status_code == 200
        assert instance.id not in [item["id"] for item in queue.data["data"]["items"]]
    assert client.get(f"{BASE_URL}{instance.id}/").status_code == 404
    # No team at all: refused at the queue permission; a team elsewhere: the request is not found.
    expected = 403 if who == "colleague" else 404
    assert client.post(f"{BASE_URL}{instance.id}/manager-approve/", {}, format="json").status_code == expected
    instance.refresh_from_db()
    assert instance.status == Status.PENDING_MANAGER


def test_an_assignment_without_the_capability_grants_nothing(cross, client_for, make_request, other_company):
    _drop_capability(cross.assignment)
    instance = make_request(cross.employee)
    client = _manager_client(client_for, cross, other_company)

    assert client.get(f"{BASE_URL}manager/").status_code == 403
    assert client.get(f"{BASE_URL}{instance.id}/").status_code == 404
    assert client.post(f"{BASE_URL}{instance.id}/manager-approve/", {}, format="json").status_code == 403
    # Without a manager who may decide it, a stuck manager-stage request goes to HR.
    assert fallback_invalid_manager_stage(instance) is True
    instance.refresh_from_db()
    assert instance.status == Status.PENDING_HR


def test_new_requests_start_at_hr_when_the_assignment_lacks_the_capability(cross, client_for):
    _drop_capability(cross.assignment)
    response = client_for(cross.employee).post(BASE_URL, payload(), format="json")
    assert response.status_code == 201, response.data
    assert response.data["data"]["status"] == Status.PENDING_HR


def test_a_pending_request_stays_with_the_cross_company_manager(cross, make_request):
    instance = make_request(cross.employee)
    assert fallback_invalid_manager_stage(instance) is False
    instance.refresh_from_db()
    assert instance.status == Status.PENDING_MANAGER


def test_revoking_the_manager_moves_pending_requests_to_hr_and_ends_access(
    cross, client_for, make_request, other_company
):
    instance = make_request(cross.employee)
    set_employee_manager(cross.employee.employee_profile, None, actor=cross.hr)

    instance.refresh_from_db()
    assert instance.status == Status.PENDING_HR
    client = _manager_client(client_for, cross, other_company)
    assert client.get(f"{BASE_URL}{instance.id}/").status_code == 404
    assert client.get(f"{BASE_URL}manager/").status_code == 403


def test_the_no_approver_message_is_neutral():
    assert NO_APPROVER_MESSAGE.endswith("Ask HR to assign your manager.")
    assert "direct" not in NO_APPROVER_MESSAGE


def test_manager_stage_refusal_does_not_claim_a_direct_manager(cross, make_user, client_for, make_request):
    instance = make_request(cross.employee)
    stranger = make_user("Manager", name="Stranger")
    make_user("Employee", manager=stranger, name="Stranger Report")
    from permission_requests.services import PermissionRequestError, apply_manager_decision

    with pytest.raises(PermissionRequestError) as excinfo:
        apply_manager_decision(instance, actor=stranger, decision=PermissionRequest.Decision.APPROVED)
    assert excinfo.value.status == 403
    assert "direct" not in excinfo.value.message
    assert "manager" in excinfo.value.message


@patch("in_app_notifications.tasks.deliver_whatsapp_notification.delay")
def test_pending_notification_reaches_the_cross_company_manager_in_their_own_company(
    delay, cross, make_request, other_company, company
):
    instance = make_request(cross.employee)

    notify_users_for_pending_status(
        users=[cross.manager, cross.other_manager],
        request_type="Exit Permission",
        request_id=instance.id,
        requester_name="Eman Employee",
        status_label=Status.PENDING_MANAGER,
        action_path=f"/manager/permission-requests/{instance.id}",
    )

    rows = Notification.objects.filter(event_key="approval.pending")
    # Only the requester's own manager is authorized outside the request company.
    assert list(rows.values_list("recipient_id", flat=True)) == [cross.manager.id]
    notification = rows.get()
    assert notification.company_id == other_company.id
    assert notification.action_url == f"/manager/permission-requests/{instance.id}?company={other_company.id}"
    assert str(company.name) not in f"{notification.title} {notification.message}"
