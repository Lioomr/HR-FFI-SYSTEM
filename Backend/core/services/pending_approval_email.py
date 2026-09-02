from __future__ import annotations

import logging
from typing import Iterable

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db.models import Q
from django.template.loader import render_to_string

from core.permissions import CEO_APPROVER_DEPARTMENT_ID
from employees.models import EmployeeProfile

from .bird_email_service import _resolve_logo_source
from .email_service import EmailService

logger = logging.getLogger(__name__)
User = get_user_model()


def _build_action_url(action_path: str | None) -> str | None:
    if not action_path:
        return None
    base = (getattr(settings, "FRONTEND_URL", "") or "").rstrip("/")
    if not base:
        return None
    path = action_path if action_path.startswith("/") else f"/{action_path}"
    return f"{base}{path}"


def _active_users_in_groups(group_names: list[str]):
    return User.objects.filter(is_active=True, groups__name__in=group_names).exclude(email="").distinct()


def _active_profile_users_by_position(position_ref_id: int):
    return User.objects.filter(
        is_active=True,
        employee_profile__employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        employee_profile__position_ref_id=position_ref_id,
    ).exclude(email="").distinct()


def _active_profile_users_by_department(department_ref_id: int):
    return User.objects.filter(
        is_active=True,
        employee_profile__employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        employee_profile__department_ref_id=department_ref_id,
    ).exclude(email="").distinct()


def get_direct_manager_user(employee_user):
    profile = getattr(employee_user, "employee_profile", None)
    from employees.services.manager_relationships import get_valid_direct_manager_user

    manager = get_valid_direct_manager_user(profile)
    return manager if manager and getattr(manager, "email", "") else None


def get_hr_approver_users():
    return _active_users_in_groups(["HRManager", "SystemAdmin"])


def get_cfo_approver_users():
    from loans.permissions import get_active_workflow_config

    config = get_active_workflow_config()
    return (
        _active_users_in_groups(["CFO", "SystemAdmin"]) | _active_profile_users_by_position(config.cfo_position_id)
    ).distinct()


def get_ceo_approver_users():
    # Keep this as one queryset. Combining querysets where one side has a
    # DISTINCT clause and the other does not can raise Django's "Cannot
    # combine a unique query with a non-unique query" TypeError.
    return (
        User.objects.filter(is_active=True)
        .exclude(email="")
        .filter(
            Q(groups__name__in=["CEO", "SystemAdmin"])
            | Q(
                employee_profile__employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
                employee_profile__department_ref_id=CEO_APPROVER_DEPARTMENT_ID,
            )
        )
        .distinct()
    )


def get_disbursement_approver_users():
    from loans.permissions import get_active_workflow_config

    config = get_active_workflow_config()
    return User.objects.filter(
        is_active=True,
        email__isnull=False,
        employee_profile__employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        employee_profile__department_ref_id=config.finance_department_id,
        employee_profile__position_ref_id=config.finance_position_id,
    ).exclude(email="") | _active_users_in_groups(["SystemAdmin"])


def send_pending_approval_email(
    *,
    to_email: str,
    approver_name: str,
    request_type: str,
    request_id: int | str,
    requester_name: str,
    status_label: str,
    details: Iterable[str] | None = None,
    action_path: str | None = None,
) -> dict:
    action_url = _build_action_url(action_path)
    subject = f"{request_type} pending approval - #{request_id}"

    message = f"A new {request_type} request from {requester_name} (#{request_id}) is pending your review."
    message_ar = f"طلب {request_type} جديد من {requester_name} (رقم {request_id}) بانتظار مراجعتك."
    rows = [
        {"label": "Request ID", "label_ar": "رقم الطلب", "value": f"#{request_id}"},
        {"label": "Requested by", "label_ar": "مقدّم الطلب", "value": requester_name},
        {"label": "Status", "label_ar": "الحالة", "value": status_label},
    ]
    for item in details or []:
        rows.append({"label": "Detail", "label_ar": "تفصيل", "value": str(item)})
    context = {
        "logo_url": _resolve_logo_source(),
        "contact_email": getattr(settings, "EMAIL_CONTACT_EMAIL", "hr@fficontracting.com"),
        "contact_name": getattr(settings, "EMAIL_CONTACT_NAME", "") or "",
        "contact_phone": getattr(settings, "EMAIL_CONTACT_PHONE", "") or "",
        "title": f"{request_type} requires your review",
        "title_ar": f"طلب {request_type} يتطلب مراجعتك",
        "employee_name": approver_name,
        "message": message,
        "message_ar": message_ar,
        "preheader": message,
        "preheader_ar": message_ar,
        "rows": rows,
        "details_title": f"{request_type} details",
        "details_title_ar": "تفاصيل الطلب",
        "status_label": "Action required",
        "status_label_ar": "إجراء مطلوب",
        "status_color": "#C2410C",
        "action_url": action_url,
        "action_text": "Review Request",
        "action_text_ar": "مراجعة الطلب",
    }

    html = render_to_string("emails/generic_notification.html", context)
    details_list = [str(item) for item in (details or [])]
    details_text = "\n".join(f"- {item}" for item in details_list) if details_list else "-"

    text = (
        f"{request_type} requires your review.\n"
        f"Request ID: {request_id}\n"
        f"Requested by: {requester_name}\n"
        f"Status: {status_label}\n"
        f"{details_text}\n"
    )
    service = EmailService()
    return service.send_html_email(to_email=to_email, subject=subject, html_content=html, fallback_text=text)


def notify_users_for_pending_status(
    *,
    users,
    request_type: str,
    request_id: int | str,
    requester_name: str,
    status_label: str,
    details: Iterable[str] | None = None,
    action_path: str | None = None,
) -> dict:
    users = list(users)
    from in_app_notifications.integrations import notify_pending_approvers

    dispatches = notify_pending_approvers(
        users=users,
        request_type=request_type,
        request_id=request_id,
        requester_name=requester_name,
        status_label=status_label,
        details=details,
        action_path=action_path,
    )
    sent = 0
    failed = 0
    whatsapp_sent = 0
    whatsapp_failed = 0
    whatsapp_skipped = 0
    whatsapp_pending = 0
    errors: list[str] = []
    whatsapp_errors: list[str] = []
    for dispatched in dispatches:
        whatsapp = dispatched.get("whatsapp") or {}
        email = dispatched.get("email") or {}
        if whatsapp.get("status") == "sent":
            whatsapp_sent += 1
        elif whatsapp.get("status") == "skipped":
            whatsapp_skipped += 1
        elif whatsapp.get("status") == "pending":
            whatsapp_pending += 1
        elif whatsapp:
            whatsapp_failed += 1
            whatsapp_errors.append(whatsapp.get("error") or "WhatsApp delivery failed.")
        if email.get("status") == "sent":
            sent += 1
        elif email.get("status") == "failed":
            failed += 1
            errors.append(email.get("error") or "Email delivery failed.")

    logger.info(
        "pending_status_notified",
        extra={
            "request_type": request_type,
            "request_id": str(request_id),
            "sent": sent,
            "failed": failed,
            "whatsapp_sent": whatsapp_sent,
            "whatsapp_failed": whatsapp_failed,
            "whatsapp_skipped": whatsapp_skipped,
            "whatsapp_pending": whatsapp_pending,
        },
    )
    return {
        "sent": sent,
        "failed": failed,
        "errors": errors,
        "whatsapp_sent": whatsapp_sent,
        "whatsapp_failed": whatsapp_failed,
        "whatsapp_skipped": whatsapp_skipped,
        "whatsapp_pending": whatsapp_pending,
        "whatsapp_errors": whatsapp_errors,
    }
