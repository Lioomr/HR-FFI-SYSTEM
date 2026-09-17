from datetime import timedelta
from decimal import Decimal

import pytest

from contract_ratings.models import ContractRating
from contract_ratings.services import ensure_contract_rating
from contract_ratings.tasks import process_contract_ratings
from employees.models import EmployeeProfile

from .conftest import answers

pytestmark = pytest.mark.django_db


def post_as(world, actor, url, data=None):
    world.client.force_authenticate(actor)
    return world.client.post(url, data or {}, format="json")


def gate(world, mode="RATE"):
    rating, _ = ensure_contract_rating(world.profile)
    response = post_as(world, world.hr, f"/contract-ratings/{rating.pk}/hr-gate/", {"rating_mode": mode})
    assert response.status_code == 200, response.data
    return rating


def submit_both(world, rating, manager_score=85, employee_score=94):
    response = post_as(
        world,
        world.manager,
        f"/contract-ratings/{rating.pk}/manager-response/",
        {"criterion_ratings": answers(manager_score, "VERY_GOOD")},
    )
    assert response.status_code == 200, response.data
    response = post_as(
        world,
        world.employee,
        f"/contract-ratings/{rating.pk}/employee-response/",
        {"criterion_ratings": answers(employee_score, "EXCELLENT")},
    )
    assert response.status_code == 200, response.data
    assert response.data["data"]["status"] == ContractRating.Status.PENDING_CEO


def test_api_walk_rate_to_salary_change(world):
    rating = gate(world)
    submit_both(world, rating)
    world.client.force_authenticate(world.ceo)
    detail = world.client.get(f"/contract-ratings/{rating.pk}/")
    assert detail.status_code == 200
    assert detail.data["data"]["manager_response"] and detail.data["data"]["employee_response"]

    payload = {
        "ceo_decision": "RENEW_WITH_CHANGES",
        "ceo_approved_terms": {"basic_salary": "1250.00"},
        "salary_effective_date": str(world.profile.contract_expiry + timedelta(days=1)),
    }
    decided = post_as(world, world.ceo, f"/contract-ratings/{rating.pk}/ceo-decision/", payload)
    assert decided.status_code == 200, decided.data
    world.profile.refresh_from_db()
    assert world.profile.basic_salary == Decimal("1250.00")
    assert decided.data["data"]["salary_change_applied_at"]


def test_api_walk_return_employee_hr_comment_then_renew(world):
    rating = gate(world)
    submit_both(world, rating)
    returned = post_as(
        world,
        world.ceo,
        f"/contract-ratings/{rating.pk}/ceo-decision/",
        {"ceo_decision": "RETURN_TO_EMPLOYEE", "comment": "Please correct"},
    )
    assert returned.status_code == 200
    rating.refresh_from_db()
    assert rating.status == ContractRating.Status.WAITING_EMPLOYEE
    resubmitted = post_as(
        world,
        world.employee,
        f"/contract-ratings/{rating.pk}/employee-response/",
        {"criterion_ratings": answers(65, "ACCEPTABLE")},
    )
    assert resubmitted.data["data"]["status"] == ContractRating.Status.PENDING_CEO

    assert post_as(world, world.ceo, f"/contract-ratings/{rating.pk}/request-hr-comment/").status_code == 200
    world.client.force_authenticate(world.hr)
    unlocked = world.client.get(f"/contract-ratings/{rating.pk}/").data["data"]
    assert unlocked["manager_response"] and unlocked["employee_response"]
    assert (
        post_as(world, world.hr, f"/contract-ratings/{rating.pk}/hr-comment/", {"comment": "Advisory"}).status_code
        == 200
    )
    decided = post_as(world, world.ceo, f"/contract-ratings/{rating.pk}/ceo-decision/", {"ceo_decision": "RENEW"})
    assert decided.data["data"]["status"] == ContractRating.Status.DECIDED


def test_api_walk_scheduled_termination(world):
    rating = gate(world)
    submit_both(world, rating)
    decided = post_as(world, world.ceo, f"/contract-ratings/{rating.pk}/ceo-decision/", {"ceo_decision": "TERMINATE"})
    assert decided.status_code == 200
    world.profile.refresh_from_db()
    assert world.profile.employment_status == EmployeeProfile.EmploymentStatus.ACTIVE
    assert world.profile.is_archived is False
    process_contract_ratings(today=world.profile.contract_expiry)
    world.profile.refresh_from_db()
    assert world.profile.employment_status == EmployeeProfile.EmploymentStatus.TERMINATED
    assert world.profile.is_archived is True


def test_api_walk_manual_resolution_on_changed_contract(world):
    rating = gate(world)
    submit_both(world, rating)
    EmployeeProfile.objects.filter(pk=world.profile.pk).update(
        contract_expiry=world.profile.contract_expiry + timedelta(days=365)
    )
    result = post_as(world, world.ceo, f"/contract-ratings/{rating.pk}/ceo-decision/", {"ceo_decision": "RENEW"})
    assert result.status_code == 200
    rating.refresh_from_db()
    assert rating.status == ContractRating.Status.MANUAL_RESOLUTION_REQUIRED


def test_api_walk_ceo_decides_without_hr_comment(world):
    rating = gate(world)
    submit_both(world, rating)
    world.client.force_authenticate(world.hr)
    coarse = world.client.get(f"/contract-ratings/{rating.pk}/").data["data"]
    assert "manager_response" not in coarse and "employee_response" not in coarse
    assert (
        post_as(world, world.ceo, f"/contract-ratings/{rating.pk}/ceo-decision/", {"ceo_decision": "RENEW"}).status_code
        == 200
    )
    world.client.force_authenticate(world.hr)
    outcome = world.client.get(f"/contract-ratings/{rating.pk}/").data["data"]
    assert outcome["ceo_decision"] == "RENEW"
    assert "manager_response" not in outcome and "employee_response" not in outcome


def test_api_walk_skip_to_ceo_has_no_rater_trace_and_rejects_return(world):
    rating = gate(world, "SKIP_TO_CEO")
    for actor in (world.manager, world.employee):
        world.client.force_authenticate(actor)
        assert world.client.get(f"/contract-ratings/{rating.pk}/").status_code == 404
    world.client.force_authenticate(world.ceo)
    payload = world.client.get(f"/contract-ratings/{rating.pk}/").data["data"]
    assert payload["rating_mode"] == "SKIP_TO_CEO"
    assert {"manager_response", "employee_response", "comparison_summary"}.isdisjoint(payload)
    rejected = post_as(
        world,
        world.ceo,
        f"/contract-ratings/{rating.pk}/ceo-decision/",
        {"ceo_decision": "RETURN_TO_MANAGER", "comment": "Impossible"},
    )
    assert rejected.status_code == 422
    assert (
        post_as(world, world.ceo, f"/contract-ratings/{rating.pk}/ceo-decision/", {"ceo_decision": "RENEW"}).status_code
        == 200
    )
