import logging

from django.conf import settings

from core.services.bird_email_service import (
    send_delegation_notification_email,
    send_leave_approved_email,
    send_leave_rejected_email,
    send_leave_request_submitted_email,
)
from core.services.whatsapp_service import WhatsAppService
from in_app_notifications.dispatcher import dispatch_notification_channels
from in_app_notifications.models import Notification
from leaves.models import LeaveRequest
from leaves.utils import get_leave_days

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _employee_name(user) -> str:
    return getattr(user, "full_name", "") or getattr(user, "email", "") or "Employee"


def _employee_phone(user) -> str:
    profile = getattr(user, "employee_profile", None)
    return getattr(profile, "mobile", "") if profile else ""


def _employee_email(user) -> str:
    return getattr(user, "email", "") or ""


def _frontend_url() -> str:
    return getattr(settings, "FRONTEND_URL", "").rstrip("/")


def _send_whatsapp_template(
    *,
    phone_number: str,
    template_name: str,
    variables: dict,
    language: str = "en",
) -> dict:
    result = WhatsAppService().send_template_message(
        phone_number=phone_number,
        template_name=template_name,
        template_variables=variables,
        language=language,
    )
    if result.get("success"):
        return {
            "sent": True,
            "provider": result.get("provider", "evolution_whatsapp"),
            "status_code": result.get("status_code"),
            "template_key": template_name,
        }
    return {
        "sent": False,
        "provider": result.get("provider", "evolution_whatsapp"),
        "status_code": result.get("status_code"),
        "reason": result.get("error"),
        "template_key": template_name,
    }


def _notify_user(
    *, user, email_template, email_context, whatsapp_template, whatsapp_variables, **notification_kwargs
) -> dict:
    return dispatch_notification_channels(
        recipient=user,
        whatsapp_template=whatsapp_template,
        whatsapp_variables=whatsapp_variables,
        email_template=email_template,
        email_context=email_context,
        **notification_kwargs,
    )


# ---------------------------------------------------------------------------
# Unified notification functions (email-first, WhatsApp fallback)
# ---------------------------------------------------------------------------


def notify_leave_submitted(leave_request: LeaveRequest) -> None:
    """Notify manager and employee when a leave request is submitted."""
    employee = leave_request.employee
    if not employee:
        return

    profile = getattr(employee, "employee_profile", None)
    manager_profile = getattr(profile, "manager_profile", None)
    manager = getattr(manager_profile, "user", None) or getattr(profile, "manager", None)

    days = get_leave_days(leave_request.start_date, leave_request.end_date)
    base_url = _frontend_url()

    # — Notify manager —
    if manager:
        manager_notification = {
            "event_key": "leave.submitted",
            "title": "Leave request requires your review",
            "message": f"{_employee_name(employee)} submitted leave request #{leave_request.id}.",
            "category": Notification.Category.LEAVE,
            "action_url": f"/manager/leave/requests/{leave_request.id}",
            "related_object": leave_request,
            "deduplication_key": f"leave.submitted.manager:{leave_request.id}",
        }

        def _manager_whatsapp():
            return _send_whatsapp_template(
                phone_number=_employee_phone(manager),
                template_name="leave_request_submitted_v1",
                language="en",
                variables={
                    "manager_name": _employee_name(manager),
                    "employee_name": _employee_name(employee),
                    "leave_type": leave_request.leave_type.name,
                    "start_date": leave_request.start_date.isoformat(),
                    "end_date": leave_request.end_date.isoformat(),
                    "total_days": days,
                },
            )

        _notify_user(
            user=manager,
            email_template=send_leave_request_submitted_email,
            email_context={
                "employee_name": _employee_name(employee),
                "leave_type": leave_request.leave_type.name,
                "start_date": leave_request.start_date.isoformat(),
                "end_date": leave_request.end_date.isoformat(),
                "total_days": days,
                "manager_name": _employee_name(manager),
                "action_url": f"{base_url}/manager/leave/requests/{leave_request.id}",
            },
            whatsapp_template="leave_request_submitted_v1",
            whatsapp_variables={
                "manager_name": _employee_name(manager),
                "employee_name": _employee_name(employee),
                "leave_type": leave_request.leave_type.name,
                "start_date": leave_request.start_date.isoformat(),
                "end_date": leave_request.end_date.isoformat(),
                "total_days": days,
            },
            **manager_notification,
        )

    # — Notify employee (confirmation) —
    employee_notification = {
        "event_key": "leave.submitted",
        "title": "Leave request submitted",
        "message": f"Your leave request #{leave_request.id} was submitted.",
        "category": Notification.Category.LEAVE,
        "action_url": "/employee/leave/requests",
        "related_object": leave_request,
        "deduplication_key": f"leave.submitted.employee:{leave_request.id}",
    }

    def _employee_whatsapp():
        return _send_whatsapp_template(
            phone_number=_employee_phone(employee),
            template_name="leave_request_submitted_v1",
            language="en",
            variables={
                "manager_name": _employee_name(employee),
                "employee_name": _employee_name(employee),
                "leave_type": leave_request.leave_type.name,
                "start_date": leave_request.start_date.isoformat(),
                "end_date": leave_request.end_date.isoformat(),
                "total_days": days,
            },
        )

    _notify_user(
        user=employee,
        email_template=send_leave_request_submitted_email,
        email_context={
            "employee_name": _employee_name(employee),
            "leave_type": leave_request.leave_type.name,
            "start_date": leave_request.start_date.isoformat(),
            "end_date": leave_request.end_date.isoformat(),
            "total_days": days,
            "action_url": f"{base_url}/employee/leave/requests",
        },
        whatsapp_template="leave_request_submitted_v1",
        whatsapp_variables={
            "manager_name": _employee_name(employee),
            "employee_name": _employee_name(employee),
            "leave_type": leave_request.leave_type.name,
            "start_date": leave_request.start_date.isoformat(),
            "end_date": leave_request.end_date.isoformat(),
            "total_days": days,
        },
        **employee_notification,
    )


