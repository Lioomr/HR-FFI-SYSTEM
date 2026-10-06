from __future__ import annotations

import logging

from django.contrib.auth import get_user_model
from django.db.models import Q

from .dispatcher import dispatch_notification_channels
from .i18n import notification_text, request_type_label
from .i18n import status_label as status_label_text
from .models import Notification
from .services import create_notification, create_notifications, notification_company_id_for_recipient

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
        if request_type in {"Permission Request", "Exit Permission", "Late Permission", "During Shift Permission"}:
            from permission_requests.models import PermissionRequest

            return PermissionRequest.objects.filter(pk=request_id).values_list("company", flat=True).first()
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
        if request_type == "Profile Change Request":
            from employees.models import ProfileChangeRequest

            return ProfileChangeRequest.objects.filter(pk=request_id).values_list("company", flat=True).first()
        if request_type in {"Annual Leave Payment Request", "Annual Leave Settlement"}:
            from leaves.models import AnnualLeavePaymentRequest

            return AnnualLeavePaymentRequest.objects.filter(pk=request_id).values_list("company", flat=True).first()
    except Exception:
        logger.exception(
            "notification_company_resolution_failed",
            extra={"request_type": request_type, "request_id": str(request_id)},
        )
    return None


# Request types whose manager stage a manager from another company can decide,
# with the employee-profile path on the request row.
_EMPLOYEE_PROFILE_FOR_REQUEST = {
    "Leave Request": ("leaves.LeaveRequest", ("employee_profile_id", "employee__employee_profile__id")),
    "Loan Request": ("loans.LoanRequest", ("employee_profile_id",)),
    "Permission Request": ("permission_requests.PermissionRequest", ("employee_profile_id",)),
    "Exit Permission": ("permission_requests.PermissionRequest", ("employee_profile_id",)),
    "Late Permission": ("permission_requests.PermissionRequest", ("employee_profile_id",)),
    "During Shift Permission": ("permission_requests.PermissionRequest", ("employee_profile_id",)),
    "Asset Return Request": ("assets.AssetReturnRequest", ("employee_id",)),
    "Attendance Request": ("attendance.AttendanceRecord", ("employee_profile_id",)),
    "Attendance Correction": ("attendance.AttendanceCorrectionRequest", ("employee_profile_id",)),
}


def _cross_company_manager_user_ids(request_type: str, request_id) -> set[int]:
    """The requester's current manager from another company, when there is one."""
    config = _EMPLOYEE_PROFILE_FOR_REQUEST.get(request_type)
    if config is None:
        return set()
    from django.apps import apps

    from employees.services.manager_relationships import current_cross_company_assignments

    model_label, fields = config
    try:
        row = apps.get_model(model_label).objects.filter(pk=request_id).values_list(*fields).first()
    except Exception:
        logger.exception(
            "notification_manager_resolution_failed",
            extra={"request_type": request_type, "request_id": str(request_id)},
        )
        return set()
    profile_id = next((value for value in (row or ()) if value), None)
    if profile_id is None:
        return set()
    return set(
        current_cross_company_assignments()
        .filter(employee_id=profile_id, manager_profile__user__is_active=True)
        .values_list("manager_profile__user_id", flat=True)
    )


def _company_scoped_recipients(users, company_id, *, request_type: str = "", request_id=None):
    """Fail closed unless each recipient is authorized for the request company.

    The requester's own manager from another company is also authorized: they
    decide the manager stage without access to the requester's company.
    """
    user_ids = [getattr(user, "pk", None) for user in users]
    user_ids = [user_id for user_id in user_ids if user_id]
    if not company_id or not user_ids:
        return []
    authorized = (
        Q(employee_profile__company_id=company_id)
        | Q(organization_access_entries__organization_id=company_id)
        | Q(groups__name="SystemAdmin")
    )
    if request_type and request_id is not None:
        manager_ids = _cross_company_manager_user_ids(request_type, request_id) & set(user_ids)
        if manager_ids:
            authorized |= Q(id__in=manager_ids)
    return list(get_user_model().objects.filter(id__in=user_ids, is_active=True).filter(authorized).distinct())


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
    users = _company_scoped_recipients(users, company_id, request_type=request_type, request_id=request_id)
    from core.services.pending_approval_email import _build_action_url, send_pending_approval_email

    # Workflows often pass the raw status code; people only ever see the labels.
    status = status_label_text(status_label)
    request_type_text = request_type_label(request_type)
    text = notification_text(
        "approval.pending",
        request_type=request_type_text,
        requester_name=requester_name,
        request_id=request_id,
        status=status,
    )

    results = []
    for user in users:
        results.append(
            dispatch_notification_channels(
                recipient=user,
                # A manager from another company opens the request from their own company.
                company_id=notification_company_id_for_recipient(user, company_id),
                event_key="approval.pending",
                title=text["title"],
                message=text["message"],
                i18n=text["i18n"],
                category=Notification.Category.APPROVAL,
                action_url=action_path or "",
                related_object_type=request_type.lower().replace(" ", "_"),
                related_object_id=request_id,
                metadata={"request_type": request_type, "status": status_label, "details": list(details or [])},
                # Keyed on the value the workflow passed so existing rows still dedupe.
                deduplication_key=f"approval.pending:{request_type}:{request_id}:{status_label}",
                whatsapp_template="pending_approval",
                whatsapp_variables={
                    "approver_name": getattr(user, "full_name", "") or getattr(user, "email", "") or "there",
                    "request_type": request_type,
                    "request_type_ar": request_type_text["ar"],
                    "request_id": request_id,
                    "requester_name": requester_name,
                    "status_label": status["en"],
                    "status_label_ar": status["ar"],
                    "details": [str(item) for item in (details or [])],
                    "action_url": _build_action_url(action_path) or "",
                },
                email_template=send_pending_approval_email,
                email_context={
                    "approver_name": getattr(user, "full_name", "") or getattr(user, "email", ""),
                    "request_type": request_type,
                    "request_type_ar": request_type_text["ar"],
                    "request_id": request_id,
                    "requester_name": requester_name,
                    "status_label": status["en"],
                    "status_label_ar": status["ar"],
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
    status = status_label_text(status_label)
    request_type_text = request_type_label(request_type)
    if reason:
        text = notification_text(
            "request.status_changed_reason", request_type=request_type_text, status=status, reason=reason
        )
    else:
        text = notification_text(
            "request.status_changed", request_type=request_type_text, status=status, request_id=request_id
        )
    return dispatch_notification_channels(
        recipient=recipient,
        company=getattr(profile, "company", None),
        event_key="request.status_changed",
        title=text["title"],
        message=text["message"],
        i18n=text["i18n"],
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
            "request_type_ar": request_type_text["ar"],
            "request_id": request_id,
            "status_label": status["en"],
            "status_label_ar": status["ar"],
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
    text = notification_text(
        "request.submitted",
        request_type=request_type_label(request_type),
        request_id=request_id,
        status=status_label_text(status_label),
    )
    return dispatch_notification_channels(
        recipient=user,
        event_key="request.submitted",
        title=text["title"],
        message=text["message"],
        i18n=text["i18n"],
        category=_category_for_request_type(request_type),
        action_url=action_path or "",
        related_object_type=request_type.lower().replace(" ", "_"),
        related_object_id=request_id,
        metadata={"request_type": request_type, "status": status_label, "details": list(details or [])},
        deduplication_key=f"request.submitted:{request_type}:{request_id}",
        email_template=email_template,
        email_context=email_context,
    )
