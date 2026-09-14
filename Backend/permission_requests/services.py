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
from datetime import date

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.db.models.functions import Length
from django.utils import timezone

from admin_portal.models import SystemSettings
from attendance.biotime_policy import is_attendance_exempt
from attendance.calculation import AttendanceCalculationService
from attendance.models import AttendanceAdjustment
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
from .models import ACTIVE_STATUSES, PENDING_STATUSES, PermissionRequest, PermissionRequestAttachment
from .permissions import is_base_hr_approver, is_hr_approver_user

logger = logging.getLogger(__name__)

Status = PermissionRequest.Status
Decision = PermissionRequest.Decision

REQUEST_TYPE = "Permission Request"
REQUEST_TYPE_BY_PERMISSION_TYPE = {
    PermissionRequest.PermissionType.EXIT: "Exit Permission",
    PermissionRequest.PermissionType.LATE: "Late Permission",
    PermissionRequest.PermissionType.DURING_SHIFT: "During Shift Permission",
}
REFERENCE_PREFIX = "PERM"
REFERENCE_ATTEMPTS = 5

EMPLOYEE_ACTION_PATH = "/employee/permission-requests/{id}"
MANAGER_ACTION_PATH = "/manager/permission-requests/{id}"
HR_ACTION_PATH = "/hr/permission-requests/{id}"

INTERVAL_CONFLICT_MESSAGE = "An active Exit or During Shift Permission already overlaps this time."
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
    """Compatibility helper retained for callers; Late requests never conflict."""

    return PermissionRequest.objects.filter(
        employee=user,
        request_date=request_date,
        status__in=ACTIVE_STATUSES,
        permission_type__in=[PermissionRequest.PermissionType.EXIT, PermissionRequest.PermissionType.DURING_SHIFT],
    ).exists()


def approved_late_permission_usage(
    employee_id: int, request_date: date, *, exclude_request_id: int | None = None
) -> int:
    """Finally approved Late Permissions in the employee's local calendar month."""

    queryset = PermissionRequest.objects.filter(
        employee_id=employee_id,
        permission_type=PermissionRequest.PermissionType.LATE,
        status=Status.APPROVED,
        request_date__year=request_date.year,
        request_date__month=request_date.month,
    )
    if exclude_request_id is not None:
        queryset = queryset.exclude(pk=exclude_request_id)
    return queryset.count()


def _assert_no_interval_conflict(*, user, request_date, from_time, to_time) -> None:
    conflict = PermissionRequest.objects.filter(
        employee=user,
        request_date=request_date,
        status__in=ACTIVE_STATUSES,
        permission_type__in=[PermissionRequest.PermissionType.EXIT, PermissionRequest.PermissionType.DURING_SHIFT],
        from_time__lt=to_time,
        to_time__gt=from_time,
    ).exists()
    if conflict:
        raise PermissionRequestError(INTERVAL_CONFLICT_MESSAGE, field="from_time")


def _assert_late_permission_allowed(
    *, profile: EmployeeProfile, request_date: date, exclude_request_id: int | None = None
) -> None:
    if is_attendance_exempt(profile):
        raise PermissionRequestError(
            "Attendance-exempt employees cannot submit Late Permission.", field="permission_type"
        )
    limit = SystemSettings.get_solo().approved_late_permission_limit_per_month
    # Pending requests do not consume the limit, so this check remains valid at
    # submission and is repeated under lock immediately before final approval.
    if (
        approved_late_permission_usage(
            profile.user_id,
            request_date,
            exclude_request_id=exclude_request_id,
        )
        >= limit
    ):
        raise PermissionRequestError(
            f"You have reached the monthly Late Permission limit of {limit}.", field="request_date"
        )


def _create_attachments(*, instance: PermissionRequest, user, files, metadata) -> None:
    for index, upload in enumerate(files or []):
        PermissionRequestAttachment.objects.create(
            permission_request=instance,
            file=upload,
            original_filename=(getattr(upload, "name", "evidence") or "evidence")[:255],
            content_type=(getattr(upload, "content_type", "") or "")[:100],
            size_bytes=upload.size,
            capture_metadata=(metadata or [{}] * len(files))[index] or {},
            uploaded_by=user,
        )


