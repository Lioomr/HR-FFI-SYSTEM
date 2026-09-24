"""The legacy contract-expiry sweep and the rating flow must not both own one contract.

Once a ``ContractRating`` exists for a ``ContractDecision``, the legacy sweep backs
off, and the rating flow closes the decision out when it settles the contract.
"""

from datetime import timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone

from contract_ratings.models import ContractRating
from contract_ratings.services import submit_ceo_decision
from contract_ratings.tasks import execute_scheduled_termination, process_contract_ratings
from employees.contract_expiry import (
    AUTO_RENEWAL_DAYS_BEFORE_EXPIRY,
    CEO_APPROVAL_WINDOW,
    process_contract_expiry,
    submit_decision,
)
from employees.models import ContractDecision, EmployeeProfile

from .conftest import rated_cycle
from .test_final_phase2 import pending_ceo

pytestmark = pytest.mark.django_db


def test_legacy_sweep_never_auto_renews_a_decision_owned_by_a_rating(world):
    rating = rated_cycle(world)
    decision = rating.contract_decision
    original_expiry = world.profile.contract_expiry
    assert decision.status == ContractDecision.Status.PENDING_HR

    # Past the legacy auto-renewal threshold, with HR never acting on the legacy decision.
    past_threshold = original_expiry - timedelta(days=AUTO_RENEWAL_DAYS_BEFORE_EXPIRY - 1)
    with patch("employees.contract_expiry.notify_hr_milestone") as milestone:
        summary = process_contract_expiry(today=past_threshold, now=timezone.now())

    decision.refresh_from_db()
    world.profile.refresh_from_db()
    rating.refresh_from_db()
    assert summary["auto_renewed"] == 0
    assert decision.status == ContractDecision.Status.PENDING_HR
    assert decision.finalized_at is None
    assert decision.automatic_renewal is False
    assert world.profile.contract_expiry == original_expiry
    assert rating.status == ContractRating.Status.PENDING_RESPONSES
    milestone.assert_not_called()


def test_legacy_sweep_sends_no_milestone_for_a_rated_decision(world):
    rated_cycle(world)
    at_65_days = world.profile.contract_expiry - timedelta(days=65)
    with patch("employees.contract_expiry.notify_hr_milestone") as milestone:
        process_contract_expiry(today=at_65_days, now=timezone.now())
    milestone.assert_not_called()


def test_hr_gets_one_notice_at_90_days_when_the_legacy_sweep_runs_first(world, notifications):
    # Both hourly tasks fire on the same minute; the legacy sweep may run before the
    # rating task has created the rating. It must defer to the rating flow's notice.
    today = world.profile.contract_expiry - timedelta(days=90)
    with patch("employees.contract_expiry.dispatch_notification_channels") as legacy_dispatch:
        process_contract_expiry(today=today, now=timezone.now())
        summary = process_contract_ratings(today=today)
    legacy_dispatch.assert_not_called()
    assert summary["created"] == 1
    hr_notices = [call for call in notifications.call_args_list if call.kwargs["recipient"].id == world.hr.id]
    assert [call.kwargs["metadata"]["event"] for call in hr_notices] == ["awaiting_routing"]


def test_legacy_sweep_never_auto_approves_or_reminds_a_rated_ceo_decision(world):
    rating = rated_cycle(world)
    with patch("employees.contract_expiry.notify_ceo_pending"):
        submit_decision(rating.contract_decision_id, actor=world.hr, decision_type="RENEW")
    past_deadline = timezone.now() + CEO_APPROVAL_WINDOW + timedelta(hours=1)

    with patch("employees.contract_expiry.notify_ceo_pending") as reminder:
        summary = process_contract_expiry(today=timezone.localdate(), now=past_deadline)

    decision = ContractDecision.objects.get(pk=rating.contract_decision_id)
    assert summary["auto_approved"] == 0
    assert decision.status == ContractDecision.Status.PENDING_CEO
    reminder.assert_not_called()


def test_rating_renewal_closes_the_decision_and_renews_the_contract(world):
    rating = pending_ceo(world)
    old_expiry = world.profile.contract_expiry

    result = submit_ceo_decision(rating.pk, actor=world.ceo, ceo_decision="RENEW", comment="Keep")

    decision = ContractDecision.objects.get(pk=result.contract_decision_id)
    world.profile.refresh_from_db()
    assert decision.status == ContractDecision.Status.APPROVED
    assert decision.decision_type == ContractDecision.DecisionType.RENEW
    assert decision.finalized_at is not None
    assert decision.ceo_decided_by_id == world.ceo.id
    assert world.profile.contract_date == old_expiry + timedelta(days=1)
    assert world.profile.contract_expiry > old_expiry

    # The legacy sweep leaves the closed decision alone and sends no duplicate final notice.
    with patch("employees.contract_expiry.notify_hr_final") as final_notice:
        process_contract_expiry(today=timezone.localdate(), now=timezone.now())
    final_notice.assert_not_called()


def test_rating_renewal_asks_hr_to_review_the_unsettled_annual_leave_term(world):
    rating = pending_ceo(world)
    old_start, old_end = world.profile.contract_date, world.profile.contract_expiry

    with patch("employees.contract_expiry.dispatch_notification_channels") as dispatch:
        dispatch.return_value = {"notification": object(), "created": True}
        result = submit_ceo_decision(rating.pk, actor=world.ceo, ceo_decision="RENEW", comment="Keep")

    calls = [
        call for call in dispatch.call_args_list if call.kwargs["deduplication_key"].endswith(":renewal-settlement")
    ]
    assert {call.kwargs["recipient"].id for call in calls} == {world.hr.id}
    notice = calls[0].kwargs
    assert notice["deduplication_key"] == f"contract.expiry:{result.contract_decision_id}:renewal-settlement"
    assert notice["action_url"] == "/hr/annual-leave-payments"
    assert notice["metadata"]["milestone"] == "contract.renewal_settlement_review_required"
    assert notice["metadata"]["cycle_start"] == old_start.isoformat()
    assert notice["metadata"]["cycle_end"] == old_end.isoformat()


def test_rating_termination_closes_the_decision_and_asks_hr_for_a_settlement(world):
    rating = pending_ceo(world)
    rating = submit_ceo_decision(rating.pk, actor=world.ceo, ceo_decision="TERMINATE", comment="End")
    assert rating.contract_decision.status == ContractDecision.Status.PENDING_HR

    with patch("employees.contract_expiry.dispatch_notification_channels") as dispatch:
        dispatch.return_value = {"notification": object(), "created": True}
        execute_scheduled_termination(rating.pk, today=world.profile.contract_expiry)

    decision = ContractDecision.objects.get(pk=rating.contract_decision_id)
    world.profile.refresh_from_db()
    assert world.profile.employment_status == EmployeeProfile.EmploymentStatus.TERMINATED
    assert decision.status == ContractDecision.Status.APPROVED
    assert decision.decision_type == ContractDecision.DecisionType.TERMINATE
    assert decision.finalized_at is not None
    settlement_calls = [
        call for call in dispatch.call_args_list if call.kwargs["deduplication_key"].endswith(":termination-settlement")
    ]
    assert {call.kwargs["recipient"].id for call in settlement_calls} == {world.hr.id}
    assert settlement_calls[0].kwargs["metadata"]["is_termination_settlement"] is True
    assert settlement_calls[0].kwargs["action_url"] == "/hr/annual-leave-payments"
