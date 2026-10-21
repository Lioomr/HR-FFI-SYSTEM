"""Business rules and state transitions for asset return requests.

Route: the employee's manager (when the workflow requires one) -> HR; an HR
manager's own request goes straight to the CEO. When HR records the asset as
returned, every open or approved request for it is marked processed. Workflow
history is recorded as each action happens.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from core.models import WorkflowAction
from core.responses import error
from core.services.archived_employee import archived_cancel_note, is_profile_archived
from core.services.stage_coverage import manager_covers_hr, record_covered_stage
from core.services.workflow_engine import begin_recorded_transition, record_workflow_transition
from django.db import transaction
from django.utils import timezone
from employees.services.manager_relationships import get_valid_manager_user, manager_approval_actor_source
from loans.permissions import get_active_workflow_config

from ..document_integrity import on_asset_return_stage_approved
from ..models import AssetReturnRequest

logger = logging.getLogger(__name__)

Status = AssetReturnRequest.RequestStatus
Action = WorkflowAction.Action

ASSET_APPROVAL_CAPABILITY = "assets.approve"
OPEN_STATUSES = [Status.PENDING_MANAGER, Status.PENDING, Status.PENDING_CEO, Status.APPROVED]
# The employee withdraws their own request before it is approved.
REQUESTER_CANCELLABLE_STATUSES = frozenset({Status.PENDING_MANAGER, Status.PENDING, Status.PENDING_CEO})

SELF_APPROVAL_MESSAGE = "Self approval is not allowed."
COMMENT_REQUIRED_MESSAGE = "comment is required."
NOT_PENDING_MANAGER_MESSAGE = "Request is not pending manager approval."
NOT_PENDING_HR_MESSAGE = "Request is not pending HR approval."
NOT_PENDING_CEO_MESSAGE = "Request is not pending CEO approval."
MANAGER_CANNOT_APPROVE_MESSAGE = "You cannot approve this asset return request."
MANAGER_CANNOT_REJECT_MESSAGE = "You cannot reject this asset return request."
NOT_REQUESTER_MESSAGE = "Only the requester can cancel this asset return request."
NOT_CANCELLABLE_MESSAGE = "Only pending asset return requests can be cancelled."
ARCHIVED_EMPLOYEE_MESSAGE = (
    "This employee is archived, so the asset return request cannot be approved or advanced. "
    "Reject or cancel it instead."
)

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


def _ensure_employee_not_archived(locked: AssetReturnRequest) -> None:
    """Refuse to approve or advance a request of an archived employee (rejecting stays allowed)."""

    if is_profile_archived(locked.employee_id):
        raise AssetReturnTransitionError(ARCHIVED_EMPLOYEE_MESSAGE)


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
    on_asset_return_stage_approved(instance, role="employee", actor=actor, at=instance.requested_at)


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
        if approve:
            _ensure_employee_not_archived(locked)

        start = begin_recorded_transition(locked, actor=actor)
        locked.manager_decision_by = actor
        locked.manager_decision_at = timezone.now()
        locked.manager_decision_note = comment
        update_fields = ["status", "manager_decision_by", "manager_decision_at", "manager_decision_note"]
        # A manager who is also an HR manager has done the HR review too, so the request is approved.
        hr_covered = approve and manager_covers_hr(actor, actor_source)
        locked.status = Status.APPROVED if hr_covered else Status.PENDING if approve else Status.REJECTED
        if hr_covered:
            locked.hr_decision_by = actor
            locked.hr_decision_at = locked.manager_decision_at
            update_fields += ["hr_decision_by", "hr_decision_at"]
        locked.save(update_fields=update_fields)
        record_workflow_transition(
            locked,
            start,
            action=Action.ADVANCE if approve else Action.REJECT,
            actor=actor,
            note=comment,
            approver_role="manager",
            metadata={"actor_source": actor_source},
        )
        if hr_covered:
            record_covered_stage(locked, start, "hr", actor=actor, source=actor_source)
        if approve:
            on_asset_return_stage_approved(locked, role="line_manager", actor=actor, at=locked.manager_decision_at)
        if hr_covered:
            on_asset_return_stage_approved(locked, role="hr", actor=actor, at=locked.hr_decision_at)
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
        if approve:
            _ensure_employee_not_archived(locked)

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
        if approve:
            on_asset_return_stage_approved(locked, role="hr", actor=actor, at=locked.hr_decision_at)
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
        if approve:
            _ensure_employee_not_archived(locked)

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
        if approve:
            on_asset_return_stage_approved(locked, role="ceo", actor=actor, at=locked.ceo_decision_at)
    return locked


def cancel_return_request(instance: AssetReturnRequest, *, actor) -> tuple[AssetReturnRequest, str]:
    """The employee withdraws their own pending return request. Returns ``(request, from_status)``."""

    if getattr(instance.employee, "user_id", None) != actor.pk:
        raise AssetReturnTransitionError(NOT_REQUESTER_MESSAGE, status=403)

    with transaction.atomic():
        locked = _lock(instance)
        if locked.status not in REQUESTER_CANCELLABLE_STATUSES:
            raise AssetReturnTransitionError(NOT_CANCELLABLE_MESSAGE)

        from_status = locked.status
        start = begin_recorded_transition(locked, actor=actor)
        locked.status = Status.CANCELLED
        locked.cancelled_at = timezone.now()
        locked.save(update_fields=["status", "cancelled_at"])
        record_workflow_transition(locked, start, action=Action.CANCEL, actor=actor, approver_role="")
    return locked, from_status


# The requester edits only while the request waits on their manager; ``PENDING`` is
# already the HR stage, so from there they cancel and resubmit.
REQUESTER_EDITABLE_STATUSES = frozenset({Status.PENDING_MANAGER})
NOT_REQUESTER_EDITOR_MESSAGE = "Only the requester can edit this asset return request."
NOT_REQUESTER_EDITABLE_MESSAGE = (
    "This asset return request can no longer be edited because it has reached HR review or a decision was "
    "recorded. Cancel it and submit a new request instead."
)
#: Stored fields the edit may change, in a stable order for history and audit.
EDITABLE_FIELDS = ("note",)
_DECISION_FIELDS = ("manager_decision_at", "hr_decision_at", "ceo_decision_at", "processed_at", "cancelled_at")


class AssetReturnEditInvalid(Exception):
    """The edited request failed the create rules; ``errors`` is the serializer error dict."""

    def __init__(self, errors):
        super().__init__("Validation error")
        self.errors = errors


@dataclass(frozen=True)
class ReturnRequestEdit:
    instance: AssetReturnRequest
    from_status: str
    changed_fields: tuple[str, ...]


def requester_edit_refusal(instance: AssetReturnRequest) -> str | None:
    """Why the requester can no longer edit ``instance``, or ``None`` while they still can."""

    if instance.status not in REQUESTER_EDITABLE_STATUSES or any(getattr(instance, name) for name in _DECISION_FIELDS):
        return NOT_REQUESTER_EDITABLE_MESSAGE
    return None


def edit_return_request(instance: AssetReturnRequest, *, actor, validate) -> ReturnRequestEdit:
    """The requester changes the note of their own request while it waits on the manager.

    ``validate(locked)`` re-runs the create rules and returns the validated changes,
    or raises ``AssetReturnEditInvalid``. The asset never changes.
    """

    if getattr(instance.employee, "user_id", None) != actor.pk:
        raise AssetReturnTransitionError(NOT_REQUESTER_EDITOR_MESSAGE, status=403)

    with transaction.atomic():
        locked = _lock(instance)
        refusal = requester_edit_refusal(locked)
        if refusal:
            raise AssetReturnTransitionError(refusal)

        changes = validate(locked)
        changed = [name for name in EDITABLE_FIELDS if name in changes and getattr(locked, name) != changes[name]]
        if not changed:
            return ReturnRequestEdit(locked, locked.status, ())

        from_status = locked.status
        start = begin_recorded_transition(locked, actor=actor)
        refusal = requester_edit_refusal(locked)
        if refusal:
            raise AssetReturnTransitionError(refusal)
        for name in changed:
            setattr(locked, name, changes[name])
        locked.save(update_fields=changed)
        # Field names only: the free-text note never enters the workflow history.
        record_workflow_transition(
            locked,
            start,
            action=Action.EDIT,
            actor=actor,
            note="Edited: " + ", ".join(changed),
            approver_role="",
            metadata={"changed_fields": changed},
        )
    return ReturnRequestEdit(locked, from_status, tuple(changed))


def notify_after_requester_edit(instance: AssetReturnRequest) -> None:
    """Tell the manager the request waiting on them was changed (after commit, never raises)."""

    stamp = int(timezone.now().timestamp())

    def send():
        from in_app_notifications.dispatcher import dispatch_notification_channels
        from in_app_notifications.i18n import notification_text, profile_name
        from in_app_notifications.models import Notification

        profile = instance.employee
        manager = get_valid_manager_user(profile, cross_company_capability=ASSET_APPROVAL_CAPABILITY)
        if manager is None or manager.pk == profile.user_id:
            return None
        return dispatch_notification_channels(
            recipient=manager,
            event_key="asset_return.updated",
            **notification_text(
                "asset_return.updated",
                employee_name=profile_name(profile, getattr(profile.user, "email", "")),
                request_id=instance.pk,
            ),
            category=Notification.Category.ASSET,
            action_url="/manager/team-requests?tab=asset-returns",
            related_object=instance,
            deduplication_key=f"asset_return.updated:{instance.pk}:{manager.pk}:{stamp}",
            whatsapp_enabled=False,
        )

    def dispatch():
        try:
            # A savepoint keeps a database error inside the notification pipeline from
            # poisoning any surrounding transaction.
            with transaction.atomic():
                send()
        except Exception:
            logger.exception(
                "asset_return_edit_notification_failed",
                extra={"entity_id": instance.pk, "notification_type": "asset_return_updated"},
            )

    transaction.on_commit(dispatch)


NOT_HR_CANCELLABLE_MESSAGE = "Only an approved asset return request that is not yet processed can be cancelled by HR."
SELF_CANCELLATION_MESSAGE = "Another HR member must cancel your own asset return request."


def apply_hr_cancellation(instance: AssetReturnRequest, *, actor, note: str = "") -> tuple[AssetReturnRequest, str]:
    """HR cancels an approved return request before the asset is received. Returns ``(request, from_status)``.

    The asset assignment is untouched: an unprocessed return never changed it.
    """

    if getattr(instance.employee, "user_id", None) == actor.pk:
        raise AssetReturnTransitionError(SELF_CANCELLATION_MESSAGE, status=403)

    with transaction.atomic():
        locked = _lock(instance)
        if locked.status != Status.APPROVED:
            raise AssetReturnTransitionError(NOT_HR_CANCELLABLE_MESSAGE)

        from_status = locked.status
        start = begin_recorded_transition(locked, actor=actor)
        locked.status = Status.CANCELLED
        locked.cancelled_at = timezone.now()
        locked.save(update_fields=["status", "cancelled_at"])
        record_workflow_transition(locked, start, action=Action.CANCEL, actor=actor, note=note, approver_role="hr")
    return locked, from_status


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
    # The "Processed" row completes the form: freeze it once the caller's transaction commits.
    on_asset_return_stage_approved(request_obj, role="asset_received", actor=actor, at=request_obj.processed_at)
    return request_obj


def cancel_open_requests_for_archived_employee(profile, *, actor, reason: str = "") -> list[int]:
    """Cancel every not-yet-approved asset return request of a freshly archived employee.

    Approved requests are left alone: HR still has to receive the asset, which is the
    point of the return. Nobody is notified, the requester's account is disabled by the
    archive. Returns the ids that were cancelled.
    """

    note = archived_cancel_note("asset return request", reason)
    cancelled: list[int] = []
    for return_request in AssetReturnRequest.objects.filter(
        employee_id=profile.pk, status__in=REQUESTER_CANCELLABLE_STATUSES
    ):
        with transaction.atomic():
            locked = _lock(return_request)
            if locked.status not in REQUESTER_CANCELLABLE_STATUSES:
                continue
            start = begin_recorded_transition(locked, actor=actor)
            locked.status = Status.CANCELLED
            locked.cancelled_at = timezone.now()
            locked.save(update_fields=["status", "cancelled_at"])
            record_workflow_transition(locked, start, action=Action.CANCEL, actor=actor, note=note, approver_role="hr")
        cancelled.append(locked.pk)
    return cancelled
