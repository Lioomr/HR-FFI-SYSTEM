"""Business rules and state transitions for loan requests.

Views scope, validate input, audit, notify, and serialize. This module owns each
transition: it checks who may act, locks the row, re-checks the state under that
lock, writes the domain ``status``, and records the workflow action in the same
transaction.

Route: manager recommendation (when required) -> HR recommendation -> CFO, who
approves, rejects, or refers to the CEO -> disbursement -> payroll deduction.
Manager and HR "reject" are recommendations that still move the request on.
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from core.models import WorkflowAction
from core.responses import error
from core.services.workflow_engine import begin_recorded_transition, record_workflow_transition
from employees.services.manager_relationships import get_valid_manager_user, manager_approval_actor_source

from .models import LoanRequest
from .permissions import get_active_workflow_config

Status = LoanRequest.RequestStatus
Recommendation = LoanRequest.Recommendation
Action = WorkflowAction.Action

LOAN_APPROVAL_CAPABILITY = "loans.approve"

LEGACY_PENDING_HR_STATUSES = [Status.PENDING_HR, Status.PENDING_FINANCE]
CANCELLABLE_STATUSES = frozenset(
    {
        Status.SUBMITTED,
        Status.PENDING_MANAGER,
        Status.PENDING_HR,
        Status.PENDING_FINANCE,
        Status.PENDING_CFO,
        Status.PENDING_CEO,
    }
)

SELF_APPROVAL_MESSAGE = "Self approval is not allowed."
COMMENT_REQUIRED_MESSAGE = "comment is required."
NOT_PENDING_MANAGER_MESSAGE = "Request is not pending manager approval."
NOT_PENDING_HR_MESSAGE = "Request is not pending HR approval."
NOT_PENDING_CFO_MESSAGE = "Request is not pending CFO approval."
NOT_PENDING_CEO_MESSAGE = "Request is not pending CEO approval."
NOT_PENDING_DISBURSEMENT_MESSAGE = "Request is not pending disbursement."
NOT_CANCELLABLE_MESSAGE = "Only pending requests can be cancelled."
MANAGER_CANNOT_DECIDE_MESSAGES = {
    Recommendation.APPROVE: "You cannot approve this loan request.",
    Recommendation.REJECT: "You cannot reject this loan request.",
}

_ERROR_TITLES = {422: "Validation error", 403: "Forbidden"}


class LoanTransitionError(Exception):
    """A refused loan transition, carrying its HTTP status."""

    def __init__(self, message: str, *, status: int = 422):
        super().__init__(message)
        self.message = message
        self.status = status

    def to_response(self):
        return error(_ERROR_TITLES.get(self.status, self.message), errors=[self.message], status=self.status)


# ---------------------------------------------------------------------------
# Routing
# ---------------------------------------------------------------------------


def _is_hr_manager(user) -> bool:
    return bool(user and user.is_authenticated and user.groups.filter(name="HRManager").exists())


def submission_status(user, profile) -> str:
    """An HR manager's loan goes to the CEO; otherwise the manager (when required and valid), then HR."""

    if _is_hr_manager(user):
        return Status.PENDING_CEO
    manager_user = get_valid_manager_user(profile, cross_company_capability=LOAN_APPROVAL_CAPABILITY)
    if manager_user and get_active_workflow_config().require_manager_stage:
        return Status.PENDING_MANAGER
    return Status.PENDING_HR


def _next_year_month(year: int, month: int) -> tuple[int, int]:
    if month == 12:
        return year + 1, 1
    return year, month + 1


def resolve_open_loan_target_period() -> tuple[int, int]:
    """Deduct an open loan in the current payroll month, or the next one once this month's payroll is closed."""

    from payroll.models import PayrollRun

    now = timezone.localtime()
    year, month = now.year, now.month
    current_run = PayrollRun.objects.filter(year=year, month=month).order_by("-id").first()
    if current_run and current_run.status in [PayrollRun.Status.COMPLETED, PayrollRun.Status.PAID]:
        return _next_year_month(year, month)
    return year, month


