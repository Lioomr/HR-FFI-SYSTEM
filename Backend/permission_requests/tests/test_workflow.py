from datetime import timedelta

import pytest
from django.contrib.contenttypes.models import ContentType
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import Resolver404, resolve
from django.utils import timezone

from audit.models import AuditLog
from core.models import DelegationRule, WorkflowInstance
from core.services.workflow_engine import WORKFLOW_TEMPLATES, build_pending_approval_item
from employees.models import EmployeeProfile
from employees.services.manager_relationships import reroute_pending_manager_requests
from in_app_notifications.integrations import _company_for_request
from permission_requests.models import PermissionRequest
from permission_requests.services import PermissionRequestError, apply_manager_decision
from permission_requests.tests.helpers import BASE_URL, payload

pytestmark = pytest.mark.django_db
Status = PermissionRequest.Status
Decision = PermissionRequest.Decision


def _submit(client_for, user, **overrides):
    response = client_for(user).post(BASE_URL, payload(**overrides), format="json")
    assert response.status_code == 201, response.data
    return PermissionRequest.objects.get(pk=response.data["data"]["id"])


def _act(client_for, user, instance, name, comment=None, tenant=None):
    body = {} if comment is None else {"comment": comment}
    return client_for(user, tenant).post(f"{BASE_URL}{instance.pk}/{name}/", body, format="json")


def _workflow(instance):
    return WorkflowInstance.objects.get(
        content_type=ContentType.objects.get_for_model(PermissionRequest), object_id=instance.pk
    )


# -- happy paths ---------------------------------------------------------------------


def test_manager_approval_advances_to_hr(team, client_for, notifications):
    instance = _submit(client_for, team.employee)
    notifications.pending.reset_mock()

    response = _act(client_for, team.manager, instance, "manager-approve", "Fine by me")

    assert response.status_code == 200, response.data
    data = response.data["data"]
    assert data["status"] == Status.PENDING_HR
    assert data["manager_decision"] == Decision.APPROVED
    assert data["manager_decision_by"]["id"] == team.manager.id
    assert data["manager_decision_note"] == "Fine by me"
    assert data["manager_decision_at"]
    assert data["workflow"]["current_stage"] == "hr"

    log = AuditLog.objects.get(action="permission_request_manager_approved", entity_id=str(instance.pk))
    assert (log.metadata["from_status"], log.metadata["to_status"]) == (Status.PENDING_MANAGER, Status.PENDING_HR)
    assert log.metadata["actor_source"] == "direct_manager"
    assert "Fine by me" not in str(log.metadata)

    notified = notifications.pending.call_args.kwargs
    assert team.hr in notified["users"] and team.employee not in notified["users"]
    assert notified["action_path"] == f"/hr/permission-requests/{instance.pk}"


def test_manager_rejection_is_final(team, client_for, notifications):
    instance = _submit(client_for, team.employee)

    response = _act(client_for, team.manager, instance, "manager-reject", "Critical delivery today")

    assert response.status_code == 200, response.data
    assert response.data["data"]["status"] == Status.REJECTED
    assert response.data["data"]["manager_decision"] == Decision.REJECTED
    assert AuditLog.objects.filter(action="permission_request_manager_rejected", entity_id=str(instance.pk)).exists()
    notified = notifications.status.call_args.kwargs
    assert notified["profile"] == team.employee.employee_profile
    assert (notified["status_label"], notified["reason"]) == ("Rejected", "Critical delivery today")
    assert _act(client_for, team.hr, instance, "hr-approve").status_code == 422


def test_hr_approval_finalizes_as_approved(team, client_for, notifications):
    instance = _submit(client_for, team.employee)
    _act(client_for, team.manager, instance, "manager-approve")

    response = _act(client_for, team.hr, instance, "hr-approve", "Logged for attendance")

    assert response.status_code == 200, response.data
    data = response.data["data"]
    assert data["status"] == Status.APPROVED
    assert data["hr_decision"] == Decision.APPROVED
    assert data["hr_decision_by"]["id"] == team.hr.id
    assert data["hr_decision_note"] == "Logged for attendance"
    assert (data["workflow"]["status"], data["workflow"]["current_stage"]) == ("approved", "")
    assert data["workflow"]["can_approve"] is False
    assert AuditLog.objects.filter(action="permission_request_hr_approved", entity_id=str(instance.pk)).exists()
    assert notifications.status.call_args.kwargs["status_label"] == "Approved"


