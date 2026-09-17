from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth.models import Group
from django.db import close_old_connections
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from audit.models import AuditLog
from contract_ratings.models import ContractRating
from contract_ratings.services import (
    ensure_contract_rating,
    submit_ceo_decision,
    submit_employee_response,
    submit_hr_review,
    submit_manager_response,
)
from contract_ratings.tasks import execute_scheduled_termination, process_contract_ratings
from core.models import DelegationRule
from employees.contract_expiry import ensure_contract_decision
from employees.models import ContractDecision, EmployeeProfile

from .conftest import answers
from .test_ratings import cycle, pending_ceo

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize("days_left", [0, 1, 45, 65, 89, 90])
def test_scheduler_catches_up_current_contract_once(world, days_left):
    today = timezone.localdate()
    world.profile.contract_expiry = today + timedelta(days=days_left)
    world.profile.save(update_fields=["contract_expiry"])
    assert process_contract_ratings(today=today)["created"] == 1
    assert process_contract_ratings(today=today)["created"] == 0
    assert ContractRating.objects.filter(employee_profile=world.profile).count() == 1


@pytest.mark.parametrize("days_left", [-1, 91])
def test_scheduler_excludes_expired_and_future_contracts(world, days_left):
    today = timezone.localdate()
    world.profile.contract_expiry = today + timedelta(days=days_left)
    world.profile.save(update_fields=["contract_expiry"])
    assert process_contract_ratings(today=today)["created"] == 0
    assert not ContractRating.objects.exists()


@pytest.mark.parametrize(
    "status", [status for status in ContractDecision.Status.values if status not in {"PENDING_HR", "PENDING_CEO"}]
)
def test_scheduler_excludes_closed_contract_decisions(world, status):
    decision, _ = ensure_contract_decision(world.profile)
    decision.status = status
    decision.save(update_fields=["status"])
    assert process_contract_ratings()["created"] == 0
    assert not ContractRating.objects.exists()


def test_scheduler_excludes_finalized_pending_decision(world):
    decision, _ = ensure_contract_decision(world.profile)
    decision.finalized_at = timezone.now()
    decision.save(update_fields=["finalized_at"])
    assert process_contract_ratings()["created"] == 0
    assert not ContractRating.objects.exists()


def test_historical_rating_does_not_block_new_contract_cycle(world):
    old_rating, _ = ensure_contract_rating(world.profile)
    world.profile.contract_date = world.profile.contract_expiry
    world.profile.contract_expiry += timedelta(days=365)
    world.profile.save(update_fields=["contract_date", "contract_expiry"])
    today = world.profile.contract_expiry - timedelta(days=89)
    assert process_contract_ratings(today=today)["created"] == 1
    assert ContractRating.objects.filter(employee_profile=world.profile).exclude(pk=old_rating.pk).count() == 1


@pytest.mark.parametrize("change", ["archived", "inactive", "expiry", "finalized"])
def test_scheduler_rechecks_stale_candidate_under_lock(world, change):
    decision, _ = ensure_contract_decision(world.profile)
    if change == "archived":
        EmployeeProfile.objects.filter(pk=world.profile.pk).update(is_archived=True)
    elif change == "inactive":
        EmployeeProfile.objects.filter(pk=world.profile.pk).update(employment_status="TERMINATED")
    elif change == "expiry":
        EmployeeProfile.objects.filter(pk=world.profile.pk).update(
            contract_expiry=timezone.localdate() - timedelta(days=1)
        )
    else:
        ContractDecision.objects.filter(pk=decision.pk).update(finalized_at=timezone.now())
    assert ensure_contract_rating(world.profile, only_if_due_on=timezone.localdate()) == (None, False)
    assert not ContractRating.objects.exists()


@pytest.mark.parametrize("delegator", ["manager", "hr", "ceo"])
def test_delegated_actions(world, delegator):
    DelegationRule.objects.create(
        from_user=getattr(world, delegator),
        to_user=world.outsider,
        start_at=timezone.now() - timedelta(hours=1),
        end_at=timezone.now() + timedelta(days=1),
        capabilities=["workflow.approve"],
    )
    if delegator == "manager":
        rating, _ = ensure_contract_rating(world.profile)
        result = submit_manager_response(
            rating.id, actor=world.outsider, criterion_ratings=answers(), recommendation="CONTINUE_CONTRACT"
        )
        assert result.manager_response.submitted_by == world.outsider
    elif delegator == "hr":
        rating = cycle(world)
        assert submit_hr_review(rating.id, actor=world.outsider, action="approve").status == "PENDING_CEO"
    else:
        rating = pending_ceo(world)
        assert submit_ceo_decision(rating.id, actor=world.outsider, action="ACCEPT").status == "APPROVED"


