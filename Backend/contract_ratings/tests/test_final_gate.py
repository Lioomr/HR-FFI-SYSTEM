from datetime import timedelta

import pytest
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from audit.models import AuditLog
from contract_ratings.models import ContractRating, ContractRatingResponse
from contract_ratings.services import (
    ensure_contract_rating,
    submit_ceo_decision,
    submit_employee_response,
    submit_hr_gate_decision,
    submit_manager_response,
)
from contract_ratings.tasks import process_contract_ratings

from .conftest import answers
from .test_final_phase3 import calls_for

pytestmark = pytest.mark.django_db


def test_new_cycle_waits_at_hr_gate_and_notifies_only_hr(world, notifications):
    rating, created = ensure_contract_rating(world.profile)
    assert created is True
    assert rating.status == ContractRating.Status.PENDING_HR_GATE
    assert rating.rating_mode == ""
    assert rating.manager_response is None and rating.employee_response is None
    recipients = {call["recipient"].pk for call in calls_for(notifications, "awaiting_routing")}
    assert recipients == {world.hr.pk}
    assert not calls_for(notifications, "opened")


def test_hr_gate_rate_opens_both_responses_once(world, notifications):
    rating, _ = ensure_contract_rating(world.profile)
    notifications.reset_mock()
    result = submit_hr_gate_decision(rating.pk, actor=world.hr, rating_mode="RATE")
    assert result.status == ContractRating.Status.PENDING_RESPONSES
    assert result.rating_mode == ContractRating.RatingMode.RATE
    assert result.hr_gate_decided_by == world.hr
    assert result.hr_gate_decided_at is not None
    recipients = {call["recipient"].pk for call in calls_for(notifications, "opened")}
    assert recipients == {world.manager.pk, world.employee.pk}
    with pytest.raises(ValueError):
        submit_hr_gate_decision(rating.pk, actor=world.hr, rating_mode="SKIP_TO_CEO")
    assert AuditLog.objects.filter(action="contract_rating_hr_gate_decided", entity_id=str(rating.pk)).count() == 1


@pytest.mark.parametrize("actor", ["manager", "employee", "ceo", "admin"])
def test_hr_gate_rejects_every_non_hr_role(world, actor):
    rating, _ = ensure_contract_rating(world.profile)
    with pytest.raises(PermissionDenied):
        submit_hr_gate_decision(rating.pk, actor=getattr(world, actor), rating_mode="RATE")


def test_hr_gate_validates_mode(world):
    rating, _ = ensure_contract_rating(world.profile)
    with pytest.raises(ValidationError):
        submit_hr_gate_decision(rating.pk, actor=world.hr, rating_mode="UNKNOWN")


def test_skip_to_ceo_collects_no_responses_and_never_exposes_cycle_to_raters(world, notifications):
    rating, _ = ensure_contract_rating(world.profile)
    notifications.reset_mock()
    skipped = submit_hr_gate_decision(rating.pk, actor=world.hr, rating_mode="SKIP_TO_CEO")
    assert skipped.status == ContractRating.Status.PENDING_CEO
    assert skipped.manager_response is None and skipped.employee_response is None
    assert not calls_for(notifications, "opened")
    recipients = {call["recipient"].pk for call in calls_for(notifications, "sent_directly_to_ceo")}
    assert recipients == {world.ceo.pk, world.admin.pk}

    for actor in (world.manager, world.employee):
        world.client.force_authenticate(actor)
        assert world.client.get(f"/contract-ratings/{rating.pk}/").status_code == 404
    with pytest.raises(ValueError):
        submit_manager_response(rating.pk, actor=world.manager, criterion_ratings=answers())
    with pytest.raises(ValueError):
        submit_employee_response(rating.pk, actor=world.employee, criterion_ratings=answers())


