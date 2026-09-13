"""Business rules and state transitions for asset return requests.

Route: the employee's manager (when the workflow requires one) -> HR; an HR
manager's own request goes straight to the CEO. When HR records the asset as
returned, every open or approved request for it is marked processed. Workflow
history is recorded as each action happens.
"""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from core.models import WorkflowAction
from core.responses import error
from core.services.workflow_engine import begin_recorded_transition, record_workflow_transition
from employees.services.manager_relationships import get_valid_manager_user, manager_approval_actor_source
from loans.permissions import get_active_workflow_config

from ..models import AssetReturnRequest

Status = AssetReturnRequest.RequestStatus
Action = WorkflowAction.Action

ASSET_APPROVAL_CAPABILITY = "assets.approve"
OPEN_STATUSES = [Status.PENDING_MANAGER, Status.PENDING, Status.PENDING_CEO, Status.APPROVED]

SELF_APPROVAL_MESSAGE = "Self approval is not allowed."
COMMENT_REQUIRED_MESSAGE = "comment is required."
NOT_PENDING_MANAGER_MESSAGE = "Request is not pending manager approval."
NOT_PENDING_HR_MESSAGE = "Request is not pending HR approval."
NOT_PENDING_CEO_MESSAGE = "Request is not pending CEO approval."
MANAGER_CANNOT_APPROVE_MESSAGE = "You cannot approve this asset return request."
MANAGER_CANNOT_REJECT_MESSAGE = "You cannot reject this asset return request."

_ERROR_TITLES = {422: "Validation error", 403: "Forbidden"}


class AssetReturnTransitionError(Exception):
    """A refused asset return transition, carrying its HTTP status."""

    def __init__(self, message: str, *, status: int = 422):
        super().__init__(message)
        self.message = message
        self.status = status

    def to_response(self):
        return error(_ERROR_TITLES.get(self.status, self.message), errors=[self.message], status=self.status)


def _in_hr_manager_group(user) -> bool:
    return bool(user and user.groups.filter(name="HRManager").exists())


def submission_status(requester, profile) -> str:
    """An HR manager's own request goes to the CEO; otherwise the manager (when required), then HR."""

    if requester.is_authenticated and _in_hr_manager_group(requester):
        return Status.PENDING_CEO
    manager_user = get_valid_manager_user(profile, cross_company_capability=ASSET_APPROVAL_CAPABILITY)
    if get_active_workflow_config().require_manager_stage and manager_user:
        return Status.PENDING_MANAGER
    return Status.PENDING


# ---------------------------------------------------------------------------
# Transitions
# ---------------------------------------------------------------------------


def _lock(instance: AssetReturnRequest) -> AssetReturnRequest:
    return AssetReturnRequest.objects.select_for_update().get(pk=instance.pk)


def _ensure_not_self_approval(instance: AssetReturnRequest, actor) -> None:
    if getattr(instance.employee, "user_id", None) == actor.pk:
        raise AssetReturnTransitionError(SELF_APPROVAL_MESSAGE)


def _rejection_comment(approve: bool, comment: str) -> str:
    comment = (comment or "").strip() if not approve else (comment or "")
    if not approve and not comment:
        raise AssetReturnTransitionError(COMMENT_REQUIRED_MESSAGE)
    return comment


def record_return_request_submission(instance: AssetReturnRequest, *, actor) -> None:
    """Start the recorded workflow history of a newly created return request."""

    start = begin_recorded_transition(instance, actor=actor, new_instance=True)
    record_workflow_transition(
        instance, start, action=Action.SUBMIT, actor=actor, note=instance.note or "", approver_role=""
    )


