"""Employee cancellation requests for already approved requests.

An employee cancels a *pending* request directly (each module's requester cancel).
Once it is approved they instead ask HR: ``request_cancellation`` records a pending
``CancellationRequest`` with their reason, and HR confirms or declines it.

- Confirm runs the module's own HR cancel service, which sets the request
  ``cancelled``, reverses its side effects and records the usual ``cancel``
  workflow action with the HR actor.
- Decline leaves the request approved; the note stays visible to the employee
  through ``workflow.cancellation_request``.
- The employee may withdraw a pending cancellation request, and may ask again
  after a decline.

Each kind registers what it needs (owner, company, eligibility, the module's HR
cancel) in ``KINDS``; the modules own their transitions. This module locks the
request row, re-checks eligibility under that lock, and records
``cancellation_requested`` / ``cancellation_declined`` / ``cancellation_withdrawn``
on the request's own recorded workflow history.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from audit.utils import audit
from django.apps import apps
from django.contrib.contenttypes.models import ContentType
from django.db import IntegrityError, transaction
from django.db.models import Q, prefetch_related_objects
from django.utils import timezone

from core.models import CancellationRequest, WorkflowAction
from core.responses import error, success
from core.services.workflow_engine import begin_recorded_transition, record_workflow_transition

logger = logging.getLogger(__name__)

Status = CancellationRequest.Status
Action = WorkflowAction.Action

REASON_MIN_LENGTH = 5
REASON_MAX_LENGTH = 1000

REASON_REQUIRED_MESSAGE = "reason is required."
REASON_TOO_SHORT_MESSAGE = f"reason must be at least {REASON_MIN_LENGTH} characters."
REASON_TOO_LONG_MESSAGE = f"reason must be at most {REASON_MAX_LENGTH} characters."
COMMENT_REQUIRED_MESSAGE = "comment is required."
COMMENT_INVALID_MESSAGE = "comment must be text."
NOT_APPROVED_MESSAGE = (
    "Only an approved request needs a cancellation request. Cancel a pending request directly instead."
)
LEAVE_MANUAL_MESSAGE = "HR manual leave records cannot be cancelled by the employee."
LEAVE_ENDED_MESSAGE = "This leave has already ended, so it can no longer be cancelled."
PERMISSION_PAST_MESSAGE = "The date of this permission has passed, so it can no longer be cancelled."
RETURN_PROCESSED_MESSAGE = "HR has already received this asset, so the return request can no longer be cancelled."
SETTLEMENT_NOT_OWN_MESSAGE = (
    "Only a settlement you filed yourself can be cancelled. Termination and HR-opened settlements are decided by HR."
)
DIRECT_CANCEL_NOTE = "Cancelled directly by HR."
SETTLEMENT_PAYOUT_UNVERIFIED_MESSAGE = (
    "An approved annual leave settlement cannot be cancelled by request because its payout cannot be verified yet. "
    "Contact HR."
)
LOAN_DISBURSED_MESSAGE = "This loan has already been disbursed, so it can no longer be cancelled."
LOAN_NOT_AWAITING_DISBURSEMENT_MESSAGE = (
    "Only a loan that is approved and waiting for disbursement can be cancelled through a cancellation request."
)
OPEN_REQUEST_EXISTS_MESSAGE = "A cancellation request for this request is already waiting for HR."
NO_PENDING_REQUEST_MESSAGE = "There is no pending cancellation request to withdraw."
ALREADY_DECIDED_MESSAGE = "This cancellation request is no longer pending."
TARGET_MISSING_MESSAGE = "The request this cancellation refers to no longer exists."
SELF_DECISION_MESSAGE = "Another HR member must decide a cancellation request for your own request."
DEFAULT_CONFIRM_NOTE = "Cancelled at the employee's request."

_ERROR_TITLES = {403: "Forbidden", 404: "Not found", 422: "Validation error"}


class CancellationRequestError(Exception):
    """A refused cancellation-request action, carrying its HTTP status and optional field."""

    def __init__(self, message: str, *, status: int = 422, field: str | None = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.field = field

    def to_response(self):
        if self.status == 404:
            return error("Not found", errors=["Not found."], status=404)
        if self.status == 422 and self.field:
            return error("Validation error", errors={self.field: [self.message]}, status=422)
        return error(_ERROR_TITLES.get(self.status, self.message), errors=[self.message], status=self.status)


def _module_error(exc) -> CancellationRequestError:
    """Translate a module transition error (they all carry ``message`` and ``status``)."""

    return CancellationRequestError(getattr(exc, "message", str(exc)), status=getattr(exc, "status", 422))


# ---------------------------------------------------------------------------
# Kinds
# ---------------------------------------------------------------------------


def _user_name(user) -> str:
    if user is None:
        return ""
    profile = getattr(user, "employee_profile", None)
    return getattr(profile, "full_name", "") or getattr(user, "full_name", "") or getattr(user, "email", "") or ""


def _profile_name(profile, fallback_user=None) -> str:
    return (
        getattr(profile, "full_name", "")
        or getattr(profile, "full_name_en", "")
        or _user_name(fallback_user)
        or getattr(profile, "employee_id", "")
        or ""
    )


# Leave -----------------------------------------------------------------------


def _leave_refusal(obj) -> str | None:
    from leaves.models import LeaveRequest

    if obj.source == LeaveRequest.RequestSource.HR_MANUAL:
        return LEAVE_MANUAL_MESSAGE
    if not obj.is_active or obj.status != LeaveRequest.RequestStatus.APPROVED:
        return NOT_APPROVED_MESSAGE
    if obj.end_date < timezone.localdate():
        return LEAVE_ENDED_MESSAGE
    return None


def _leave_confirm(locked, *, actor, note: str) -> None:
    from leaves.services import LeaveTransitionError, apply_hr_cancellation

    try:
        apply_hr_cancellation(locked, actor=actor, comment=note)
    except LeaveTransitionError as exc:
        raise _module_error(exc) from exc


def _leave_title(obj) -> str:
    leave_type = getattr(getattr(obj, "leave_type", None), "name", "") or "Leave"
    return f"{leave_type}: {obj.start_date} to {obj.end_date}"


def _leave_employee_name(obj) -> str:
    return _profile_name(getattr(obj, "employee_profile", None), obj.employee)


# Permission ------------------------------------------------------------------


def _permission_refusal(obj) -> str | None:
    from permission_requests.models import PermissionRequest

    if obj.status != PermissionRequest.Status.APPROVED:
        return NOT_APPROVED_MESSAGE
    if obj.request_date < timezone.localdate():
        return PERMISSION_PAST_MESSAGE
    return None


def _permission_confirm(locked, *, actor, note: str) -> None:
    from permission_requests.services import PermissionRequestError, apply_hr_cancellation

    try:
        apply_hr_cancellation(locked, actor=actor, note=note)
    except PermissionRequestError as exc:
        raise _module_error(exc) from exc


def _permission_title(obj) -> str:
    window = f" {obj.from_time:%H:%M}-{obj.to_time:%H:%M}" if obj.from_time and obj.to_time else ""
    return f"{obj.get_permission_type_display()}: {obj.request_date}{window}"


def _permission_employee_name(obj) -> str:
    return _profile_name(obj.employee_profile, obj.employee)


# Annual leave settlement -----------------------------------------------------


def _settlement_refusal(obj) -> str | None:
    from leaves.models import AnnualLeavePaymentRequest

    if obj.is_termination_settlement or obj.submitted_by_id is None or obj.submitted_by_id != obj.employee_id:
        return SETTLEMENT_NOT_OWN_MESSAGE
    if obj.status != AnnualLeavePaymentRequest.Status.APPROVED:
        return NOT_APPROVED_MESSAGE
    # ``settled_at`` is stamped by the CEO approval itself and no payroll run or payment
    # record links to a settlement, so an approved settlement cannot be told apart from a
    # paid one. Refuse until a payout link exists (owner decision); HR can still cancel
    # such a settlement outside this flow.
    return SETTLEMENT_PAYOUT_UNVERIFIED_MESSAGE


def _settlement_confirm(locked, *, actor, note: str) -> None:
    from leaves.annual_payment_services import apply_annual_payment_hr_cancellation
    from leaves.services import LeaveTransitionError

    try:
        apply_annual_payment_hr_cancellation(locked, actor=actor, note=note)
    except LeaveTransitionError as exc:
        raise _module_error(exc) from exc


def _settlement_title(obj) -> str:
    return f"Annual leave settlement: {obj.cycle_start} to {obj.cycle_end}"


def _settlement_employee_name(obj) -> str:
    return _profile_name(obj.employee_profile, obj.employee)


# Asset return / damage -------------------------------------------------------


def _asset_owner_id(obj):
    return getattr(obj.employee, "user_id", None)


def _asset_company_id(obj):
    return getattr(obj.asset, "company_id", None)


def _asset_employee_name(obj) -> str:
    return _profile_name(obj.employee, getattr(obj.employee, "user", None))


def _asset_return_refusal(obj) -> str | None:
    from assets.models import AssetReturnRequest

    if obj.status == AssetReturnRequest.RequestStatus.PROCESSED:
        return RETURN_PROCESSED_MESSAGE
    if obj.status != AssetReturnRequest.RequestStatus.APPROVED:
        return NOT_APPROVED_MESSAGE
    return None


def _asset_return_confirm(locked, *, actor, note: str) -> None:
    from assets.services.return_requests import AssetReturnTransitionError, apply_hr_cancellation

    try:
        apply_hr_cancellation(locked, actor=actor, note=note)
    except AssetReturnTransitionError as exc:
        raise _module_error(exc) from exc


def _asset_return_title(obj) -> str:
    return f"Asset return: {getattr(obj.asset, 'asset_code', '')}"


def _asset_damage_refusal(obj) -> str | None:
    from assets.models import AssetDamageReport

    if obj.status != AssetDamageReport.RequestStatus.APPROVED:
        return NOT_APPROVED_MESSAGE
    return None


def _asset_damage_confirm(locked, *, actor, note: str) -> None:
    from assets.services.damage_reports import AssetDamageTransitionError, apply_hr_cancellation

    try:
        apply_hr_cancellation(locked, actor=actor, note=note)
    except AssetDamageTransitionError as exc:
        raise _module_error(exc) from exc


def _asset_damage_title(obj) -> str:
    return f"Asset damage report: {getattr(obj.asset, 'asset_code', '')}"


# Loan ------------------------------------------------------------------------


def _loan_refusal(obj) -> str | None:
    from loans.models import LoanRequest

    status = LoanRequest.RequestStatus
    if obj.status in {status.APPROVED, status.DEDUCTED} or obj.deduction_payroll_run_id:
        return LOAN_DISBURSED_MESSAGE
    if not obj.is_active or obj.status != status.PENDING_DISBURSEMENT:
        return LOAN_NOT_AWAITING_DISBURSEMENT_MESSAGE
    return None


def _loan_confirm(locked, *, actor, note: str) -> None:
    from loans.services import LoanTransitionError, apply_hr_cancellation

    try:
        apply_hr_cancellation(locked, actor=actor, note=note)
    except LoanTransitionError as exc:
        raise _module_error(exc) from exc


def _loan_title(obj) -> str:
    return f"Loan: {obj.approved_amount or obj.requested_amount}"


def _loan_employee_name(obj) -> str:
    return _profile_name(obj.employee_profile, obj.employee)


@dataclass(frozen=True)
class CancellationKind:
    key: str
    model_label: str
    #: English request type, localized by ``in_app_notifications.i18n.request_type_label``.
    request_type: str
    notification_category: str
    owner_id: Callable[[Any], int | None]
    company_id: Callable[[Any], int | None]
    #: Why the request cannot be cancelled now (state only), or ``None``.
    refusal: Callable[[Any], str | None]
    #: The module's HR cancel; runs inside the caller's transaction on the locked row.
    confirm: Callable[..., None]
    title: Callable[[Any], str]
    employee_name: Callable[[Any], str]
    hr_path: str
    employee_path: str
    #: Permission requests keep the employee's free-text reason out of workflow history.
    reason_in_history: bool = True

    @property
    def model(self):
        return apps.get_model(self.model_label)


def _employee_user_id(obj):
    return obj.employee_id


def _company_id(obj):
    return obj.company_id


KINDS: dict[str, CancellationKind] = {
    kind.key: kind
    for kind in (
        CancellationKind(
            key="leave",
            model_label="leaves.LeaveRequest",
            request_type="Leave Request",
            notification_category="leave",
            owner_id=_employee_user_id,
            company_id=_company_id,
            refusal=_leave_refusal,
            confirm=_leave_confirm,
            title=_leave_title,
            employee_name=_leave_employee_name,
            hr_path="/hr/leave/requests/{id}",
            employee_path="/employee/leave/requests/{id}",
        ),
        CancellationKind(
            key="permission",
            model_label="permission_requests.PermissionRequest",
            request_type="Permission Request",
            notification_category="request",
            owner_id=_employee_user_id,
            company_id=_company_id,
            refusal=_permission_refusal,
            confirm=_permission_confirm,
            title=_permission_title,
            employee_name=_permission_employee_name,
            hr_path="/hr/permission-requests/{id}",
            employee_path="/employee/permission-requests/{id}",
            reason_in_history=False,
        ),
        CancellationKind(
            key="annual_leave_payment",
            model_label="leaves.AnnualLeavePaymentRequest",
            request_type="Annual Leave Settlement",
            notification_category="leave",
            owner_id=_employee_user_id,
            company_id=_company_id,
            refusal=_settlement_refusal,
            confirm=_settlement_confirm,
            title=_settlement_title,
            employee_name=_settlement_employee_name,
            hr_path="/hr/annual-leave-payments/{id}",
            employee_path="/employee/leave/requests",
        ),
        CancellationKind(
            key="asset_return",
            model_label="assets.AssetReturnRequest",
            request_type="Asset Return Request",
            notification_category="asset",
            owner_id=_asset_owner_id,
            company_id=_asset_company_id,
            refusal=_asset_return_refusal,
            confirm=_asset_return_confirm,
            title=_asset_return_title,
            employee_name=_asset_employee_name,
            hr_path="/hr/assets",
            employee_path="/employee/assets",
        ),
        CancellationKind(
            key="asset_damage",
            model_label="assets.AssetDamageReport",
            request_type="Asset Damage Report",
            notification_category="asset",
            owner_id=_asset_owner_id,
            company_id=_asset_company_id,
            refusal=_asset_damage_refusal,
            confirm=_asset_damage_confirm,
            title=_asset_damage_title,
            employee_name=_asset_employee_name,
            hr_path="/hr/assets",
            employee_path="/employee/assets",
        ),
        CancellationKind(
            key="loan",
            model_label="loans.LoanRequest",
            request_type="Loan Request",
            notification_category="loan",
            owner_id=_employee_user_id,
            company_id=_company_id,
            refusal=_loan_refusal,
            confirm=_loan_confirm,
            title=_loan_title,
            employee_name=_loan_employee_name,
            hr_path="/hr/loan-requests/{id}",
            employee_path="/employee/loans/{id}",
        ),
    )
}

_KIND_BY_MODEL = {kind.model_label.split(".")[1]: kind for kind in KINDS.values()}


def kind_for(instance) -> CancellationKind | None:
    return _KIND_BY_MODEL.get(instance.__class__.__name__)


def _require_kind(instance) -> CancellationKind:
    kind = kind_for(instance)
    if kind is None:
        raise ValueError(f"{instance.__class__.__name__} does not support cancellation requests.")
    return kind


def _lock_target(kind: CancellationKind, object_id):
    return kind.model.objects.select_for_update(of=("self",)).filter(pk=object_id).first()


def _target_filter(instance) -> Q:
    content_type = ContentType.objects.get_for_model(instance.__class__)
    return Q(content_type=content_type, object_id=instance.pk)


# ---------------------------------------------------------------------------
# Snapshot (``workflow.can_request_cancellation`` and friends)
# ---------------------------------------------------------------------------

UNSET = object()

EMPTY_SNAPSHOT = {
    "can_request_cancellation": False,
    "can_withdraw_cancellation_request": False,
    "cancellation_request": None,
}


def latest_cancellation_request(instance) -> CancellationRequest | None:
    return (
        CancellationRequest.objects.select_related("decided_by", "decided_by__employee_profile")
        .filter(_target_filter(instance))
        .order_by("-requested_at", "-id")
        .first()
    )


def latest_cancellation_requests(instances) -> dict[tuple[int, int], CancellationRequest]:
    """The latest cancellation request per instance, keyed by ``(content_type_id, pk)``, in one query per model."""

    grouped: dict[int, list[int]] = {}
    for instance in instances:
        if kind_for(instance) is None:
            continue
        content_type = ContentType.objects.get_for_model(instance.__class__)
        grouped.setdefault(content_type.id, []).append(instance.pk)
    latest: dict[tuple[int, int], CancellationRequest] = {}
    for content_type_id, object_ids in grouped.items():
        rows = CancellationRequest.objects.filter(content_type_id=content_type_id, object_id__in=object_ids).order_by(
            "object_id", "-requested_at", "-id"
        )
        for row in rows:
            latest.setdefault((content_type_id, row.object_id), row)
    # Deciders are loaded only when some row has one, so lists without decisions never touch the user table.
    decided = [row for row in latest.values() if row.decided_by_id]
    if decided:
        prefetch_related_objects(decided, "decided_by__employee_profile")
    return latest


def serialize_cancellation_request(row: CancellationRequest | None) -> dict | None:
    if row is None:
        return None
    return {
        "id": row.pk,
        "status": row.status,
        "reason": row.reason,
        "requested_at": row.requested_at,
        "decided_at": row.decided_at,
        "decided_by_name": _user_name(row.decided_by) if row.decided_by_id else None,
        "decision_note": row.decision_note,
    }


def cancellation_snapshot(instance, actor, *, latest=UNSET) -> dict:
    """``can_request_cancellation``, ``can_withdraw_cancellation_request`` and the latest ``cancellation_request``.

    The flags are true only for the request's owner; the services enforce the same rules.
    """

    kind = kind_for(instance)
    if kind is None or not getattr(instance, "pk", None):
        return dict(EMPTY_SNAPSHOT)
    if latest is UNSET:
        latest = latest_cancellation_request(instance)
    is_owner = bool(actor and actor.is_authenticated and kind.owner_id(instance) == actor.pk)
    pending = latest is not None and latest.status == Status.PENDING
    return {
        "can_request_cancellation": bool(is_owner and not pending and kind.refusal(instance) is None),
        "can_withdraw_cancellation_request": bool(is_owner and pending and latest.requested_by_id == actor.pk),
        "cancellation_request": serialize_cancellation_request(latest),
    }


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CancellationOutcome:
    request: CancellationRequest
    kind: CancellationKind
    target: Any
    from_status: str


def clean_reason(value) -> str:
    if value is None or (isinstance(value, str) and not value.strip()):
        raise CancellationRequestError(REASON_REQUIRED_MESSAGE, field="reason")
    if not isinstance(value, str):
        raise CancellationRequestError(REASON_REQUIRED_MESSAGE, field="reason")
    reason = value.strip()
    if len(reason) < REASON_MIN_LENGTH:
        raise CancellationRequestError(REASON_TOO_SHORT_MESSAGE, field="reason")
    if len(reason) > REASON_MAX_LENGTH:
        raise CancellationRequestError(REASON_TOO_LONG_MESSAGE, field="reason")
    return reason


def _clean_comment(value, *, required: bool) -> str:
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise CancellationRequestError(COMMENT_INVALID_MESSAGE, field="comment")
    comment = value.strip()
    if required and not comment:
        raise CancellationRequestError(COMMENT_REQUIRED_MESSAGE, field="comment")
    return comment


def request_cancellation(instance, *, actor, reason) -> CancellationOutcome:
    """The owner asks HR to cancel their approved request. 404 for anyone else."""

    kind = _require_kind(instance)
    reason = clean_reason(reason)
    if kind.owner_id(instance) != actor.pk:
        raise CancellationRequestError("Not found.", status=404)

    with transaction.atomic():
        locked = _lock_target(kind, instance.pk)
        if locked is None:
            raise CancellationRequestError("Not found.", status=404)
        refusal = kind.refusal(locked)
        if refusal:
            raise CancellationRequestError(refusal)
        if CancellationRequest.objects.filter(_target_filter(locked), status=Status.PENDING).exists():
            raise CancellationRequestError(OPEN_REQUEST_EXISTS_MESSAGE)

        start = begin_recorded_transition(locked, actor=actor)
        try:
            with transaction.atomic():
                row = CancellationRequest.objects.create(
                    content_type=ContentType.objects.get_for_model(locked.__class__),
                    object_id=locked.pk,
                    kind=kind.key,
                    company_id=kind.company_id(locked),
                    requested_by=actor,
                    reason=reason,
                )
        except IntegrityError as exc:
            raise CancellationRequestError(OPEN_REQUEST_EXISTS_MESSAGE) from exc
        record_workflow_transition(
            locked,
            start,
            action=Action.CANCELLATION_REQUESTED,
            actor=actor,
            note=reason if kind.reason_in_history else "",
            approver_role="",
            metadata={"cancellation_request_id": row.pk},
        )
    return CancellationOutcome(row, kind, locked, locked.status)


def withdraw_cancellation_request(instance, *, actor) -> CancellationOutcome:
    """The owner withdraws their own pending cancellation request; the request stays approved."""

    kind = _require_kind(instance)
    if kind.owner_id(instance) != actor.pk:
        raise CancellationRequestError("Not found.", status=404)

    with transaction.atomic():
        locked = _lock_target(kind, instance.pk)
        if locked is None:
            raise CancellationRequestError("Not found.", status=404)
        row = (
            CancellationRequest.objects.select_for_update()
            .filter(_target_filter(locked), status=Status.PENDING, requested_by=actor)
            .first()
        )
        if row is None:
            raise CancellationRequestError(NO_PENDING_REQUEST_MESSAGE)

        start = begin_recorded_transition(locked, actor=actor)
        row.status = Status.WITHDRAWN
        row.decided_by = actor
        row.decided_at = timezone.now()
        row.save(update_fields=["status", "decided_by", "decided_at", "updated_at"])
        record_workflow_transition(
            locked,
            start,
            action=Action.CANCELLATION_WITHDRAWN,
            actor=actor,
            approver_role="",
            metadata={"cancellation_request_id": row.pk},
        )
    return CancellationOutcome(row, kind, locked, locked.status)


def close_pending_after_direct_cancel(instance, *, actor, note: str = "") -> int:
    """Close an open cancellation request when HR cancels the request directly.

    The employee's wish has been met, so the row is marked confirmed with HR as the
    decider instead of being left pending (where confirm would only fail).
    """

    if kind_for(instance) is None:
        return 0
    return CancellationRequest.objects.filter(_target_filter(instance), status=Status.PENDING).update(
        status=Status.CONFIRMED,
        decided_by=actor,
        decided_at=timezone.now(),
        decision_note=(note or DIRECT_CANCEL_NOTE)[:1000],
        updated_at=timezone.now(),
    )


def is_self_decision(row: CancellationRequest, target, actor) -> bool:
    kind = KINDS.get(row.kind)
    owner_id = kind.owner_id(target) if (kind and target is not None) else None
    return actor.pk in {row.requested_by_id, owner_id}


def _lock_for_decision(row: CancellationRequest, actor):
    """Lock the request, then the cancellation request (the same order as the employee actions)."""

    kind = KINDS[row.kind]
    target = _lock_target(kind, row.object_id)
    locked_row = CancellationRequest.objects.select_for_update().get(pk=row.pk)
    if locked_row.status != Status.PENDING:
        raise CancellationRequestError(ALREADY_DECIDED_MESSAGE)
    if is_self_decision(locked_row, target, actor):
        raise CancellationRequestError(SELF_DECISION_MESSAGE, status=403)
    return kind, target, locked_row


def confirm_cancellation_request(row: CancellationRequest, *, actor, comment="") -> CancellationOutcome:
    """HR confirms: the module's HR cancel runs under the lock after eligibility is re-checked."""

    comment = _clean_comment(comment, required=False)
    with transaction.atomic():
        kind, target, locked_row = _lock_for_decision(row, actor)
        if target is None:
            raise CancellationRequestError(TARGET_MISSING_MESSAGE)
        refusal = kind.refusal(target)
        if refusal:
            raise CancellationRequestError(refusal)

        from_status = target.status
        kind.confirm(target, actor=actor, note=comment or DEFAULT_CONFIRM_NOTE)
        locked_row.status = Status.CONFIRMED
        locked_row.decided_by = actor
        locked_row.decided_at = timezone.now()
        locked_row.decision_note = comment
        locked_row.save(update_fields=["status", "decided_by", "decided_at", "decision_note", "updated_at"])
    target.refresh_from_db()
    return CancellationOutcome(locked_row, kind, target, from_status)


