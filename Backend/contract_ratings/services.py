import logging
from copy import deepcopy

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from audit.utils import audit
from core.models import WorkflowAction
from core.permissions import get_role, is_department_ceo_approver_user, is_hr_workflow_approver_user
from core.services.workflow_engine import (
    begin_recorded_transition,
    can_user_act_on_instance,
    record_workflow_transition,
    sync_workflow,
)
from employees.contract_expiry import (
    _renewal_dates,
    _resolved_renewal_terms,
    apply_contract_terms,
    contract_rating_due,
    contract_terms_snapshot,
    ensure_contract_decision,
)
from employees.models import ContractDecision, EmployeeProfile
from employees.services.manager_relationships import get_valid_direct_manager_user, manager_approval_actor_source

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
        if not contract_rating_due(profile, decision, only_if_due_on):
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
            _notify(rating, "awaiting_routing", ["hr"])
    return rating, created


@transaction.atomic
def submit_hr_gate_decision(rating_id, *, actor, rating_mode):
    rating, profile = _locked(rating_id)
    require_company_access(actor, rating)
    if not is_hr_workflow_approver_user(actor) or get_role(actor) == "SystemAdmin":
        raise PermissionDenied("Only HR approvers may route a rating.")
    _reject_self_dealing(rating, profile, actor)
    if rating.status != S.PENDING_HR_GATE or rating.rating_mode:
        raise ValueError("The HR routing decision has already been made.")
    workflow = sync_workflow(rating, actor=actor)
    if not can_user_act_on_instance(actor, rating, workflow):
        raise PermissionDenied("You cannot act on this rating.")
    if _guard(rating, profile, actor):
        return rating

    from .serializers import HrGateWriteSerializer

    serializer = HrGateWriteSerializer(data={"rating_mode": rating_mode})
    serializer.is_valid(raise_exception=True)
    mode = serializer.validated_data["rating_mode"]
    start = begin_recorded_transition(rating, actor=actor)
    rating.rating_mode = mode
    rating.hr_gate_decided_by = actor
    rating.hr_gate_decided_at = timezone.now()
    if mode == ContractRating.RatingMode.RATE:
        rating.status = S.PENDING_RESPONSES
    else:
        rating.status = S.PENDING_CEO
        rating.salary_before_snapshot = contract_terms_snapshot(profile)
        rating.notification_milestones = {
            **rating.notification_milestones,
            "ceo_reminder_at": timezone.now().isoformat(),
        }
    rating.save()
    _record(
        rating,
        "contract_rating_hr_gate_decided",
        actor,
        start=start,
        metadata={"rating_mode": mode, "account_connected": bool(profile.user_id)},
    )
    if mode == ContractRating.RatingMode.RATE:
        _notify(rating, "opened", ["manager", "employee"])
        if not get_valid_direct_manager_user(profile) or not profile.user_id:
            _notify(rating, "missing_rater", ["hr"], "A valid manager or linked employee account is missing.")
    else:
        _notify(rating, "sent_directly_to_ceo", ["ceo"])
    return rating


def _recompute_status(rating):
    manager = rating.manager_response
    employee = rating.employee_response
    manager_done = manager and manager.status == R.Status.SUBMITTED
    employee_done = employee and employee.status == R.Status.SUBMITTED
    if manager_done and employee_done:
        rating.status = S.PENDING_CEO
        rating.comparison_summary = build_comparison_summary(manager, employee)
    else:
        rating.status = (
            S.WAITING_EMPLOYEE if manager_done else S.WAITING_MANAGER if employee_done else S.PENDING_RESPONSES
        )
        rating.comparison_summary = {}