def test_hr_rejection_finalizes_as_rejected_without_a_comment(team, client_for, notifications):
    instance = _submit(client_for, team.employee)
    _act(client_for, team.manager, instance, "manager-approve")

    response = _act(client_for, team.hr, instance, "hr-reject")

    assert response.status_code == 200, response.data
    assert response.data["data"]["status"] == Status.REJECTED
    assert response.data["data"]["hr_decision"] == Decision.REJECTED
    assert AuditLog.objects.filter(action="permission_request_hr_rejected", entity_id=str(instance.pk)).exists()
    assert notifications.status.call_args.kwargs["reason"] is None


def test_delegated_manager_can_decide_the_manager_stage(team, make_user, client_for):
    delegate = make_user("Employee")
    DelegationRule.objects.create(
        from_user=team.manager,
        to_user=delegate,
        start_at=timezone.now() - timedelta(minutes=1),
        end_at=timezone.now() + timedelta(hours=1),
        capabilities=[DelegationRule.Capability.WORKFLOW_APPROVE],
        created_by=team.hr,
    )
    instance = _submit(client_for, team.employee)

    response = _act(client_for, delegate, instance, "manager-approve")

    assert response.status_code == 200, response.data
    log = AuditLog.objects.get(action="permission_request_manager_approved", entity_id=str(instance.pk))
    assert log.metadata["actor_source"] == "delegate"
    assert PermissionRequest.objects.get(pk=instance.pk).manager_decision_by == delegate


# -- no CEO ----------------------------------------------------------------------------


def test_permission_workflow_has_no_ceo_route_stage_status_or_field(team, client_for):
    instance = _submit(client_for, team.employee)

    for suffix in ("ceo-approve", "ceo-reject"):
        with pytest.raises(Resolver404):
            resolve(f"{BASE_URL}{instance.pk}/{suffix}/")
        assert _act(client_for, team.manager, instance, suffix).status_code == 404
    with pytest.raises(Resolver404):
        resolve(f"{BASE_URL}ceo/")
    assert [stage["key"] for stage in WORKFLOW_TEMPLATES["permission_request"]["stages"]] == ["manager", "hr"]
    assert not [value for value in Status.values if "ceo" in value]
    assert not [field.name for field in PermissionRequest._meta.get_fields() if "ceo" in field.name]


def test_ceo_user_has_no_approval_authority(team, make_user, client_for):
    ceo = make_user("CEO")
    instance = _submit(client_for, team.employee)

    assert _act(client_for, ceo, instance, "manager-approve").status_code == 403
    assert client_for(ceo).get(f"{BASE_URL}{instance.pk}/").status_code == 404
    _act(client_for, team.manager, instance, "manager-approve")
    assert _act(client_for, ceo, instance, "hr-approve").status_code == 403
    assert _act(client_for, ceo, instance, "hr-reject").status_code == 403
    assert client_for(ceo).get(f"{BASE_URL}hr/").status_code == 403
    assert client_for(ceo).get(f"{BASE_URL}manager/").status_code == 403
    instance.refresh_from_db()
    assert instance.status == Status.PENDING_HR


# -- self-approval and routing ----------------------------------------------------------


def test_requester_cannot_approve_own_request_as_manager(make_user, client_for):
    director = make_user("Manager")
    lead = make_user("Manager", manager=director)
    make_user("Employee", manager=lead)  # lead manages a team, so holds manager access
    instance = _submit(client_for, lead)

    assert _act(client_for, lead, instance, "manager-approve").status_code == 403
    instance.refresh_from_db()
    assert instance.status == Status.PENDING_MANAGER
    assert _act(client_for, director, instance, "manager-approve").status_code == 200


def test_hr_requester_skips_the_hr_stage_after_manager_approval(make_user, client_for, notifications):
    manager = make_user("Manager")
    requester = make_user("HRManager", manager=manager)
    instance = _submit(client_for, requester)
    assert instance.status == Status.PENDING_MANAGER

    response = _act(client_for, manager, instance, "manager-approve")

    data = response.data["data"]
    assert data["status"] == Status.APPROVED
    assert data["hr_decision"] is None
    assert data["workflow"]["status"] == "approved"
    assert [entry["action"] for entry in data["workflow"]["history"]] == ["submit", "approve"]
    assert notifications.status.call_args.kwargs["status_label"] == "Approved"


def test_hr_requester_cannot_approve_own_request_at_the_hr_stage(make_user, client_for):
    requester = make_user("HRManager")
    colleague = make_user("HRManager")
    instance = _submit(client_for, requester)
    assert instance.status == Status.PENDING_HR

    assert _act(client_for, requester, instance, "hr-approve").status_code == 403
    queue = client_for(requester).get(f"{BASE_URL}hr/").data["data"]["items"]
    assert instance.pk not in [item["id"] for item in queue]
    own = client_for(requester).get(f"{BASE_URL}{instance.pk}/").data["data"]
    assert own["workflow"]["can_approve"] is False
    assert _act(client_for, colleague, instance, "hr-approve").status_code == 200


