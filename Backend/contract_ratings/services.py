import logging
from copy import deepcopy
from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from audit.utils import audit
from core.models import WorkflowAction
from core.permissions import is_department_ceo_approver_user, is_hr_workflow_approver_user
from core.services.workflow_engine import (
    begin_recorded_transition,
    can_user_act_on_instance,
    record_workflow_transition,
    sync_workflow,
)
from employees.contract_expiry import (
    _resolved_renewal_terms,
    apply_contract_terms,
    contract_terms_snapshot,
    ensure_contract_decision,
)
from employees.models import ContractDecision, EmployeeProfile
from employees.services.manager_relationships import get_valid_direct_manager_user, manager_approval_actor_source
from hr_reference.models import Position

from .criteria import ChangeType, Recommendation
from .models import ContractRating, ContractRatingResponse
from .permissions import require_company_access
from .scoring import build_comparison_summary, compute_average_and_grade

S = ContractRating.Status
R = ContractRatingResponse
RESPONSE_STATES = {S.PENDING_RESPONSES, S.WAITING_MANAGER, S.WAITING_EMPLOYEE}
logger = logging.getLogger(__name__)


def _locked(rating_id):
    decision_id = ContractRating.objects.values_list("contract_decision_id", flat=True).get(pk=rating_id)
    decision = ContractDecision.objects.select_for_update().get(pk=decision_id)
    rating = ContractRating.objects.select_for_update().get(pk=rating_id)
    profile = EmployeeProfile.objects.select_for_update().get(pk=rating.employee_profile_id)
    rating.contract_decision, rating.employee_profile = decision, profile
    return rating, profile


def _record(rating, event, actor=None, *, start=None, metadata=None, action=WorkflowAction.Action.ADVANCE):
    start = start or begin_recorded_transition(rating, actor=actor)
    audit(None, event, entity="ContractRating", entity_id=rating.id, metadata=metadata or {}, actor=actor)
    record_workflow_transition(
        rating,
        start,
        action=action,
        actor=actor,
        note=(metadata or {}).get("comment") or (metadata or {}).get("reason", ""),
        metadata={"event": event, **(metadata or {})},
    )


def _notify(rating, event, audiences, message=""):
    from .tasks import notify_event

    try:
        with transaction.atomic():
            notify_event(rating, event, audiences, message)
    except Exception:
        logger.exception("contract_rating_notification_failed", extra={"rating_id": rating.id, "event": event})


def _snapshot_mismatch_reason(rating, profile=None):
    profile = profile or rating.employee_profile
    decision = rating.contract_decision
    if profile.is_archived:
        return "Employee profile was archived through another workflow."
    if profile.company_id != rating.company_id or decision.company_id != rating.company_id:
        return "Employee or contract company changed."
    if decision.employee_profile_id != profile.id:
        return "Contract employee changed."
    if decision.finalized_at or decision.status not in {
        ContractDecision.Status.PENDING_HR,
        ContractDecision.Status.PENDING_CEO,
    }:
        return "The independent contract decision was finalized or requires resolution."
    if (
        profile.contract_date != rating.evaluation_period_from
        or profile.contract_expiry != rating.evaluation_period_to
        or decision.original_contract_date != rating.evaluation_period_from
        or decision.original_contract_expiry != rating.evaluation_period_to
    ):
        return "The contract dates changed after the rating cycle was created."
    return ""


def _manual_resolution(rating, reason, actor=None, event="contract_rating_manual_resolution_required", metadata=None):
    start = begin_recorded_transition(rating, actor=actor)
    rating.status = S.MANUAL_RESOLUTION_REQUIRED
    rating.save(update_fields=["status", "updated_at"])
    _record(rating, event, actor, start=start, metadata={"reason": reason, **(metadata or {})})
    _notify(rating, event, ["hr"], reason)
    return rating


def _guard(rating, profile, actor=None):
    reason = _snapshot_mismatch_reason(rating, profile)
    if reason:
        _manual_resolution(rating, reason, actor)
    return bool(reason)