# ---------------------------------------------------------------------------
# Transitions
# ---------------------------------------------------------------------------


def _lock(instance: LoanRequest) -> LoanRequest:
    return LoanRequest.objects.select_for_update().get(pk=instance.pk)


def _ensure_not_self_approval(instance: LoanRequest, actor) -> None:
    if instance.employee_id == actor.pk:
        raise LoanTransitionError(SELF_APPROVAL_MESSAGE)


def _required_comment(comment: str) -> str:
    comment = (comment or "").strip()
    if not comment:
        raise LoanTransitionError(COMMENT_REQUIRED_MESSAGE)
    return comment


def record_loan_submission(instance: LoanRequest, *, actor) -> None:
    """Start the recorded workflow history of a newly created loan request."""

    start = begin_recorded_transition(instance, actor=actor, new_instance=True)
    record_workflow_transition(
        instance, start, action=Action.SUBMIT, actor=actor, note=instance.reason or "", approver_role=""
    )


def apply_manager_recommendation(
    instance: LoanRequest, *, actor, recommendation: str, note: str = ""
) -> tuple[LoanRequest, str]:
    """Record the manager's recommendation and send the request to HR. Returns ``(loan, actor_source)``."""

    _ensure_not_self_approval(instance, actor)
    actor_source = manager_approval_actor_source(
        actor, instance.employee_profile, capability=LOAN_APPROVAL_CAPABILITY, allow_admin=True
    )
    if not actor_source:
        raise LoanTransitionError(MANAGER_CANNOT_DECIDE_MESSAGES[recommendation], status=403)
    if instance.status != Status.PENDING_MANAGER:
        raise LoanTransitionError(NOT_PENDING_MANAGER_MESSAGE)

    with transaction.atomic():
        locked = _lock(instance)
        if locked.status != Status.PENDING_MANAGER:
            raise LoanTransitionError(NOT_PENDING_MANAGER_MESSAGE)

        start = begin_recorded_transition(locked, actor=actor)
        locked.status = Status.PENDING_HR
        locked.manager_decision_by = actor
        locked.manager_decision_at = timezone.now()
        locked.manager_decision_note = note
        locked.manager_recommendation = recommendation
        locked.save(
            update_fields=[
                "status",
                "manager_decision_by",
                "manager_decision_at",
                "manager_decision_note",
                "manager_recommendation",
                "updated_at",
            ]
        )
        record_workflow_transition(
            locked,
            start,
            action=Action.ADVANCE,
            actor=actor,
            note=note,
            approver_role="manager",
            metadata={"recommendation": recommendation, "actor_source": actor_source},
        )
    return locked, actor_source


def apply_hr_recommendation(instance: LoanRequest, *, actor, recommendation: str, note: str = "") -> LoanRequest:
    """Record HR's recommendation and send the request to the CFO."""

    _ensure_not_self_approval(instance, actor)
    if instance.status not in LEGACY_PENDING_HR_STATUSES:
        raise LoanTransitionError(NOT_PENDING_HR_MESSAGE)

    with transaction.atomic():
        locked = _lock(instance)
        if locked.status not in LEGACY_PENDING_HR_STATUSES:
            raise LoanTransitionError(NOT_PENDING_HR_MESSAGE)

        start = begin_recorded_transition(locked, actor=actor)
        locked.status = Status.PENDING_CFO
        locked.finance_decision_by = actor
        locked.finance_decision_at = timezone.now()
        locked.finance_decision_note = note
        locked.hr_recommendation = recommendation
        locked.save(
            update_fields=[
                "status",
                "finance_decision_by",
                "finance_decision_at",
                "finance_decision_note",
                "hr_recommendation",
                "updated_at",
            ]
        )
        record_workflow_transition(
            locked,
            start,
            action=Action.ADVANCE,
            actor=actor,
            note=note,
            approver_role="hr",
            metadata={"recommendation": recommendation},
        )
    return locked


