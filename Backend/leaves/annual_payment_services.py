"""Business rules and state transitions for annual leave payment (settlement) requests.

Route: employee or HR submits -> HR review (pay or carry forward) -> CEO approves
or rejects. An HR-submitted termination settlement can start at the CEO. Workflow
history is recorded as each action happens.
"""

from __future__ import annotations

import logging

from django.db import transaction
from django.utils import timezone

from core.models import WorkflowAction
from core.services import get_ceo_approver_users, get_hr_approver_users, notify_users_for_pending_status
from core.services.workflow_engine import begin_recorded_transition, record_workflow_transition
from in_app_notifications.dispatcher import dispatch_notification_channels
from in_app_notifications.models import Notification

from .models import AnnualLeavePaymentRequest
from .services import COMMENT_REQUIRED_MESSAGE, LeaveTransitionError, leave_employee_name

logger = logging.getLogger(__name__)

Status = AnnualLeavePaymentRequest.Status
Resolution = AnnualLeavePaymentRequest.Resolution
Action = WorkflowAction.Action

HR_ACTION_PATH = "/hr/annual-leave-payments/{id}"
CEO_ACTION_PATH = "/ceo/annual-leave-payments/{id}"
EMPLOYEE_ACTION_PATH = "/employee/leave/requests"

NOT_PENDING_HR_MESSAGE = "Payment request is not pending HR review."
NOT_PENDING_CEO_MESSAGE = "Payment request is not pending CEO approval."


def _lock(instance: AnnualLeavePaymentRequest) -> AnnualLeavePaymentRequest:
    return AnnualLeavePaymentRequest.objects.select_for_update().get(pk=instance.pk)


# ---------------------------------------------------------------------------
# Transitions
# ---------------------------------------------------------------------------


def record_annual_payment_submission(instance: AnnualLeavePaymentRequest, *, actor) -> None:
    """Start the recorded workflow history of a newly created payment request."""

    start = begin_recorded_transition(instance, actor=actor, new_instance=True)
    record_workflow_transition(
        instance, start, action=Action.SUBMIT, actor=actor, note=instance.employee_note or "", approver_role=""
    )


def ensure_pending_hr_review(instance: AnnualLeavePaymentRequest) -> None:
    """Refuse early, so the state error wins over input validation errors."""

    if instance.status != Status.PENDING_HR:
        raise LeaveTransitionError(NOT_PENDING_HR_MESSAGE)


def apply_annual_payment_hr_review(
    instance: AnnualLeavePaymentRequest, *, actor, decision: str, comment: str = ""
) -> AnnualLeavePaymentRequest:
    """HR chooses to pay the unused balance or carry it forward, then sends it to the CEO."""

    ensure_pending_hr_review(instance)
    with transaction.atomic():
        locked = _lock(instance)
        ensure_pending_hr_review(locked)

        start = begin_recorded_transition(locked, actor=actor)
        carry_forward = decision == "carry_forward"
        locked.resolution = Resolution.CARRY_FORWARD if carry_forward else Resolution.PAY
        locked.carry_forward_days = locked.eligible_unused_days if carry_forward else 0
        locked.payment_amount = 0 if carry_forward else locked.payment_amount
        locked.status = Status.PENDING_CEO
        locked.hr_reviewed_by = actor
        locked.hr_reviewed_at = timezone.now()
        locked.hr_review_note = comment
        locked.save()
        record_workflow_transition(
            locked,
            start,
            action=Action.ADVANCE,
            actor=actor,
            note=comment,
            approver_role="hr",
            metadata={"resolution": locked.resolution},
        )
    return locked


def apply_annual_payment_ceo_approval(
    instance: AnnualLeavePaymentRequest, *, actor, note: str = ""
) -> AnnualLeavePaymentRequest:
    """Settle the request: pay it, or carry the balance forward when HR chose that."""

    with transaction.atomic():
        locked = _lock(instance)
        if locked.status != Status.PENDING_CEO:
            raise LeaveTransitionError(NOT_PENDING_CEO_MESSAGE)

        start = begin_recorded_transition(locked, actor=actor)
        now = timezone.now()
        locked.status = Status.CARRIED_FORWARD if locked.resolution == Resolution.CARRY_FORWARD else Status.APPROVED
        locked.ceo_decided_by = actor
        locked.ceo_decided_at = now
        locked.ceo_decision_note = note
        locked.settled_at = now
        locked.save()
        record_workflow_transition(
            locked,
            start,
            action=Action.APPROVE,
            actor=actor,
            note=note,
            approver_role="ceo",
            metadata={"resolution": locked.resolution},
        )
    return locked