def decline_cancellation_request(row: CancellationRequest, *, actor, comment) -> CancellationOutcome:
    """HR declines: the request stays approved and the note is shown to the employee."""

    comment = _clean_comment(comment, required=True)
    with transaction.atomic():
        kind, target, locked_row = _lock_for_decision(row, actor)
        start = begin_recorded_transition(target, actor=actor) if target is not None else None
        locked_row.status = Status.DECLINED
        locked_row.decided_by = actor
        locked_row.decided_at = timezone.now()
        locked_row.decision_note = comment
        locked_row.save(update_fields=["status", "decided_by", "decided_at", "decision_note", "updated_at"])
        if start is not None:
            record_workflow_transition(
                target,
                start,
                action=Action.CANCELLATION_DECLINED,
                actor=actor,
                note=comment,
                approver_role="hr",
                metadata={"cancellation_request_id": locked_row.pk},
            )
    return CancellationOutcome(locked_row, kind, target, getattr(target, "status", ""))


# ---------------------------------------------------------------------------
# Audit and notifications
# ---------------------------------------------------------------------------


def audit_cancellation(request, action: str, outcome: CancellationOutcome) -> None:
    """Operational facts only; the free-text reason and HR note are never logged."""

    target = outcome.target
    audit(
        request,
        action,
        entity=outcome.kind.model_label.split(".")[1],
        entity_id=outcome.request.object_id,
        metadata={
            "cancellation_request_id": outcome.request.pk,
            "kind": outcome.kind.key,
            "target_id": outcome.request.object_id,
            "company_id": outcome.request.company_id,
            "from_status": outcome.from_status,
            "to_status": getattr(target, "status", None),
            "cancellation_status": outcome.request.status,
        },
    )


