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

import logging
from dataclasses import dataclass

from core.models import WorkflowAction
from core.responses import error
from core.services.archived_employee import archived_cancel_note, is_profile_archived
from core.services.stage_coverage import MANAGER_OWN_SOURCES, is_in_group, manager_covers_hr, record_covered_stage
from core.services.workflow_engine import begin_recorded_transition, record_workflow_transition
from django.db import transaction
from django.utils import timezone
from employees.services.manager_relationships import get_valid_manager_user, manager_approval_actor_source

from .document_integrity import on_loan_stage_approved
from .models import LoanRequest
from .permissions import get_active_workflow_config, is_cfo_requester

logger = logging.getLogger(__name__)

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

#: Everything not yet paid out: archiving cancels these, and HR may cancel them for an archived employee.
ARCHIVED_OPEN_STATUSES = CANCELLABLE_STATUSES | {Status.PENDING_DISBURSEMENT}

SELF_APPROVAL_MESSAGE = "Self approval is not allowed."
COMMENT_REQUIRED_MESSAGE = "comment is required."
NOT_PENDING_MANAGER_MESSAGE = "Request is not pending manager approval."
NOT_PENDING_HR_MESSAGE = "Request is not pending HR approval."
NOT_PENDING_CFO_MESSAGE = "Request is not pending CFO approval."
NOT_PENDING_CEO_MESSAGE = "Request is not pending CEO approval."
NOT_PENDING_DISBURSEMENT_MESSAGE = "Request is not pending disbursement."
NOT_CANCELLABLE_MESSAGE = "Only pending requests can be cancelled."
ARCHIVED_EMPLOYEE_MESSAGE = (
    "This employee is archived, so the loan request cannot be approved or advanced. Reject or cancel it instead."
)
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


def _ensure_employee_not_archived(locked: LoanRequest) -> None:
    """Refuse to move a request forward for an archived employee (rejecting or cancelling stays allowed)."""

    if is_profile_archived(locked.employee_profile_id):
        raise LoanTransitionError(ARCHIVED_EMPLOYEE_MESSAGE)


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
    on_loan_stage_approved(instance, role="employee", actor=instance.employee or actor, at=instance.created_at)


def _manager_cfo_coverage(locked: LoanRequest) -> tuple[object, str] | None:
    """Return the real manager and source when their recommendations safely cover CFO."""

    manager = locked.manager_decision_by
    source = manager_approval_actor_source(
        manager,
        locked.employee_profile,
        capability=LOAN_APPROVAL_CAPABILITY,
        allow_admin=True,
    )
    if (
        source not in MANAGER_OWN_SOURCES
        or is_in_group(manager, "SystemAdmin")
        or not is_cfo_requester(manager)
        or locked.manager_recommendation != Recommendation.APPROVE
        or locked.hr_recommendation != Recommendation.APPROVE
        # HR managers' own loans require the CEO route and must not be finalized here.
        or _is_hr_manager(locked.employee)
    ):
        return None
    return manager, source


