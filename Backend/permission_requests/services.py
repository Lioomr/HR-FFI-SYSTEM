"""Business rules and state transitions for exit permission requests.

Views authenticate, scope, and serialize. This module owns every transition: it
locks the row, re-checks authority and state under that lock, writes the domain
``status``, and projects it into the shared workflow engine in the same
transaction. Notifications are sent afterwards and can never undo a decision.

The approval chain is Direct Manager -> HR -> approved. There is no CEO stage.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.db.models.functions import Length
from django.utils import timezone

from audit.utils import audit
from core.models import WorkflowAction
from core.responses import error
from core.services import (
    get_hr_approver_users,
    notify_profile_request_status_whatsapp,
    notify_users_for_pending_status,
)
from core.services.workflow_engine import begin_recorded_transition, record_workflow_transition
from employees.models import EmployeeProfile
from employees.services.manager_relationships import get_valid_manager_user, manager_approval_actor_source

from .labels import EXIT_TYPE_LABELS, STATUS_LABELS
from .models import ACTIVE_STATUSES, PENDING_STATUSES, PermissionRequest
from .permissions import is_base_hr_approver, is_hr_approver_user

logger = logging.getLogger(__name__)

Status = PermissionRequest.Status
Decision = PermissionRequest.Decision

REQUEST_TYPE = "Permission Request"
REFERENCE_PREFIX = "PERM"
REFERENCE_ATTEMPTS = 5

EMPLOYEE_ACTION_PATH = "/employee/permission-requests/{id}"
MANAGER_ACTION_PATH = "/manager/permission-requests/{id}"
HR_ACTION_PATH = "/hr/permission-requests/{id}"

DUPLICATE_ACTIVE_MESSAGE = "You already have an active permission request for this date."
NO_APPROVER_MESSAGE = (
    "No eligible approver is available for this permission request. Ask HR to assign your direct manager."
)
SELF_DECISION_MESSAGE = "You cannot approve or reject your own permission request."


class PermissionRequestError(Exception):
    """A refused action, carrying its HTTP status and the field it belongs to."""

    def __init__(self, message: str, *, status: int = 422, field: str | None = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.field = field

    def to_response(self):
        if self.status == 422:
            return error("Validation error", errors={self.field or "non_field_errors": [self.message]}, status=422)
        return error(self.message, errors=[self.message], status=self.status)


@dataclass(frozen=True)
class Transition:
    instance: PermissionRequest
    from_status: str
    actor_source: str = ""


# ---------------------------------------------------------------------------
# Routing
# ---------------------------------------------------------------------------


def eligible_hr_approvers(company_id, *, exclude_user_id=None):
    """Active HR approvers authorized for ``company_id``, never the requester."""

    users = get_hr_approver_users().filter(
        Q(employee_profile__company_id=company_id)
        | Q(organization_access_entries__organization_id=company_id)
        | Q(groups__name="SystemAdmin")
    )
    if exclude_user_id is not None:
        users = users.exclude(pk=exclude_user_id)
    return users.distinct()


def resolve_initial_status(user, profile: EmployeeProfile):
    """Return ``(status, manager_user)`` for a new request, or refuse an un-actionable one.

    The direct manager comes from the employee relationship service, which already
    rejects a self-assigned, archived, inactive, or cross-company manager. Without a
    valid manager the request starts at HR, provided an HR approver other than the
    requester exists; otherwise nobody could ever decide it.
    """

    manager_user = get_valid_manager_user(profile)
    if manager_user is not None and manager_user.pk != user.pk:
        return Status.PENDING_MANAGER, manager_user
    if eligible_hr_approvers(profile.company_id, exclude_user_id=user.pk).exists():
        return Status.PENDING_HR, None
    raise PermissionRequestError(NO_APPROVER_MESSAGE)


def status_after_manager_approval(instance: PermissionRequest) -> str:
    """An HR approver cannot approve their own request, so their HR stage is skipped."""

    if is_base_hr_approver(instance.employee):
        return Status.APPROVED
    return Status.PENDING_HR


def can_actor_decide(
    actor,
    instance: PermissionRequest,
    *,
    is_hr_approver: Callable[[object], bool] = is_hr_approver_user,
) -> bool:
    """Whether the decision endpoints would accept ``actor`` for the current stage."""

    if not actor or not getattr(actor, "is_authenticated", False) or actor.pk == instance.employee_id:
        return False
    if instance.status == Status.PENDING_MANAGER:
        return bool(manager_approval_actor_source(actor, instance.employee_profile))
    if instance.status == Status.PENDING_HR:
        return is_hr_approver(actor)
    return False


# ---------------------------------------------------------------------------
# Transitions
# ---------------------------------------------------------------------------


def _has_active_request(user, request_date) -> bool:
    return PermissionRequest.objects.filter(
        employee=user,
        request_date=request_date,
        status__in=ACTIVE_STATUSES,
    ).exists()


def _next_reference_no(on_date) -> str:
    prefix = f"{REFERENCE_PREFIX}-{on_date:%Y%m%d}-"
    last = (
        PermissionRequest.objects.filter(reference_no__startswith=prefix)
        .order_by(Length("reference_no").desc(), "-reference_no")
        .values_list("reference_no", flat=True)
        .first()
    )
    sequence = int(last.rsplit("-", 1)[1]) + 1 if last else 1
    return f"{prefix}{sequence:04d}"


def submit_permission_request(*, user, profile: EmployeeProfile, data: dict):
    """Create a request owned by ``user``. Returns ``(instance, manager_user)``.

    Ownership and company come from the authenticated profile, never the client.
    """

    request_date = data["request_date"]
    attempt = 0
    while True:
        attempt += 1
        try:
            with transaction.atomic():
                # Serialize simultaneous submissions by the same employee so the
                # one-active-request-per-day rule is evaluated one at a time.
                EmployeeProfile.objects.select_for_update().only("pk").get(pk=profile.pk)
                if _has_active_request(user, request_date):
                    raise PermissionRequestError(DUPLICATE_ACTIVE_MESSAGE, field="request_date")
                initial_status, manager_user = resolve_initial_status(user, profile)
                instance = PermissionRequest.objects.create(
                    employee=user,
                    employee_profile=profile,
                    company_id=profile.company_id,
                    reference_no=_next_reference_no(request_date),
                    request_date=request_date,
                    from_time=data["from_time"],
                    to_time=data["to_time"],
                    duration_minutes=data["duration_minutes"],
                    exit_type=data["exit_type"],
                    reason=data["reason"],
                    status=initial_status,
                )
                # The free-text reason stays out of the workflow history.
                start = begin_recorded_transition(instance, actor=user, new_instance=True)
                record_workflow_transition(
                    instance, start, action=WorkflowAction.Action.SUBMIT, actor=user, approver_role=""
                )
            return instance, manager_user
        except IntegrityError:
            # The partial unique index backs up the duplicate rule; any other
            # collision is a reference-number race between employees, so retry.
            if _has_active_request(user, request_date):
                raise PermissionRequestError(DUPLICATE_ACTIVE_MESSAGE, field="request_date") from None
            if attempt >= REFERENCE_ATTEMPTS:
                raise


def _manager_decision_action(instance: PermissionRequest, decision: str) -> str:
    """A rejection ends the request; an approval forwards it to HR or, for an HR approver's own request, is final."""

    if decision == Decision.REJECTED:
        return WorkflowAction.Action.REJECT
    if instance.status == Status.PENDING_HR:
        return WorkflowAction.Action.ADVANCE
    return WorkflowAction.Action.APPROVE