def test_pending_manager_request_falls_back_to_hr_when_the_manager_leaves(team, client_for):
    instance = _submit(client_for, team.employee)
    EmployeeProfile.objects.filter(user=team.manager).update(is_archived=True)

    assert reroute_pending_manager_requests(EmployeeProfile.objects.get(user=team.employee)) == 1

    instance.refresh_from_db()
    assert instance.status == Status.PENDING_HR
    assert _act(client_for, team.hr, instance, "hr-approve").status_code == 200


# -- concurrency -------------------------------------------------------------------------


def test_stale_decision_is_refused_after_rechecking_under_the_row_lock(team, client_for):
    instance = _submit(client_for, team.employee)
    stale = PermissionRequest.objects.get(pk=instance.pk)  # read before the first decision lands

    assert _act(client_for, team.manager, instance, "manager-approve").status_code == 200
    with pytest.raises(PermissionRequestError) as refused:
        apply_manager_decision(stale, actor=team.manager, decision=Decision.REJECTED)

    assert refused.value.status == 422
    stale.refresh_from_db()
    assert (stale.status, stale.manager_decision) == (Status.PENDING_HR, Decision.APPROVED)


def test_decisions_lock_the_request_row(team, client_for):
    instance = _submit(client_for, team.employee)

    with CaptureQueriesContext(connection) as captured:
        assert _act(client_for, team.manager, instance, "manager-approve").status_code == 200

    assert [
        query["sql"]
        for query in captured.captured_queries
        if "FOR UPDATE" in query["sql"] and "permission_requests_permissionrequest" in query["sql"]
    ]


def test_competing_decisions_allow_exactly_one_transition(team, client_for):
    instance = _submit(client_for, team.employee)

    codes = [
        _act(client_for, team.manager, instance, "manager-approve").status_code,
        _act(client_for, team.manager, instance, "manager-reject").status_code,
    ]

    assert codes == [200, 422]
    assert _workflow(instance).actions.filter(approver_role="manager").count() == 1


def test_cancellation_and_approval_cannot_both_succeed(team, client_for):
    instance = _submit(client_for, team.employee)

    assert client_for(team.employee).post(f"{BASE_URL}{instance.pk}/cancel/").status_code == 200
    assert _act(client_for, team.manager, instance, "manager-approve").status_code == 422
    instance.refresh_from_db()
    assert (instance.status, instance.manager_decision) == (Status.CANCELLED, None)


# -- cancel ----------------------------------------------------------------------------


def test_owner_cancels_a_pending_request(team, client_for):
    instance = _submit(client_for, team.employee)
    _act(client_for, team.manager, instance, "manager-approve")

    response = client_for(team.employee).post(f"{BASE_URL}{instance.pk}/cancel/")

    assert response.status_code == 200, response.data
    data = response.data["data"]
    assert data["status"] == Status.CANCELLED
    assert data["cancelled_at"]
    assert (data["workflow"]["status"], data["workflow"]["can_cancel"]) == ("cancelled", False)
    log = AuditLog.objects.get(action="permission_request_cancelled", entity_id=str(instance.pk))
    assert log.metadata["from_status"] == Status.PENDING_HR


def test_decided_request_cannot_be_cancelled(team, client_for):
    instance = _submit(client_for, team.employee)
    _act(client_for, team.manager, instance, "manager-reject")

    assert client_for(team.employee).post(f"{BASE_URL}{instance.pk}/cancel/").status_code == 422


def test_only_the_owner_can_cancel(team, client_for):
    instance = _submit(client_for, team.employee)

    assert client_for(team.manager).post(f"{BASE_URL}{instance.pk}/cancel/").status_code == 403
    assert client_for(team.hr).post(f"{BASE_URL}{instance.pk}/cancel/").status_code == 403


# -- scoping ---------------------------------------------------------------------------


def test_cross_company_hr_cannot_view_or_decide(team, make_user, company, other_company, client_for):
    instance = _submit(client_for, team.employee)
    _act(client_for, team.manager, instance, "manager-approve")
    foreign_hr = make_user("HRManager", tenant=other_company)

    assert _act(client_for, foreign_hr, instance, "hr-approve", tenant=other_company).status_code == 404
    assert client_for(foreign_hr, other_company).get(f"{BASE_URL}{instance.pk}/").status_code == 404
    assert client_for(foreign_hr, other_company).get(f"{BASE_URL}hr/").data["data"]["items"] == []
    # Selecting a company the approver has no access to is refused outright.
    assert _act(client_for, foreign_hr, instance, "hr-approve", tenant=company).status_code == 403
    instance.refresh_from_db()
    assert instance.status == Status.PENDING_HR