def notify_leave_approved(leave_request: LeaveRequest) -> dict:
    """Notify the employee when their leave is approved."""
    employee = leave_request.employee
    if not employee:
        return {}

    notification_kwargs = {
        "event_key": "leave.approved",
        "title": "Leave request approved",
        "message": f"Your leave request #{leave_request.id} was approved.",
        "category": Notification.Category.LEAVE,
        "action_url": "/employee/leave/requests",
        "related_object": leave_request,
        "deduplication_key": f"leave.approved:{leave_request.id}",
    }
    days = get_leave_days(leave_request.start_date, leave_request.end_date)
    base_url = _frontend_url()

    def _whatsapp():
        return _send_whatsapp_template(
            phone_number=_employee_phone(employee),
            template_name="leave_request_approved_v1",
            language="en",
            variables={
                "employee_name": _employee_name(employee),
                "leave_type": leave_request.leave_type.name,
                "start_date": leave_request.start_date.isoformat(),
                "end_date": leave_request.end_date.isoformat(),
                "total_days": days,
            },
        )

    return _notify_user(
        user=employee,
        email_template=send_leave_approved_email,
        email_context={
            "employee_name": _employee_name(employee),
            "leave_type": leave_request.leave_type.name,
            "start_date": leave_request.start_date.isoformat(),
            "end_date": leave_request.end_date.isoformat(),
            "total_days": days,
            "action_url": f"{base_url}/employee/leave/requests",
        },
        whatsapp_template="leave_request_approved_v1",
        whatsapp_variables={
            "employee_name": _employee_name(employee),
            "leave_type": leave_request.leave_type.name,
            "start_date": leave_request.start_date.isoformat(),
            "end_date": leave_request.end_date.isoformat(),
            "total_days": days,
        },
        **notification_kwargs,
    )


