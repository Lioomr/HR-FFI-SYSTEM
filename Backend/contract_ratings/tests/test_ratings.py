from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from audit.models import AuditLog
from contract_ratings.criteria import CRITERIA, GRADE_RANGES
from contract_ratings.models import ContractRating, ContractRatingResponse
from contract_ratings.scoring import compute_average_and_grade, validate_criterion_ratings
from contract_ratings.services import (
    acknowledge_termination_notice,
    apply_approved_salary_change,
    ensure_contract_rating,
    submit_ceo_decision,
    submit_employee_response,
    submit_hr_review,
    submit_manager_response,
)
from contract_ratings.tasks import execute_scheduled_termination, process_contract_ratings
from core.models import WorkflowAction
from employees.contract_expiry import finalize_decision, submit_decision
from employees.models import EmployeeProfile

from .conftest import answers

pytestmark = pytest.mark.django_db


def cycle(world, *, recommendation="CONTINUE_CONTRACT", salary=False, employee_first=False):
    rating, _ = ensure_contract_rating(world.profile)
    data = {"criterion_ratings": answers(), "recommendation": "CONTINUE_WITH_CHANGES" if salary else recommendation}
    if salary:
        data.update(recommended_change_types=["SALARY_INCREASE"], proposed_terms={"basic_salary": "1200.00"})
    if employee_first:
        submit_employee_response(rating.id, actor=world.employee, criterion_ratings=answers(94, "EXCELLENT"))
    submit_manager_response(rating.id, actor=world.manager, **data)
    if not employee_first:
        submit_employee_response(rating.id, actor=world.employee, criterion_ratings=answers(94, "EXCELLENT"))
    rating.refresh_from_db()
    return rating


def pending_ceo(world, **kwargs):
    rating = cycle(world, **kwargs)
    return submit_hr_review(rating.id, actor=world.hr, action="approve", comment="private HR comment")


@pytest.mark.parametrize("grade,bounds", list(GRADE_RANGES.items()))
def test_grade_ranges(grade, bounds):
    lo, hi = bounds
    for score in (lo, hi):
        avg, computed = compute_average_and_grade(answers(score, grade))
        assert avg == Decimal(score) and computed == grade
    for score in (-1, 101, lo - 1, hi + 1, True, "85", 85.0, None):
        with pytest.raises(ValueError):
            validate_criterion_ratings(answers(score, grade))


@pytest.mark.parametrize("mutation", ["missing", "extra", "grade", "remark", "score", "shape", "unknown_grade"])
def test_exact_criteria_shape(mutation):
    data = answers()
    if mutation == "missing":
        data.pop("appearance")
    elif mutation == "extra":
        data["unknown"] = data["appearance"]
    elif mutation in {"grade", "remark", "score"}:
        data["appearance"].pop(mutation)
    elif mutation == "shape":
        data["appearance"] = []
    else:
        data["appearance"]["grade"] = []
    with pytest.raises(ValueError):
        validate_criterion_ratings(data)


def test_fractional_average_and_single_criteria_api(world):
    data = answers(89, "VERY_GOOD")
    for item in CRITERIA[:9]:
        data[item["code"]] = {"grade": "EXCELLENT", "score": 90, "remark": ""}
    assert compute_average_and_grade(data) == (Decimal("89.50"), "VERY_GOOD")
    world.client.force_authenticate(world.employee)
    response = world.client.get("/contract-ratings/criteria/")
    assert response.status_code == 200
    assert response.data["data"]["criteria"] == CRITERIA


@pytest.mark.parametrize("employee_first", [True, False])
def test_submission_order_comparison_and_locked_responses(world, employee_first):
    rating = cycle(world, employee_first=employee_first)
    assert rating.status == "PENDING_HR"
    assert rating.manager_response.average_score == Decimal("85.00")
    assert rating.employee_response.average_score == Decimal("94.00")
    assert rating.comparison_summary["appearance"]["difference"] == -9
    with pytest.raises(ValueError):
        submit_employee_response(rating.id, actor=world.employee, criterion_ratings=answers())
    assert AuditLog.objects.filter(entity="ContractRating", action="contract_rating_created").count() == 1