def _submit_response(rating_id, actor, data, rater_type):
    rating, profile = _locked(rating_id)
    require_company_access(actor, rating)
    manager = rater_type == R.RaterType.MANAGER
    if manager:
        if not manager_approval_actor_source(actor, profile):
            raise PermissionDenied("Only the current manager or their delegate may submit.")
    elif profile.user_id != actor.id:
        raise PermissionDenied("Only the rated employee may submit.")
    if rating.rating_mode != ContractRating.RatingMode.RATE:
        raise ValueError("This rating was not routed for manager and employee evaluation.")
    if rating.status not in RESPONSE_STATES:
        raise ValueError("This rating is not accepting responses.")
    if _guard(rating, profile, actor):
        return rating
    from .serializers import ContractRatingResponseWriteSerializer

    serializer = ContractRatingResponseWriteSerializer(data=data)
    serializer.is_valid(raise_exception=True)
    values = dict(serializer.validated_data)
    average, grade = compute_average_and_grade(values["criterion_ratings"])
    response = R.objects.select_for_update().filter(rating=rating, rater_type=rater_type).first()
    if response and response.status != R.Status.RETURNED:
        raise ValueError("A submitted response is locked until the CEO returns it.")
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
    _recompute_status(rating)
    if rating.status == S.PENDING_CEO:
        rating.salary_before_snapshot = contract_terms_snapshot(profile)
        rating.notification_milestones = {
            **rating.notification_milestones,
            "ceo_reminder_at": timezone.now().isoformat(),
        }
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
    if rating.status == S.PENDING_CEO:
        _notify(rating, "both_submitted", ["ceo"])
    return rating


@transaction.atomic
def submit_manager_response(rating_id, *, actor, **data):
    return _submit_response(rating_id, actor, data, R.RaterType.MANAGER)


@transaction.atomic
def submit_employee_response(rating_id, *, actor, **data):
    return _submit_response(rating_id, actor, data, R.RaterType.EMPLOYEE)


RENEWAL_DECISIONS = {ContractDecision.DecisionType.RENEW, ContractDecision.DecisionType.RENEW_WITH_CHANGES}
OPEN_DECISION_STATUSES = {ContractDecision.Status.PENDING_HR, ContractDecision.Status.PENDING_CEO}


def close_contract_decision(rating, *, actor=None):
    """Finalize the linked ``ContractDecision`` with the outcome the rating flow reached.

    The rating flow owns the contract once a rating exists (the legacy sweep skips
    it), so the decision must not stay PENDING_HR/PENDING_CEO after the contract's
    fate is settled. ``APPROVED`` is reused for both outcomes, exactly as the legacy
    flow records an approved renewal or an approved termination; ``decision_type``
    tells them apart. The caller holds the decision row lock (see ``_locked``).
    """
    decision = rating.contract_decision
    if decision.status not in OPEN_DECISION_STATUSES:
        return decision
    start = begin_recorded_transition(decision, actor=actor)
    now = timezone.now()
    decision.decision_type = rating.ceo_decision
    if rating.ceo_decision in RENEWAL_DECISIONS:
        decision.proposed_terms = rating.ceo_approved_terms or {}
    decision.status = ContractDecision.Status.APPROVED
    decision.ceo_decided_by_id = rating.ceo_decided_by_id
    decision.ceo_decided_at = rating.ceo_decided_at or now
    decision.ceo_comment = rating.ceo_comment
    decision.finalized_by = actor
    decision.finalized_at = now
    decision.finalized_by_system = actor is None
    decision.automatic_renewal = False
    decision.automatic_renewal_reason = ""
    decision.failure_reason = ""
    # The rating flow sends its own outcome notices; keep the legacy final notice from repeating them.
    decision.final_notification_sent_at = now
    decision.save()
    metadata = {"source": "contract_rating", "contract_rating_id": rating.id, "decision_type": decision.decision_type}
    record_workflow_transition(
        decision,
        start,
        action=WorkflowAction.Action.APPROVE,
        actor=actor,
        note=rating.ceo_comment or "",
        approver_role="ceo",
        metadata=metadata,
    )
    audit(
        None,
        "contract_decision_finalized_by_rating",
        entity="ContractDecision",
        entity_id=decision.id,
        metadata=metadata,
        actor=actor,
    )
    return decision


def _apply_renewal_dates(rating, profile):
    """Move the profile onto the renewed contract term, as a legacy approved renewal does."""
    start, expiry = _renewal_dates(rating.contract_decision)
    profile.refresh_from_db()  # A salary change may have been applied through a separately loaded row.
    profile.contract_date = start
    profile.contract_expiry = expiry
    apply_contract_terms(profile, {}, extra_update_fields=["contract_date", "contract_expiry"])
    decision = rating.contract_decision
    decision.proposed_contract_date = start
    decision.proposed_contract_expiry = expiry


def _reject_self_dealing(rating, profile, actor):
    if actor.id == profile.user_id or (rating.manager_response and actor.id == rating.manager_response.submitted_by_id):
        raise PermissionDenied("A manager-rater cannot also act as HR or CEO on the same rating.")