def hr_recipients(company_id, *, exclude_user_ids=()):
    """Active HR approvers (HRManager/SystemAdmin) authorized for ``company_id``."""

    from core.services.pending_approval_email import get_hr_approver_users

    users = get_hr_approver_users().filter(
        Q(employee_profile__company_id=company_id)
        | Q(organization_access_entries__organization_id=company_id)
        | Q(groups__name="SystemAdmin")
    )
    excluded = [user_id for user_id in exclude_user_ids if user_id]
    if excluded:
        users = users.exclude(pk__in=excluded)
    return users.distinct()


def _dispatch(event: str, row: CancellationRequest, send: Callable[[], None]) -> None:
    def run():
        try:
            with transaction.atomic():
                send()
        except Exception:
            logger.exception(
                "cancellation_request_notification_failed",
                extra={"event": event, "cancellation_request_id": row.pk, "kind": row.kind},
            )

    transaction.on_commit(run)


def notify_hr_of_cancellation_request(outcome: CancellationOutcome) -> None:
    """Tell the company's HR approvers (never the requester) that a cancellation request waits for them."""

    row, kind, target = outcome.request, outcome.kind, outcome.target

    def send():
        from in_app_notifications.dispatcher import dispatch_notification_channels
        from in_app_notifications.i18n import notification_text, request_type_label

        text = notification_text(
            "cancellation.requested",
            request_type=request_type_label(kind.request_type),
            employee_name=kind.employee_name(target),
            request_id=target.pk,
        )
        owner_id = kind.owner_id(target)
        for recipient in hr_recipients(row.company_id, exclude_user_ids=(row.requested_by_id, owner_id)):
            dispatch_notification_channels(
                recipient=recipient,
                event_key="cancellation.requested",
                **text,
                category=kind.notification_category,
                action_url=kind.hr_path.format(id=target.pk),
                related_object=target,
                company_id=row.company_id,
                metadata={"cancellation_request_id": row.pk, "kind": kind.key},
                deduplication_key=f"cancellation.requested:{row.pk}:{recipient.pk}",
                whatsapp_enabled=False,
            )

    _dispatch("requested", row, send)