def test_privileged_raters_keep_confidentiality(world):
    rating = cycle(world)
    for user in (world.manager, world.employee):
        user.groups.add(Group.objects.get_or_create(name="HRManager")[0])
        world.client.force_authenticate(user)
        data = world.client.get(f"/contract-ratings/{rating.id}/").data["data"]
        assert "comparison_summary" not in data and "workflow" not in data


@pytest.mark.parametrize(
    "data",
    [
        {"recommendation": "CONTINUE_WITH_CHANGES"},
        {"recommendation": "CONTINUE_CONTRACT", "recommended_change_types": ["SALARY_INCREASE"]},
        {"recommendation": "CONTINUE_WITH_CHANGES", "recommended_change_types": ["SALARY_INCREASE"]},
        {"recommendation": "CONTINUE_WITH_CHANGES", "recommended_change_types": ["JOB_TITLE_CHANGE"]},
        {
            "recommendation": "CONTINUE_WITH_CHANGES",
            "recommended_change_types": ["POSITION_CHANGE"],
            "proposed_position_id": -1,
        },
        {"recommendation": "CONTINUE_WITH_CHANGES", "recommended_change_types": ["OTHER"]},
        {"recommendation": "CONTINUE_CONTRACT", "proposed_terms": {"basic_salary": "2"}},
        {
            "recommendation": "CONTINUE_WITH_CHANGES",
            "recommended_change_types": ["SALARY_INCREASE"],
            "proposed_terms": {"basic_salary": "1200", "total_salary": "900"},
        },
    ],
)
def test_manager_change_validation(world, data):
    rating, _ = ensure_contract_rating(world.profile)
    with pytest.raises(ValidationError):
        submit_manager_response(rating.id, actor=world.manager, criterion_ratings=answers(), **data)


def test_informational_changes_never_mutate_profile(world):
    rating, _ = ensure_contract_rating(world.profile)
    submit_manager_response(
        rating.id,
        actor=world.manager,
        criterion_ratings=answers(),
        recommendation="CONTINUE_WITH_CHANGES",
        recommended_change_types=["JOB_TITLE_CHANGE", "OTHER"],
        proposed_job_title="Senior",
        other_change_notes="Training",
    )
    submit_employee_response(rating.id, actor=world.employee, criterion_ratings=answers())
    submit_hr_review(rating.id, actor=world.hr, action="approve")
    submit_ceo_decision(rating.id, actor=world.ceo, action="ACCEPT")
    world.profile.refresh_from_db()
    assert world.profile.job_title != "Senior"


def test_salary_decrease_not_invented_floor(world):
    rating, _ = ensure_contract_rating(world.profile)
    submit_manager_response(
        rating.id,
        actor=world.manager,
        criterion_ratings=answers(),
        recommendation="CONTINUE_WITH_CHANGES",
        recommended_change_types=["SALARY_INCREASE"],
        proposed_terms={"basic_salary": "900"},
    )
    submit_employee_response(rating.id, actor=world.employee, criterion_ratings=answers())
    submit_hr_review(rating.id, actor=world.hr, action="approve")
    submit_ceo_decision(rating.id, actor=world.ceo, action="ACCEPT")
    world.profile.refresh_from_db()
    assert world.profile.basic_salary == Decimal("900")


@pytest.mark.parametrize("option", ["", "INVALID"])
def test_alternative_requires_valid_option(world, option):
    rating = pending_ceo(world)
    with pytest.raises(ValidationError):
        submit_ceo_decision(
            rating.id, actor=world.ceo, action="DECLINE_WITH_ALTERNATIVE", comment="Reason", ceo_selected_option=option
        )


