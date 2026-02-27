from __future__ import annotations

import logging
from typing import Iterable

from django.conf import settings
from django.template.loader import render_to_string
from django.contrib.auth import get_user_model

from employees.models import EmployeeProfile

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
    ).exclude(email="")


def get_direct_manager_user(employee_user):
    profile = getattr(employee_user, "employee_profile", None)
    if not profile:
        return None
    manager = None
    if profile.manager_profile and profile.manager_profile.user_id:
        manager = profile.manager_profile.user
    elif profile.manager_id:
        manager = profile.manager
    if manager and getattr(manager, "is_active", False) and getattr(manager, "email", ""):
        return manager
    return None


def get_hr_approver_users():
    return _active_users_in_groups(["HRManager", "SystemAdmin"])


def get_cfo_approver_users():
    from loans.permissions import get_active_workflow_config

    config = get_active_workflow_config()
    return (
        _active_users_in_groups(["CFO", "SystemAdmin"]) | _active_profile_users_by_position(config.cfo_position_id)
    ).distinct()


def get_ceo_approver_users():
    from loans.permissions import get_active_workflow_config

    config = get_active_workflow_config()
    return (
        _active_users_in_groups(["CEO", "SystemAdmin"]) | _active_profile_users_by_position(config.ceo_position_id)
    ).distinct()


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

    context = {
        "title": f"{request_type} requires your review",
        "title_ar": f"طلب {request_type} يتطلب مراجعتك",
        "employee_name": approver_name,
        "message": "A new request is pending your action.",
        "message_ar": "هناك طلب جديد معلق بانتظار إجراء منك.",
        "request_type": request_type,
        "request_id": request_id,
        "requester_name": requester_name,
        "status_label": status_label,
        "details": details,
        "action_url": action_url,
        "action_text": "Review Request",
        "action_text_ar": "مراجعة الطلب",
    }
    
    html = render_to_string("emails/pending_approval_email.html", context)

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
    sent = 0
    failed = 0
    errors: list[str] = []
    seen = set()

    for user in users:
        email = (getattr(user, "email", "") or "").strip().lower()
        if not email or email in seen:
            continue
        seen.add(email)
        result = send_pending_approval_email(
            to_email=email,
            approver_name=getattr(user, "full_name", "") or email,
            request_type=request_type,
            request_id=request_id,
            requester_name=requester_name,
            status_label=status_label,
            details=details,
            action_path=action_path,
        )
        if result.get("success"):
            sent += 1
        else:
            failed += 1
            errors.append(f"{email}: {result.get('error')}")

    logger.info(
        "pending_status_notified",
        extra={"request_type": request_type, "request_id": str(request_id), "sent": sent, "failed": failed},
    )
    return {"sent": sent, "failed": failed, "errors": errors}
