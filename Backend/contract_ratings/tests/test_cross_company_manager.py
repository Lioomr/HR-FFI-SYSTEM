"""An employee's manager from another company rates them; open ratings follow manager changes."""

import json
from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APIClient

from audit.models import AuditLog
from contract_ratings.models import ContractRating
from contract_ratings.services import submit_employee_response, submit_manager_response
from core.models import CrossCompanyManagerAssignment
from employees.models import EmployeeProfile
from employees.services.manager_relationships import set_employee_manager
from organization.models import UserOrganizationAccess

from .conftest import answers, rated_cycle

pytestmark = pytest.mark.django_db

CAPABILITY = "contract_ratings.rate"
S = ContractRating.Status


def _foreign_user(world, key, *, manager=None):
    user = get_user_model().objects.create_user(email=f"rating-x-{key}@example.com", full_name=f"Foreign {key}")
    EmployeeProfile.objects.create(
        user=user,
        company=world.foreign,
        employee_id=f"RX-{key}"[:20],
        full_name=f"Foreign {key}",
        manager_profile=manager.employee_profile if manager else None,
    )
    UserOrganizationAccess.objects.create(user=user, organization=world.foreign)
    return user


@pytest.fixture
def cross(world):
    world.cross_manager = _foreign_user(world, "manager")
    world.foreign_peer = _foreign_user(world, "peer")
    world.foreign_other_manager = _foreign_user(world, "other-mgr")
    _foreign_user(world, "other-rep", manager=world.foreign_other_manager)
    change = set_employee_manager(world.profile, world.cross_manager.employee_profile, actor=world.hr)
    world.assignment = change.assignment
    world.profile.refresh_from_db()
    return world


def _client(user, company):
    client = APIClient()
    client.force_authenticate(user)
    client.credentials(HTTP_X_ACTIVE_COMPANY_ID=str(company.id))
    return client


def _drop_capability(assignment):
    CrossCompanyManagerAssignment.objects.filter(pk=assignment.pk).update(
        capabilities=[value for value in CrossCompanyManagerAssignment.Capability.values if value != CAPABILITY]
    )


def _manager_calls(notifications):
    return [
        call.kwargs
        for call in notifications.call_args_list
        if "/manager/contract-ratings/" in call.kwargs["action_url"]
    ]


def test_new_rating_is_rated_by_the_cross_company_manager(cross, notifications):
    rating = rated_cycle(cross)

    assert rating.manager_at_creation == cross.cross_manager
    manager_calls = _manager_calls(notifications)
    assert [call["recipient"] for call in manager_calls] == [cross.cross_manager]
    # Filed under the manager's own company, which they can open.
    assert manager_calls[0]["company"] == cross.foreign
    events = [call.kwargs["metadata"]["event"] for call in notifications.call_args_list]
    assert "missing_rater" not in events


def test_cross_company_manager_sees_and_submits_without_access_to_the_employee_company(cross):
    rating = rated_cycle(cross)
    client = _client(cross.cross_manager, cross.foreign)

    listing = client.get("/contract-ratings/")
    assert listing.status_code == 200
    assert [row["id"] for row in listing.data["data"]["items"]] == [rating.id]

    detail = client.get(f"/contract-ratings/{rating.id}/")
    assert detail.status_code == 200
    data = detail.data["data"]
    assert "manager_response" in data and "employee_response" not in data
    assert data["manager_name"] == cross.cross_manager.full_name
    assert "company_name" not in data and "company_name" not in data["employee"]

    response = client.post(
        f"/contract-ratings/{rating.id}/manager-response/",
        {"criterion_ratings": answers(), "overall_remark": "fine"},
        format="json",
    )
    assert response.status_code == 200, response.data
    rating.refresh_from_db()
    assert rating.status == S.WAITING_EMPLOYEE
    assert rating.manager_response.submitted_by == cross.cross_manager


def test_employee_sees_only_the_manager_name(cross):
    rating = rated_cycle(cross)
    client = _client(cross.employee, cross.company)
    data = client.get(f"/contract-ratings/{rating.id}/").data["data"]
    assert data["manager_name"] == cross.cross_manager.full_name
    assert cross.foreign.name not in json.dumps(data, default=str)


@pytest.mark.parametrize("who", ["foreign_peer", "foreign_other_manager", "foreign_hr", "manager", "outsider"])
def test_nobody_else_gains_access(cross, who):
    rating = rated_cycle(cross)
    user = getattr(cross, who)
    company = cross.company if who in {"manager", "outsider"} else cross.foreign
    client = _client(user, company)

    assert client.get(f"/contract-ratings/{rating.id}/").status_code == 404
    listing = client.get("/contract-ratings/")
    assert rating.id not in [row["id"] for row in listing.data["data"]["items"]]
    with pytest.raises(PermissionDenied):
        submit_manager_response(rating.id, actor=user, criterion_ratings=answers())


def test_an_assignment_without_the_capability_grants_nothing(cross):
    rating = rated_cycle(cross)
    _drop_capability(cross.assignment)
    client = _client(cross.cross_manager, cross.foreign)

    assert client.get(f"/contract-ratings/{rating.id}/").status_code == 404
    with pytest.raises(PermissionDenied):
        submit_manager_response(rating.id, actor=cross.cross_manager, criterion_ratings=answers())


