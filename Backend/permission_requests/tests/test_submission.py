from datetime import time, timedelta

import pytest
from django.utils import timezone

from audit.models import AuditLog
from employees.models import EmployeeProfile
from organization.models import UserOrganizationAccess
from permission_requests.models import PermissionRequest
from permission_requests.services import NO_APPROVER_MESSAGE
from permission_requests.tests.helpers import BASE_URL, field_errors, payload

pytestmark = pytest.mark.django_db
Status = PermissionRequest.Status


def _post(client_for, user, **overrides):
    return client_for(user).post(BASE_URL, payload(**overrides), format="json")


def test_employee_submits_a_valid_request(team, client_for, notifications):
    response = _post(client_for, team.employee, from_time="09:00", to_time="10:30")

    assert response.status_code == 201, response.data
    data = response.data["data"]
    assert data["reference_no"].startswith(f"PERM-{timezone.localdate():%Y%m%d}-")
    assert len(data["reference_no"]) == len("PERM-20260910-0001")
    assert data["status"] == Status.PENDING_MANAGER
    assert data["status_label"] == "Pending Manager"
    assert data["duration_minutes"] == 90
    assert (data["from_time"], data["to_time"]) == ("09:00:00", "10:30:00")
    assert data["employee"]["id"] == team.employee.id
    assert data["direct_manager"]["id"] == team.manager.id
    workflow = data["workflow"]
    assert workflow["current_stage"] == "manager"
    assert (workflow["can_approve"], workflow["can_reject"], workflow["can_cancel"]) == (False, False, True)
    assert [entry["action"] for entry in workflow["history"]] == ["submit"]

    log = AuditLog.objects.get(action="permission_request_submitted", entity_id=str(data["id"]))
    assert log.metadata["to_status"] == Status.PENDING_MANAGER
    assert log.metadata["duration_minutes"] == 90
    assert "Personal appointment" not in str(log.metadata)

    notified = notifications.pending.call_args.kwargs
    assert notified["users"] == [team.manager]
    assert notified["request_type"] == "Permission Request"
    assert notified["action_path"] == f"/manager/permission-requests/{data['id']}"


@pytest.mark.parametrize("role", ["HRManager", "CFO", "CEO", "Manager", "SystemAdmin"])
def test_every_role_with_an_active_employee_profile_can_submit(role, make_user, client_for):
    manager = make_user("Manager")
    requester = make_user(role, manager=manager)

    response = _post(client_for, requester)

    assert response.status_code == 201, response.data
    assert response.data["data"]["employee"]["id"] == requester.id
    assert response.data["data"]["status"] == Status.PENDING_MANAGER


def test_system_admin_without_an_employee_profile_cannot_submit(make_user, client_for):
    admin = make_user("SystemAdmin", profile=False)

    response = _post(client_for, admin)

    assert response.status_code == 403
    assert not PermissionRequest.objects.exists()


def test_archived_employee_cannot_submit(team, client_for):
    EmployeeProfile.objects.filter(user=team.employee).update(is_archived=True)

    assert _post(client_for, team.employee).status_code == 403


def test_ownership_and_company_come_from_the_authenticated_user(team, client_for):
    response = _post(client_for, team.employee)

    instance = PermissionRequest.objects.get(pk=response.data["data"]["id"])
    assert instance.employee == team.employee
    assert instance.employee_profile == team.employee.employee_profile
    assert instance.company_id == team.employee.employee_profile.company_id


@pytest.mark.parametrize(
    "forged",
    [
        {"employee": 999},
        {"employee_id": 999},
        {"employee_profile": 999},
        {"company": 999},
        {"company_id": 999},
        {"status": "approved"},
        {"reference_no": "PERM-FORGED-0001"},
        {"manager_decision": "approved", "hr_decision_by": 1},
    ],
)
def test_server_assigned_fields_are_rejected(forged, team, client_for):
    response = _post(client_for, team.employee, **forged)

    assert response.status_code == 422
    assert set(field_errors(response)) == set(forged)
    assert not PermissionRequest.objects.exists()


def test_client_duration_is_rejected_when_it_disagrees_with_the_times(team, client_for):
    response = _post(client_for, team.employee, duration_minutes=30)

    assert response.status_code == 422
    assert "duration_minutes" in field_errors(response)


def test_matching_client_duration_is_accepted_but_server_calculated(team, client_for):
    response = _post(client_for, team.employee, from_time="09:00", to_time="10:00", duration_minutes=60)

    assert response.status_code == 201, response.data
    assert PermissionRequest.objects.get().duration_minutes == 60


@pytest.mark.parametrize("reason", [None, "", "   \n\t "])
def test_reason_is_required(reason, team, client_for):
    data = payload()
    if reason is None:
        data.pop("reason")
    else:
        data["reason"] = reason

    response = client_for(team.employee).post(BASE_URL, data, format="json")

    assert response.status_code == 422
    assert "reason" in field_errors(response)


def test_reason_is_trimmed_and_arabic_text_is_preserved(team, client_for):
    response = _post(client_for, team.employee, reason="  موعد طبي عاجل - clinic visit  ")

    assert response.status_code == 201, response.data
    assert PermissionRequest.objects.get().reason == "موعد طبي عاجل - clinic visit"