def notify_employee_of_cancellation_decision(outcome: CancellationOutcome) -> None:
    """Tell the employee HR confirmed or declined their cancellation request (with HR's note)."""

    row, kind, target = outcome.request, outcome.kind, outcome.target
    if target is None or row.status not in {Status.CONFIRMED, Status.DECLINED}:
        return
    event_key = f"cancellation.{row.status}"

    def send():
        from in_app_notifications.dispatcher import dispatch_notification_channels
        from in_app_notifications.i18n import notification_text, request_type_label

        recipient = row.requested_by
        if recipient is None:
            return
        dispatch_notification_channels(
            recipient=recipient,
            event_key=event_key,
            **notification_text(
                event_key,
                request_type=request_type_label(kind.request_type),
                request_id=target.pk,
                note=row.decision_note or "-",
            ),
            category=kind.notification_category,
            action_url=kind.employee_path.format(id=target.pk),
            related_object=target,
            company_id=row.company_id,
            metadata={"cancellation_request_id": row.pk, "kind": kind.key},
            deduplication_key=f"{event_key}:{row.pk}",
            whatsapp_enabled=False,
        )

    _dispatch(row.status, row, send)


# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------


def request_cancellation_response(request, target, *, serialize):
    """``POST .../request-cancellation/`` for a request the view already scoped to the caller."""

    try:
        outcome = request_cancellation(target, actor=request.user, reason=request.data.get("reason"))
    except CancellationRequestError as exc:
        return exc.to_response()
    audit_cancellation(request, "cancellation_requested", outcome)
    notify_hr_of_cancellation_request(outcome)
    return success(serialize(outcome.target), message="Cancellation request sent to HR.", status=201)