def test_termination_task_rolls_back_on_record_failure(world):
    rating = pending_ceo(world, recommendation="TERMINATE")
    submit_ceo_decision(rating.id, actor=world.ceo, action="ACCEPT")
    with patch("contract_ratings.services._record", side_effect=RuntimeError("history unavailable")):
        with pytest.raises(RuntimeError):
            execute_scheduled_termination(rating.id, today=world.profile.contract_expiry)
    world.profile.refresh_from_db()
    world.employee.refresh_from_db()
    rating.refresh_from_db()
    assert not world.profile.is_archived and world.employee.is_active and not rating.termination_processed_at


def test_termination_via_same_scheduler(world):
    rating = pending_ceo(world, recommendation="TERMINATE")
    submit_ceo_decision(rating.id, actor=world.ceo, action="ACCEPT")
    process_contract_ratings(today=world.profile.contract_expiry)
    rating.refresh_from_db()
    assert rating.termination_processed_at


def test_api_anonymous_and_unauthorized_actions(world):
    rating = cycle(world)
    assert world.client.get("/contract-ratings/").status_code == 401
    world.client.force_authenticate(world.employee)
    assert world.client.post(f"/contract-ratings/{rating.id}/hr-review/", {"action": "approve"}).status_code == 403
    assert world.client.post(f"/contract-ratings/{rating.id}/ceo-decision/", {"action": "ACCEPT"}).status_code == 403
    assert world.client.post(f"/contract-ratings/{rating.id}/employee-response/", [], format="json").status_code == 422


def test_ceo_sees_pending_and_own_decided_only(world):
    rating = cycle(world)
    world.client.force_authenticate(world.ceo)
    assert world.client.get(f"/contract-ratings/{rating.id}/").status_code == 404
    submit_hr_review(rating.id, actor=world.hr, action="approve")
    assert world.client.get(f"/contract-ratings/{rating.id}/").status_code == 200
    submit_ceo_decision(rating.id, actor=world.admin, action="DECLINE", comment="No")
    assert world.client.get(f"/contract-ratings/{rating.id}/").status_code == 404


def test_workflow_guard_is_authoritative(world):
    rating = pending_ceo(world)
    with patch("contract_ratings.services.can_user_act_on_instance", return_value=False):
        with pytest.raises(PermissionDenied):
            submit_ceo_decision(rating.id, actor=world.ceo, action="ACCEPT")


def test_api_score_validation_and_locked_side(world):
    rating, _ = ensure_contract_rating(world.profile)
    world.client.force_authenticate(world.manager)
    path = f"/contract-ratings/{rating.id}/manager-response/"
    response = world.client.post(
        path, {"criterion_ratings": answers(85, "EXCELLENT"), "recommendation": "CONTINUE_CONTRACT"}, format="json"
    )
    assert response.status_code == 422
    submit_manager_response(
        rating.id, actor=world.manager, criterion_ratings=answers(), recommendation="CONTINUE_CONTRACT"
    )
    with pytest.raises(ValueError, match="locked"):
        submit_manager_response(
            rating.id, actor=world.manager, criterion_ratings=answers(), recommendation="CONTINUE_CONTRACT"
        )


@pytest.mark.parametrize("stage", ["manager", "employee", "hr"])
def test_snapshot_checks_before_non_ceo_mutations(world, stage):
    rating = cycle(world) if stage == "hr" else ensure_contract_rating(world.profile)[0]
    EmployeeProfile.objects.filter(pk=world.profile.pk).update(contract_date=timezone.localdate())
    if stage == "manager":
        result = submit_manager_response(
            rating.id, actor=world.manager, criterion_ratings=answers(), recommendation="CONTINUE_CONTRACT"
        )
    elif stage == "employee":
        result = submit_employee_response(rating.id, actor=world.employee, criterion_ratings=answers())
    else:
        result = submit_hr_review(rating.id, actor=world.hr, action="approve")
    assert result.status == "MANUAL_RESOLUTION_REQUIRED"


def test_ceo_can_propose_salary_alternative_without_original_salary(world):
    rating = pending_ceo(world)
    result = submit_ceo_decision(
        rating.id,
        actor=world.ceo,
        action="DECLINE_WITH_ALTERNATIVE",
        comment="Raise",
        ceo_selected_option="RENEW_WITH_CHANGES",
        ceo_approved_terms={"basic_salary": "1350"},
        ceo_salary_override_reason="Revised recommendation",
    )
    assert result.salary_change_applied_at
    assert result.salary_after_snapshot["basic_salary"] == "1350.00"