def add_permission_request_attachments(*, instance: PermissionRequest, user, files, metadata) -> None:
    """Append evidence under the request row lock to avoid stale pending-state writes."""

    with transaction.atomic():
        locked = _lock(instance)
        if locked.employee_id != user.pk:
            raise PermissionRequestError("Only the requester can add evidence attachments.", status=403)
        if locked.status not in PENDING_STATUSES:
            raise PermissionRequestError("Evidence can only be changed while the request is pending.")
        _create_attachments(instance=locked, user=user, files=files, metadata=metadata)


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
    permission_type = data["permission_type"]
    attempt = 0
    while True:
        attempt += 1
        try:
            with transaction.atomic():
                # Serialize simultaneous submissions by the same employee so
                # interval conflicts and monthly limits are rechecked together.
                EmployeeProfile.objects.select_for_update().only("pk").get(pk=profile.pk)
                if permission_type == PermissionRequest.PermissionType.LATE:
                    _assert_late_permission_allowed(profile=profile, request_date=request_date)
                else:
                    _assert_no_interval_conflict(
                        user=user,
                        request_date=request_date,
                        from_time=data["from_time"],
                        to_time=data["to_time"],
                    )
                initial_status, manager_user = resolve_initial_status(user, profile)
                instance = PermissionRequest.objects.create(
                    employee=user,
                    employee_profile=profile,
                    company_id=profile.company_id,
                    reference_no=_next_reference_no(request_date),
                    permission_type=permission_type,
                    request_date=request_date,
                    from_time=data["from_time"],
                    to_time=data["to_time"],
                    duration_minutes=data["duration_minutes"],
                    exit_type=data["exit_type"],
                    reason=data["reason"],
                    status=initial_status,
                )
                _create_attachments(
                    instance=instance,
                    user=user,
                    files=data.get("attachments", []),
                    metadata=data.get("attachment_metadata", []),
                )
                # The free-text reason stays out of the workflow history.
                start = begin_recorded_transition(instance, actor=user, new_instance=True)
                record_workflow_transition(
                    instance, start, action=WorkflowAction.Action.SUBMIT, actor=user, approver_role=""
                )
            return instance, manager_user
        except IntegrityError:
            # Reference numbers are generated per day and can race between users.
            if attempt >= REFERENCE_ATTEMPTS:
                raise


def _upsert_attendance_adjustment(instance: PermissionRequest, *, actor) -> None:
    """Create one auditable calculation input for a finally approved request."""

    kind_by_type = {
        PermissionRequest.PermissionType.LATE: AttendanceAdjustment.Kind.LATE_PERMISSION,
        PermissionRequest.PermissionType.DURING_SHIFT: AttendanceAdjustment.Kind.DURING_SHIFT_PERMISSION,
        PermissionRequest.PermissionType.EXIT: AttendanceAdjustment.Kind.EXIT_PERMISSION,
    }
    # Late is a durable arrival-excusal marker. Its raw-punch-dependent effect
    # belongs to Backend Agent 3's final enforcement, so this workflow never
    # converts a physical arrival into approved minutes. Exit remains metadata
    # only; During Shift is the sole interval that contributes minutes here.
    approved_minutes = (
        instance.duration_minutes if instance.permission_type == PermissionRequest.PermissionType.DURING_SHIFT else 0
    )
    AttendanceAdjustment.objects.update_or_create(
        kind=kind_by_type[instance.permission_type],
        source_key=str(instance.pk),
        defaults={
            "employee_profile": instance.employee_profile,
            "company": instance.company,
            "date": instance.request_date,
            "effective_date": instance.request_date,
            "start_time": instance.from_time,
            "end_time": instance.to_time,
            "approved_minutes": approved_minutes,
            "reason": f"{instance.permission_type}:{instance.reference_no}",
            "created_by": actor,
        },
    )


