"""Business rules and state transitions for leave requests.

Views authenticate, scope, validate input, audit, and serialize. This module owns
the transition itself: it checks who may act, locks the row, re-checks the state
under that lock, writes the domain ``status``, and records the workflow action in
the same transaction. Notifications are sent afterwards and can never undo a
decision.

Approval route: alternative employee (when chosen) -> direct manager (when the
employee has a valid one) -> HR -> CEO -> HR completion (non-Saudi travellers
only). An HR manager's own leave skips the HR stage. The CEO stage is required
for every request. Only HR can cancel, including approved leave.

Workflow history is recorded as each action happens (see
``core.services.workflow_engine.begin_recorded_transition``), not rebuilt from
the decision timestamps.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from django.db import transaction
from django.utils import timezone
from rest_framework import status as http_status
from rest_framework.response import Response

from audit.utils import audit
from core.models import WorkflowAction
from core.responses import error
from core.services import (
    get_ceo_approver_users,
    get_hr_approver_users,
    notify_users_for_pending_status,
    sync_leave_obligations,
    waive_open_blocking_obligations,
)
from core.services.request_obligations import close_leave_obligations, is_business_trip_leave
from core.services.workflow_engine import begin_recorded_transition, record_workflow_transition
from employees.document_extraction import extract_visa_fields
from employees.models import EmployeeDocument
from employees.services.manager_relationships import get_valid_manager_user, manager_approval_actor_source
from in_app_notifications.dispatcher import dispatch_notification_channels
from in_app_notifications.models import Notification

from .models import LeaveRequest
from .notifications import notify_delegation_assigned, notify_leave_approved, notify_leave_rejected
from .utils import resolve_employee_profile

logger = logging.getLogger(__name__)

Status = LeaveRequest.RequestStatus
Action = WorkflowAction.Action

REQUEST_TYPE = "Leave Request"
LEAVE_APPROVAL_CAPABILITY = "leaves.approve"
CEO_ACTION_PATH = "/ceo/leave/requests"
HR_ACTION_PATH = "/hr/leave/requests/{id}"
MANAGER_ACTION_PATH = "/manager/leave/requests/{id}"
EMPLOYEE_REQUESTS_PATH = "/employee/leave/requests"

# An alternative employee can be added or replaced until the CEO has decided.
DELEGATE_ASSIGNABLE_STATUSES = frozenset(
    {Status.SUBMITTED, Status.PENDING_DELEGATE, Status.PENDING_MANAGER, Status.PENDING_HR, Status.PENDING_CEO}
)
MANAGER_DECIDABLE_STATUSES = frozenset({Status.SUBMITTED, Status.PENDING_MANAGER})
HR_APPROVABLE_STATUSES = frozenset({Status.SUBMITTED, Status.PENDING_HR})
# HR may also reject a request that is still waiting on the manager.
HR_REJECTABLE_STATUSES = frozenset({Status.SUBMITTED, Status.PENDING_HR, Status.PENDING_MANAGER})
# HR may only send a request to the CEO once the manager stage is over.
CEO_REFERRABLE_STATUSES = frozenset({Status.SUBMITTED, Status.PENDING_HR})
# Employees cannot cancel; HR cancels any request that is in progress or already approved.
HR_CANCELLABLE_STATUSES = frozenset(
    {
        Status.SUBMITTED,
        Status.PENDING_DELEGATE,
        Status.PENDING_MANAGER,
        Status.PENDING_HR,
        Status.PENDING_CEO,
        Status.PENDING_HR_COMPLETION,
        Status.APPROVED,
    }
)

COMMENT_REQUIRED_MESSAGE = "comment is required."
DELEGATE_NOT_ASSIGNABLE_MESSAGE = "Delegate can only be updated while the request is pending."
SELF_DELEGATE_MESSAGE = "You cannot delegate the request to the same employee."
DELEGATE_UNAVAILABLE_MESSAGE = "Delegate must be an active employee with an active user account."
DELEGATE_NOT_ASSIGNED_MESSAGE = "You are not the alternative employee for this leave request."
NOT_DELEGATE_PENDING_MESSAGE = "Request is not waiting for delegated user approval."
MANAGER_CANNOT_APPROVE_MESSAGE = "You cannot approve this leave request."
MANAGER_CANNOT_REJECT_MESSAGE = "You cannot reject this leave request."
NOT_MANAGER_APPROVABLE_MESSAGE = "Request is not in a state to be approved by manager."
NOT_MANAGER_REJECTABLE_MESSAGE = "Request is not in a state to be rejected by manager."
HR_ORIGIN_MESSAGE = "HR manager requests must be approved by CEO."
NOT_HR_APPROVABLE_MESSAGE = "Request is not in a state to be approved by HR."
NOT_HR_REJECTABLE_MESSAGE = "Request cannot be rejected."
NOT_CEO_REFERRABLE_MESSAGE = "Request cannot be sent to CEO in current state."
ALREADY_WITH_CEO_MESSAGE = "Request is already waiting for CEO approval."
NOT_CEO_APPROVABLE_MESSAGE = "Request is not in a state to be approved by CEO."
NOT_CEO_REJECTABLE_MESSAGE = "Request is not in a state to be rejected by CEO."
SELF_DECISION_MESSAGE = "Self approval is not allowed."
OBLIGATIONS_BLOCKING_MESSAGE = "Business Trip obligations must be resolved or waived by CEO before approval."
NOT_AWAITING_HR_COMPLETION_MESSAGE = "Request is not waiting for HR completion."
PROFILE_NOT_FOUND_MESSAGE = "Employee profile not found."
VISA_REQUIRED_MESSAGE = "visa_document is required for non-Saudi employees who will travel."
CONTACT_HR_TO_CANCEL_MESSAGE = "Contact HR to cancel this leave request."
SELF_CANCELLATION_MESSAGE = "Another HR member must cancel your own leave request."
NOT_CANCELLABLE_MESSAGE = "Rejected or cancelled requests cannot be cancelled."

_ERROR_TITLES = {422: "Validation error", 403: "Forbidden"}


class LeaveTransitionError(Exception):
    """A refused transition, carrying its HTTP status and optional response data."""

    def __init__(self, message: str, *, status: int = 422, data: dict | None = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.data = data

    def to_response(self):
        if self.data is not None:
            return Response(
                {
                    "status": "error",
                    "message": self.message,
                    "errors": [{"message": self.message}],
                    "data": self.data,
                },
                status=self.status,
            )
        return error(_ERROR_TITLES.get(self.status, self.message), errors=[self.message], status=self.status)


@dataclass(frozen=True)
class Transition:
    instance: LeaveRequest
    from_status: str
    actor_source: str = ""


@dataclass(frozen=True)
class HRCompletion:
    instance: LeaveRequest
    from_status: str
    profile: object
    visa_required: bool
    document: EmployeeDocument | None = None
    extraction_warnings: list = field(default_factory=list)


# ---------------------------------------------------------------------------
# Lookups
# ---------------------------------------------------------------------------


def leave_profile(instance: LeaveRequest):
    return getattr(instance, "employee_profile", None) or resolve_employee_profile(getattr(instance, "employee", None))


def leave_employee_name(instance: LeaveRequest):
    employee = getattr(instance, "employee", None)
    profile = leave_profile(instance)
    return (
        getattr(employee, "full_name", "")
        or getattr(employee, "email", "")
        or getattr(profile, "full_name", "")
        or getattr(profile, "full_name_en", "")
        or getattr(profile, "employee_id", "")
        or "-"
    )


def leave_employee_email(instance: LeaveRequest):
    employee = getattr(instance, "employee", None)
    profile = leave_profile(instance)
    profile_user = getattr(profile, "user", None) if profile else None
    return getattr(employee, "email", "") or getattr(profile_user, "email", "") or "-"


def leave_manager_user(instance: LeaveRequest):
    return get_valid_manager_user(leave_profile(instance), cross_company_capability=LEAVE_APPROVAL_CAPABILITY)


# ---------------------------------------------------------------------------
# Routing
# ---------------------------------------------------------------------------


def is_hr_manager(user) -> bool:
    return bool(user and user.groups.filter(name="HRManager").exists())


def is_hr_manager_origin_request(instance: LeaveRequest) -> bool:
    """An HR manager cannot clear their own leave at the HR stage; the CEO decides it."""

    return is_hr_manager(getattr(instance, "employee", None))


def is_self_ceo_decision(instance: LeaveRequest, actor) -> bool:
    """An HR manager who also holds CEO approval rights cannot decide their own leave."""

    return is_hr_manager_origin_request(instance) and instance.employee_id == actor.pk


def manager_actor_source(instance: LeaveRequest, actor) -> str | None:
    """How ``actor`` may decide the manager stage (direct, delegate, cross-company, admin), if at all."""

    return manager_approval_actor_source(
        actor,
        leave_profile(instance),
        capability=LEAVE_APPROVAL_CAPABILITY,
        allow_admin=True,
    )


def status_after_manager_stage(employee) -> str:
    """HR cannot approve an HR manager's own leave, so it goes to the CEO; anyone else's goes to HR."""

    if is_hr_manager(employee):
        return Status.PENDING_CEO
    return Status.PENDING_HR


def first_approval_status(employee, profile) -> str:
    """Where a request goes once no alternative employee is waiting on it.

    Everyone's valid manager approves first, HR managers included. Without one,
    the request goes straight to the stage after the manager.
    """

    if get_valid_manager_user(profile, cross_company_capability=LEAVE_APPROVAL_CAPABILITY):
        return Status.PENDING_MANAGER
    return status_after_manager_stage(employee)


def submission_status(employee, profile, *, has_alternative_employee: bool) -> str:
    if has_alternative_employee:
        return Status.PENDING_DELEGATE
    return first_approval_status(employee, profile)


def status_after_delegate_approval(instance: LeaveRequest) -> str:
    """Return to the stage the alternative employee interrupted, or start the normal route."""

    return instance.delegate_return_status or first_approval_status(instance.employee, leave_profile(instance))


def status_after_manager_approval(instance: LeaveRequest) -> str:
    return status_after_manager_stage(instance.employee)


def status_after_hr_approval(instance: LeaveRequest) -> str:
    """The CEO stage is required for every leave request."""

    return Status.PENDING_CEO


def status_after_ceo_approval(instance: LeaveRequest) -> str:
    """Only non-Saudi travellers need HR to record a visa; every other CEO approval is final."""

    if instance.requires_hr_completion():
        return Status.PENDING_HR_COMPLETION
    return Status.APPROVED


# ---------------------------------------------------------------------------
# Transitions
# ---------------------------------------------------------------------------


def _lock(instance: LeaveRequest) -> LeaveRequest:
    return LeaveRequest.objects.select_for_update().get(pk=instance.pk)


def record_leave_submission(instance: LeaveRequest, *, actor) -> None:
    """Start the recorded workflow history of a newly created leave request."""

    start = begin_recorded_transition(instance, actor=actor, new_instance=True)
    record_workflow_transition(
        instance, start, action=Action.SUBMIT, actor=actor, note=instance.reason or "", approver_role=""
    )


_DELEGATE_DECISION_FIELDS = [
    "status",
    "delegate_decision_by",
    "delegate_decision_at",
    "delegate_decision_note",
    "delegate_return_status",
    "updated_at",
]


def ensure_delegate_assignable(instance: LeaveRequest) -> None:
    """Refuse early, so the state error wins over input validation errors."""

    if instance.status not in DELEGATE_ASSIGNABLE_STATUSES:
        raise LeaveTransitionError(DELEGATE_NOT_ASSIGNABLE_MESSAGE)


def ensure_delegate_available(delegated_to) -> None:
    try:
        profile = delegated_to.employee_profile
    except Exception:
        profile = None
    if (
        not delegated_to
        or not delegated_to.is_active
        or profile is None
        or profile.is_archived
        or profile.employment_status != profile.EmploymentStatus.ACTIVE
        or not profile.company_id
        or not profile.company.is_active
    ):
        raise LeaveTransitionError(DELEGATE_UNAVAILABLE_MESSAGE)


def apply_delegate_assignment(instance: LeaveRequest, *, actor, delegated_to, note: str | None = None) -> Transition:
    """Add or replace the alternative employee; the request waits on them before continuing.

    A request already past submission remembers its stage and returns there once
    the alternative employee approves. ``note=None`` keeps the existing note.
    """

    ensure_delegate_assignable(instance)
    ensure_delegate_available(delegated_to)
    if delegated_to.pk == instance.employee_id:
        raise LeaveTransitionError(SELF_DELEGATE_MESSAGE)

    with transaction.atomic():
        locked = _lock(instance)
        ensure_delegate_assignable(locked)

        from_status = locked.status
        start = begin_recorded_transition(locked, actor=actor)
        locked.delegated_to = delegated_to
        if note is not None:
            locked.delegation_note = note
        if locked.status != Status.PENDING_DELEGATE:
            locked.delegate_return_status = locked.status
            locked.status = Status.PENDING_DELEGATE
        locked.delegate_decision_by = None
        locked.delegate_decision_at = None
        locked.delegate_decision_note = ""
        locked.save(update_fields=[*_DELEGATE_DECISION_FIELDS, "delegated_to", "delegation_note"])
        record_workflow_transition(
            locked,
            start,
            action=Action.REASSIGN,
            actor=actor,
            note=locked.delegation_note,
            approver_role="",
            metadata={"delegated_to": delegated_to.pk},
        )
        sync_leave_obligations(locked, actor=actor)
    return Transition(locked, from_status)


def _ensure_assigned_delegate(instance: LeaveRequest, actor) -> None:
    if not instance.delegated_to_id or instance.delegated_to_id != actor.pk:
        raise LeaveTransitionError(DELEGATE_NOT_ASSIGNED_MESSAGE, status=403)


def apply_delegate_approval(instance: LeaveRequest, *, actor, note: str = "") -> Transition:
    _ensure_assigned_delegate(instance, actor)

    with transaction.atomic():
        locked = _lock(instance)
        if locked.status != Status.PENDING_DELEGATE:
            raise LeaveTransitionError(NOT_DELEGATE_PENDING_MESSAGE)

        from_status = locked.status
        start = begin_recorded_transition(locked, actor=actor)
        locked.status = status_after_delegate_approval(locked)
        locked.delegate_return_status = ""
        locked.delegate_decision_by = actor
        locked.delegate_decision_at = timezone.now()
        locked.delegate_decision_note = note
        locked.save(update_fields=_DELEGATE_DECISION_FIELDS)
        record_workflow_transition(locked, start, action=Action.APPROVE, actor=actor, note=note)
    return Transition(locked, from_status)


def apply_delegate_rejection(instance: LeaveRequest, *, actor, comment: str) -> Transition:
    _ensure_assigned_delegate(instance, actor)
    comment = (comment or "").strip()
    if not comment:
        raise LeaveTransitionError(COMMENT_REQUIRED_MESSAGE)

    with transaction.atomic():
        locked = _lock(instance)
        if locked.status != Status.PENDING_DELEGATE:
            raise LeaveTransitionError(NOT_DELEGATE_PENDING_MESSAGE)

        from_status = locked.status
        start = begin_recorded_transition(locked, actor=actor)
        locked.status = Status.REJECTED
        locked.delegate_return_status = ""
        locked.delegate_decision_by = actor
        locked.delegate_decision_at = timezone.now()
        locked.delegate_decision_note = comment
        locked.save(update_fields=_DELEGATE_DECISION_FIELDS)
        record_workflow_transition(locked, start, action=Action.REJECT, actor=actor, note=comment)
    return Transition(locked, from_status)


_MANAGER_DECISION_FIELDS = [
    "status",
    "manager_decision_by",
    "manager_decision_at",
    "manager_decision_note",
    "updated_at",
]


def apply_manager_approval(instance: LeaveRequest, *, actor, note: str = "") -> Transition:
    actor_source = manager_actor_source(instance, actor)
    if not actor_source:
        raise LeaveTransitionError(MANAGER_CANNOT_APPROVE_MESSAGE, status=403)

    with transaction.atomic():
        locked = _lock(instance)
        if locked.status not in MANAGER_DECIDABLE_STATUSES:
            raise LeaveTransitionError(NOT_MANAGER_APPROVABLE_MESSAGE)

        from_status = locked.status
        start = begin_recorded_transition(locked, actor=actor)
        locked.status = status_after_manager_approval(locked)
        locked.manager_decision_by = actor
        locked.manager_decision_at = timezone.now()
        locked.manager_decision_note = note
        locked.save(update_fields=_MANAGER_DECISION_FIELDS)
        record_workflow_transition(
            locked,
            start,
            action=Action.APPROVE,
            actor=actor,
            note=note,
            approver_role="manager",
            metadata={"actor_source": actor_source},
        )
    return Transition(locked, from_status, actor_source)


def apply_manager_rejection(instance: LeaveRequest, *, actor, comment: str) -> Transition:
    actor_source = manager_actor_source(instance, actor)
    if not actor_source:
        raise LeaveTransitionError(MANAGER_CANNOT_REJECT_MESSAGE, status=403)
    comment = (comment or "").strip()
    if not comment:
        raise LeaveTransitionError(COMMENT_REQUIRED_MESSAGE)

    with transaction.atomic():
        locked = _lock(instance)
        if locked.status not in MANAGER_DECIDABLE_STATUSES:
            raise LeaveTransitionError(NOT_MANAGER_REJECTABLE_MESSAGE)

        from_status = locked.status
        start = begin_recorded_transition(locked, actor=actor)
        locked.status = Status.REJECTED
        locked.manager_decision_by = actor
        locked.manager_decision_at = timezone.now()
        locked.manager_decision_note = comment
        locked.save(update_fields=_MANAGER_DECISION_FIELDS)
        record_workflow_transition(
            locked,
            start,
            action=Action.REJECT,
            actor=actor,
            note=comment,
            approver_role="manager",
            metadata={"actor_source": actor_source},
        )
    return Transition(locked, from_status, actor_source)


_HR_DECISION_FIELDS = ["status", "decided_by", "decided_at", "hr_decision_note", "updated_at"]


def apply_hr_approval(instance: LeaveRequest, *, actor, note: str = "") -> Transition:
    if is_hr_manager_origin_request(instance):
        raise LeaveTransitionError(HR_ORIGIN_MESSAGE)

    with transaction.atomic():
        locked = _lock(instance)
        if locked.status not in HR_APPROVABLE_STATUSES:
            raise LeaveTransitionError(NOT_HR_APPROVABLE_MESSAGE)

        from_status = locked.status
        start = begin_recorded_transition(locked, actor=actor)
        locked.decided_by = actor
        locked.decided_at = timezone.now()
        locked.hr_decision_note = note
        locked.status = status_after_hr_approval(locked)
        locked.save(update_fields=_HR_DECISION_FIELDS)
        record_workflow_transition(locked, start, action=Action.APPROVE, actor=actor, note=note, approver_role="hr")
    return Transition(locked, from_status)


def apply_hr_rejection(instance: LeaveRequest, *, actor, comment: str) -> Transition:
    comment = (comment or "").strip()
    if not comment:
        raise LeaveTransitionError(COMMENT_REQUIRED_MESSAGE)

    with transaction.atomic():
        locked = _lock(instance)
        if locked.status not in HR_REJECTABLE_STATUSES:
            raise LeaveTransitionError(NOT_HR_REJECTABLE_MESSAGE)

        from_status = locked.status
        start = begin_recorded_transition(locked, actor=actor)
        locked.status = Status.REJECTED
        locked.decided_by = actor
        locked.decided_at = timezone.now()
        locked.hr_decision_note = comment
        locked.save(update_fields=_HR_DECISION_FIELDS)
        record_workflow_transition(locked, start, action=Action.REJECT, actor=actor, note=comment, approver_role="hr")
    return Transition(locked, from_status)


def apply_ceo_referral(instance: LeaveRequest, *, actor, note: str = "") -> Transition:
    """HR sends a request to the CEO once the manager stage is over.

    A request already waiting on the CEO is refused, so the original referral is
    never overwritten. A blank note keeps the existing HR note.
    """

    note = (note or "").strip()
    with transaction.atomic():
        locked = _lock(instance)
        if locked.status == Status.PENDING_CEO:
            raise LeaveTransitionError(ALREADY_WITH_CEO_MESSAGE)
        if locked.status not in CEO_REFERRABLE_STATUSES:
            raise LeaveTransitionError(NOT_CEO_REFERRABLE_MESSAGE)

        from_status = locked.status
        start = begin_recorded_transition(locked, actor=actor)
        if note:
            locked.hr_decision_note = note
        locked.status = Status.PENDING_CEO
        locked.decided_by = actor
        locked.decided_at = timezone.now()
        locked.save(update_fields=_HR_DECISION_FIELDS)
        record_workflow_transition(locked, start, action=Action.ADVANCE, actor=actor, note=note, approver_role="hr")
    return Transition(locked, from_status)


def _ensure_ceo_can_decide(instance: LeaveRequest, actor, not_pending_message: str) -> None:
    if instance.status != Status.PENDING_CEO:
        raise LeaveTransitionError(not_pending_message)
    if is_self_ceo_decision(instance, actor):
        raise LeaveTransitionError(SELF_DECISION_MESSAGE)


_CEO_DECISION_FIELDS = ["status", "ceo_decision_by", "ceo_decision_at", "ceo_decision_note", "updated_at"]


def apply_ceo_approval(
    instance: LeaveRequest, *, actor, note: str = "", waiver_reason: str = "", audit_request=None
) -> Transition:
    """Approve at the CEO stage.

    Business Trip leave with open blocking obligations needs a waiver reason. A
    refusal still commits the obligation rows the check synced, so the caller can
    show them; ``audit_request`` is only used to audit a waiver.
    """

    _ensure_ceo_can_decide(instance, actor, NOT_CEO_APPROVABLE_MESSAGE)
    waiver_reason = (waiver_reason or "").strip()
    blocked_summary = None

    with transaction.atomic():
        locked = _lock(instance)
        if locked.status != Status.PENDING_CEO:
            raise LeaveTransitionError(NOT_CEO_APPROVABLE_MESSAGE)

        from_status = locked.status
        obligations_summary = sync_leave_obligations(locked, actor=actor)
        blocking = is_business_trip_leave(locked) and obligations_summary.get("blocking_open", 0) > 0
        if blocking and not waiver_reason:
            blocked_summary = obligations_summary
        else:
            if blocking:
                waive_open_blocking_obligations(locked, actor=actor, reason=waiver_reason, request=audit_request)

            start = begin_recorded_transition(locked, actor=actor)
            locked.status = status_after_ceo_approval(locked)
            locked.ceo_decision_by = actor
            locked.ceo_decision_at = timezone.now()
            locked.ceo_decision_note = note
            locked.save(update_fields=_CEO_DECISION_FIELDS)
            record_workflow_transition(
                locked,
                start,
                action=Action.APPROVE,
                actor=actor,
                note=note,
                approver_role="ceo",
                metadata={"obligations_waived": True} if blocking else None,
            )
            sync_leave_obligations(locked, actor=actor)

    if blocked_summary is not None:
        raise LeaveTransitionError(
            OBLIGATIONS_BLOCKING_MESSAGE,
            status=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            data={"obligations_summary": blocked_summary},
        )
    return Transition(locked, from_status)


def apply_ceo_rejection(instance: LeaveRequest, *, actor, comment: str) -> Transition:
    _ensure_ceo_can_decide(instance, actor, NOT_CEO_REJECTABLE_MESSAGE)
    comment = (comment or "").strip()
    if not comment:
        raise LeaveTransitionError(COMMENT_REQUIRED_MESSAGE)

    with transaction.atomic():
        locked = _lock(instance)
        if locked.status != Status.PENDING_CEO:
            raise LeaveTransitionError(NOT_CEO_REJECTABLE_MESSAGE)

        from_status = locked.status
        start = begin_recorded_transition(locked, actor=actor)
        locked.status = Status.REJECTED
        locked.ceo_decision_by = actor
        locked.ceo_decision_at = timezone.now()
        locked.ceo_decision_note = comment
        locked.save(update_fields=_CEO_DECISION_FIELDS)
        record_workflow_transition(locked, start, action=Action.REJECT, actor=actor, note=comment, approver_role="ceo")
    return Transition(locked, from_status)


def ensure_awaiting_hr_completion(instance: LeaveRequest) -> None:
    """Refuse early, so the state error wins over upload validation errors."""

    if instance.status != Status.PENDING_HR_COMPLETION:
        raise LeaveTransitionError(NOT_AWAITING_HR_COMPLETION_MESSAGE)


def apply_hr_completion(
    instance: LeaveRequest, *, actor, note: str = "", visa_file=None, audit_request=None
) -> HRCompletion:
    """Finish a CEO-approved leave at the HR completion stage and approve it.

    A non-Saudi employee who will travel needs a visa PDF. It is stored and its
    fields extracted inside the transaction; file storage is not transactional, so
    any failure after the upload deletes the stored file before re-raising.
    ``audit_request`` is only used to audit the document upload.
    """

    ensure_awaiting_hr_completion(instance)
    document = None
    try:
        with transaction.atomic():
            locked = (
                LeaveRequest.objects.select_for_update(of=("self",))
                .select_related("employee_profile", "employee__employee_profile")
                .get(pk=instance.pk)
            )
            ensure_awaiting_hr_completion(locked)
            profile = leave_profile(locked)
            if not profile:
                raise LeaveTransitionError(PROFILE_NOT_FOUND_MESSAGE)
            visa_required = locked.requires_hr_completion()
            if visa_required and not visa_file:
                raise LeaveTransitionError(VISA_REQUIRED_MESSAGE)

            extraction_warnings = []
            if visa_file:
                document = EmployeeDocument.objects.create(
                    employee_profile=profile,
                    company=locked.company or profile.company,
                    leave_request=locked,
                    document_type=EmployeeDocument.DocumentType.VISA,
                    file=visa_file,
                    original_filename=getattr(visa_file, "name", ""),
                    uploaded_by=actor,
                )
                extraction_warnings = extract_visa_fields(document)
                audit(
                    audit_request,
                    "employee_document_uploaded",
                    entity="employee_document",
                    entity_id=document.id,
                    metadata={
                        "employee_profile_id": profile.id,
                        "leave_request_id": locked.id,
                        "document_type": document.document_type,
                        "extraction_status": document.extraction_status,
                        "warnings": extraction_warnings,
                    },
                )

            from_status = locked.status
            start = begin_recorded_transition(locked, actor=actor)
            locked.status = Status.APPROVED
            locked.hr_completed_by = actor
            locked.hr_completed_at = timezone.now()
            locked.hr_completion_note = note
            locked.save(
                update_fields=["status", "hr_completed_by", "hr_completed_at", "hr_completion_note", "updated_at"]
            )
            record_workflow_transition(
                locked,
                start,
                action=Action.APPROVE,
                actor=actor,
                note=note,
                approver_role="hr",
                metadata={"visa_document_id": document.id if document else None},
            )
            sync_leave_obligations(locked, actor=actor)
    except Exception:
        if document is not None and document.file.name:
            document.file.storage.delete(document.file.name)
        raise
    return HRCompletion(locked, from_status, profile, visa_required, document, extraction_warnings)


def refuse_requester_cancellation() -> None:
    """Employees cannot cancel their own leave request at any stage; HR cancels it for them."""

    raise LeaveTransitionError(CONTACT_HR_TO_CANCEL_MESSAGE, status=403)


def apply_hr_cancellation(instance: LeaveRequest, *, actor, comment: str) -> Transition:
    """HR cancels a request in progress or already approved, recording why.

    A cancelled Business Trip also closes its obligations and ends the delegation
    it created.
    """

    if instance.employee_id == actor.pk:
        raise LeaveTransitionError(SELF_CANCELLATION_MESSAGE, status=403)
    comment = (comment or "").strip()
    if not comment:
        raise LeaveTransitionError(COMMENT_REQUIRED_MESSAGE)

    with transaction.atomic():
        locked = _lock(instance)
        if locked.status not in HR_CANCELLABLE_STATUSES:
            raise LeaveTransitionError(NOT_CANCELLABLE_MESSAGE)

        from_status = locked.status
        start = begin_recorded_transition(locked, actor=actor)
        locked.status = Status.CANCELLED
        locked.save(update_fields=["status", "updated_at"])
        record_workflow_transition(locked, start, action=Action.CANCEL, actor=actor, note=comment, approver_role="hr")
        close_leave_obligations(locked, note="Leave request cancelled by HR.", actor=actor)
    return Transition(locked, from_status)


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------


def _log_notification_failure(event_name: str, instance: LeaveRequest, notification_type: str, actor_id) -> None:
    extra = {"entity_id": instance.id, "notification_type": notification_type}
    if actor_id is not None:
        extra["actor_id"] = actor_id
    logger.exception(event_name, extra=extra)


def _notify_ceo_of_pending_leave(instance: LeaveRequest, *, failure_event: str, actor_id) -> None:
    try:
        notify_users_for_pending_status(
            users=get_ceo_approver_users(),
            request_type=REQUEST_TYPE,
            request_id=instance.id,
            requester_name=instance.employee.full_name or instance.employee.email,
            status_label=instance.status,
            details=[f"Leave Type: {instance.leave_type.name}", f"Employee: {instance.employee.email}"],
            action_path=CEO_ACTION_PATH,
        )
    except Exception:
        _log_notification_failure(failure_event, instance, "pending_status", actor_id)


def _notify_pending_approvers(instance: LeaveRequest, *, users, action_path: str, failure_event: str, actor_id) -> None:
    try:
        notify_users_for_pending_status(
            users=users,
            request_type=REQUEST_TYPE,
            request_id=instance.id,
            requester_name=leave_employee_name(instance),
            status_label=instance.status,
            details=[f"Leave Type: {instance.leave_type.name}", f"Employee: {leave_employee_email(instance)}"],
            action_path=action_path,
        )
    except Exception:
        _log_notification_failure(failure_event, instance, "pending_status", actor_id)


def notify_after_delegate_assignment(instance: LeaveRequest, *, actor_id=None) -> None:
    try:
        notify_delegation_assigned(instance)
    except Exception:
        _log_notification_failure(
            "leave_delegation_update_notification_failed", instance, "delegation_assigned", actor_id
        )


def notify_after_delegate_approval(instance: LeaveRequest, *, actor_id=None) -> None:
    failure_event = "leave_delegate_approval_notification_failed"
    if instance.status == Status.PENDING_CEO:
        _notify_ceo_of_pending_leave(instance, failure_event=failure_event, actor_id=actor_id)
    elif instance.status == Status.PENDING_MANAGER:
        _notify_pending_approvers(
            instance,
            users=[user for user in [leave_manager_user(instance)] if user],
            action_path=MANAGER_ACTION_PATH.format(id=instance.id),
            failure_event=failure_event,
            actor_id=actor_id,
        )
    else:
        _notify_pending_approvers(
            instance,
            users=get_hr_approver_users(),
            action_path=HR_ACTION_PATH.format(id=instance.id),
            failure_event=failure_event,
            actor_id=actor_id,
        )


def notify_after_delegate_rejection(instance: LeaveRequest, *, actor_id=None) -> None:
    try:
        notify_leave_rejected(instance, instance.delegate_decision_note)
    except Exception:
        _log_notification_failure("leave_delegate_rejection_notification_failed", instance, "leave_rejected", actor_id)


def notify_after_manager_approval(instance: LeaveRequest, *, actor_id=None) -> None:
    if instance.status == Status.PENDING_CEO:
        _notify_ceo_of_pending_leave(
            instance, failure_event="manager_leave_approval_notification_failed", actor_id=actor_id
        )
        return
    try:
        notify_users_for_pending_status(
            users=get_hr_approver_users(),
            request_type=REQUEST_TYPE,
            request_id=instance.id,
            requester_name=instance.employee.full_name or instance.employee.email,
            status_label=instance.status,
            details=[f"Leave Type: {instance.leave_type.name}", f"Employee: {instance.employee.email}"],
            action_path=HR_ACTION_PATH.format(id=instance.id),
        )
    except Exception:
        _log_notification_failure("manager_leave_approval_notification_failed", instance, "pending_status", actor_id)


def notify_after_manager_rejection(instance: LeaveRequest, *, actor_id=None) -> None:
    try:
        notify_leave_rejected(instance, instance.manager_decision_note)
    except Exception:
        _log_notification_failure("manager_leave_rejection_notification_failed", instance, "leave_rejected", actor_id)


def notify_after_hr_approval(instance: LeaveRequest, *, actor_id=None) -> None:
    if instance.status != Status.PENDING_CEO:
        return
    _notify_ceo_of_pending_leave(instance, failure_event="leave_hr_approval_notification_failed", actor_id=actor_id)


def notify_after_hr_rejection(instance: LeaveRequest, *, actor_id=None) -> None:
    try:
        notify_leave_rejected(instance, instance.hr_decision_note)
    except Exception:
        _log_notification_failure("leave_hr_rejection_notification_failed", instance, "leave_rejected", actor_id)


def notify_after_ceo_referral(instance: LeaveRequest, *, actor_id=None) -> None:
    _notify_ceo_of_pending_leave(instance, failure_event="leave_ceo_referral_notification_failed", actor_id=actor_id)


def notify_after_ceo_approval(instance: LeaveRequest, *, actor_id=None) -> None:
    if instance.status == Status.PENDING_HR_COMPLETION:
        _notify_pending_approvers(
            instance,
            users=get_hr_approver_users(),
            action_path=HR_ACTION_PATH.format(id=instance.id),
            failure_event="ceo_leave_approval_notification_failed",
            actor_id=actor_id,
        )
        return
    try:
        notify_leave_approved(instance)
    except Exception:
        _log_notification_failure("ceo_leave_approval_notification_failed", instance, "leave_approved", actor_id)


def notify_after_ceo_rejection(instance: LeaveRequest, *, actor_id=None) -> None:
    try:
        notify_leave_rejected(instance, instance.ceo_decision_note)
    except Exception:
        _log_notification_failure("ceo_leave_rejection_notification_failed", instance, "leave_rejected", actor_id)


def notify_after_hr_completion(instance: LeaveRequest, *, actor_id=None) -> None:
    try:
        notify_leave_approved(instance)
    except Exception:
        _log_notification_failure("leave_completion_notification_failed", instance, "leave_approved", actor_id)


def notify_after_hr_cancellation(instance: LeaveRequest, *, reason: str, actor_id=None) -> None:
    """Tell the requester HR cancelled their leave request, and why."""

    employee = instance.employee
    try:
        from in_app_notifications.i18n import notification_text

        dispatch_notification_channels(
            recipient=employee,
            event_key="leave.cancelled",
            **notification_text("leave.cancelled", request_id=instance.id),
            category=Notification.Category.LEAVE,
            action_url=EMPLOYEE_REQUESTS_PATH,
            related_object=instance,
            deduplication_key=f"leave.cancelled:{instance.id}",
            whatsapp_template="request_status_update",
            whatsapp_variables={
                "employee_name": employee.full_name or employee.email,
                "request_type": REQUEST_TYPE,
                "request_id": instance.id,
                "status_label": "Cancelled by HR",
                "reason": reason,
                "details": [],
                "action_url": EMPLOYEE_REQUESTS_PATH,
            },
        )
    except Exception:
        _log_notification_failure("leave_cancellation_notification_failed", instance, "leave_cancelled", actor_id)