def _approve_amount(locked: LoanRequest) -> list[str]:
    """Approve the requested amount and set the payroll month an open loan is deducted in."""

    now = timezone.localtime()
    target_year = target_month = None
    if locked.loan_type == LoanRequest.LoanType.OPEN:
        target_year, target_month = resolve_open_loan_target_period()
    locked.status = Status.PENDING_DISBURSEMENT
    locked.approved_amount = locked.requested_amount
    locked.approved_year = now.year
    locked.approved_month = now.month
    locked.target_deduction_year = target_year
    locked.target_deduction_month = target_month
    return [
        "status",
        "approved_amount",
        "approved_year",
        "approved_month",
        "target_deduction_year",
        "target_deduction_month",
    ]


def _ensure_pending(instance: LoanRequest, actor, expected_status: str, message: str) -> None:
    _ensure_not_self_approval(instance, actor)
    if instance.status != expected_status:
        raise LoanTransitionError(message)


def apply_cfo_approval(instance: LoanRequest, *, actor, note: str = "") -> LoanRequest:
    _ensure_pending(instance, actor, Status.PENDING_CFO, NOT_PENDING_CFO_MESSAGE)

    with transaction.atomic():
        locked = _lock(instance)
        if locked.status != Status.PENDING_CFO:
            raise LoanTransitionError(NOT_PENDING_CFO_MESSAGE)

        start = begin_recorded_transition(locked, actor=actor)
        update_fields = _approve_amount(locked)
        locked.cfo_decision_by = actor
        locked.cfo_decision_at = timezone.now()
        locked.cfo_decision_note = note
        locked.save(
            update_fields=[*update_fields, "cfo_decision_by", "cfo_decision_at", "cfo_decision_note", "updated_at"]
        )
        record_workflow_transition(locked, start, action=Action.ADVANCE, actor=actor, note=note, approver_role="cfo")
    return locked


def _apply_cfo_final_or_referral(
    instance: LoanRequest, *, actor, comment: str, target_status: str, action: str
) -> LoanRequest:
    _ensure_pending(instance, actor, Status.PENDING_CFO, NOT_PENDING_CFO_MESSAGE)
    comment = _required_comment(comment)

    with transaction.atomic():
        locked = _lock(instance)
        if locked.status != Status.PENDING_CFO:
            raise LoanTransitionError(NOT_PENDING_CFO_MESSAGE)

        start = begin_recorded_transition(locked, actor=actor)
        locked.status = target_status
        locked.cfo_decision_by = actor
        locked.cfo_decision_at = timezone.now()
        locked.cfo_decision_note = comment
        locked.save(update_fields=["status", "cfo_decision_by", "cfo_decision_at", "cfo_decision_note", "updated_at"])
        record_workflow_transition(locked, start, action=action, actor=actor, note=comment, approver_role="cfo")
    return locked


def apply_cfo_rejection(instance: LoanRequest, *, actor, comment: str) -> LoanRequest:
    return _apply_cfo_final_or_referral(
        instance, actor=actor, comment=comment, target_status=Status.REJECTED, action=Action.REJECT
    )


def apply_ceo_referral(instance: LoanRequest, *, actor, comment: str) -> LoanRequest:
    """The CFO sends the request to the CEO for the decision."""

    return _apply_cfo_final_or_referral(
        instance, actor=actor, comment=comment, target_status=Status.PENDING_CEO, action=Action.ADVANCE
    )