def _lock(instance: PermissionRequest) -> PermissionRequest:
    return (
        PermissionRequest.objects.select_for_update(of=("self",))
        .select_related("employee", "employee_profile")
        .get(pk=instance.pk)
    )


def apply_manager_decision(instance: PermissionRequest, *, actor, decision: str, note: str = "") -> Transition:
    with transaction.atomic():
        locked = _lock(instance)
        if locked.employee_id == actor.pk:
            raise PermissionRequestError(SELF_DECISION_MESSAGE, status=403)
        actor_source = manager_approval_actor_source(actor, locked.employee_profile)
        if not actor_source:
            raise PermissionRequestError(
                "Only the requester's direct or delegated manager can decide the manager stage.", status=403
            )
        if locked.status != Status.PENDING_MANAGER:
            raise PermissionRequestError("This permission request is no longer pending manager approval.")

        from_status = locked.status
        start = begin_recorded_transition(locked, actor=actor)
        locked.manager_decision = decision
        locked.manager_decision_by = actor
        locked.manager_decision_at = timezone.now()
        locked.manager_decision_note = note
        locked.status = Status.REJECTED if decision == Decision.REJECTED else status_after_manager_approval(locked)
        locked.save(
            update_fields=[
                "status",
                "manager_decision",
                "manager_decision_by",
                "manager_decision_at",
                "manager_decision_note",
                "updated_at",
            ]
        )
        record_workflow_transition(
            locked,
            start,
            action=_manager_decision_action(locked, decision),
            actor=actor,
            note=note,
            approver_role="manager",
            metadata={"decision": decision, "actor_source": actor_source},
        )
    return Transition(locked, from_status, actor_source)


