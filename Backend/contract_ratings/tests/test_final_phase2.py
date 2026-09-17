from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from audit.models import AuditLog
from contract_ratings.models import ContractRating, ContractRatingResponse
from contract_ratings.serializers import RETURN_TO_BOTH, RETURN_TO_EMPLOYEE, RETURN_TO_MANAGER
from contract_ratings.services import (
    apply_approved_salary_change,
    ensure_contract_rating,
    request_hr_comment,
    submit_ceo_decision,
    submit_employee_response,
    submit_hr_comment,
    submit_manager_response,
)
from core.models import WorkflowAction
from employees.models import EmployeeProfile

from .conftest import answers

pytestmark = pytest.mark.django_db


def pending_ceo(world, *, manager_score=85, employee_score=94):
    rating, _ = ensure_contract_rating(world.profile)
    submit_manager_response(
        rating.pk,
        actor=world.manager,
        criterion_ratings=answers(manager_score, "VERY_GOOD"),
        overall_remark="manager confidential",
    )
    submit_employee_response(
        rating.pk,
        actor=world.employee,
        criterion_ratings=answers(employee_score, "EXCELLENT"),
        overall_remark="employee confidential",
    )
    rating.refresh_from_db()
    assert rating.status == ContractRating.Status.PENDING_CEO
    return rating


@pytest.mark.parametrize("role", ["manager", "employee"])
@pytest.mark.parametrize("status", ContractRating.Status.values)
def test_raters_never_receive_the_other_response_or_decision_content(world, role, status):
    rating = pending_ceo(world)
    rating.status = status
    rating.ceo_decision = "TERMINATE"
    rating.ceo_comment = "CEO confidential"
    rating.hr_comment = "HR confidential"
    rating.scheduled_termination = True
    rating.save()
    world.client.force_authenticate(getattr(world, role))
    response = world.client.get(f"/contract-ratings/{rating.pk}/")
    assert response.status_code == 200
    payload = response.data["data"]
    other = "employee" if role == "manager" else "manager"
    assert f"{role}_response" in payload
    for field in (
        f"{other}_response",
        "comparison_summary",
        "hr_comment",
        "ceo_comment",
        "ceo_decision",
        "current_terms",
        "salary_before_snapshot",
        "salary_after_snapshot",
        "ceo_approved_terms",
        "scheduled_termination",
        "workflow",
    ):
        assert field not in payload


def test_hr_is_coarse_by_default_and_unlocks_only_requested_rating(world):
    requested = pending_ceo(world)

    other_profile = world.outsider.employee_profile
    other_profile.manager_profile = world.manager.employee_profile
    other_profile.contract_date = world.profile.contract_date
    other_profile.contract_expiry = world.profile.contract_expiry
    other_profile.save()
    other = pending_ceo_for_profile(world, other_profile, world.outsider)

    world.client.force_authenticate(world.hr)
    coarse = world.client.get(f"/contract-ratings/{requested.pk}/").data["data"]
    assert set(coarse) >= {"id", "status", "company", "employee"}
    assert {
        "manager_response",
        "employee_response",
        "comparison_summary",
        "current_terms",
        "salary_before_snapshot",
    }.isdisjoint(coarse)

    request_hr_comment(requested.pk, actor=world.ceo)
    unlocked = world.client.get(f"/contract-ratings/{requested.pk}/").data["data"]
    still_coarse = world.client.get(f"/contract-ratings/{other.pk}/").data["data"]
    assert unlocked["manager_response"] and unlocked["employee_response"] and unlocked["comparison_summary"]
    assert "manager_response" not in still_coarse and "employee_response" not in still_coarse


def pending_ceo_for_profile(world, profile, employee):
    rating, _ = ensure_contract_rating(profile)
    submit_manager_response(rating.pk, actor=world.manager, criterion_ratings=answers())
    submit_employee_response(rating.pk, actor=employee, criterion_ratings=answers())
    return ContractRating.objects.get(pk=rating.pk)


def test_hr_comment_is_requested_by_ceo_optional_and_late_safe(world):
    rating = pending_ceo(world)
    with pytest.raises(PermissionDenied):
        request_hr_comment(rating.pk, actor=world.hr)
    with pytest.raises(ValueError):
        submit_hr_comment(rating.pk, actor=world.hr, comment="Unrequested")

    requested = request_hr_comment(rating.pk, actor=world.ceo)
    requested_again = request_hr_comment(rating.pk, actor=world.ceo)
    assert requested_again.hr_comment_requested_at == requested.hr_comment_requested_at
    assert requested.hr_comment_requested_by == world.ceo

    decided = submit_ceo_decision(rating.pk, actor=world.ceo, ceo_decision="RENEW", comment="Proceed")
    commented = submit_hr_comment(rating.pk, actor=world.hr, comment="Late advisory note")
    assert decided.status == ContractRating.Status.DECIDED
    assert commented.status == ContractRating.Status.DECIDED
    assert commented.hr_comment == "Late advisory note"
    assert AuditLog.objects.filter(action="contract_rating_hr_comment_submitted", entity_id=str(rating.pk)).exists()