@transaction.atomic
def request_hr_comment(rating_id, *, actor):
    rating, profile = _locked(rating_id)
    require_company_access(actor, rating)
    if not is_department_ceo_approver_user(actor):
        raise PermissionDenied("Only CEO approvers may request an HR comment.")
    _reject_self_dealing(rating, profile, actor)
    if rating.status != S.PENDING_CEO:
        raise ValueError("HR comments may be requested only while a CEO decision is pending.")
    workflow = sync_workflow(rating, actor=actor)
    if not can_user_act_on_instance(actor, rating, workflow):
        raise PermissionDenied("You cannot act on this rating.")
    if _guard(rating, profile, actor):
        return rating
    if rating.hr_comment_requested_at:
        return rating
    start = begin_recorded_transition(rating, actor=actor)
    rating.hr_comment_requested_by = actor
    rating.hr_comment_requested_at = timezone.now()
    rating.save(update_fields=["hr_comment_requested_by", "hr_comment_requested_at", "updated_at"])
    _record(rating, "contract_rating_hr_comment_requested", actor, start=start)
    _notify(rating, "hr_comment_requested", ["hr"])
    return rating


@transaction.atomic
def submit_hr_comment(rating_id, *, actor, comment):
    rating, profile = _locked(rating_id)
    require_company_access(actor, rating)
    if not is_hr_workflow_approver_user(actor):
        raise PermissionDenied("Only HR approvers may submit an advisory comment.")
    _reject_self_dealing(rating, profile, actor)
    if not rating.hr_comment_requested_at:
        raise ValueError("The CEO has not requested an HR comment for this rating.")
    if not isinstance(comment, str) or not comment.strip():
        raise ValueError("An HR comment is required.")
    if rating.status != S.DECIDED and _guard(rating, profile, actor):
        return rating
    start = begin_recorded_transition(rating, actor=actor)
    rating.hr_comment = comment.strip()
    rating.hr_comment_by = actor
    rating.hr_comment_submitted_at = timezone.now()
    rating.save(update_fields=["hr_comment", "hr_comment_by", "hr_comment_submitted_at", "updated_at"])
    _record(rating, "contract_rating_hr_comment_submitted", actor, start=start)
    _notify(rating, "hr_comment_submitted", ["requesting_ceo"])
    return rating


def _return_targets(decision):
    from .serializers import RETURN_TO_BOTH, RETURN_TO_EMPLOYEE, RETURN_TO_MANAGER

    return {
        RETURN_TO_MANAGER: [R.RaterType.MANAGER],
        RETURN_TO_EMPLOYEE: [R.RaterType.EMPLOYEE],
        RETURN_TO_BOTH: [R.RaterType.MANAGER, R.RaterType.EMPLOYEE],
    }.get(decision)


