"""Business rules and state transitions for employee archive (deletion) requests.

HR requests an archive; the CEO approves it (the employee is archived, their
BioTime mapping retired, and their account disabled) or rejects it. Workflow
history is recorded as each action happens.
"""

from __future__ import annotations

import logging

from django.db import IntegrityError, transaction
from django.utils import timezone

from core.models import WorkflowAction
from core.responses import error
from core.services.workflow_engine import begin_recorded_transition, record_workflow_transition
from leaves.models import LeaveRequest
from loans.models import LoanRequest

from .models import EmployeeDeletionRequest
from .services.archiving import retire_biotime_mapping_and_archive_profile

logger = logging.getLogger(__name__)

Status = EmployeeDeletionRequest.Status
Action = WorkflowAction.Action

NOT_PENDING_CEO_MESSAGE = "Request is not pending CEO approval."
PROFILE_UNAVAILABLE_MESSAGE = "Employee profile is no longer available."
ALREADY_ARCHIVED_MESSAGE = "Employee is already archived."
REASON_REQUIRED_MESSAGE = "Reason is required."
ARCHIVE_BLOCKED_TITLE = "Archive cannot be completed."
ARCHIVE_BLOCKED_MESSAGE = (
    "The employee could not be archived because an active record still blocks the request. "
    "No attendance history or BioTime mapping was changed. Please contact HR support."
)


class ArchiveRequestError(Exception):
    """A refused archive request action, carrying its HTTP response details."""

    def __init__(self, message: str, *, title: str = "Validation error", status: int = 422, errors=None):
        super().__init__(message)
        self.message = message
        self.title = title
        self.status = status
        self.errors = errors if errors is not None else [message]

    def to_response(self):
        return error(self.title, errors=self.errors, status=self.status)


def build_archive_execution_snapshot(instance: EmployeeDeletionRequest) -> dict:
    """What the employee still had open when the CEO approved the archive."""

    from assets.models import AssetAssignment

    profile = instance.employee_profile
    target_user = instance.target_user
    snapshot = dict(instance.request_snapshot or {})
    if profile:
        snapshot.update(
            {
                "open_leave_requests": LeaveRequest.objects.filter(employee_profile=profile).count(),
                "asset_assignments": AssetAssignment.objects.filter(employee=profile, is_active=True).count(),
                "loan_requests": LoanRequest.objects.filter(employee_profile=profile).count(),
            }
        )
    snapshot["target_user_email"] = target_user.email if target_user else snapshot.get("email", "")
    snapshot["target_user_was_active"] = bool(target_user and target_user.is_active)
    return snapshot


def record_archive_request_submission(instance: EmployeeDeletionRequest, *, actor) -> None:
    """Start the recorded workflow history of a newly created archive request."""

    start = begin_recorded_transition(instance, actor=actor, new_instance=True)
    record_workflow_transition(
        instance, start, action=Action.SUBMIT, actor=actor, note=instance.reason or "", approver_role=""
    )


def apply_archive_approval(instance: EmployeeDeletionRequest, *, actor) -> tuple[EmployeeDeletionRequest, object, dict]:
    """Archive the employee and mark the request executed.

    Returns ``(request, profile, execution_snapshot)``. Nothing changes when an
    active record blocks archiving.
    """

    with transaction.atomic():
        # PostgreSQL cannot apply FOR UPDATE to the nullable outer joins
        # introduced by select_related() on these optional relations.
        # Lock the request row directly, then load its relations normally.
        locked = EmployeeDeletionRequest.objects.select_for_update().get(pk=instance.pk)
        if locked.status != Status.PENDING_CEO:
            raise ArchiveRequestError(NOT_PENDING_CEO_MESSAGE)

        profile = locked.employee_profile
        target_user = locked.target_user or (profile.user if profile and profile.user_id else None)
        if profile is None:
            raise ArchiveRequestError(PROFILE_UNAVAILABLE_MESSAGE)
        if profile.is_archived:
            raise ArchiveRequestError(ALREADY_ARCHIVED_MESSAGE)

        start = begin_recorded_transition(locked, actor=actor)
        execution_snapshot = build_archive_execution_snapshot(locked)
        now = timezone.now()
        try:
            retire_biotime_mapping_and_archive_profile(profile, execution_snapshot, actor, locked.archive_reason, now)
        except IntegrityError:
            logger.exception("employee_archive_integrity_check_failed", extra={"request_id": locked.id})
            raise ArchiveRequestError(ARCHIVE_BLOCKED_MESSAGE, title=ARCHIVE_BLOCKED_TITLE) from None
        execution_snapshot.update(
            {
                "is_archived": True,
                "archived_at": now.isoformat(),
                "archived_by_id": actor.id,
                "archive_reason": locked.archive_reason,
                "target_user_disabled": bool(target_user),
            }
        )

        if target_user is not None and target_user.is_active:
            target_user.is_active = False
            target_user.auth_token_version += 1
            target_user.save(update_fields=["is_active", "auth_token_version"])

        locked.status = Status.EXECUTED
        locked.approved_by = actor
        locked.approved_at = now
        locked.executed_at = now
        locked.execution_snapshot = execution_snapshot
        locked.save(
            update_fields=["status", "approved_by", "approved_at", "executed_at", "execution_snapshot", "updated_at"]
        )
        record_workflow_transition(
            locked, start, action=Action.APPROVE, actor=actor, note=locked.reason or "", approver_role="ceo"
        )

    locked.refresh_from_db()
    return locked, profile, execution_snapshot


def apply_archive_rejection(instance: EmployeeDeletionRequest, *, actor, reason: str) -> EmployeeDeletionRequest:
    if instance.status != Status.PENDING_CEO:
        raise ArchiveRequestError(NOT_PENDING_CEO_MESSAGE)
    reason = (reason or "").strip()
    if not reason:
        raise ArchiveRequestError(REASON_REQUIRED_MESSAGE, errors={"reason": [REASON_REQUIRED_MESSAGE]})

    with transaction.atomic():
        locked = EmployeeDeletionRequest.objects.select_for_update().get(pk=instance.pk)
        if locked.status != Status.PENDING_CEO:
            raise ArchiveRequestError(NOT_PENDING_CEO_MESSAGE)

        start = begin_recorded_transition(locked, actor=actor)
        locked.status = Status.REJECTED
        locked.rejected_by = actor
        locked.rejected_at = timezone.now()
        locked.rejection_reason = reason
        locked.save(update_fields=["status", "rejected_by", "rejected_at", "rejection_reason", "updated_at"])
        record_workflow_transition(locked, start, action=Action.REJECT, actor=actor, note=reason, approver_role="ceo")
    return locked