def test_notification_exception_does_not_block_submission(world, notifications):
    notifications.side_effect = RuntimeError("provider unavailable")
    rating, created = ensure_contract_rating(world.profile)
    assert created
    result = submit_manager_response(
        rating.id, actor=world.manager, criterion_ratings=answers(), recommendation="CONTINUE_CONTRACT"
    )
    assert result.status == "WAITING_EMPLOYEE"
    rating.refresh_from_db()
    assert any(v.get("attempts") for v in rating.notification_milestones.values())


@pytest.mark.parametrize(
    "action,event",
    [
        ("ACCEPT", "ceo_accepted"),
        ("RETURN_TO_HR", "ceo_returned_to_hr"),
        ("DECLINE", "ceo_declined"),
        ("DECLINE_WITH_ALTERNATIVE", "ceo_declined_with_alternative"),
    ],
)
def test_ceo_notification_recipients(world, notifications, action, event):
    rating = pending_ceo(world)
    notifications.reset_mock()
    submit_ceo_decision(
        rating.id,
        actor=world.ceo,
        action=action,
        comment="Decision reason",
        ceo_selected_option="RENEW" if action == "DECLINE_WITH_ALTERNATIVE" else "",
    )
    calls = [c.kwargs for c in notifications.call_args_list if c.kwargs["metadata"]["event"] == event]
    expected = {world.hr.id} if action == "RETURN_TO_HR" else {world.hr.id, world.manager.id}
    assert {c["recipient"].id for c in calls} == expected
    assert all("Decision reason" in c["message"] for c in calls)


@pytest.mark.parametrize("target", ["manager", "employee", "both"])
def test_hr_return_notification_recipients(world, notifications, target):
    rating = cycle(world)
    notifications.reset_mock()
    submit_hr_review(rating.id, actor=world.hr, action=f"return-{target}", comment="Correction reason")
    calls = [c.kwargs for c in notifications.call_args_list if c.kwargs["metadata"]["event"] == "hr_returned"]
    expected = {world.manager.id, world.employee.id} if target == "both" else {getattr(world, target).id}
    assert {c["recipient"].id for c in calls} == expected


def test_submission_and_approval_notification_recipients(world, notifications):
    rating = cycle(world)
    assert {
        c.kwargs["recipient"].id
        for c in notifications.call_args_list
        if c.kwargs["metadata"]["event"] == "both_submitted"
    } == {world.hr.id}
    notifications.reset_mock()
    submit_hr_review(rating.id, actor=world.hr, action="approve")
    assert {
        c.kwargs["recipient"].id for c in notifications.call_args_list if c.kwargs["metadata"]["event"] == "hr_approved"
    } == {world.ceo.id, world.admin.id}


def test_acknowledgment_api_and_final_notification(world, notifications):
    rating = pending_ceo(world, recommendation="TERMINATE")
    submit_ceo_decision(rating.id, actor=world.ceo, action="ACCEPT")
    path = f"/contract-ratings/{rating.id}/acknowledge-termination-notice/"
    world.client.force_authenticate(world.manager)
    assert world.client.post(path, {}).status_code == 403
    world.client.force_authenticate(world.hr)
    assert world.client.post(path, {}).status_code == 200
    notifications.reset_mock()
    execute_scheduled_termination(rating.id, today=world.profile.contract_expiry)
    assert {
        c.kwargs["recipient"].id
        for c in notifications.call_args_list
        if c.kwargs["metadata"]["event"] == "termination_finalized"
    } == {world.hr.id, world.manager.id}


@pytest.mark.django_db(transaction=True)
def test_concurrent_creation_and_termination_are_idempotent(world):
    def create():
        close_old_connections()
        try:
            return ensure_contract_rating(EmployeeProfile.objects.get(pk=world.profile.pk))[0].pk
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        ids = list(pool.map(lambda _: create(), range(2)))
    assert ids[0] == ids[1] and ContractRating.objects.count() == 1
    rating = pending_ceo(world, recommendation="TERMINATE")
    submit_ceo_decision(rating.id, actor=world.ceo, action="ACCEPT")

    def terminate():
        close_old_connections()
        try:
            execute_scheduled_termination(rating.id, today=world.profile.contract_expiry)
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda _: terminate(), range(2)))
    assert AuditLog.objects.filter(action="contract_rating_termination_processed").count() == 1