def _apply_manager_covered_cfo(locked: LoanRequest) -> tuple[list[str], tuple[object, str] | None]:
    coverage = _manager_cfo_coverage(locked)
    if coverage is None:
        return [], None

    manager, _source = coverage
    update_fields = _approve_amount(locked)
    locked.cfo_decision_by = manager
    locked.cfo_decision_at = timezone.now()
    locked.cfo_decision_note = ""
    update_fields += ["cfo_decision_by", "cfo_decision_at", "cfo_decision_note"]
    return update_fields, coverage


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
        _ensure_employee_not_archived(locked)

        start = begin_recorded_transition(locked, actor=actor)
        locked.manager_decision_by = actor
        locked.manager_decision_at = timezone.now()
        locked.manager_decision_note = note
        locked.manager_recommendation = recommendation
        update_fields = [
            "status",
            "manager_decision_by",
            "manager_decision_at",
            "manager_decision_note",
            "manager_recommendation",
            "updated_at",
        ]
        # A manager who is also an HR manager has given the HR recommendation too, so HR
        # is not asked again and the request goes straight to the CFO.
        hr_covered = manager_covers_hr(actor, actor_source)
        locked.status = Status.PENDING_CFO if hr_covered else Status.PENDING_HR
        if hr_covered:
            locked.finance_decision_by = actor
            locked.finance_decision_at = locked.manager_decision_at
            locked.hr_recommendation = recommendation
            update_fields += ["finance_decision_by", "finance_decision_at", "hr_recommendation"]
        cfo_update_fields, cfo_coverage = _apply_manager_covered_cfo(locked) if hr_covered else ([], None)
        update_fields += [field for field in cfo_update_fields if field not in update_fields]
        locked.save(update_fields=update_fields)
        record_workflow_transition(
            locked,
            start,
            action=Action.ADVANCE,
            actor=actor,
            note=note,
            approver_role="manager",
            metadata={"recommendation": recommendation, "actor_source": actor_source},
        )
        if hr_covered:
            record_covered_stage(
                locked,
                start,
                "hr",
                actor=actor,
                source=actor_source,
                action=Action.ADVANCE,
                metadata={"recommendation": recommendation},
            )
        if cfo_coverage:
            manager, source = cfo_coverage
            record_covered_stage(locked, start, "cfo", actor=manager, by="manager", source=source)
        on_loan_stage_approved(locked, role="line_manager", actor=actor, at=locked.manager_decision_at)
        if hr_covered:
            on_loan_stage_approved(locked, role="hr", actor=actor, at=locked.finance_decision_at)
        if cfo_coverage:
            on_loan_stage_approved(locked, role="cfo", actor=manager, at=locked.cfo_decision_at)
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
        _ensure_employee_not_archived(locked)

        start = begin_recorded_transition(locked, actor=actor)
        locked.status = Status.PENDING_CFO
        locked.finance_decision_by = actor
        locked.finance_decision_at = timezone.now()
        locked.finance_decision_note = note
        locked.hr_recommendation = recommendation
        update_fields = [
            "status",
            "finance_decision_by",
            "finance_decision_at",
            "finance_decision_note",
            "hr_recommendation",
            "updated_at",
        ]
        cfo_update_fields, cfo_coverage = _apply_manager_covered_cfo(locked)
        update_fields += [field for field in cfo_update_fields if field not in update_fields]
        locked.save(update_fields=update_fields)
        record_workflow_transition(
            locked,
            start,
            action=Action.ADVANCE,
            actor=actor,
            note=note,
            approver_role="hr",
            metadata={"recommendation": recommendation},
        )
        if cfo_coverage:
            manager, source = cfo_coverage
            record_covered_stage(locked, start, "cfo", actor=manager, by="manager", source=source)
        on_loan_stage_approved(locked, role="hr", actor=actor, at=locked.finance_decision_at)
        if cfo_coverage:
            on_loan_stage_approved(locked, role="cfo", actor=manager, at=locked.cfo_decision_at)
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
        _ensure_employee_not_archived(locked)

        start = begin_recorded_transition(locked, actor=actor)
        update_fields = _approve_amount(locked)
        locked.cfo_decision_by = actor
        locked.cfo_decision_at = timezone.now()
        locked.cfo_decision_note = note
        locked.save(
            update_fields=[*update_fields, "cfo_decision_by", "cfo_decision_at", "cfo_decision_note", "updated_at"]
        )
        record_workflow_transition(locked, start, action=Action.ADVANCE, actor=actor, note=note, approver_role="cfo")
        on_loan_stage_approved(locked, role="cfo", actor=actor, at=locked.cfo_decision_at)
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
        if target_status != Status.REJECTED:
            _ensure_employee_not_archived(locked)

        start = begin_recorded_transition(locked, actor=actor)
        locked.status = target_status
        locked.cfo_decision_by = actor
        locked.cfo_decision_at = timezone.now()
        locked.cfo_decision_note = comment
        locked.save(update_fields=["status", "cfo_decision_by", "cfo_decision_at", "cfo_decision_note", "updated_at"])
        record_workflow_transition(locked, start, action=action, actor=actor, note=comment, approver_role="cfo")
        if target_status == Status.PENDING_CEO:
            # A referral is the CFO's recorded decision on the form; a rejection is never frozen.
            on_loan_stage_approved(locked, role="cfo", actor=actor, at=locked.cfo_decision_at)
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
        _ensure_employee_not_archived(locked)

        start = begin_recorded_transition(locked, actor=actor)
        update_fields = _approve_amount(locked)
        locked.ceo_decision_by = actor
        locked.ceo_decision_at = timezone.now()
        locked.ceo_decision_note = note
        locked.save(
            update_fields=[*update_fields, "ceo_decision_by", "ceo_decision_at", "ceo_decision_note", "updated_at"]
        )
        record_workflow_transition(locked, start, action=Action.APPROVE, actor=actor, note=note, approver_role="ceo")
        on_loan_stage_approved(locked, role="ceo", actor=actor, at=locked.ceo_decision_at)
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
        _ensure_employee_not_archived(locked)

        start = begin_recorded_transition(locked, actor=actor)
        locked.status = Status.APPROVED
        locked.disbursed_by = actor
        locked.disbursed_at = timezone.now()
        locked.disbursement_note = note
        locked.save(update_fields=["status", "disbursed_by", "disbursed_at", "disbursement_note", "updated_at"])
        record_workflow_transition(
            locked, start, action=Action.DISBURSE, actor=actor, note=note, approver_role="disbursement"
        )
        # The last column on the form: the loan is now ``approved`` and its PDF is frozen after commit.
        on_loan_stage_approved(locked, role="disbursement", actor=actor, at=locked.disbursed_at)
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