def withdraw_cancellation_response(request, target, *, serialize):
    """``POST .../withdraw-cancellation-request/`` for a request the view already scoped to the caller."""

    try:
        outcome = withdraw_cancellation_request(target, actor=request.user)
    except CancellationRequestError as exc:
        return exc.to_response()
    audit_cancellation(request, "cancellation_withdrawn", outcome)
    return success(serialize(outcome.target), message="Cancellation request withdrawn.")


def inbox_item(row: CancellationRequest, actor=None) -> dict:
    """One HR inbox row; ``detail_path`` is the HR page of the request itself."""

    from core.services.request_references import public_reference_for

    kind = KINDS.get(row.kind)
    target = row.target
    item = {
        "id": row.pk,
        "kind": row.kind,
        "request_id": row.object_id,
        "reference_no": public_reference_for(target) if target is not None else None,
        "employee_name": kind.employee_name(target) if (kind and target is not None) else _user_name(row.requested_by),
        "request_title": kind.title(target) if (kind and target is not None) else "",
        "request_status": getattr(target, "status", None),
        "reason": row.reason,
        "status": row.status,
        "requested_at": row.requested_at,
        "decided_at": row.decided_at,
        "decided_by_name": _user_name(row.decided_by) if row.decided_by_id else None,
        "decision_note": row.decision_note,
        "detail_path": kind.hr_path.format(id=row.object_id) if kind else "",
        "can_decide": bool(
            actor is not None
            and row.status == Status.PENDING
            and target is not None
            and not is_self_decision(row, target, actor)
        ),
    }
    return item