@transaction.atomic
def submit_ceo_decision(
    rating_id,
    *,
    actor,
    ceo_decision,
    comment="",
    ceo_approved_terms=None,
    salary_effective_date=None,
):
    rating, profile = _locked(rating_id)
    require_company_access(actor, rating)
    if not is_department_ceo_approver_user(actor):
        raise PermissionDenied("Only CEO approvers may decide ratings.")
    _reject_self_dealing(rating, profile, actor)
    if rating.status == S.DECIDED and rating.ceo_decided_by_id == actor.id and rating.ceo_decision == ceo_decision:
        return rating
    if rating.status != S.PENDING_CEO:
        raise ValueError("This rating is not pending a CEO decision.")
    workflow = sync_workflow(rating, actor=actor)
    if not can_user_act_on_instance(actor, rating, workflow):
        raise PermissionDenied("You cannot act on this rating.")
    if _guard(rating, profile, actor):
        return rating

    from .serializers import CeoDecisionWriteSerializer

    payload = {"ceo_decision": ceo_decision, "comment": comment}
    if ceo_approved_terms is not None:
        payload["ceo_approved_terms"] = ceo_approved_terms
    if salary_effective_date is not None:
        payload["salary_effective_date"] = salary_effective_date
    serializer = CeoDecisionWriteSerializer(data=payload)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    targets = _return_targets(ceo_decision)
    if targets and rating.rating_mode == ContractRating.RatingMode.SKIP_TO_CEO:
        raise ValueError("A rating sent directly to the CEO has no responses to return.")
    start = begin_recorded_transition(rating, actor=actor)

    if targets:
        for target in targets:
            response = R.objects.select_for_update().get(rating=rating, rater_type=target)
            response.status = R.Status.RETURNED
            response.returned_by = actor
            response.returned_at = timezone.now()
            response.return_reason = data["comment"].strip()
            response.save(update_fields=["status", "returned_by", "returned_at", "return_reason", "updated_at"])
            if target == R.RaterType.MANAGER:
                rating.manager_response = response
            else:
                rating.employee_response = response
        _recompute_status(rating)
        rating.save(update_fields=["status", "comparison_summary", "updated_at"])
        suffix = {
            (R.RaterType.MANAGER,): "manager",
            (R.RaterType.EMPLOYEE,): "employee",
            (R.RaterType.MANAGER, R.RaterType.EMPLOYEE): "both",
        }[tuple(targets)]
        _record(
            rating,
            f"contract_rating_ceo_returned_to_{suffix}",
            actor,
            start=start,
            action=WorkflowAction.Action.REQUEST_CHANGES,
            metadata={"targets": targets, "reason": data["comment"].strip()},
        )
        _notify(rating, "ceo_returned", [target.lower() for target in targets], data["comment"].strip())
        return rating

    approved_terms = {}
    if ceo_decision == ContractDecision.DecisionType.RENEW_WITH_CHANGES:
        approved_terms = _resolved_renewal_terms(profile, data["ceo_approved_terms"])
    if ceo_decision in RENEWAL_DECISIONS:
        # Fail before anything is written when the renewed term cannot be derived.
        _renewal_dates(rating.contract_decision)

    rating.status = S.DECIDED
    rating.ceo_decision = ceo_decision
    rating.ceo_decided_by = actor
    rating.ceo_comment = data["comment"].strip()
    rating.ceo_decided_at = timezone.now()
    rating.ceo_approved_terms = approved_terms
    rating.salary_effective_date = data.get("salary_effective_date")
    rating.scheduled_termination = ceo_decision == ContractDecision.DecisionType.TERMINATE
    rating.save()

    event_suffix = {
        ContractDecision.DecisionType.RENEW: "renew",
        ContractDecision.DecisionType.RENEW_WITH_CHANGES: "renew_with_increase",
        ContractDecision.DecisionType.TERMINATE: "terminate",
    }[ceo_decision]
    _record(
        rating,
        f"contract_rating_ceo_decided_{event_suffix}",
        actor,
        start=start,
        action=WorkflowAction.Action.APPROVE,
        metadata={
            "ceo_decision": ceo_decision,
            "comment": rating.ceo_comment,
            "ceo_approved_terms": approved_terms,
        },
    )
    if approved_terms:
        apply_approved_salary_change(rating.id, actor=actor)
        rating.refresh_from_db()
        if rating.status == S.MANUAL_RESOLUTION_REQUIRED:
            return rating
    if ceo_decision in RENEWAL_DECISIONS:
        # Renewal is settled now; a termination is closed out when it executes at expiry.
        _apply_renewal_dates(rating, profile)
        close_contract_decision(rating, actor=actor)
    if rating.scheduled_termination:
        _record(
            rating,
            "contract_rating_termination_scheduled",
            actor,
            metadata={"contract_expiry": str(profile.contract_expiry)},
        )
    audiences = ["hr"]
    if rating.rating_mode == ContractRating.RatingMode.RATE:
        audiences.append("manager")
    _notify(rating, f"ceo_decided_{event_suffix}", audiences, rating.ceo_comment)
    return rating


@transaction.atomic
def apply_approved_salary_change(rating_id, *, actor):
    rating, profile = _locked(rating_id)
    if rating.ceo_decision != ContractDecision.DecisionType.RENEW_WITH_CHANGES:
        return rating
    if rating.salary_change_applied_at:
        return rating
    if rating.status != S.DECIDED or not rating.ceo_approved_terms or rating.scheduled_termination:
        raise ValueError("A decided renew-with-increase outcome is required.")
    if _guard(rating, profile, actor):
        return rating
    current = contract_terms_snapshot(profile)
    if current != rating.salary_before_snapshot:
        return _manual_resolution(
            rating,
            "Salary changed after both evaluations were submitted.",
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
    if (
        rating.status != S.DECIDED
        or rating.ceo_decision != ContractDecision.DecisionType.TERMINATE
        or not rating.scheduled_termination
    ):
        raise ValueError("This rating has no decided scheduled termination.")
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