def test_cross_company_manager_cannot_decide(team, make_user, other_company, client_for):
    foreign_manager = make_user("Manager", tenant=other_company)
    make_user("Employee", tenant=other_company, manager=foreign_manager)
    instance = _submit(client_for, team.employee)

    assert _act(client_for, foreign_manager, instance, "manager-approve", tenant=other_company).status_code == 404
    instance.refresh_from_db()
    assert instance.status == Status.PENDING_MANAGER


def test_other_employees_cannot_see_cancel_or_download_a_request(team, make_user, client_for):
    instance = _submit(client_for, team.employee)
    coworker = client_for(make_user("Employee", manager=team.manager))

    assert coworker.get(f"{BASE_URL}{instance.pk}/").status_code == 404
    assert coworker.post(f"{BASE_URL}{instance.pk}/cancel/").status_code == 404
    assert coworker.get(f"{BASE_URL}{instance.pk}/pdf/").status_code == 404
    assert coworker.get(BASE_URL).data["data"]["items"] == []

    own = client_for(team.employee).get(BASE_URL).data["data"]
    assert [item["id"] for item in own["items"]] == [instance.pk]
    assert {"items", "page", "page_size", "count", "total_pages"} <= set(own)


def test_manager_and_hr_queues_list_only_actionable_requests(team, make_user, client_for):
    instance = _submit(client_for, team.employee)
    _submit(client_for, make_user("Employee", manager=make_user("Manager")))

    manager_items = client_for(team.manager).get(f"{BASE_URL}manager/").data["data"]["items"]
    assert [item["id"] for item in manager_items] == [instance.pk]
    assert manager_items[0]["workflow"]["can_approve"] is True
    assert client_for(team.hr).get(f"{BASE_URL}hr/").data["data"]["items"] == []

    _act(client_for, team.manager, instance, "manager-approve")

    assert client_for(team.manager).get(f"{BASE_URL}manager/").data["data"]["items"] == []
    decided = client_for(team.manager).get(f"{BASE_URL}manager/?status=all").data["data"]["items"]
    assert [item["id"] for item in decided] == [instance.pk]
    hr_items = client_for(team.hr).get(f"{BASE_URL}hr/").data["data"]["items"]
    assert [item["id"] for item in hr_items] == [instance.pk]
    assert hr_items[0]["workflow"]["can_approve"] is True
    assert client_for(team.employee).get(f"{BASE_URL}manager/").status_code == 403
    assert client_for(team.employee).get(f"{BASE_URL}hr/").status_code == 403
    assert client_for(team.hr).get(f"{BASE_URL}hr/?status=pending_ceo").status_code == 422


# -- workflow projection and integrations ------------------------------------------------


def test_detail_includes_history_and_actor_specific_flags(team, client_for):
    instance = _submit(client_for, team.employee)
    _act(client_for, team.manager, instance, "manager-approve", "ok")

    def workflow_for(user):
        response = client_for(user).get(f"{BASE_URL}{instance.pk}/")
        assert response.status_code == 200, response.data
        return response.data["data"]["workflow"]

    hr_view = workflow_for(team.hr)
    assert [(entry["action"], entry["stage"]) for entry in hr_view["history"]] == [
        ("submit", ""),
        ("advance", "manager"),
    ]
    assert hr_view["history"][1]["actor"]["id"] == team.manager.id
    assert (hr_view["can_approve"], hr_view["can_cancel"]) == (True, False)
    owner_view = workflow_for(team.employee)
    assert (owner_view["can_approve"], owner_view["can_cancel"]) == (False, True)
    assert workflow_for(team.manager)["can_approve"] is False


def test_notification_failures_never_roll_back_the_request(team, client_for, notifications):
    notifications.pending.side_effect = RuntimeError("provider down")
    notifications.status.side_effect = RuntimeError("provider down")

    instance = _submit(client_for, team.employee)
    assert _act(client_for, team.manager, instance, "manager-approve").status_code == 200
    assert _act(client_for, team.hr, instance, "hr-approve").status_code == 200

    instance.refresh_from_db()
    assert instance.status == Status.APPROVED
    assert notifications.pending.called and notifications.status.called


def test_notification_company_resolution_knows_permission_requests(team, client_for):
    instance = _submit(client_for, team.employee)

    assert _company_for_request("Permission Request", instance.pk) == instance.company_id


def test_pending_approval_inbox_item_points_to_the_hr_review_page(team, client_for):
    instance = _submit(client_for, team.employee)
    _act(client_for, team.manager, instance, "manager-approve")

    item = build_pending_approval_item(_workflow(instance))

    assert (item["request_type"], item["request_type_label"]) == ("PERMISSION", "Exit Permission")
    assert item["review_path"] == f"/hr/permission-requests/{instance.pk}"
    assert item["current_approver_role"] == "hr"