def notify_leave_rejected(leave_request: LeaveRequest, rejection_reason: str) -> dict:
    """Notify the employee when their leave is rejected."""
    employee = leave_request.employee
    if not employee:
        return {}

    reason = rejection_reason or "Not specified"
    notification_kwargs = {
        "event_key": "leave.rejected",
        "title": "Leave request rejected",
        "message": reason,
        "category": Notification.Category.LEAVE,
        "action_url": "/employee/leave/requests",
        "related_object": leave_request,
        "metadata": {"reason": reason},
        "deduplication_key": f"leave.rejected:{leave_request.id}",
    }
    base_url = _frontend_url()

    def _whatsapp():
        return _send_whatsapp_template(
            phone_number=_employee_phone(employee),
            template_name="leave_request_rejected_v1",
            language="en",
            variables={
                "employee_name": _employee_name(employee),
                "leave_type": leave_request.leave_type.name,
                "start_date": leave_request.start_date.isoformat(),
                "end_date": leave_request.end_date.isoformat(),
                "rejection_reason": reason,
            },
        )

    return _notify_user(
        user=employee,
        email_template=send_leave_rejected_email,
        email_context={
            "employee_name": _employee_name(employee),
            "leave_type": leave_request.leave_type.name,
            "start_date": leave_request.start_date.isoformat(),
            "end_date": leave_request.end_date.isoformat(),
            "rejection_reason": reason,
            "action_url": f"{base_url}/employee/leave/requests",
        },
        whatsapp_template="leave_request_rejected_v1",
        whatsapp_variables={
            "employee_name": _employee_name(employee),
            "leave_type": leave_request.leave_type.name,
            "start_date": leave_request.start_date.isoformat(),
            "end_date": leave_request.end_date.isoformat(),
            "rejection_reason": reason,
        },
        **notification_kwargs,
    )


def notify_delegation_assigned(leave_request: LeaveRequest) -> dict:
    """Notify the delegated employee when they are assigned as delegate."""
    if not leave_request.delegated_to:
        return {"sent": False, "reason": "No delegated user set."}

    delegate = leave_request.delegated_to
    employee = leave_request.employee
    employee_name = _employee_name(employee) if employee else "An employee"
    base_url = _frontend_url()
    notification_kwargs = {
        "event_key": "leave.delegation_assigned",
        "title": "Leave delegation assigned",
        "message": f"You were assigned as delegate for {employee_name}.",
        "category": Notification.Category.DELEGATION,
        "action_url": f"/employee/leave/requests/{leave_request.id}",
        "related_object": leave_request,
        "deduplication_key": f"leave.delegation:{leave_request.id}:{delegate.id}",
    }

    def _whatsapp():
        phone = _employee_phone(delegate)
        if not phone:
            return {"sent": False, "reason": "Delegated user has no phone number."}
        return _send_whatsapp_template(
            phone_number=phone,
            template_name="leave_delegation_assigned_v1",
            language="en",
            variables={
                "delegate_name": _employee_name(delegate),
                "employee_name": employee_name,
                "leave_type": leave_request.leave_type.name,
                "start_date": leave_request.start_date.isoformat(),
                "end_date": leave_request.end_date.isoformat(),
                "total_days": get_leave_days(leave_request.start_date, leave_request.end_date),
            },
        )

    return _notify_user(
        user=delegate,
        email_template=send_delegation_notification_email,
        email_context={
            "recipient_name": _employee_name(delegate),
            "from_user_name": employee_name,
            "to_user_name": _employee_name(delegate),
            "start_at": leave_request.start_date.isoformat(),
            "end_at": leave_request.end_date.isoformat(),
            "reason": leave_request.delegation_note or None,
            "recipient_role": "delegate",
            "action_url": f"{base_url}/employee/leave/requests/{leave_request.id}",
        },
        whatsapp_template="leave_delegation_assigned_v1",
        whatsapp_variables={
            "delegate_name": _employee_name(delegate),
            "employee_name": employee_name,
            "leave_type": leave_request.leave_type.name,
            "start_date": leave_request.start_date.isoformat(),
            "end_date": leave_request.end_date.isoformat(),
            "total_days": get_leave_days(leave_request.start_date, leave_request.end_date),
        },
        **notification_kwargs,
    )


# ---------------------------------------------------------------------------
# Legacy aliases kept for any external callers
# ---------------------------------------------------------------------------


def send_leave_request_submitted_whatsapp(leave_request: LeaveRequest, language: str = "en") -> dict:
    notify_leave_submitted(leave_request)
    return {}


def send_leave_request_approved_whatsapp(leave_request: LeaveRequest, language: str = "en") -> dict:
    return notify_leave_approved(leave_request)


def send_leave_request_rejected_whatsapp(
    leave_request: LeaveRequest, rejection_reason: str, language: str = "en"
) -> dict:
    return notify_leave_rejected(leave_request, rejection_reason)


def send_delegation_assigned_whatsapp(leave_request: LeaveRequest, language: str = "en") -> dict:
    return notify_delegation_assigned(leave_request)