def test_hr_gate_api_shows_fresh_account_connection_signal(world):
    rating, _ = ensure_contract_rating(world.profile)
    world.client.force_authenticate(world.hr)
    detail = world.client.get(f"/contract-ratings/{rating.pk}/").data["data"]
    assert detail["account_connected"] is True
    assert detail["rating_mode"] == ""
    response = world.client.post(f"/contract-ratings/{rating.pk}/hr-gate/", {"rating_mode": "RATE"}, format="json")
    assert response.status_code == 200
    assert response.data["data"]["rating_mode"] == "RATE"


def test_unlinked_employee_account_is_visible_to_hr_without_forcing_a_route(world):
    profile = world.outsider.employee_profile
    profile.manager_profile = world.manager.employee_profile
    profile.contract_date = world.profile.contract_date
    profile.contract_expiry = world.profile.contract_expiry
    profile.save()
    type(profile)._base_manager.filter(pk=profile.pk).update(user=None)
    profile.refresh_from_db()
    rating, _ = ensure_contract_rating(profile)
    world.client.force_authenticate(world.hr)
    payload = world.client.get(f"/contract-ratings/{rating.pk}/").data["data"]
    assert payload["account_connected"] is False
    result = submit_hr_gate_decision(rating.pk, actor=world.hr, rating_mode="RATE")
    assert result.status == ContractRating.Status.PENDING_RESPONSES


def skipped_rating(world):
    rating, _ = ensure_contract_rating(world.profile)
    return submit_hr_gate_decision(rating.pk, actor=world.hr, rating_mode="SKIP_TO_CEO")


def test_ceo_skipped_payload_has_banner_metadata_and_no_evaluation_panels(world):
    rating = skipped_rating(world)
    world.client.force_authenticate(world.ceo)
    payload = world.client.get(f"/contract-ratings/{rating.pk}/").data["data"]
    assert payload["rating_mode"] == "SKIP_TO_CEO"
    assert payload["hr_gate_decided_by"] == world.hr.pk
    assert payload["hr_gate_decided_at"]
    assert {"manager_response", "employee_response", "comparison_summary"}.isdisjoint(payload)


@pytest.mark.parametrize("decision", ["RENEW", "RENEW_WITH_CHANGES", "TERMINATE"])
def test_skipped_rating_supports_all_final_decisions(world, decision):
    rating = skipped_rating(world)
    kwargs = {}
    if decision == "RENEW_WITH_CHANGES":
        kwargs = {
            "ceo_approved_terms": {"basic_salary": "1200.00"},
            "salary_effective_date": world.profile.contract_expiry + timedelta(days=1),
        }
    result = submit_ceo_decision(rating.pk, actor=world.ceo, ceo_decision=decision, **kwargs)
    assert result.status == ContractRating.Status.DECIDED
    assert result.ceo_decision == decision


@pytest.mark.parametrize("target", ["RETURN_TO_MANAGER", "RETURN_TO_EMPLOYEE", "RETURN_TO_BOTH"])
def test_skipped_rating_rejects_return_actions(world, target):
    rating = skipped_rating(world)
    with pytest.raises(ValueError, match="no responses"):
        submit_ceo_decision(rating.pk, actor=world.ceo, ceo_decision=target, comment="Correct")
    assert not ContractRatingResponse.objects.filter(rating=rating).exists()


def test_gate_65_day_reminder_targets_hr_only(world, notifications):
    rating, _ = ensure_contract_rating(world.profile)
    notifications.reset_mock()
    today = world.profile.contract_expiry - timedelta(days=65)
    process_contract_ratings(today=today)
    recipients = {call["recipient"].pk for call in calls_for(notifications, "hr_gate_reminder")}
    assert recipients == {world.hr.pk}
    assert not calls_for(notifications, "incomplete")
    assert not calls_for(notifications, "reminder")


def test_skip_final_notifications_never_contact_manager(world, notifications):
    rating = skipped_rating(world)
    notifications.reset_mock()
    submit_ceo_decision(rating.pk, actor=world.ceo, ceo_decision="RENEW")
    recipients = {call["recipient"].pk for call in calls_for(notifications, "ceo_decided_renew")}
    assert recipients == {world.hr.pk}