def apply_annual_payment_ceo_rejection(
    instance: AnnualLeavePaymentRequest, *, actor, comment: str
) -> AnnualLeavePaymentRequest:
    comment = (comment or "").strip()
    if not comment:
        raise LeaveTransitionError(COMMENT_REQUIRED_MESSAGE)

    with transaction.atomic():
        locked = _lock(instance)
        if locked.status != Status.PENDING_CEO:
            raise LeaveTransitionError(NOT_PENDING_CEO_MESSAGE)

        start = begin_recorded_transition(locked, actor=actor)
        locked.status = Status.REJECTED
        locked.ceo_decided_by = actor
        locked.ceo_decided_at = timezone.now()
        locked.ceo_decision_note = comment
        locked.save()
        record_workflow_transition(locked, start, action=Action.REJECT, actor=actor, note=comment, approver_role="ceo")
    return locked


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------


def _log_notification_failure(event_name: str, instance, notification_type: str, actor_id=None) -> None:
    extra = {"entity_id": instance.id, "notification_type": notification_type}
    if actor_id is not None:
        extra["actor_id"] = actor_id
    logger.exception(event_name, extra=extra)


def _notify_ceo(instance: AnnualLeavePaymentRequest) -> None:
    notify_users_for_pending_status(
        users=get_ceo_approver_users(),
        request_type="Annual Leave Settlement",
        request_id=instance.id,
        requester_name=leave_employee_name(instance),
        status_label=instance.status,
        details=[
            f"Resolution: {instance.resolution}",
            f"Eligible Days: {instance.eligible_unused_days}",
            f"Payment Amount: {instance.payment_amount}",
        ],
        action_path=CEO_ACTION_PATH.format(id=instance.id),
    )


def notify_after_annual_payment_submission(instance: AnnualLeavePaymentRequest, *, actor_id=None) -> None:
    try:
        if instance.status == Status.PENDING_CEO:
            _notify_ceo(instance)
        else:
            notify_users_for_pending_status(
                users=get_hr_approver_users(),
                request_type="Annual Leave Payment Request",
                request_id=instance.id,
                requester_name=leave_employee_name(instance),
                status_label=instance.status,
                details=[
                    f"Eligible Days: {instance.eligible_unused_days}",
                    f"Payment Amount: {instance.payment_amount}",
                ],
                action_path=HR_ACTION_PATH.format(id=instance.id),
            )
    except Exception:
        _log_notification_failure(
            "annual_leave_payment_submission_notification_failed", instance, "annual_leave_payment_submitted", actor_id
        )


def notify_after_annual_payment_hr_review(instance: AnnualLeavePaymentRequest, *, actor_id=None) -> None:
    try:
        _notify_ceo(instance)
    except Exception:
        _log_notification_failure(
            "annual_leave_payment_review_notification_failed", instance, "pending_status", actor_id
        )


def notify_employee_of_annual_payment_decision(instance: AnnualLeavePaymentRequest, *, approved: bool) -> None:
    if not instance.employee:
        return
    from in_app_notifications.i18n import notification_text

    event_key = "annual_leave.payment_approved" if approved else "annual_leave.payment_rejected"
    try:
        dispatch_notification_channels(
            recipient=instance.employee,
            event_key=event_key,
            **notification_text(event_key, request_id=instance.id),
            category=Notification.Category.LEAVE,
            action_url=EMPLOYEE_ACTION_PATH,
            related_object=instance,
            metadata={
                "payment_amount": str(instance.payment_amount),
                "eligible_unused_days": str(instance.eligible_unused_days),
                "resolution": instance.resolution,
            },
            deduplication_key=f"{event_key}:{instance.id}",
            company=instance.company,
        )
    except Exception:
        _log_notification_failure("annual_leave_payment_status_notification_failed", instance, event_key)