@transaction.atomic
def ensure_contract_rating(profile, *, actor=None, only_if_due_on=None):
    decision, _ = ensure_contract_decision(profile)
    decision = ContractDecision.objects.select_for_update().get(pk=decision.pk)
    profile = EmployeeProfile.objects.select_for_update().get(pk=profile.pk)
    if only_if_due_on is not None:
        # Recheck after locking: the scheduler's candidate snapshot may be stale.
        if (
            profile.is_archived
            or profile.employment_status != "ACTIVE"
            or not profile.company.is_active
            or not profile.contract_expiry
            or not only_if_due_on <= profile.contract_expiry <= only_if_due_on + timedelta(days=90)
            or decision.finalized_at
            or decision.status not in {ContractDecision.Status.PENDING_HR, ContractDecision.Status.PENDING_CEO}
            or decision.company_id != profile.company_id
            or decision.original_contract_date != profile.contract_date
            or decision.original_contract_expiry != profile.contract_expiry
        ):
            return None, False
    rating, created = ContractRating.objects.get_or_create(
        contract_decision=decision,
        defaults={
            "employee_profile": profile,
            "company_id": profile.company_id,
            "manager_at_creation": get_valid_direct_manager_user(profile),
            "department_snapshot": profile.department_name_en or profile.department,
            "section_snapshot": str(profile.task_group_ref or ""),
            "job_title_snapshot": profile.job_title_en or profile.job_title,
            "evaluation_period_from": profile.contract_date,
            "evaluation_period_to": profile.contract_expiry,
        },
    )
    if created:
        start = begin_recorded_transition(rating, actor=actor, new_instance=True)
        _record(rating, "contract_rating_created", actor, start=start, action=WorkflowAction.Action.SUBMIT)
        if not _guard(rating, profile, actor):
            _notify(rating, "opened", ["manager", "employee"])
            if not get_valid_direct_manager_user(profile) or not profile.user_id:
                _notify(rating, "missing_rater", ["hr"], "A valid manager or linked employee account is missing.")
    return rating, created


def _recompute_status(rating):
    manager = rating.manager_response
    employee = rating.employee_response
    manager_done = manager and manager.status == R.Status.SUBMITTED
    employee_done = employee and employee.status == R.Status.SUBMITTED
    if manager_done and employee_done:
        rating.status = S.PENDING_HR
        rating.comparison_summary = build_comparison_summary(manager, employee)
    else:
        rating.status = (
            S.WAITING_EMPLOYEE if manager_done else S.WAITING_MANAGER if employee_done else S.PENDING_RESPONSES
        )
        rating.comparison_summary = {}


def validate_manager_proposal(data, profile):
    recommendation = data.get("recommendation")
    if recommendation not in Recommendation.values:
        raise ValueError("A valid manager recommendation is required.")
    changes = data.get("recommended_change_types", [])
    if (
        not isinstance(changes, list)
        or any(not isinstance(c, str) or c not in ChangeType.values for c in changes)
        or len(set(changes)) != len(changes)
    ):
        raise ValueError("Invalid or duplicate change types.")
    if recommendation == Recommendation.CONTINUE_WITH_CHANGES:
        if not changes:
            raise ValueError("Select at least one change type.")
    elif changes:
        raise ValueError("Change types require CONTINUE_WITH_CHANGES.")
    fields = {
        ChangeType.SALARY_INCREASE: "proposed_terms",
        ChangeType.JOB_TITLE_CHANGE: "proposed_job_title",
        ChangeType.POSITION_CHANGE: "proposed_position_id",
        ChangeType.OTHER: "other_change_notes",
    }
    result = {"recommendation": recommendation, "recommended_change_types": changes}
    for change, field in fields.items():
        value = data.get(field)
        if change in changes and not value:
            raise ValueError(f"{field} is required for {change}.")
        if change not in changes and value:
            raise ValueError(f"{field} requires {change}.")
        result[field] = value or ({} if field == "proposed_terms" else None if field == "proposed_position_id" else "")
    if ChangeType.SALARY_INCREASE in changes:
        result["proposed_terms"] = _resolved_renewal_terms(profile, result["proposed_terms"])
    if (
        ChangeType.POSITION_CHANGE in changes
        and not Position.objects.filter(pk=result["proposed_position_id"], company_id=profile.company_id).exists()
    ):
        raise ValueError("Proposed position must belong to the employee's company.")
    return result