def apply_ceo_approval(instance: LoanRequest, *, actor, note: str = "") -> LoanRequest:
    _ensure_pending(instance, actor, Status.PENDING_CEO, NOT_PENDING_CEO_MESSAGE)

    with transaction.atomic():
        locked = _lock(instance)
        if locked.status != Status.PENDING_CEO:
            raise LoanTransitionError(NOT_PENDING_CEO_MESSAGE)

        start = begin_recorded_transition(locked, actor=actor)
        update_fields = _approve_amount(locked)
        locked.ceo_decision_by = actor
        locked.ceo_decision_at = timezone.now()
        locked.ceo_decision_note = note
        locked.save(
            update_fields=[*update_fields, "ceo_decision_by", "ceo_decision_at", "ceo_decision_note", "updated_at"]
        )
        record_workflow_transition(locked, start, action=Action.APPROVE, actor=actor, note=note, approver_role="ceo")
    return locked


def apply_ceo_rejection(instance: LoanRequest, *, actor, comment: str) -> LoanRequest:
    _ensure_pending(instance, actor, Status.PENDING_CEO, NOT_PENDING_CEO_MESSAGE)
    comment = _required_comment(comment)

    with transaction.atomic():
        locked = _lock(instance)
        if locked.status != Status.PENDING_CEO:
            raise LoanTransitionError(NOT_PENDING_CEO_MESSAGE)

        start = begin_recorded_transition(locked, actor=actor)
        locked.status = Status.REJECTED
        locked.ceo_decision_by = actor
        locked.ceo_decision_at = timezone.now()
        locked.ceo_decision_note = comment
        locked.save(update_fields=["status", "ceo_decision_by", "ceo_decision_at", "ceo_decision_note", "updated_at"])
        record_workflow_transition(locked, start, action=Action.REJECT, actor=actor, note=comment, approver_role="ceo")
    return locked


def apply_disbursement(instance: LoanRequest, *, actor, note: str = "") -> LoanRequest:
    if instance.status != Status.PENDING_DISBURSEMENT:
        raise LoanTransitionError(NOT_PENDING_DISBURSEMENT_MESSAGE)

    with transaction.atomic():
        locked = _lock(instance)
        if locked.status != Status.PENDING_DISBURSEMENT:
            raise LoanTransitionError(NOT_PENDING_DISBURSEMENT_MESSAGE)

        start = begin_recorded_transition(locked, actor=actor)
        locked.status = Status.APPROVED
        locked.disbursed_by = actor
        locked.disbursed_at = timezone.now()
        locked.disbursement_note = note
        locked.save(update_fields=["status", "disbursed_by", "disbursed_at", "disbursement_note", "updated_at"])
        record_workflow_transition(
            locked, start, action=Action.DISBURSE, actor=actor, note=note, approver_role="disbursement"
        )
    return locked


def apply_cancellation(instance: LoanRequest, *, actor) -> LoanRequest:
    if instance.employee_id != actor.pk:
        raise LoanTransitionError("Forbidden.", status=403)

    with transaction.atomic():
        locked = _lock(instance)
        if locked.status not in CANCELLABLE_STATUSES:
            raise LoanTransitionError(NOT_CANCELLABLE_MESSAGE)

        start = begin_recorded_transition(locked, actor=actor)
        locked.status = Status.CANCELLED
        locked.save(update_fields=["status", "updated_at"])
        record_workflow_transition(locked, start, action=Action.CANCEL, actor=actor, approver_role="")
    return locked


def apply_payroll_deduction(loan: LoanRequest, *, run) -> LoanRequest:
    """Mark a disbursed loan deducted in ``run``. Call with the loan row already locked."""

    start = begin_recorded_transition(loan)
    loan.deduction_payroll_run = run
    loan.deducted_at = timezone.now()
    loan.deducted_amount = loan.approved_amount or loan.requested_amount
    loan.status = Status.DEDUCTED
    loan.save(update_fields=["deduction_payroll_run", "deducted_at", "deducted_amount", "status", "updated_at"])
    record_workflow_transition(
        loan,
        start,
        action=Action.DEDUCT,
        actor=None,
        note=f"Deducted amount: {loan.deducted_amount}",
        approver_role="",
        metadata={"payroll_run_id": run.id},
    )
    return loan
