from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db.models import Q
from django.utils import timezone

from core.models import DelegationRule
from employees.models import EmployeeProfile

User = get_user_model()


def _get_active_workflow_config():
    from loans.permissions import get_active_workflow_config

    return get_active_workflow_config()


def _get_ceo_department_id():
    from core.permissions import CEO_APPROVER_DEPARTMENT_ID

    return CEO_APPROVER_DEPARTMENT_ID


def _active_delegation_queryset():
    now = timezone.now()
    return DelegationRule.objects.filter(is_active=True, start_at__lte=now).filter(
        Q(end_at__isnull=True) | Q(end_at__gte=now)
    )


def get_active_delegation(from_user):
    if not from_user:
        return None
    return _active_delegation_queryset().filter(from_user=from_user).order_by("-updated_at", "-id").first()


def get_active_delegate_for_user(from_user):
    delegation = get_active_delegation(from_user)
    return delegation.to_user if delegation else None


def get_delegated_from_user_ids(to_user, *, role: str | None = None) -> list[int]:
    if not to_user or not getattr(to_user, "is_authenticated", False):
        return []

    qs = _active_delegation_queryset().filter(to_user=to_user).select_related("from_user")
    user_ids = []
    for rule in qs:
        if role and not is_user_base_approver_for_role(rule.from_user, role):
            continue
        user_ids.append(rule.from_user_id)
    return user_ids


def get_delegated_manager_user_ids(to_user) -> list[int]:
    return get_delegated_from_user_ids(to_user)


def get_role_approver_users(role: str):
    if role == "hr":
        return User.objects.filter(is_active=True, groups__name__in=["HRManager", "SystemAdmin"]).exclude(
            email=""
        ).distinct()

    if role == "cfo":
        config = _get_active_workflow_config()
        return User.objects.filter(
            Q(is_active=True, groups__name__in=["CFO", "SystemAdmin"])
            | Q(
                is_active=True,
                employee_profile__employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
                employee_profile__position_ref_id=config.cfo_position_id,
            )
        ).exclude(email="").distinct()

    if role == "ceo":
        return User.objects.filter(
            is_active=True,
            employee_profile__employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            employee_profile__department_ref_id=_get_ceo_department_id(),
        ).exclude(email="").distinct()

    if role == "disbursement":
        config = _get_active_workflow_config()
        return User.objects.filter(
            Q(is_active=True, groups__name__in=["SystemAdmin"])
            | Q(
                is_active=True,
                employee_profile__employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
                employee_profile__department_ref_id=config.finance_department_id,
                employee_profile__position_ref_id=config.finance_position_id,
            )
        ).exclude(email="").distinct()

    return User.objects.none()


def is_user_base_approver_for_role(user, role: str) -> bool:
    if not user or not getattr(user, "is_authenticated", False):
        return False
    return get_role_approver_users(role).filter(id=user.id).exists()


def is_user_delegated_for_role(user, role: str) -> bool:
    if not user or not getattr(user, "is_authenticated", False):
        return False

    from_user_ids = get_delegated_from_user_ids(user, role=role)
    return bool(from_user_ids)


def is_user_approver_for_role(user, role: str) -> bool:
    return is_user_base_approver_for_role(user, role) or is_user_delegated_for_role(user, role)


def get_pending_approval_roles_for_user(user) -> list[str]:
    if not user or not getattr(user, "is_authenticated", False):
        return []

    roles = []
    for role in ("hr", "cfo", "ceo", "disbursement"):
        if is_user_approver_for_role(user, role):
            roles.append(role)
    return roles


def is_user_delegate_for_manager(user, manager_user) -> bool:
    if not user or not getattr(user, "is_authenticated", False) or not manager_user:
        return False
    return manager_user.id in get_delegated_manager_user_ids(user)