def _submit_response(rating_id, actor, data, rater_type):
    rating, profile = _locked(rating_id)
    require_company_access(actor, rating)
    manager = rater_type == R.RaterType.MANAGER
    if manager:
        if not manager_approval_actor_source(actor, profile):
            raise PermissionDenied("Only the current manager or their delegate may submit.")
    elif profile.user_id != actor.id:
        raise PermissionDenied("Only the rated employee may submit.")
    if rating.status not in RESPONSE_STATES:
        raise ValueError("This rating is not accepting responses.")
    if _guard(rating, profile, actor):
        return rating
    from .serializers import ContractRatingResponseWriteSerializer

    serializer = ContractRatingResponseWriteSerializer(data=data, context={"is_manager": manager, "profile": profile})
    serializer.is_valid(raise_exception=True)
    values = dict(serializer.validated_data)
    effective_date = values.pop("salary_effective_date", None)
    average, grade = compute_average_and_grade(values["criterion_ratings"])
    response = R.objects.select_for_update().filter(rating=rating, rater_type=rater_type).first()
    if response and response.status != R.Status.RETURNED:
        raise ValueError("A submitted response is locked until HR returns it.")
    start = begin_recorded_transition(rating, actor=actor)
    previous = None
    if response:
        previous = {
            "criterion_ratings": deepcopy(response.criterion_ratings),
            "average_score": str(response.average_score),
            "overall_grade": response.overall_grade,
            "reason": response.return_reason,
        }
    else:
        response = R(rating=rating, rater_type=rater_type)
    for field, value in values.items():
        setattr(response, field, value)
    response.average_score, response.overall_grade = average, grade
    response.status, response.submitted_by, response.submitted_at = R.Status.SUBMITTED, actor, timezone.now()
    response.save()
    setattr(rating, "manager_response" if manager else "employee_response", response)
    if manager:
        rating.salary_change_proposed = ChangeType.SALARY_INCREASE in response.recommended_change_types
        rating.salary_effective_date = (
            (effective_date or profile.contract_expiry + timedelta(days=1)) if rating.salary_change_proposed else None
        )
    _recompute_status(rating)
    rating.save()
    event = "contract_rating_manager_submitted" if manager else "contract_rating_employee_submitted"
    _record(rating, event, actor, start=start, action=WorkflowAction.Action.SUBMIT)
    if previous:
        _record(
            rating,
            "contract_rating_response_resubmitted",
            actor,
            metadata={
                "rater_type": rater_type,
                "old": previous,
                "new": {
                    "criterion_ratings": response.criterion_ratings,
                    "average_score": str(average),
                    "overall_grade": grade,
                },
            },
        )
    if manager and rating.salary_change_proposed:
        _record(
            rating,
            "contract_rating_salary_proposed",
            actor,
            metadata={"proposed_terms": response.proposed_terms, "effective_date": str(rating.salary_effective_date)},
        )
    if rating.status == S.PENDING_HR:
        _notify(rating, "both_submitted", ["hr"])
    return rating


@transaction.atomic
def submit_manager_response(rating_id, *, actor, **data):
    return _submit_response(rating_id, actor, data, R.RaterType.MANAGER)


@transaction.atomic
def submit_employee_response(rating_id, *, actor, **data):
    return _submit_response(rating_id, actor, data, R.RaterType.EMPLOYEE)


@transaction.atomic
def submit_hr_review(rating_id, *, actor, action, comment="", targets=None):
    rating, profile = _locked(rating_id)
    require_company_access(actor, rating)
    if not is_hr_workflow_approver_user(actor):
        raise PermissionDenied("Only HR approvers may review ratings.")
    if rating.status != S.PENDING_HR:
        raise ValueError("This rating is not pending HR review.")
    if _guard(rating, profile, actor):
        return rating
    if action not in {"approve", "return", "return-manager", "return-employee", "return-both"}:
        raise ValueError("Invalid HR action.")
    start = begin_recorded_transition(rating, actor=actor)
    if action == "approve":
        if not all(r and r.status == R.Status.SUBMITTED for r in (rating.manager_response, rating.employee_response)):
            raise ValueError("Both submitted responses are required.")
        rating.status = S.PENDING_CEO
        rating.hr_reviewed_by, rating.hr_decided_at, rating.hr_comment = actor, timezone.now(), comment
        rating.salary_before_snapshot = contract_terms_snapshot(profile)
        rating.notification_milestones = {
            **rating.notification_milestones,
            "ceo_reminder_at": timezone.now().isoformat(),
        }
        rating.save()
        _record(rating, "contract_rating_hr_approved", actor, start=start, metadata={"comment": comment})
        _notify(rating, "hr_approved", ["ceo"])
    else:
        targets = {
            "return-manager": ["MANAGER"],
            "return-employee": ["EMPLOYEE"],
            "return-both": ["MANAGER", "EMPLOYEE"],
        }.get(action, targets)
        if (
            not isinstance(targets, list)
            or not targets
            or any(t not in R.RaterType.values for t in targets)
            or not comment.strip()
        ):
            raise ValueError("Return requires valid target(s) and a reason.")
        for target in set(targets):
            response = R.objects.select_for_update().get(rating=rating, rater_type=target)
            response.status, response.returned_by = R.Status.RETURNED, actor
            response.returned_at, response.return_reason = timezone.now(), comment
            response.save()
        rating.refresh_from_db()
        _recompute_status(rating)
        rating.save()
        _record(
            rating,
            "contract_rating_hr_returned",
            actor,
            start=start,
            action=WorkflowAction.Action.REQUEST_CHANGES,
            metadata={"targets": targets, "reason": comment},
        )
        _notify(rating, "hr_returned", [t.lower() for t in targets], comment)
    return rating


