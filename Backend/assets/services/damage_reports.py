"""State transitions for asset damage reports.

The CEO approval is the final decision on the form and the moment its PDF is
frozen (``assets.document_integrity``). The checks and messages are the ones
``CEOAssetDamageReportViewSet.approve`` always used. The employee may also cancel
their own report while it is pending; that cancel is recorded in the workflow
history (``asset_damage_report``).
"""

from __future__ import annotations

from core.models import WorkflowAction
from core.services.workflow_engine import begin_recorded_transition, record_workflow_transition
from django.db import transaction
from django.utils import timezone

from ..document_integrity import on_asset_damage_stage_approved
from ..models import AssetDamageReport

Status = AssetDamageReport.RequestStatus

NOT_PENDING_CEO_MESSAGE = "Request is not pending CEO approval."
NOT_REQUESTER_MESSAGE = "Only the employee who reported the damage can cancel this report."
NOT_CANCELLABLE_MESSAGE = "Only pending damage reports can be cancelled."

# The employee withdraws their own report before HR/CEO decide it.
REQUESTER_CANCELLABLE_STATUSES = frozenset({Status.PENDING_HR, Status.PENDING_CEO})


class AssetDamageTransitionError(Exception):
    """A refused damage-report transition (HTTP 422 unless ``status`` says otherwise)."""

    def __init__(self, message: str = "", *, status: int = 422):
        super().__init__(message)
        self.message = message
        self.status = status


def approve_damage_report_by_ceo(report: AssetDamageReport, *, actor, comment: str = "") -> AssetDamageReport:
    """Approve a damage report pending CEO; freezes its PDF after the commit.

    The freeze runs on commit and never raises, so it can never undo the approval.
    """

    with transaction.atomic():
        locked = AssetDamageReport.objects.select_for_update().get(pk=report.pk)
        if locked.status != AssetDamageReport.RequestStatus.PENDING_CEO:
            raise AssetDamageTransitionError(NOT_PENDING_CEO_MESSAGE)
        locked.status = AssetDamageReport.RequestStatus.APPROVED
        locked.ceo_decision_by = actor
        locked.ceo_decision_at = timezone.now()
        locked.ceo_decision_note = comment or ""
        locked.save(update_fields=["status", "ceo_decision_by", "ceo_decision_at", "ceo_decision_note"])
        on_asset_damage_stage_approved(locked, role="ceo", actor=actor, at=locked.ceo_decision_at)
    return locked


def is_requester_cancellable_by(report: AssetDamageReport, user) -> bool:
    return bool(
        user
        and user.is_authenticated
        and getattr(report.employee, "user_id", None) == user.pk
        and report.status in REQUESTER_CANCELLABLE_STATUSES
    )


def cancel_damage_report(report: AssetDamageReport, *, actor) -> tuple[AssetDamageReport, str]:
    """The employee withdraws their own pending damage report. Returns ``(report, from_status)``."""

    if getattr(report.employee, "user_id", None) != actor.pk:
        raise AssetDamageTransitionError(NOT_REQUESTER_MESSAGE, status=403)

    with transaction.atomic():
        locked = AssetDamageReport.objects.select_for_update().get(pk=report.pk)
        if locked.status not in REQUESTER_CANCELLABLE_STATUSES:
            raise AssetDamageTransitionError(NOT_CANCELLABLE_MESSAGE)

        from_status = locked.status
        start = begin_recorded_transition(locked, actor=actor)
        locked.status = Status.CANCELLED
        locked.cancelled_at = timezone.now()
        locked.save(update_fields=["status", "cancelled_at"])
        record_workflow_transition(locked, start, action=WorkflowAction.Action.CANCEL, actor=actor, approver_role="")
    return locked, from_status


NOT_HR_CANCELLABLE_MESSAGE = "Only an approved damage report can be cancelled by HR."
SELF_CANCELLATION_MESSAGE = "Another HR member must cancel your own damage report."


def apply_hr_cancellation(report: AssetDamageReport, *, actor, note: str = "") -> tuple[AssetDamageReport, str]:
    """HR cancels an approved damage report. Returns ``(report, from_status)``."""

    if getattr(report.employee, "user_id", None) == actor.pk:
        raise AssetDamageTransitionError(SELF_CANCELLATION_MESSAGE, status=403)

    with transaction.atomic():
        locked = AssetDamageReport.objects.select_for_update().get(pk=report.pk)
        if locked.status != Status.APPROVED:
            raise AssetDamageTransitionError(NOT_HR_CANCELLABLE_MESSAGE)

        from_status = locked.status
        start = begin_recorded_transition(locked, actor=actor)
        locked.status = Status.CANCELLED
        locked.cancelled_at = timezone.now()
        locked.save(update_fields=["status", "cancelled_at"])
        record_workflow_transition(
            locked, start, action=WorkflowAction.Action.CANCEL, actor=actor, note=note, approver_role="hr"
        )
    return locked, from_status
