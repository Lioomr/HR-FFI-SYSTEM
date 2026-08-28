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
    return (
        DelegationRule.objects.filter(
            is_active=True,
            revoked_at__isnull=True,
            start_at__lte=now,
            from_user__is_active=True,
            to_user__is_active=True,
            from_user__employee_profile__is_archived=False,
            from_user__employee_profile__employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            from_user__employee_profile__company__is_active=True,
            to_user__employee_profile__is_archived=False,
            to_user__employee_profile__employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            to_user__employee_profile__company__is_active=True,
        )
        .filter(Q(end_at__isnull=True) | Q(end_at__gte=now))
        .distinct()
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
        if DelegationRule.Capability.WORKFLOW_APPROVE not in (rule.capabilities or []):
            continue
        if role and not is_user_base_approver_for_role(rule.from_user, role):
            continue
        user_ids.append(rule.from_user_id)
    return user_ids


def get_active_employee_read_scope_ids(to_user) -> set[int]:
    """Return only currently valid employee-read scopes, failing closed for legacy rows.

    These participant and company checks are intentionally repeated here rather
    than relying only on lifecycle triggers. This makes old or manually-created
    rows harmless if they predate the database lifecycle protections.
    """
    if not to_user or not getattr(to_user, "is_authenticated", False):
        return set()
    now = timezone.now()
    return set(
        _active_delegation_queryset()
        .filter(
            to_user=to_user,
            is_active=True,
            revoked_at__isnull=True,
            start_at__lte=now,
            from_user__is_active=True,
            to_user__is_active=True,
            from_user__employee_profile__is_archived=False,
            from_user__employee_profile__employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            from_user__employee_profile__company__node_type="company",
            from_user__employee_profile__company__is_active=True,
            to_user__employee_profile__is_archived=False,
            to_user__employee_profile__employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            to_user__employee_profile__company__node_type="company",
            to_user__employee_profile__company__is_active=True,
            scope__isnull=False,
            scope__is_active=True,
            capabilities__contains=[DelegationRule.Capability.EMPLOYEE_READ],
        )
        .filter(Q(end_at__isnull=True) | Q(end_at__gte=now))
        .values_list("scope_id", flat=True)
    )


def get_current_scope_ids_for_user(user) -> set[int]:
    """Scopes that may be displayed to a non-audit user right now.

    Historical grants and assignments remain in their tables for audit, but never
    become a discovery channel for expired, revoked, inactive, or disabled users.
    """
    if not user or not getattr(user, "is_authenticated", False) or not user.is_active:
        return set()

    delegation_scope_ids = get_active_employee_read_scope_ids(user)
    from core.models import CrossCompanyManagerAssignment

    now = timezone.now()
    assignment_scope_ids = CrossCompanyManagerAssignment.objects.filter(
        manager_profile__user=user,
        manager_profile__is_archived=False,
        manager_profile__employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        manager_profile__user__is_active=True,
        employee__is_archived=False,
        employee__employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        employee__user__is_active=True,
        is_active=True,
        revoked_at__isnull=True,
        start_at__lte=now,
        end_at__gte=now,
        scope__is_active=True,
        capabilities__contains=[CrossCompanyManagerAssignment.Capability.EMPLOYEE_VIEW],
    ).values_list("scope_id", flat=True)
    return delegation_scope_ids | set(assignment_scope_ids)


def get_delegated_manager_user_ids(to_user) -> list[int]:
    return get_delegated_from_user_ids(to_user)


def get_role_approver_users(role: str):
    if role == "hr":
        return (
            User.objects.filter(is_active=True, groups__name__in=["HRManager", "SystemAdmin"])
            .exclude(email="")
            .distinct()
        )

    if role == "cfo":
        config = _get_active_workflow_config()
        return (
            User.objects.filter(
                Q(is_active=True, groups__name__in=["CFO", "SystemAdmin"])
                | Q(
                    is_active=True,
                    employee_profile__employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
                    employee_profile__position_ref_id=config.cfo_position_id,
                )
            )
            .exclude(email="")
            .distinct()
        )

    if role == "ceo":
        return (
            User.objects.filter(
                Q(is_active=True, groups__name__in=["CEO", "SystemAdmin"])
                | Q(
                    is_active=True,
                    employee_profile__employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
                    employee_profile__department_ref_id=_get_ceo_department_id(),
                )
            )
            .exclude(email="")
            .distinct()
        )

    if role == "disbursement":
        config = _get_active_workflow_config()
        return (
            User.objects.filter(
                Q(is_active=True, groups__name__in=["SystemAdmin"])
                | Q(
                    is_active=True,
                    employee_profile__employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
                    employee_profile__department_ref_id=config.finance_department_id,
                    employee_profile__position_ref_id=config.finance_position_id,
                )
            )
            .exclude(email="")
            .distinct()
        )

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
