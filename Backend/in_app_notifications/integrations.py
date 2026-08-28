from __future__ import annotations

import logging

from django.contrib.auth import get_user_model
from django.db.models import Q

from .dispatcher import dispatch_notification_channels
from .models import Notification
from .services import create_notification, create_notifications

logger = logging.getLogger(__name__)


def _category_for_request_type(request_type: str) -> str:
    value = request_type.lower()
    for keyword, category in (
        ("leave", Notification.Category.LEAVE),
        ("loan", Notification.Category.LOAN),
        ("asset", Notification.Category.ASSET),
        ("attendance", Notification.Category.ATTENDANCE),
        ("payroll", Notification.Category.PAYROLL),
        ("document", Notification.Category.DOCUMENT),
    ):
        if keyword in value:
            return category
    return Notification.Category.REQUEST


def _company_for_request(request_type: str, request_id):
    """Resolve tenant ownership at the orchestration boundary without coupling domain models to notifications."""
    try:
        if request_type in {"Leave Request", "Manual Leave Record"}:
            from leaves.models import LeaveRequest

            return LeaveRequest.objects.filter(pk=request_id).values_list("company", flat=True).first()
        if request_type in {"Loan Request", "Loan Disbursement"}:
            from loans.models import LoanRequest

            return LoanRequest.objects.filter(pk=request_id).values_list("company", flat=True).first()
        if request_type == "Asset Damage Report":
            from assets.models import AssetDamageReport

            return AssetDamageReport.objects.filter(pk=request_id).values_list("asset__company", flat=True).first()
        if request_type == "Asset Return Request":
            from assets.models import AssetReturnRequest

            return AssetReturnRequest.objects.filter(pk=request_id).values_list("asset__company", flat=True).first()
        if request_type == "Attendance Request":
            from attendance.models import AttendanceRecord

            return (
                AttendanceRecord.objects.filter(pk=request_id)
                .values_list("employee_profile__company", flat=True)
                .first()
            )
        if request_type == "Attendance Correction":
            from attendance.models import AttendanceCorrectionRequest

            return (
                AttendanceCorrectionRequest.objects.filter(pk=request_id)
                .values_list("employee_profile__company", flat=True)
                .first()
            )
        if request_type in {"Employee Archive", "Employee Deletion"}:
            from employees.models import EmployeeDeletionRequest

            return EmployeeDeletionRequest.objects.filter(pk=request_id).values_list("company", flat=True).first()
        if request_type in {"Annual Leave Payment Request", "Annual Leave Settlement"}:
            from leaves.models import AnnualLeavePaymentRequest

            return AnnualLeavePaymentRequest.objects.filter(pk=request_id).values_list("company", flat=True).first()
    except Exception:
        logger.exception(
            "notification_company_resolution_failed",
            extra={"request_type": request_type, "request_id": str(request_id)},
        )
    return None


def _company_scoped_recipients(users, company_id):
    """Fail closed unless each recipient is authorized for the request company."""
    user_ids = [getattr(user, "pk", None) for user in users]
    user_ids = [user_id for user_id in user_ids if user_id]
    if not company_id or not user_ids:
        return []
    return list(
        get_user_model()
        .objects.filter(id__in=user_ids, is_active=True)
        .filter(
            Q(employee_profile__company_id=company_id)
            | Q(organization_access_entries__organization_id=company_id)
            | Q(groups__name="SystemAdmin")
        )
        .distinct()
    )


def safe_create_notification(**kwargs):
    try:
        return create_notification(**kwargs)
    except Exception:
        logger.exception(
            "in_app_notification_creation_failed",
            extra={"event_key": kwargs.get("event_key"), "recipient_id": getattr(kwargs.get("recipient"), "id", None)},
        )
        return None, False


def safe_create_notifications(*, recipients, **kwargs):
    try:
        return create_notifications(recipients=recipients, **kwargs)
    except Exception:
        logger.exception("in_app_notifications_creation_failed", extra={"event_key": kwargs.get("event_key")})
        return []


def notify_pending_approvers(
    *, users, request_type, request_id, requester_name, status_label, details=None, action_path=None
):
    users = list(users)
    company_id = _company_for_request(request_type, request_id) if any(getattr(user, "pk", None) for user in users) else None
    users = _company_scoped_recipients(users, company_id)
    from core.services.pending_approval_email import _build_action_url, send_pending_approval_email

    results = []
    for user in users:
        results.append(
            dispatch_notification_channels(
                recipient=user,
                company_id=company_id,
                event_key="approval.pending",
                title=f"{request_type} requires your review",
                message=f"{requester_name}'s request #{request_id} is {status_label}.",
                category=Notification.Category.APPROVAL,
                action_url=action_path or "",
                related_object_type=request_type.lower().replace(" ", "_"),
                related_object_id=request_id,
                metadata={"request_type": request_type, "status": status_label, "details": list(details or [])},
                deduplication_key=f"approval.pending:{request_type}:{request_id}:{status_label}",
                whatsapp_template="pending_approval",
                whatsapp_variables={
                    "approver_name": getattr(user, "full_name", "") or getattr(user, "email", "") or "there",
                    "request_type": request_type,
                    "request_id": request_id,
                    "requester_name": requester_name,
                    "status_label": status_label,
                    "details": [str(item) for item in (details or [])],
                    "action_url": _build_action_url(action_path) or "",
                },
                email_template=send_pending_approval_email,
                email_context={
                    "approver_name": getattr(user, "full_name", "") or getattr(user, "email", ""),
                    "request_type": request_type,
                    "request_id": request_id,
                    "requester_name": requester_name,
                    "status_label": status_label,
                    "details": details,
                    "action_path": action_path,
                },
            )
        )
    return results


def notify_request_status(
    *, profile, request_type, request_id, status_label, details=None, action_path=None, reason=None
):
    recipient = getattr(profile, "user", None)
    return dispatch_notification_channels(
        recipient=recipient,
        company=getattr(profile, "company", None),
        event_key="request.status_changed",
        title=f"{request_type} {status_label}",
        message=reason or f"Request #{request_id} is now {status_label}.",
        category=_category_for_request_type(request_type),
        action_url=action_path or "",
        related_object_type=request_type.lower().replace(" ", "_"),
        related_object_id=request_id,
        metadata={
            "request_type": request_type,
            "status": status_label,
            "details": list(details or []),
            "reason": reason or "",
        },
        deduplication_key=f"request.status:{request_type}:{request_id}:{status_label}",
        whatsapp_template="request_status_update",
        whatsapp_variables={
            "employee_name": getattr(profile, "full_name", "") or "there",
            "request_type": request_type,
            "request_id": request_id,
            "status_label": status_label,
            "reason": reason or "",
            "details": [str(item) for item in (details or [])],
            "action_url": action_path or "",
        },
    )


def notify_request_submitted_by_email(
    *,
    to_email,
    request_type,
    request_id,
    status_label,
    details=None,
    action_path=None,
    email_template=None,
    email_context=None,
):
    if not to_email:
        return None, False
    user = get_user_model().objects.filter(email__iexact=to_email, is_active=True).first()
    return dispatch_notification_channels(
        recipient=user,
        event_key="request.submitted",
        title=f"{request_type} submitted",
        message=f"Request #{request_id} was submitted and is {status_label}.",
        category=_category_for_request_type(request_type),
        action_url=action_path or "",
        related_object_type=request_type.lower().replace(" ", "_"),
        related_object_id=request_id,
        metadata={"request_type": request_type, "status": status_label, "details": list(details or [])},
        deduplication_key=f"request.submitted:{request_type}:{request_id}",
        email_template=email_template,
        email_context=email_context,
    )
