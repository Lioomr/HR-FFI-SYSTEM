from __future__ import annotations

import logging
from typing import Iterable

from django.conf import settings
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
    details_html = ""
    details_text = ""
    if details:
        items = [str(item) for item in details if str(item).strip()]
        if items:
            details_html = "<ul>" + "".join(f"<li>{item}</li>" for item in items) + "</ul>"
            details_text = "\n".join(f"- {item}" for item in items)

    action_btn = ""
    if action_url:
        action_btn = (
            f'<p><a href="{action_url}" style="display:inline-block;padding:10px 14px;'
            'background:#f97316;color:#fff;text-decoration:none;border-radius:8px;">Review Request</a></p>'
        )

    subject = f"{request_type} pending approval - #{request_id}"
    html = (
        f"<h2>{request_type} requires your review</h2>"
        f"<p>Dear {approver_name},</p>"
        f"<p>A new request is pending your action.</p>"
        f"<p><strong>Request ID:</strong> {request_id}<br/>"
        f"<strong>Requested by:</strong> {requester_name}<br/>"
        f"<strong>Status:</strong> {status_label}</p>"
        f"{details_html}"
        f"{action_btn}"
    )
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