@transaction.atomic
def submit_ceo_decision(
    rating_id,
    *,
    actor,
    action,
    comment="",
    ceo_selected_option="",
    ceo_approved_terms=None,
    ceo_salary_override_reason="",
):
    rating, profile = _locked(rating_id)
    require_company_access(actor, rating)
    if not is_department_ceo_approver_user(actor):
        raise PermissionDenied("Only CEO approvers may decide ratings.")
    if actor.id == profile.user_id or (rating.manager_response and actor.id == rating.manager_response.submitted_by_id):
        raise PermissionDenied(
            "You cannot approve your own evaluation. Use a different approver through core/delegation.py."
        )
    if (
        rating.status == S.APPROVED
        and rating.salary_change_applied_at
        and rating.ceo_decided_by_id == actor.id
        and rating.ceo_action == action
    ):
        return rating
    if rating.status != S.PENDING_CEO:
        raise ValueError("This rating is not pending CEO review.")
    workflow = sync_workflow(rating, actor=actor)
    if not can_user_act_on_instance(actor, rating, workflow):
        raise PermissionDenied("You cannot act on this rating.")
    if _guard(rating, profile, actor):
        return rating
    from .serializers import CeoDecisionWriteSerializer

    serializer = CeoDecisionWriteSerializer(
        data={
            "action": action,
            "comment": comment,
            "ceo_selected_option": ceo_selected_option,
            "ceo_approved_terms": ceo_approved_terms,
            "ceo_salary_override_reason": ceo_salary_override_reason,
        }
    )
    serializer.is_valid(raise_exception=True)
    A = ContractRating.CeoAction
    response = rating.manager_response
    outcome = (
        {
            Recommendation.CONTINUE_CONTRACT: "RENEW",
            Recommendation.CONTINUE_WITH_CHANGES: "RENEW_WITH_CHANGES",
            Recommendation.TERMINATE: "TERMINATE",
        }[response.recommendation]
        if action == A.ACCEPT
        else ceo_selected_option
    )
    approved_terms = None
    if action in {A.ACCEPT, A.DECLINE_WITH_ALTERNATIVE} and outcome == "RENEW_WITH_CHANGES":
        approved_terms = (
            response.proposed_terms if action == A.ACCEPT or ceo_approved_terms is None else ceo_approved_terms
        )
        if approved_terms:
            approved_terms = _resolved_renewal_terms(profile, approved_terms)
        if approved_terms != response.proposed_terms and not ceo_salary_override_reason.strip():
            raise ValueError("A salary override reason is required.")
    start = begin_recorded_transition(rating, actor=actor)
    rating.ceo_action, rating.ceo_comment = action, comment
    rating.ceo_selected_option = ceo_selected_option if action == A.DECLINE_WITH_ALTERNATIVE else ""
    rating.ceo_decided_by, rating.ceo_decided_at = actor, timezone.now()
    rating.status = S.PENDING_HR if action == A.RETURN_TO_HR else S.REJECTED if action == A.DECLINE else S.APPROVED
    if rating.status == S.APPROVED:
        rating.ceo_approved_terms = approved_terms or {}
        rating.ceo_salary_override_reason = ceo_salary_override_reason if approved_terms else ""
        rating.scheduled_termination = outcome == "TERMINATE"
        if approved_terms:
            rating.salary_change_proposed = True
            rating.salary_effective_date = rating.salary_effective_date or profile.contract_expiry + timedelta(days=1)
    rating.save()
    event = {
        A.ACCEPT: "accepted",
        A.RETURN_TO_HR: "returned_to_hr",
        A.DECLINE: "declined",
        A.DECLINE_WITH_ALTERNATIVE: "declined_with_alternative",
    }[action]
    _record(
        rating,
        f"contract_rating_ceo_{event}",
        actor,
        start=start,
        metadata={"ceo_selected_option": rating.ceo_selected_option, "comment": comment},
        action=WorkflowAction.Action.REQUEST_CHANGES
        if action == A.RETURN_TO_HR
        else WorkflowAction.Action.REJECT
        if action == A.DECLINE
        else WorkflowAction.Action.APPROVE,
    )
    if rating.status == S.APPROVED and approved_terms:
        _record(
            rating,
            "contract_rating_ceo_salary_accepted"
            if approved_terms == response.proposed_terms
            else "contract_rating_ceo_salary_overridden",
            actor,
            metadata={"terms": approved_terms, "reason": ceo_salary_override_reason},
        )
        apply_approved_salary_change(rating.id, actor=actor)
        rating.refresh_from_db()
    if rating.scheduled_termination:
        _record(
            rating,
            "contract_rating_termination_scheduled",
            actor,
            metadata={"contract_expiry": str(profile.contract_expiry)},
        )
    _notify(
        rating,
        f"ceo_{event}",
        ["hr"] if action == A.RETURN_TO_HR else ["hr", "manager"],
        f"Recommendation: {response.recommendation}; outcome: {outcome}; {comment}",
    )
    return rating