@pytest.mark.parametrize(
    "target,status",
    [
        ("return-manager", "WAITING_MANAGER"),
        ("return-employee", "WAITING_EMPLOYEE"),
        ("return-both", "PENDING_RESPONSES"),
    ],
)
def test_returns_and_resubmission_recalculate(world, target, status):
    rating = cycle(world)
    submit_hr_review(rating.id, actor=world.hr, action=target, comment="Fix the figures")
    rating.refresh_from_db()
    assert rating.status == status and rating.comparison_summary == {}
    if target in {"return-manager", "return-both"}:
        submit_manager_response(
            rating.id,
            actor=world.manager,
            criterion_ratings=answers(75, "GOOD"),
            recommendation="CONTINUE_CONTRACT",
            average_score=100,
            overall_grade="EXCELLENT",
        )
        rating.refresh_from_db()
        assert rating.manager_response.average_score == Decimal("75.00")
        if target == "return-both":
            assert rating.status == "WAITING_EMPLOYEE"
    if target in {"return-employee", "return-both"}:
        submit_employee_response(
            rating.id,
            actor=world.employee,
            criterion_ratings=answers(65, "ACCEPTABLE"),
            average_score=100,
            overall_grade="EXCELLENT",
        )
    rating.refresh_from_db()
    assert rating.status == "PENDING_HR"
    event = AuditLog.objects.filter(action="contract_rating_response_resubmitted").last()
    assert event.metadata["old"]["criterion_ratings"] != event.metadata["new"]["criterion_ratings"]
    assert event.metadata["old"]["reason"] == "Fix the figures"
    assert ContractRatingResponse.objects.filter(rating=rating).count() == 2


@pytest.mark.parametrize("status", ContractRating.Status.values)
@pytest.mark.parametrize("role", ["manager", "employee"])
def test_privacy_structural_absence_at_every_status(world, status, role):
    rating = cycle(world, salary=True)
    rating.status, rating.hr_comment, rating.ceo_comment = status, "secret HR", "secret CEO"
    rating.ceo_action, rating.ceo_selected_option, rating.scheduled_termination = (
        "DECLINE_WITH_ALTERNATIVE",
        "TERMINATE",
        True,
    )
    rating.save()
    world.client.force_authenticate(getattr(world, role))
    for path in (f"/contract-ratings/{rating.id}/", "/contract-ratings/"):
        response = world.client.get(path)
        assert response.status_code == 200
        data = response.data["data"]
        if path.endswith("ratings/"):
            data = data["items"][0]
        other = "employee" if role == "manager" else "manager"
        for key in (
            f"{other}_response",
            "comparison_summary",
            "hr_comment",
            "ceo_comment",
            "workflow",
            "ceo_action",
            "ceo_approved_terms",
            "scheduled_termination",
            "salary_before_snapshot",
        ):
            assert key not in data
        assert data[f"{role}_response"]["criterion_ratings"]


def test_hr_full_payload_and_foreign_access(world):
    rating = cycle(world, salary=True)
    world.client.force_authenticate(world.hr)
    data = world.client.get(f"/contract-ratings/{rating.id}/").data["data"]
    assert data["manager_response"] and data["employee_response"] and data["comparison_summary"] and data["workflow"]
    world.client.force_authenticate(world.foreign_hr)
    world.client.credentials(HTTP_X_ACTIVE_COMPANY_ID=str(world.foreign.id))
    assert world.client.get(f"/contract-ratings/{rating.id}/").status_code == 404
    assert world.client.post(f"/contract-ratings/{rating.id}/hr-review/", {"action": "approve"}).status_code == 404
    with pytest.raises(PermissionDenied):
        submit_hr_review(rating.id, actor=world.foreign_hr, action="approve")


@pytest.mark.parametrize("role", ["outsider", "employee", "hr", "ceo"])
def test_wrong_manager_blocked(world, role):
    rating, _ = ensure_contract_rating(world.profile)
    with pytest.raises(PermissionDenied):
        submit_manager_response(
            rating.id, actor=getattr(world, role), criterion_ratings=answers(), recommendation="CONTINUE_CONTRACT"
        )