def apply_manager_decision(
    instance: AssetReturnRequest, *, actor, approve: bool, comment: str = ""
) -> tuple[AssetReturnRequest, str]:
    """The manager forwards the request to HR or rejects it. Returns ``(request, actor_source)``."""

    _ensure_not_self_approval(instance, actor)
    actor_source = manager_approval_actor_source(
        actor, instance.employee, capability=ASSET_APPROVAL_CAPABILITY, allow_admin=True
    )
    if not actor_source:
        message = MANAGER_CANNOT_APPROVE_MESSAGE if approve else MANAGER_CANNOT_REJECT_MESSAGE
        raise AssetReturnTransitionError(message, status=403)
    if instance.status != Status.PENDING_MANAGER:
        raise AssetReturnTransitionError(NOT_PENDING_MANAGER_MESSAGE)
    comment = _rejection_comment(approve, comment)

    with transaction.atomic():
        locked = _lock(instance)
        if locked.status != Status.PENDING_MANAGER:
            raise AssetReturnTransitionError(NOT_PENDING_MANAGER_MESSAGE)

        start = begin_recorded_transition(locked, actor=actor)
        locked.status = Status.PENDING if approve else Status.REJECTED
        locked.manager_decision_by = actor
        locked.manager_decision_at = timezone.now()
        locked.manager_decision_note = comment
        locked.save(update_fields=["status", "manager_decision_by", "manager_decision_at", "manager_decision_note"])
        record_workflow_transition(
            locked,
            start,
            action=Action.ADVANCE if approve else Action.REJECT,
            actor=actor,
            note=comment,
            approver_role="manager",
            metadata={"actor_source": actor_source},
        )
    return locked, actor_source


def apply_hr_decision(instance: AssetReturnRequest, *, actor, approve: bool, comment: str = "") -> AssetReturnRequest:
    _ensure_not_self_approval(instance, actor)
    if instance.status != Status.PENDING:
        raise AssetReturnTransitionError(NOT_PENDING_HR_MESSAGE)
    comment = _rejection_comment(approve, comment)

    with transaction.atomic():
        locked = _lock(instance)
        if locked.status != Status.PENDING:
            raise AssetReturnTransitionError(NOT_PENDING_HR_MESSAGE)

        start = begin_recorded_transition(locked, actor=actor)
        locked.status = Status.APPROVED if approve else Status.REJECTED
        locked.hr_decision_by = actor
        locked.hr_decision_at = timezone.now()
        locked.hr_decision_note = comment
        locked.save(update_fields=["status", "hr_decision_by", "hr_decision_at", "hr_decision_note"])
        record_workflow_transition(
            locked,
            start,
            action=Action.APPROVE if approve else Action.REJECT,
            actor=actor,
            note=comment,
            approver_role="hr",
        )
    return locked


def apply_ceo_decision(instance: AssetReturnRequest, *, actor, approve: bool, comment: str = "") -> AssetReturnRequest:
    if instance.status != Status.PENDING_CEO:
        raise AssetReturnTransitionError(NOT_PENDING_CEO_MESSAGE)
    employee_user = getattr(instance.employee, "user", None)
    if _in_hr_manager_group(employee_user) and employee_user.pk == actor.pk:
        raise AssetReturnTransitionError(SELF_APPROVAL_MESSAGE)
    comment = _rejection_comment(approve, comment)

    with transaction.atomic():
        locked = _lock(instance)
        if locked.status != Status.PENDING_CEO:
            raise AssetReturnTransitionError(NOT_PENDING_CEO_MESSAGE)

        start = begin_recorded_transition(locked, actor=actor)
        locked.status = Status.APPROVED if approve else Status.REJECTED
        locked.ceo_decision_by = actor
        locked.ceo_decision_at = timezone.now()
        locked.ceo_decision_note = comment
        locked.save(update_fields=["status", "ceo_decision_by", "ceo_decision_at", "ceo_decision_note"])
        record_workflow_transition(
            locked,
            start,
            action=Action.APPROVE if approve else Action.REJECT,
            actor=actor,
            note=comment,
            approver_role="ceo",
        )
    return locked


def mark_return_request_processed(request_obj: AssetReturnRequest, *, actor) -> AssetReturnRequest:
    """HR received the asset. Call with the request row already locked."""

    start = begin_recorded_transition(request_obj, actor=actor)
    request_obj.status = Status.PROCESSED
    request_obj.processed_by = actor
    request_obj.processed_at = timezone.now()
    request_obj.save(update_fields=["status", "processed_by", "processed_at"])
    record_workflow_transition(
        request_obj,
        start,
        action=Action.OVERRIDE,
        actor=actor,
        note="Asset received by HR",
        approver_role="hr",
        metadata={"result": "processed"},
    )
    return request_obj