# ---------------------------------------------------------------------------
# Requester edit (before the HR stage)
# ---------------------------------------------------------------------------

# The requester edits only while the loan waits on their manager; ``pending_hr`` is
# already the HR stage, so from there they cancel and resubmit.
REQUESTER_EDITABLE_STATUSES = frozenset({Status.SUBMITTED, Status.PENDING_MANAGER})
NOT_REQUESTER_EDITOR_MESSAGE = "Only the requester can edit this loan request."
NOT_REQUESTER_EDITABLE_MESSAGE = (
    "This loan request can no longer be edited because it has reached HR review or a decision was recorded. "
    "Cancel it and submit a new request instead."
)
#: API field name -> stored field, in a stable order for history and audit.
EDITABLE_FIELDS = (
    ("amount", "requested_amount"),
    ("loan_type", "loan_type"),
    ("installment_months", "installment_months"),
    ("reason", "reason"),
)
_DECISION_FIELDS = ("manager_decision_at", "finance_decision_at", "cfo_decision_at", "ceo_decision_at", "disbursed_at")


class LoanEditInvalid(Exception):
    """The edited loan failed the create rules; ``errors`` is the serializer error dict."""

    def __init__(self, errors):
        super().__init__("Validation error")
        self.errors = errors


@dataclass(frozen=True)
class LoanEdit:
    instance: LoanRequest
    from_status: str
    changed_fields: tuple[str, ...]


def requester_edit_refusal(instance: LoanRequest) -> str | None:
    """Why the requester can no longer edit ``instance``, or ``None`` while they still can."""

    if (
        not instance.is_active
        or instance.status not in REQUESTER_EDITABLE_STATUSES
        or any(getattr(instance, name) for name in _DECISION_FIELDS)
    ):
        return NOT_REQUESTER_EDITABLE_MESSAGE
    return None


def apply_requester_edit(instance: LoanRequest, *, actor, validate) -> LoanEdit:
    """The requester changes their own loan while it waits on the manager.

    ``validate(locked)`` re-runs the create rules on the merged request and returns
    the validated values keyed by API field name, or raises ``LoanEditInvalid``.
    The approval route never depends on the amount, so status and route are kept;
    nothing is derived from the amount before approval (``approved_amount`` and the
    deduction period are set by the approving stage) and the PDF renders live.
    """

    if instance.employee_id != actor.pk:
        raise LoanTransitionError(NOT_REQUESTER_EDITOR_MESSAGE, status=403)

    with transaction.atomic():
        locked = _lock(instance)
        refusal = requester_edit_refusal(locked)
        if refusal:
            raise LoanTransitionError(refusal)

        values = validate(locked)
        changes = {
            stored: values[api]
            for api, stored in EDITABLE_FIELDS
            if api in values and getattr(locked, stored) != values[api]
        }
        if not changes:
            return LoanEdit(locked, locked.status, ())

        from_status = locked.status
        start = begin_recorded_transition(locked, actor=actor)
        refusal = requester_edit_refusal(locked)
        if refusal:
            raise LoanTransitionError(refusal)
        for name, value in changes.items():
            setattr(locked, name, value)
        locked.save(update_fields=[*changes, "updated_at"])
        summary = [api for api, stored in EDITABLE_FIELDS if stored in changes]
        # Field names only: the free-text reason never enters the workflow history.
        record_workflow_transition(
            locked,
            start,
            action=Action.EDIT,
            actor=actor,
            note="Edited: " + ", ".join(summary),
            approver_role="",
            metadata={"changed_fields": summary},
        )
    return LoanEdit(locked, from_status, tuple(summary))