def test_wrong_employee_hr_and_ceo_blocked(world):
    rating = cycle(world)
    with pytest.raises(PermissionDenied):
        submit_employee_response(rating.id, actor=world.manager, criterion_ratings=answers())
    with pytest.raises(PermissionDenied):
        submit_hr_review(rating.id, actor=world.manager, action="approve")
    submit_hr_review(rating.id, actor=world.hr, action="approve")
    with pytest.raises(PermissionDenied):
        submit_ceo_decision(rating.id, actor=world.employee, action="ACCEPT")


def test_live_manager_and_self_dealing(world):
    rating, _ = ensure_contract_rating(world.profile)
    EmployeeProfile.objects.filter(pk=world.profile.pk).update(
        manager_profile=world.ceo.employee_profile, manager=world.ceo
    )
    with pytest.raises(PermissionDenied):
        submit_manager_response(
            rating.id, actor=world.manager, criterion_ratings=answers(), recommendation="CONTINUE_CONTRACT"
        )
    submit_manager_response(rating.id, actor=world.ceo, criterion_ratings=answers(), recommendation="CONTINUE_CONTRACT")
    submit_employee_response(rating.id, actor=world.employee, criterion_ratings=answers())
    submit_hr_review(rating.id, actor=world.hr, action="approve")
    with pytest.raises(PermissionDenied):
        submit_ceo_decision(rating.id, actor=world.ceo, action="ACCEPT")


@pytest.mark.parametrize(
    "action,expected",
    [
        ("ACCEPT", "APPROVED"),
        ("RETURN_TO_HR", "PENDING_HR"),
        ("DECLINE", "REJECTED"),
        ("DECLINE_WITH_ALTERNATIVE", "APPROVED"),
    ],
)
def test_ceo_actions(world, action, expected):
    rating = pending_ceo(world)
    result = submit_ceo_decision(
        rating.id,
        actor=world.ceo,
        action=action,
        comment="Reason",
        ceo_selected_option="RENEW" if action == "DECLINE_WITH_ALTERNATIVE" else "",
    )
    assert result.status == expected
    assert result.contract_decision.status == "PENDING_HR"
    if expected != "PENDING_HR":
        with pytest.raises(ValueError):
            submit_hr_review(rating.id, actor=world.hr, action="approve")


def test_ceo_return_hr_return_employee_then_reapprove(world):
    rating = pending_ceo(world, salary=True)
    submit_ceo_decision(rating.id, actor=world.ceo, action="RETURN_TO_HR", comment="Recheck")
    submit_hr_review(rating.id, actor=world.hr, action="return-employee", comment="Recheck")
    submit_employee_response(rating.id, actor=world.employee, criterion_ratings=answers(95, "EXCELLENT"))
    submit_hr_review(rating.id, actor=world.hr, action="approve")
    result = submit_ceo_decision(
        rating.id,
        actor=world.ceo,
        action="DECLINE_WITH_ALTERNATIVE",
        comment="Different raise",
        ceo_selected_option="RENEW_WITH_CHANGES",
        ceo_approved_terms={"basic_salary": "1300.00"},
        ceo_salary_override_reason="Revised budget",
    )
    assert result.salary_after_snapshot["basic_salary"] == "1300.00"
    assert WorkflowAction.objects.filter(metadata__event="contract_rating_hr_approved").count() == 2


@pytest.mark.parametrize("action", ["RETURN_TO_HR", "DECLINE", "DECLINE_WITH_ALTERNATIVE"])
def test_ceo_requires_comment(world, action):
    rating = pending_ceo(world)
    with pytest.raises(ValidationError):
        submit_ceo_decision(rating.id, actor=world.ceo, action=action)


