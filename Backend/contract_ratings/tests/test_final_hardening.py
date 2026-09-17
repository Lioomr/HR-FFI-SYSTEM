from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from contract_ratings.models import ContractRating
from contract_ratings.services import (
    ensure_contract_rating,
    request_hr_comment,
    submit_ceo_decision,
    submit_employee_response,
    submit_hr_comment,
    submit_manager_response,
)
from contract_ratings.tasks import process_contract_ratings
from core.models import DelegationRule
from employees.contract_expiry import ensure_contract_decision
from employees.models import ContractDecision, EmployeeProfile

from .conftest import answers
from .test_final_phase2 import pending_ceo

pytestmark = pytest.mark.django_db


def delegate(world, role):
    return DelegationRule.objects.create(
        from_user=getattr(world, role),
        to_user=world.outsider,
        start_at=timezone.now() - timedelta(hours=1),
        end_at=timezone.now() + timedelta(days=1),
        capabilities=[DelegationRule.Capability.WORKFLOW_APPROVE],
    )


@pytest.mark.parametrize("role", ["manager", "hr", "ceo"])
def test_workflow_delegates_can_perform_the_delegated_action(world, role):
    delegate(world, role)
    if role == "manager":
        rating, _ = ensure_contract_rating(world.profile)
        result = submit_manager_response(rating.pk, actor=world.outsider, criterion_ratings=answers())
        assert result.manager_response.submitted_by == world.outsider
    elif role == "hr":
        rating = pending_ceo(world)
        request_hr_comment(rating.pk, actor=world.ceo)
        result = submit_hr_comment(rating.pk, actor=world.outsider, comment="Delegated advisory")
        assert result.hr_comment_by == world.outsider
    else:
        rating = pending_ceo(world)
        result = submit_ceo_decision(rating.pk, actor=world.outsider, ceo_decision="RENEW")
        assert result.ceo_decided_by == world.outsider


def test_hr_self_dealing_is_blocked_when_hr_authored_manager_response(world):
    rating, _ = ensure_contract_rating(world.profile)
    submit_manager_response(rating.pk, actor=world.manager, criterion_ratings=answers())
    rating.refresh_from_db()
    rating.manager_response.submitted_by = world.hr
    rating.manager_response.save(update_fields=["submitted_by"])
    submit_employee_response(rating.pk, actor=world.employee, criterion_ratings=answers())
    request_hr_comment(rating.pk, actor=world.ceo)
    with pytest.raises(PermissionDenied):
        submit_hr_comment(rating.pk, actor=world.hr, comment="Self review")


@pytest.mark.parametrize("role", ["manager", "employee"])
def test_list_payload_preserves_rater_privacy(world, role):
    pending_ceo(world)
    world.client.force_authenticate(getattr(world, role))
    response = world.client.get("/contract-ratings/")
    assert response.status_code == 200
    payload = response.data["data"]["items"][0]
    own = role
    other = "employee" if role == "manager" else "manager"
    assert f"{own}_response" in payload
    assert f"{other}_response" not in payload
    assert "comparison_summary" not in payload
    assert "ceo_decision" not in payload


def test_hr_list_is_coarse_until_a_comment_is_requested(world):
    rating = pending_ceo(world)
    world.client.force_authenticate(world.hr)
    before = world.client.get("/contract-ratings/").data["data"]["items"][0]
    assert "manager_response" not in before and "employee_response" not in before
    request_hr_comment(rating.pk, actor=world.ceo)
    after = world.client.get("/contract-ratings/").data["data"]["items"][0]
    assert after["manager_response"] and after["employee_response"]


@pytest.mark.parametrize(
    "terms,effective_date",
    [({}, None), ({"basic_salary": "1200.00"}, None), ({}, timezone.localdate() + timedelta(days=1))],
)
def test_salary_decision_requires_terms_and_effective_date(world, terms, effective_date):
    rating = pending_ceo(world)
    with pytest.raises(ValidationError):
        submit_ceo_decision(
            rating.pk,
            actor=world.ceo,
            ceo_decision="RENEW_WITH_CHANGES",
            ceo_approved_terms=terms,
            salary_effective_date=effective_date,
        )


def test_salary_decrease_is_allowed_when_ceo_explicitly_decides_it(world):
    rating = pending_ceo(world)
    result = submit_ceo_decision(
        rating.pk,
        actor=world.ceo,
        ceo_decision="RENEW_WITH_CHANGES",
        ceo_approved_terms={"basic_salary": "900.00"},
        salary_effective_date=world.profile.contract_expiry + timedelta(days=1),
    )
    world.profile.refresh_from_db()
    assert result.status == ContractRating.Status.DECIDED
    assert world.profile.basic_salary == Decimal("900.00")


@pytest.mark.parametrize("action", ["manager_response", "request_hr", "ceo_decision"])
def test_contract_snapshot_is_checked_before_mutating_actions(world, action):
    if action == "manager_response":
        rating, _ = ensure_contract_rating(world.profile)
    else:
        rating = pending_ceo(world)
    EmployeeProfile.objects.filter(pk=world.profile.pk).update(
        contract_expiry=world.profile.contract_expiry + timedelta(days=365)
    )
    if action == "manager_response":
        result = submit_manager_response(rating.pk, actor=world.manager, criterion_ratings=answers())
    elif action == "request_hr":
        result = request_hr_comment(rating.pk, actor=world.ceo)
    else:
        result = submit_ceo_decision(rating.pk, actor=world.ceo, ceo_decision="RENEW")
    assert result.status == ContractRating.Status.MANUAL_RESOLUTION_REQUIRED


@pytest.mark.parametrize("days_left", [-1, 91])
def test_scheduler_excludes_contracts_outside_the_current_window(world, days_left):
    today = timezone.localdate()
    world.profile.contract_expiry = today + timedelta(days=days_left)
    world.profile.save(update_fields=["contract_expiry"])
    assert process_contract_ratings(today=today)["created"] == 0
    assert not ContractRating.objects.exists()


@pytest.mark.parametrize(
    "status", [status for status in ContractDecision.Status.values if status not in {"PENDING_HR", "PENDING_CEO"}]
)
def test_scheduler_excludes_closed_standalone_decisions(world, status):
    decision, _ = ensure_contract_decision(world.profile)
    decision.status = status
    decision.save(update_fields=["status"])
    assert process_contract_ratings()["created"] == 0
    assert not ContractRating.objects.exists()


def test_historical_rating_does_not_block_a_new_contract_cycle(world):
    old, _ = ensure_contract_rating(world.profile)
    world.profile.contract_date = world.profile.contract_expiry
    world.profile.contract_expiry += timedelta(days=365)
    world.profile.save(update_fields=["contract_date", "contract_expiry"])
    today = world.profile.contract_expiry - timedelta(days=89)
    assert process_contract_ratings(today=today)["created"] == 1
    assert ContractRating.objects.filter(employee_profile=world.profile).exclude(pk=old.pk).count() == 1


def test_unauthenticated_and_unrelated_users_cannot_use_action_routes(world):
    rating, _ = ensure_contract_rating(world.profile)
    url = f"/contract-ratings/{rating.pk}/manager-response/"
    assert world.client.post(url, {"criterion_ratings": answers()}, format="json").status_code == 401
    world.client.force_authenticate(world.outsider)
    assert world.client.post(url, {"criterion_ratings": answers()}, format="json").status_code == 404