@pytest.mark.parametrize(
    "target,expected_status,manager_status,employee_status",
    [
        (RETURN_TO_MANAGER, "WAITING_MANAGER", "RETURNED", "SUBMITTED"),
        (RETURN_TO_EMPLOYEE, "WAITING_EMPLOYEE", "SUBMITTED", "RETURNED"),
        (RETURN_TO_BOTH, "PENDING_RESPONSES", "RETURNED", "RETURNED"),
    ],
)
def test_ceo_returns_targeted_responses_and_resubmission_recalculates(
    world, target, expected_status, manager_status, employee_status
):
    rating = pending_ceo(world)
    with pytest.raises(ValidationError):
        submit_ceo_decision(rating.pk, actor=world.ceo, ceo_decision=target)
    result = submit_ceo_decision(rating.pk, actor=world.ceo, ceo_decision=target, comment="Correct the scores")
    result.refresh_from_db()
    assert result.status == expected_status
    assert result.manager_response.status == manager_status
    assert result.employee_response.status == employee_status
    assert result.comparison_summary == {}

    if manager_status == ContractRatingResponse.Status.RETURNED:
        submit_manager_response(
            rating.pk,
            actor=world.manager,
            criterion_ratings=answers(75, "GOOD"),
            average_score=100,
            overall_grade="EXCELLENT",
        )
    if employee_status == ContractRatingResponse.Status.RETURNED:
        submit_employee_response(
            rating.pk,
            actor=world.employee,
            criterion_ratings=answers(65, "ACCEPTABLE"),
            average_score=100,
            overall_grade="EXCELLENT",
        )
    result.refresh_from_db()
    assert result.status == ContractRating.Status.PENDING_CEO
    if manager_status == ContractRatingResponse.Status.RETURNED:
        assert result.manager_response.average_score == Decimal("75.00")
    if employee_status == ContractRatingResponse.Status.RETURNED:
        assert result.employee_response.average_score == Decimal("65.00")
    audit = AuditLog.objects.filter(action="contract_rating_response_resubmitted").last()
    assert audit.metadata["old"]["criterion_ratings"] != audit.metadata["new"]["criterion_ratings"]
    assert audit.metadata["old"]["reason"] == "Correct the scores"


@pytest.mark.parametrize("decision", ["RENEW", "TERMINATE"])
def test_non_salary_decisions_are_terminal_and_never_mutate_salary(world, decision):
    rating = pending_ceo(world)
    before = world.profile.basic_salary
    result = submit_ceo_decision(rating.pk, actor=world.ceo, ceo_decision=decision, comment="Final")
    world.profile.refresh_from_db()
    assert result.status == ContractRating.Status.DECIDED
    assert result.ceo_decision == decision
    assert world.profile.basic_salary == before
    assert not result.salary_change_applied_at
    assert result.scheduled_termination is (decision == "TERMINATE")
    assert result.contract_decision.status == "PENDING_HR"


@pytest.mark.parametrize("decision", ["RENEW", "TERMINATE", RETURN_TO_MANAGER])
def test_salary_fields_are_rejected_for_every_other_ceo_action(world, decision):
    rating = pending_ceo(world)
    with pytest.raises(ValidationError):
        submit_ceo_decision(
            rating.pk,
            actor=world.ceo,
            ceo_decision=decision,
            comment="Reason",
            ceo_approved_terms={"basic_salary": "1200.00"},
            salary_effective_date=world.profile.contract_expiry + timedelta(days=1),
        )


def test_renew_with_increase_applies_ceo_terms_atomically_exactly_once(world):
    rating = pending_ceo(world)
    effective = world.profile.contract_expiry + timedelta(days=1)
    result = submit_ceo_decision(
        rating.pk,
        actor=world.ceo,
        ceo_decision="RENEW_WITH_CHANGES",
        ceo_approved_terms={"basic_salary": "1250.00"},
        salary_effective_date=effective,
    )
    world.profile.refresh_from_db()
    assert result.status == ContractRating.Status.DECIDED
    assert result.salary_before_snapshot["basic_salary"] == "1000.00"
    assert result.salary_after_snapshot["basic_salary"] == "1250.00"
    assert result.salary_effective_date == effective
    assert world.profile.basic_salary == Decimal("1250.00")
    applied_at = result.salary_change_applied_at

    duplicate = submit_ceo_decision(
        rating.pk,
        actor=world.ceo,
        ceo_decision="RENEW_WITH_CHANGES",
        ceo_approved_terms={"basic_salary": "1250.00"},
        salary_effective_date=effective,
    )
    apply_approved_salary_change(rating.pk, actor=world.ceo)
    duplicate.refresh_from_db()
    assert duplicate.salary_change_applied_at == applied_at
    assert AuditLog.objects.filter(action="contract_rating_salary_applied", entity_id=str(rating.pk)).count() == 1