@pytest.mark.parametrize(
    ("start", "end", "minutes"),
    [("09:00", "10:00", 60), ("09:15", "11:15", 120), ("13:07", "13:08", 1)],
    ids=["one-hour", "exactly-two-hours", "any-minute"],
)
def test_valid_time_windows(start, end, minutes, team, client_for):
    response = _post(client_for, team.employee, from_time=start, to_time=end)

    assert response.status_code == 201, response.data
    assert response.data["data"]["duration_minutes"] == minutes


@pytest.mark.parametrize(
    ("start", "end"),
    [("09:00", "11:01"), ("10:00", "09:30"), ("23:30", "00:15"), ("09:00", "09:00")],
    ids=["over-two-hours", "end-before-start", "cross-midnight", "zero-length"],
)
def test_invalid_time_windows(start, end, team, client_for):
    response = _post(client_for, team.employee, from_time=start, to_time=end)

    assert response.status_code == 422
    assert "to_time" in field_errors(response)
    assert not PermissionRequest.objects.exists()


def test_times_with_seconds_are_rejected(team, client_for):
    response = _post(client_for, team.employee, from_time="09:00:30")

    assert response.status_code == 422
    assert "from_time" in field_errors(response)


@pytest.mark.parametrize("offset", [-1, 1], ids=["past", "future"])
def test_only_the_current_workday_is_accepted(offset, team, client_for):
    day = timezone.localdate() + timedelta(days=offset)

    response = _post(client_for, team.employee, request_date=day.isoformat())

    assert response.status_code == 422
    assert "request_date" in field_errors(response)


def test_unknown_exit_type_is_rejected(team, client_for):
    response = _post(client_for, team.employee, exit_type="vacation")

    assert response.status_code == 422
    assert "exit_type" in field_errors(response)


@pytest.mark.parametrize("existing", [Status.PENDING_MANAGER, Status.PENDING_HR, Status.APPROVED])
def test_active_overlapping_exit_request_blocks_a_new_one(existing, team, client_for, make_request):
    make_request(team.employee, status=existing, from_time=time(9, 0), to_time=time(10, 0))

    response = _post(client_for, team.employee, from_time="09:30", to_time="10:30")

    assert response.status_code == 422
    assert response.data["status"] == "error"
    assert "from_time" in field_errors(response)
    assert PermissionRequest.objects.count() == 1


@pytest.mark.parametrize("closed", [Status.REJECTED, Status.CANCELLED])
def test_closed_request_does_not_block_a_new_one(closed, team, client_for, make_request):
    make_request(team.employee, status=closed)

    response = _post(client_for, team.employee)

    assert response.status_code == 201, response.data
    assert PermissionRequest.objects.count() == 2


def test_non_overlapping_active_exit_requests_can_coexist(team, make_request):
    make_request(team.employee, status=Status.APPROVED)
    second = make_request(
        team.employee,
        status=Status.PENDING_HR,
        from_time=time(11, 0),
        to_time=time(12, 0),
    )

    assert second.pk


def test_reference_numbers_are_unique_and_sequential(team, make_user, client_for):
    colleague = make_user("Employee", manager=team.manager)

    first = _post(client_for, team.employee).data["data"]["reference_no"]
    second = _post(client_for, colleague).data["data"]["reference_no"]

    assert first != second
    assert int(second.rsplit("-", 1)[1]) == int(first.rsplit("-", 1)[1]) + 1


def test_submission_requires_the_employee_company_to_be_the_active_company(team, other_company, client_for):
    # HR may switch into another company, but a request always belongs to the profile's company.
    UserOrganizationAccess.objects.create(user=team.hr, organization=other_company)

    response = client_for(team.hr, other_company).post(BASE_URL, payload(), format="json")

    assert response.status_code == 403
    assert not PermissionRequest.objects.exists()


def test_employee_without_a_manager_starts_at_hr(make_user, client_for, notifications):
    hr = make_user("HRManager")
    employee = make_user("Employee")

    response = _post(client_for, employee)

    assert response.status_code == 201, response.data
    assert response.data["data"]["status"] == Status.PENDING_HR
    assert response.data["data"]["workflow"]["current_stage"] == "hr"
    assert hr in notifications.pending.call_args.kwargs["users"]


def test_self_assigned_manager_is_ignored_and_the_request_starts_at_hr(make_user, client_for):
    make_user("HRManager")
    employee = make_user("Employee")
    profile = employee.employee_profile
    # Both manager columns must agree (a database trigger enforces it); save() validation is bypassed.
    EmployeeProfile.objects.filter(pk=profile.pk).update(manager_profile=profile, manager=employee)

    response = _post(client_for, employee)

    assert response.status_code == 201, response.data
    assert response.data["data"]["status"] == Status.PENDING_HR


def test_request_nobody_else_could_decide_is_refused(make_user, client_for):
    # The only HR approver has no manager: both stages would be self-approval.
    lone_hr = make_user("HRManager")

    response = _post(client_for, lone_hr)

    assert response.status_code == 422
    assert field_errors(response) == {"non_field_errors": [NO_APPROVER_MESSAGE]}
    assert not PermissionRequest.objects.exists()


def test_hr_requester_without_a_manager_is_routed_to_another_hr_approver(make_user, client_for):
    requester = make_user("HRManager")
    make_user("HRManager")

    response = _post(client_for, requester)

    assert response.status_code == 201, response.data
    assert response.data["data"]["status"] == Status.PENDING_HR