def test_salary_accept_once_and_snapshots(world):
    rating = pending_ceo(world, salary=True)
    world.profile.refresh_from_db()
    assert world.profile.basic_salary == Decimal("1000")
    result = submit_ceo_decision(rating.id, actor=world.ceo, action="ACCEPT")
    assert result.salary_before_snapshot["basic_salary"] == "1000.00"
    assert result.salary_after_snapshot["basic_salary"] == "1200.00"
    again = submit_ceo_decision(rating.id, actor=world.ceo, action="ACCEPT")
    apply_approved_salary_change(rating.id, actor=world.ceo)
    assert again.salary_change_applied_at == result.salary_change_applied_at
    assert AuditLog.objects.filter(action="contract_rating_salary_applied").count() == 1
    world.profile.refresh_from_db()
    assert world.profile.basic_salary == Decimal("1200")


def test_override_reason_and_salary_conflict(world):
    rating = pending_ceo(world, salary=True)
    with pytest.raises(ValueError, match="override reason"):
        submit_ceo_decision(
            rating.id,
            actor=world.ceo,
            action="DECLINE_WITH_ALTERNATIVE",
            comment="Change",
            ceo_selected_option="RENEW_WITH_CHANGES",
            ceo_approved_terms={"basic_salary": "1500"},
        )
    EmployeeProfile.objects.filter(pk=world.profile.pk).update(basic_salary=Decimal("1100"))
    result = submit_ceo_decision(rating.id, actor=world.ceo, action="ACCEPT")
    assert result.status == "MANUAL_RESOLUTION_REQUIRED" and not result.salary_change_applied_at
    world.profile.refresh_from_db()
    assert world.profile.basic_salary == Decimal("1100")


@pytest.mark.parametrize("action", ["DECLINE", "RETURN_TO_HR"])
def test_salary_unchanged_on_no_approval(world, action):
    rating = pending_ceo(world, salary=True)
    result = submit_ceo_decision(rating.id, actor=world.ceo, action=action, comment="No")
    world.profile.refresh_from_db()
    assert world.profile.basic_salary == Decimal("1000") and not result.salary_change_applied_at


def test_salary_transaction_rollback(world):
    rating = pending_ceo(world, salary=True)
    from contract_ratings import services

    original = services._record

    def fail_after_write(rating, event, *args, **kwargs):
        if event == "contract_rating_salary_applied":
            raise RuntimeError("after profile write")
        return original(rating, event, *args, **kwargs)

    with patch("contract_ratings.services._record", side_effect=fail_after_write):
        with pytest.raises(RuntimeError):
            submit_ceo_decision(rating.id, actor=world.ceo, action="ACCEPT")
    world.profile.refresh_from_db()
    rating.refresh_from_db()
    assert world.profile.basic_salary == Decimal("1000") and rating.status == "PENDING_CEO"
    assert not AuditLog.objects.filter(action="contract_rating_ceo_accepted").exists()


@pytest.mark.parametrize("change", ["expiry", "company", "archive", "finalized"])
def test_snapshot_mismatch(world, change):
    rating = pending_ceo(world)
    if change == "expiry":
        EmployeeProfile.objects.filter(pk=world.profile.pk).update(contract_expiry=timezone.localdate())
    elif change == "company":
        EmployeeProfile.objects.filter(pk=world.profile.pk).update(
            company=world.foreign, manager_profile=None, manager=None
        )
    elif change == "archive":
        EmployeeProfile.objects.filter(pk=world.profile.pk).update(is_archived=True)
    else:
        rating.contract_decision.finalized_at = timezone.now()
        rating.contract_decision.save()
    result = submit_ceo_decision(rating.id, actor=world.ceo, action="ACCEPT")
    assert result.status == "MANUAL_RESOLUTION_REQUIRED"