def schedule_attendance_recalculation(instance: PermissionRequest) -> None:
    """Schedule calculation only after the approval transaction commits."""

    def recalculate():
        try:
            AttendanceCalculationService.recalculate(instance.employee_profile, instance.request_date)
        except Exception:
            # The approval and source adjustment are durable; a worker or HR can
            # retry calculation without losing either audit trail.
            logger.exception("permission_request_attendance_recalculation_failed", extra={"request_id": instance.pk})

    transaction.on_commit(recalculate)


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


def _assert_final_approval_allowed(locked: PermissionRequest) -> None:
    """Recheck final-only limits before transition, under the employee lock."""

    EmployeeProfile.objects.select_for_update().only("pk").get(pk=locked.employee_profile_id)
    if locked.permission_type == PermissionRequest.PermissionType.LATE:
        _assert_late_permission_allowed(
            profile=locked.employee_profile,
            request_date=locked.request_date,
            exclude_request_id=locked.pk,
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
        next_status = Status.REJECTED if decision == Decision.REJECTED else status_after_manager_approval(locked)
        if next_status == Status.APPROVED:
            _assert_final_approval_allowed(locked)
        locked.status = next_status
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
        if locked.status == Status.APPROVED:
            _upsert_attendance_adjustment(locked, actor=actor)
            schedule_attendance_recalculation(locked)
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
        next_status = Status.APPROVED if decision == Decision.APPROVED else Status.REJECTED
        if next_status == Status.APPROVED:
            _assert_final_approval_allowed(locked)
        locked.status = next_status
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
        if locked.status == Status.APPROVED:
            _upsert_attendance_adjustment(locked, actor=actor)
            schedule_attendance_recalculation(locked)
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
        "permission_type": instance.permission_type,
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


def _request_type_label(instance: PermissionRequest) -> str:
    """Use the concrete permission in employee-facing notifications."""

    return REQUEST_TYPE_BY_PERMISSION_TYPE.get(instance.permission_type, REQUEST_TYPE)


def _details(instance: PermissionRequest) -> list[str]:
    details = [
        f"Reference: {instance.reference_no}",
        f"Date: {instance.request_date:%Y-%m-%d}",
    ]
    if instance.from_time and instance.to_time:
        details.append(f"Time: {instance.from_time:%H:%M} - {instance.to_time:%H:%M} ({instance.duration_minutes} min)")
    if instance.permission_type == PermissionRequest.PermissionType.EXIT:
        exit_type = EXIT_TYPE_LABELS.get(instance.exit_type, (str(instance.exit_type),))[0]
        details.append(f"Exit type: {exit_type}")
    else:
        details.append(f"Permission type: {instance.get_permission_type_display()}")
    return details


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
            request_type=_request_type_label(instance),
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
            request_type=_request_type_label(instance),
            request_id=instance.pk,
            status_label=_status_label(instance),
            details=_details(instance),
            action_path=EMPLOYEE_ACTION_PATH.format(id=instance.pk),
            reason=reason or None,
        ),
    )


def notify_after_submission(instance: PermissionRequest, manager_user=None) -> None:
    def send():
        if instance.status == Status.PENDING_MANAGER and manager_user is not None:
            _notify_approvers(instance, "submitted", lambda: [manager_user], MANAGER_ACTION_PATH)
        elif instance.status == Status.PENDING_HR:
            _notify_hr(instance, "submitted")

    transaction.on_commit(send)


def notify_after_manager_decision(instance: PermissionRequest) -> None:
    def send():
        if instance.status == Status.PENDING_HR:
            _notify_hr(instance, "manager_approved")
        elif instance.status == Status.REJECTED:
            _notify_requester(instance, "manager_rejected", reason=instance.manager_decision_note)
        else:
            _notify_requester(instance, "manager_approved_final")

    transaction.on_commit(send)


def notify_after_hr_decision(instance: PermissionRequest) -> None:
    def send():
        if instance.status == Status.REJECTED:
            _notify_requester(instance, "hr_rejected", reason=instance.hr_decision_note)
        else:
            _notify_requester(instance, "hr_approved")

    transaction.on_commit(send)