def notify_after_requester_edit(instance: LoanRequest) -> None:
    """Tell the manager the loan waiting on them was changed (after commit, never raises)."""

    def send():
        from in_app_notifications.dispatcher import dispatch_notification_channels
        from in_app_notifications.i18n import notification_text, profile_name
        from in_app_notifications.models import Notification

        manager = get_valid_manager_user(instance.employee_profile, cross_company_capability=LOAN_APPROVAL_CAPABILITY)
        if manager is None or manager.pk == instance.employee_id:
            return None
        fallback = instance.employee.full_name or instance.employee.email
        stamp = int(instance.updated_at.timestamp()) if instance.updated_at else 0
        return dispatch_notification_channels(
            recipient=manager,
            event_key="loan.updated",
            **notification_text(
                "loan.updated",
                employee_name=profile_name(instance.employee_profile, fallback),
                request_id=instance.pk,
            ),
            category=Notification.Category.LOAN,
            action_url=f"/manager/loan-requests/{instance.pk}",
            related_object=instance,
            deduplication_key=f"loan.updated:{instance.pk}:{manager.pk}:{stamp}",
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
                "loan_edit_notification_failed",
                extra={"entity_id": instance.pk, "notification_type": "loan_updated"},
            )

    transaction.on_commit(dispatch)


NOT_HR_CANCELLABLE_MESSAGE = "Only a loan waiting for disbursement can be cancelled by HR."
SELF_CANCELLATION_MESSAGE = "Another HR member must cancel your own loan request."


def apply_hr_cancellation(instance: LoanRequest, *, actor, note: str = "") -> LoanRequest:
    """HR cancels an approved loan before any money is paid out (``pending_disbursement`` only).

    Nothing is reserved in payroll before disbursement, so the loan simply leaves the
    disbursement queue.
    """

    if instance.employee_id == actor.pk:
        raise LoanTransitionError(SELF_CANCELLATION_MESSAGE, status=403)

    with transaction.atomic():
        locked = _lock(instance)
        # A stale request of an archived employee can be closed by HR from any open stage.
        cancellable = (
            ARCHIVED_OPEN_STATUSES if is_profile_archived(locked.employee_profile_id) else {Status.PENDING_DISBURSEMENT}
        )
        if locked.status not in cancellable:
            raise LoanTransitionError(NOT_HR_CANCELLABLE_MESSAGE)

        start = begin_recorded_transition(locked, actor=actor)
        locked.status = Status.CANCELLED
        locked.save(update_fields=["status", "updated_at"])
        record_workflow_transition(locked, start, action=Action.CANCEL, actor=actor, note=note, approver_role="hr")
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


def restore_payroll_deduction(loan: LoanRequest, *, run, actor, reason) -> LoanRequest:
    """Release a draft reservation through the same recorded workflow trail."""
    if run.status != "DRAFT" or loan.deduction_payroll_run_id != run.pk:
        raise ValueError("Only the owning DRAFT can restore a payroll deduction.")
    start = begin_recorded_transition(loan)
    loan.status = (loan.payroll_pre_deduction_snapshot or {}).get("status", Status.APPROVED)
    loan.deduction_payroll_run = None
    loan.deducted_at = loan.deducted_amount = None
    loan.payroll_pre_deduction_snapshot = None
    loan.save(
        update_fields=[
            "status",
            "deduction_payroll_run",
            "deducted_at",
            "deducted_amount",
            "payroll_pre_deduction_snapshot",
            "updated_at",
        ]
    )
    record_workflow_transition(
        loan,
        start,
        action=Action.OVERRIDE,
        actor=actor,
        note=reason,
        approver_role="",
        metadata={"payroll_run_id": run.pk, "payroll_deduction_restored": True},
    )
    return loan


def cancel_open_requests_for_archived_employee(profile, *, actor, reason: str = "") -> list[int]:
    """Cancel every loan request of a freshly archived employee that has not been paid out.

    Approved (disbursed) loans are left alone: the money is out and payroll still owns
    the deduction. Nobody is notified, the requester's account is disabled by the archive.
    Returns the ids that were cancelled.
    """

    note = archived_cancel_note("loan request", reason)
    cancelled: list[int] = []
    for loan in LoanRequest.objects.filter(employee_profile_id=profile.pk, status__in=ARCHIVED_OPEN_STATUSES):
        with transaction.atomic():
            locked = _lock(loan)
            if locked.status not in ARCHIVED_OPEN_STATUSES:
                continue
            start = begin_recorded_transition(locked, actor=actor)
            locked.status = Status.CANCELLED
            locked.save(update_fields=["status", "updated_at"])
            record_workflow_transition(locked, start, action=Action.CANCEL, actor=actor, note=note, approver_role="hr")
        cancelled.append(locked.pk)
    return cancelled