@pytest.mark.parametrize("alternative", [True, False])
def test_scheduled_termination_not_immediate_idempotent(world, alternative):
    rating = pending_ceo(world, recommendation="TERMINATE", salary=alternative)
    result = submit_ceo_decision(
        rating.id,
        actor=world.ceo,
        action="DECLINE_WITH_ALTERNATIVE" if alternative else "ACCEPT",
        comment="Contract end",
        ceo_selected_option="TERMINATE" if alternative else "",
        ceo_approved_terms={"basic_salary": "9999"},
    )
    world.profile.refresh_from_db()
    assert result.scheduled_termination and not world.profile.is_archived
    assert not result.ceo_approved_terms and world.profile.basic_salary == Decimal("1000")
    assert not execute_scheduled_termination(rating.id).termination_processed_at
    result = execute_scheduled_termination(rating.id, today=world.profile.contract_expiry)
    world.profile.refresh_from_db()
    world.employee.refresh_from_db()
    assert world.profile.is_archived and world.profile.employment_status == "TERMINATED"
    assert world.profile.archive_reason == "END_OF_CONTRACT" and not world.employee.is_active
    assert result.termination_processed_at and not result.employee_notified_of_termination_at
    execute_scheduled_termination(rating.id, today=world.profile.contract_expiry)
    assert AuditLog.objects.filter(action="contract_rating_termination_processed").count() == 1


def test_acknowledge_is_record_keeping_only(world):
    rating = pending_ceo(world, recommendation="TERMINATE")
    submit_ceo_decision(rating.id, actor=world.ceo, action="ACCEPT")
    first = acknowledge_termination_notice(rating.id, actor=world.hr)
    assert first.employee_notified_of_termination_by == world.hr
    assert not execute_scheduled_termination(rating.id).termination_processed_at
    assert (
        acknowledge_termination_notice(rating.id, actor=world.hr).employee_notified_of_termination_at
        == first.employee_notified_of_termination_at
    )
    with pytest.raises(PermissionDenied):
        acknowledge_termination_notice(rating.id, actor=world.manager)


@pytest.mark.parametrize("conflict", ["archive", "renewal"])
def test_termination_conflicts(world, conflict):
    rating = pending_ceo(world, recommendation="TERMINATE")
    submit_ceo_decision(rating.id, actor=world.ceo, action="ACCEPT")
    if conflict == "archive":
        EmployeeProfile.objects.filter(pk=world.profile.pk).update(is_archived=True)
    else:
        EmployeeProfile.objects.filter(pk=world.profile.pk).update(
            contract_expiry=world.profile.contract_expiry + timedelta(days=365)
        )
    assert (
        execute_scheduled_termination(rating.id, today=world.profile.contract_expiry).status
        == "MANUAL_RESOLUTION_REQUIRED"
    )


def test_standalone_termination_still_immediate(world):
    rating, _ = ensure_contract_rating(world.profile)
    with patch("employees.contract_expiry.notify_ceo_pending"):
        submit_decision(rating.contract_decision_id, actor=world.hr, decision_type="TERMINATE")
    finalize_decision(rating.contract_decision_id, actor=world.ceo)
    world.profile.refresh_from_db()
    assert world.profile.is_archived
    assert world.profile.employment_status == "ACTIVE"
    result = submit_employee_response(rating.id, actor=world.employee, criterion_ratings=answers())
    assert result.status == "MANUAL_RESOLUTION_REQUIRED"


def test_tasks_idempotent_open_and_missing_rater(world, notifications):
    assert process_contract_ratings()["created"] == 1
    assert process_contract_ratings()["created"] == 0
    assert ContractRating.objects.count() == 1
    opened = [
        c.kwargs["recipient"].pk for c in notifications.call_args_list if c.kwargs["metadata"]["event"] == "opened"
    ]
    assert set(opened) == {world.manager.pk, world.employee.pk} and len(opened) == 2
    profile = world.outsider.employee_profile
    profile.contract_date, profile.contract_expiry = world.profile.contract_date, world.profile.contract_expiry
    profile.user = None
    profile.save()
    ensure_contract_rating(profile)
    assert any(
        c.kwargs["metadata"]["event"] == "missing_rater" and c.kwargs["recipient"] == world.hr
        for c in notifications.call_args_list
    )