def apply_hr_decision(instance: PermissionRequest, *, actor, decision: str, note: str = "") -> Transition:
    with transaction.atomic():
        locked = _lock(instance)
        if locked.employee_id == actor.pk:
            raise PermissionRequestError(SELF_DECISION_MESSAGE, status=403)
        if not is_hr_approver_user(actor):
            raise PermissionRequestError("Only HR workflow approvers can decide the HR stage.", status=403)
        if locked.status != Status.PENDING_HR:
            raise PermissionRequestError("This permission request is no longer pending HR approval.")

        from_status = locked.status
        start = begin_recorded_transition(locked, actor=actor)
        locked.hr_decision = decision
        locked.hr_decision_by = actor
        locked.hr_decision_at = timezone.now()
        locked.hr_decision_note = note
        locked.status = Status.APPROVED if decision == Decision.APPROVED else Status.REJECTED
        locked.save(
            update_fields=[
                "status",
                "hr_decision",
                "hr_decision_by",
                "hr_decision_at",
                "hr_decision_note",
                "updated_at",
            ]
        )
        record_workflow_transition(
            locked,
            start,
            action=WorkflowAction.Action.APPROVE if decision == Decision.APPROVED else WorkflowAction.Action.REJECT,
            actor=actor,
            note=note,
            approver_role="hr",
            metadata={"decision": decision},
        )
    return Transition(locked, from_status)


def cancel_permission_request(instance: PermissionRequest, *, actor) -> Transition:
    with transaction.atomic():
        locked = _lock(instance)
        if locked.employee_id != actor.pk:
            raise PermissionRequestError("Only the requester can cancel this permission request.", status=403)
        if locked.status not in PENDING_STATUSES:
            raise PermissionRequestError("Only pending permission requests can be cancelled.")

        from_status = locked.status
        start = begin_recorded_transition(locked, actor=actor)
        locked.status = Status.CANCELLED
        locked.cancelled_at = timezone.now()
        locked.save(update_fields=["status", "cancelled_at", "updated_at"])
        record_workflow_transition(locked, start, action=WorkflowAction.Action.CANCEL, actor=actor, approver_role="")
    return Transition(locked, from_status)


# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------