def test_open_ratings_follow_every_manager_change(cross):
    set_employee_manager(cross.profile, cross.manager.employee_profile, actor=cross.hr)
    rating = rated_cycle(cross)
    assert rating.manager_at_creation == cross.manager

    change = set_employee_manager(cross.profile, cross.cross_manager.employee_profile, actor=cross.hr)
    rating.refresh_from_db()
    assert change.reassigned_contract_rating_ids == [rating.id]
    assert rating.manager_at_creation == cross.cross_manager
    log = AuditLog.objects.get(action="contract_rating_manager_reassigned", entity_id=str(rating.id))
    assert log.metadata["previous_manager_user_id"] == cross.manager.id
    assert log.metadata["new_manager_user_id"] == cross.cross_manager.id
    # The previous manager can no longer rate.
    with pytest.raises(PermissionDenied):
        submit_manager_response(rating.id, actor=cross.manager, criterion_ratings=answers())

    set_employee_manager(cross.profile, cross.manager.employee_profile, actor=cross.hr)
    rating.refresh_from_db()
    assert rating.manager_at_creation == cross.manager

    set_employee_manager(cross.profile, None, actor=cross.hr)
    rating.refresh_from_db()
    assert rating.manager_at_creation is None


def test_new_manager_is_told_about_the_rating_they_inherit(cross, notifications):
    set_employee_manager(cross.profile, cross.manager.employee_profile, actor=cross.hr)
    rated_cycle(cross)
    notifications.reset_mock()

    set_employee_manager(cross.profile, cross.cross_manager.employee_profile, actor=cross.hr)

    calls = _manager_calls(notifications)
    assert [call["recipient"] for call in calls] == [cross.cross_manager]
    assert calls[0]["metadata"]["event"] == "opened"


def test_submitted_and_decided_ratings_stay_historical(cross):
    set_employee_manager(cross.profile, cross.manager.employee_profile, actor=cross.hr)
    rating = rated_cycle(cross)
    submit_manager_response(rating.id, actor=cross.manager, criterion_ratings=answers())

    set_employee_manager(cross.profile, cross.cross_manager.employee_profile, actor=cross.hr)
    rating.refresh_from_db()
    assert rating.manager_at_creation == cross.manager
    assert rating.manager_response.submitted_by == cross.manager

    submit_employee_response(rating.id, actor=cross.employee, criterion_ratings=answers())
    ContractRating.objects.filter(pk=rating.pk).update(status=S.DECIDED)
    set_employee_manager(cross.profile, None, actor=cross.hr)
    rating.refresh_from_db()
    assert rating.manager_at_creation == cross.manager


def test_a_response_returned_by_the_ceo_awaits_the_current_manager(cross):
    set_employee_manager(cross.profile, cross.manager.employee_profile, actor=cross.hr)
    rating = rated_cycle(cross)
    submit_manager_response(rating.id, actor=cross.manager, criterion_ratings=answers())
    rating.refresh_from_db()
    rating.manager_response.status = rating.manager_response.Status.RETURNED
    rating.manager_response.save(update_fields=["status"])
    ContractRating.objects.filter(pk=rating.pk).update(status=S.WAITING_MANAGER)

    set_employee_manager(cross.profile, cross.cross_manager.employee_profile, actor=cross.hr)

    rating.refresh_from_db()
    assert rating.manager_at_creation == cross.cross_manager
    submit_manager_response(rating.id, actor=cross.cross_manager, criterion_ratings=answers())


def test_consolidate_command_moves_already_open_ratings(cross):
    rating = rated_cycle(cross)
    # Legacy data: the open rating still names an earlier manager.
    ContractRating.objects.filter(pk=rating.pk).update(manager_at_creation=cross.manager)

    out = StringIO()
    call_command("consolidate_manager_relationships", "--format", "json", stdout=out)
    report = json.loads(out.getvalue())
    assert report["summary"]["mode"] == "dry-run"
    assert [row["rating_id"] for row in report["open_contract_ratings"]] == [rating.id]
    assert report["open_contract_ratings"][0]["recorded_manager"]["user_id"] == cross.manager.id
    assert report["open_contract_ratings"][0]["current_manager"]["user_id"] == cross.cross_manager.id
    rating.refresh_from_db()
    assert rating.manager_at_creation == cross.manager

    out = StringIO()
    call_command("consolidate_manager_relationships", "--apply", "--format", "json", stdout=out)
    report = json.loads(out.getvalue())
    assert report["summary"]["open_contract_ratings_to_reassign"] == 1
    assert report["summary"]["open_contract_ratings_still_mismatched"] == 0
    rating.refresh_from_db()
    assert rating.manager_at_creation == cross.cross_manager

    out = StringIO()
    call_command("consolidate_manager_relationships", "--format", "json", stdout=out)
    assert json.loads(out.getvalue())["open_contract_ratings"] == []


def test_consolidate_command_leaves_submitted_ratings_alone(cross):
    rating = rated_cycle(cross)
    submit_manager_response(rating.id, actor=cross.cross_manager, criterion_ratings=answers())
    ContractRating.objects.filter(pk=rating.pk).update(manager_at_creation=cross.manager)

    out = StringIO()
    call_command("consolidate_manager_relationships", "--apply", "--format", "json", stdout=out)

    assert json.loads(out.getvalue())["open_contract_ratings"] == []
    rating.refresh_from_db()
    assert rating.manager_at_creation == cross.manager