@pytest.mark.parametrize("submitted", ["none", "manager", "employee", "both"])
def test_65_day_breakdown(world, notifications, submitted):
    rating, _ = ensure_contract_rating(world.profile)
    if submitted in {"manager", "both"}:
        submit_manager_response(
            rating.id, actor=world.manager, criterion_ratings=answers(), recommendation="CONTINUE_CONTRACT"
        )
    if submitted in {"employee", "both"}:
        submit_employee_response(rating.id, actor=world.employee, criterion_ratings=answers())
    notifications.reset_mock()
    today = world.profile.contract_expiry - timedelta(days=65)
    process_contract_ratings(today=today)
    process_contract_ratings(today=today)
    calls = notifications.call_args_list
    hr = [c for c in calls if c.kwargs["recipient"] == world.hr]
    assert len(hr) == 1
    assert hr[0].kwargs["metadata"]["event"] == ("awaiting_hr_review" if submitted == "both" else "incomplete")
    reminded = {c.kwargs["recipient"].id for c in calls if c.kwargs["metadata"]["event"] == "reminder"}
    expected = set()
    if submitted not in {"manager", "both"}:
        expected.add(world.manager.id)
    if submitted not in {"employee", "both"}:
        expected.add(world.employee.id)
    assert reminded == expected


def test_notification_failure_retries_and_ceo_reminders(world, notifications):
    notifications.return_value = {"notification": None, "created": False}
    rating, _ = ensure_contract_rating(world.profile)
    assert any(not v.get("sent_at") for v in rating.notification_milestones.values())
    notifications.return_value = {"notification": object(), "created": True}
    process_contract_ratings()
    rating.refresh_from_db()
    assert all(v.get("sent_at") for v in rating.notification_milestones.values())
    rating = pending_ceo(world)
    notifications.reset_mock()
    now = timezone.now() + timedelta(hours=10)
    process_contract_ratings(now=now)
    process_contract_ratings(now=now + timedelta(hours=1))
    reminders = [c for c in notifications.call_args_list if c.kwargs["metadata"]["event"] == "ceo_reminder"]
    assert len(reminders) == 2
    assert {c.kwargs["recipient"].pk for c in reminders} == {world.ceo.pk, world.admin.pk}


def test_invalid_hr_returns_and_employee_manager_fields(world):
    rating, _ = ensure_contract_rating(world.profile)
    with pytest.raises(ValidationError):
        submit_employee_response(
            rating.id, actor=world.employee, criterion_ratings=answers(), recommendation="TERMINATE"
        )
    with pytest.raises(ValueError):
        submit_hr_review(rating.id, actor=world.hr, action="approve")
    rating = cycle(world)
    with pytest.raises(ValueError):
        submit_hr_review(rating.id, actor=world.hr, action="return-both")


def test_api_full_salary_cycle_and_rating_summary(world):
    rating, _ = ensure_contract_rating(world.profile)
    world.client.force_authenticate(world.manager)
    response = world.client.post(
        f"/contract-ratings/{rating.id}/manager-response/",
        {
            "criterion_ratings": answers(),
            "recommendation": "CONTINUE_WITH_CHANGES",
            "recommended_change_types": ["SALARY_INCREASE"],
            "proposed_terms": {"basic_salary": "1250.00"},
        },
        format="json",
    )
    assert response.status_code == 200, response.data
    world.client.force_authenticate(world.employee)
    assert (
        world.client.post(
            f"/contract-ratings/{rating.id}/employee-response/", {"criterion_ratings": answers()}, format="json"
        ).status_code
        == 200
    )
    world.client.force_authenticate(world.hr)
    assert world.client.post(f"/contract-ratings/{rating.id}/hr-review/", {"action": "approve"}).status_code == 200
    world.client.force_authenticate(world.ceo)
    response = world.client.post(f"/contract-ratings/{rating.id}/ceo-decision/", {"action": "ACCEPT"})
    assert response.status_code == 200, response.data
    assert response.data["data"]["salary_after_snapshot"]["basic_salary"] == "1250.00"
    world.client.force_authenticate(world.hr)
    summary = world.client.get(f"/api/employees/contract-decisions/{rating.contract_decision_id}/").data["data"][
        "rating"
    ]
    assert summary["ceo_action"] == "ACCEPT"