def audit_permission_request(request, action: str, instance: PermissionRequest, *, from_status=None, extra=None):
    """Record operational facts only - never the free-text reason, notes, or signatures."""

    metadata = {
        "request_id": instance.pk,
        "reference_no": instance.reference_no,
        "company_id": instance.company_id,
        "from_status": from_status,
        "to_status": instance.status,
        "duration_minutes": instance.duration_minutes,
        "exit_type": instance.exit_type,
        "actor_id": getattr(request.user, "pk", None),
    }
    metadata.update(extra or {})
    audit(request, action, entity="PermissionRequest", entity_id=instance.pk, metadata=metadata)


# ---------------------------------------------------------------------------
# Notifications (after commit; failures are logged and never propagate)
# ---------------------------------------------------------------------------


def _status_label(instance: PermissionRequest) -> str:
    return STATUS_LABELS.get(instance.status, (str(instance.status),))[0]


def _details(instance: PermissionRequest) -> list[str]:
    exit_type = EXIT_TYPE_LABELS.get(instance.exit_type, (str(instance.exit_type),))[0]
    return [
        f"Reference: {instance.reference_no}",
        f"Date: {instance.request_date:%Y-%m-%d}",
        f"Time: {instance.from_time:%H:%M} - {instance.to_time:%H:%M} ({instance.duration_minutes} min)",
        f"Exit type: {exit_type}",
    ]


def _requester_name(instance: PermissionRequest) -> str:
    profile = instance.employee_profile
    employee = instance.employee
    return profile.full_name or employee.full_name or employee.email


def _dispatch(event: str, instance: PermissionRequest, send: Callable[[], object]) -> None:
    try:
        # A savepoint keeps a database error inside the notification pipeline from
        # poisoning any surrounding transaction.
        with transaction.atomic():
            send()
    except Exception:
        logger.exception(
            "permission_request_notification_failed",
            extra={"event": event, "entity_id": instance.pk, "status": instance.status},
        )


def _notify_approvers(instance: PermissionRequest, event: str, users: Callable[[], object], path: str) -> None:
    def send():
        recipients = [user for user in users() if user and user.pk != instance.employee_id]
        if not recipients:
            return None
        return notify_users_for_pending_status(
            users=recipients,
            request_type=REQUEST_TYPE,
            request_id=instance.pk,
            requester_name=_requester_name(instance),
            status_label=_status_label(instance),
            details=_details(instance),
            action_path=path.format(id=instance.pk),
        )

    _dispatch(event, instance, send)


def _notify_hr(instance: PermissionRequest, event: str) -> None:
    _notify_approvers(
        instance,
        event,
        lambda: eligible_hr_approvers(instance.company_id, exclude_user_id=instance.employee_id),
        HR_ACTION_PATH,
    )


def _notify_requester(instance: PermissionRequest, event: str, *, reason: str = "") -> None:
    _dispatch(
        event,
        instance,
        lambda: notify_profile_request_status_whatsapp(
            profile=instance.employee_profile,
            request_type=REQUEST_TYPE,
            request_id=instance.pk,
            status_label=_status_label(instance),
            details=_details(instance),
            action_path=EMPLOYEE_ACTION_PATH.format(id=instance.pk),
            reason=reason or None,
        ),
    )


def notify_after_submission(instance: PermissionRequest, manager_user=None) -> None:
    if instance.status == Status.PENDING_MANAGER and manager_user is not None:
        _notify_approvers(instance, "submitted", lambda: [manager_user], MANAGER_ACTION_PATH)
    elif instance.status == Status.PENDING_HR:
        _notify_hr(instance, "submitted")


def notify_after_manager_decision(instance: PermissionRequest) -> None:
    if instance.status == Status.PENDING_HR:
        _notify_hr(instance, "manager_approved")
    elif instance.status == Status.REJECTED:
        _notify_requester(instance, "manager_rejected", reason=instance.manager_decision_note)
    else:
        _notify_requester(instance, "manager_approved_final")


def notify_after_hr_decision(instance: PermissionRequest) -> None:
    if instance.status == Status.REJECTED:
        _notify_requester(instance, "hr_rejected", reason=instance.hr_decision_note)
    else:
        _notify_requester(instance, "hr_approved")