def test_salary_snapshot_mismatch_requires_manual_resolution(world):
    rating = pending_ceo(world)
    EmployeeProfile.objects.filter(pk=world.profile.pk).update(basic_salary=Decimal("1100.00"))
    result = submit_ceo_decision(
        rating.pk,
        actor=world.ceo,
        ceo_decision="RENEW_WITH_CHANGES",
        ceo_approved_terms={"basic_salary": "1250.00"},
        salary_effective_date=world.profile.contract_expiry + timedelta(days=1),
    )
    world.profile.refresh_from_db()
    assert result.status == ContractRating.Status.MANUAL_RESOLUTION_REQUIRED
    assert world.profile.basic_salary == Decimal("1100.00")
    assert not result.salary_change_applied_at


def test_salary_write_rolls_back_with_ceo_decision(world):
    rating = pending_ceo(world)
    from contract_ratings import services

    original = services._record

    def fail_after_profile_write(rating, event, *args, **kwargs):
        if event == "contract_rating_salary_applied":
            raise RuntimeError("history write failed")
        return original(rating, event, *args, **kwargs)

    with patch("contract_ratings.services._record", side_effect=fail_after_profile_write):
        with pytest.raises(RuntimeError):
            submit_ceo_decision(
                rating.pk,
                actor=world.ceo,
                ceo_decision="RENEW_WITH_CHANGES",
                ceo_approved_terms={"basic_salary": "1300.00"},
                salary_effective_date=world.profile.contract_expiry + timedelta(days=1),
            )
    world.profile.refresh_from_db()
    rating.refresh_from_db()
    assert world.profile.basic_salary == Decimal("1000.00")
    assert rating.status == ContractRating.Status.PENDING_CEO
    assert not rating.ceo_decision


def test_role_gates_company_scope_workflow_guard_and_self_dealing(world):
    rating = pending_ceo(world)
    with pytest.raises(PermissionDenied):
        submit_ceo_decision(rating.pk, actor=world.hr, ceo_decision="RENEW")
    with patch("contract_ratings.services.can_user_act_on_instance", return_value=False):
        with pytest.raises(PermissionDenied):
            submit_ceo_decision(rating.pk, actor=world.ceo, ceo_decision="RENEW")

    world.client.force_authenticate(world.foreign_hr)
    world.client.credentials(HTTP_X_ACTIVE_COMPANY_ID=str(world.foreign.pk))
    assert world.client.get(f"/contract-ratings/{rating.pk}/").status_code == 404

    self_rating, _ = ensure_contract_rating(world.profile)
    self_rating.manager_response.submitted_by = world.ceo
    self_rating.manager_response.save(update_fields=["submitted_by"])
    with pytest.raises(PermissionDenied):
        submit_ceo_decision(self_rating.pk, actor=world.ceo, ceo_decision="RENEW")


def test_privileged_rater_still_gets_rater_shaped_payload(world):
    rating = pending_ceo(world)
    world.manager.groups.add(Group.objects.get_or_create(name="HRManager")[0])
    world.client.force_authenticate(world.manager)
    payload = world.client.get(f"/contract-ratings/{rating.pk}/").data["data"]
    assert "manager_response" in payload
    assert "employee_response" not in payload
    assert "comparison_summary" not in payload


def test_final_api_routes_replace_hr_review_and_return_contract_summary(world):
    rating = pending_ceo(world)
    world.client.force_authenticate(world.ceo)
    assert world.client.post(f"/contract-ratings/{rating.pk}/request-hr-comment/", {}).status_code == 200
    world.client.force_authenticate(world.hr)
    assert (
        world.client.post(
            f"/contract-ratings/{rating.pk}/hr-comment/", {"comment": "Advisory"}, format="json"
        ).status_code
        == 200
    )
    assert world.client.post(f"/contract-ratings/{rating.pk}/hr-review/", {"action": "approve"}).status_code == 404
    world.client.force_authenticate(world.ceo)
    response = world.client.post(
        f"/contract-ratings/{rating.pk}/ceo-decision/", {"ceo_decision": "RENEW", "comment": "Final"}, format="json"
    )
    assert response.status_code == 200, response.data

    world.client.force_authenticate(world.hr)
    summary = world.client.get(f"/api/employees/contract-decisions/{rating.contract_decision_id}/").data["data"][
        "rating"
    ]
    assert summary == {"status": "DECIDED", "ceo_decision": "RENEW", "ceo_comment": "Final"}
    assert WorkflowAction.objects.filter(metadata__event="contract_rating_ceo_decided_renew").exists()