@transaction.atomic
def apply_approved_salary_change(rating_id, *, actor):
    rating, profile = _locked(rating_id)
    if rating.salary_change_applied_at or not rating.salary_change_proposed:
        return rating
    if (
        rating.status != S.APPROVED
        or rating.ceo_action not in {"ACCEPT", "DECLINE_WITH_ALTERNATIVE"}
        or not rating.ceo_approved_terms
        or rating.scheduled_termination
    ):
        raise ValueError("An approved salary decision is required.")
    if _guard(rating, profile, actor):
        return rating
    current = contract_terms_snapshot(profile)
    if current != rating.salary_before_snapshot:
        return _manual_resolution(
            rating,
            "Salary changed after HR approval.",
            actor,
            "contract_rating_salary_manual_resolution_required",
            {"expected": rating.salary_before_snapshot, "actual": current},
        )
    start = begin_recorded_transition(rating, actor=actor)
    terms = _resolved_renewal_terms(profile, rating.ceo_approved_terms)
    apply_contract_terms(profile, terms)
    rating.salary_after_snapshot = contract_terms_snapshot(profile)
    rating.salary_change_applied_at = timezone.now()
    rating.save(update_fields=["salary_after_snapshot", "salary_change_applied_at", "updated_at"])
    _record(
        rating,
        "contract_rating_salary_applied",
        actor,
        start=start,
        metadata={
            "before": rating.salary_before_snapshot,
            "after": rating.salary_after_snapshot,
            "contract_decision_id": rating.contract_decision_id,
            "ceo_decided_by": actor.id if actor else None,
        },
    )
    return rating


@transaction.atomic
def acknowledge_termination_notice(rating_id, *, actor):
    rating, profile = _locked(rating_id)
    require_company_access(actor, rating)
    if not is_hr_workflow_approver_user(actor):
        raise PermissionDenied("Only HR may acknowledge termination notice.")
    if rating.status != S.APPROVED or not rating.scheduled_termination:
        raise ValueError("This rating has no approved scheduled termination.")
    if rating.employee_notified_of_termination_at:
        return rating
    if not rating.termination_processed_at and _guard(rating, profile, actor):
        return rating
    start = begin_recorded_transition(rating, actor=actor)
    rating.employee_notified_of_termination_at, rating.employee_notified_of_termination_by = timezone.now(), actor
    rating.save(
        update_fields=["employee_notified_of_termination_at", "employee_notified_of_termination_by", "updated_at"]
    )
    _record(rating, "contract_rating_termination_acknowledged", actor, start=start)
    return rating
