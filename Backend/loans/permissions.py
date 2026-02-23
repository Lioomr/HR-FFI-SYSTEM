from rest_framework.permissions import BasePermission

from core.permissions import get_role
from employees.models import EmployeeProfile
from loans.models import LoanWorkflowConfig


def get_active_workflow_config():
    config = LoanWorkflowConfig.objects.filter(is_active=True).order_by("-updated_at", "-id").first()
    if config:
        return config
    return LoanWorkflowConfig(
        finance_department_id=8,
        finance_position_id=24,
        cfo_position_id=3,
        ceo_position_id=1,
        require_manager_stage=True,
        is_active=True,
    )


def _is_group_member(user, group_name):
    return bool(user and user.is_authenticated and user.groups.filter(name=group_name).exists())


def _is_active_profile(profile):
    return bool(profile and profile.employment_status == EmployeeProfile.EmploymentStatus.ACTIVE)


def is_finance_approver_user(user):
    if not user or not user.is_authenticated:
        return False

    if _is_group_member(user, "SystemAdmin") or _is_group_member(user, "HRManager"):
        return True

    profile = getattr(user, "employee_profile", None)
    if not _is_active_profile(profile):
        return False

    config = get_active_workflow_config()
    return (
        profile.department_ref_id == config.finance_department_id
        and profile.position_ref_id == config.finance_position_id
    )


class IsEmployeeOnly(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and get_role(request.user) == "Employee"


class IsManagerOrAdmin(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and get_role(request.user) in ["Manager", "SystemAdmin"]


class IsCFOOrAdmin(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and get_role(request.user) in ["CFO", "SystemAdmin"]


class IsFinanceApproverOrAdmin(BasePermission):
    def has_permission(self, request, view):
        return is_finance_approver_user(request.user)


def is_cfo_approver_user(user):
    if not user or not user.is_authenticated:
        return False

    if _is_group_member(user, "SystemAdmin") or _is_group_member(user, "CFO"):
        return True

    profile = getattr(user, "employee_profile", None)
    if not _is_active_profile(profile):
        return False

    config = get_active_workflow_config()
    return profile.position_ref_id == config.cfo_position_id


def is_ceo_approver_user(user):
    if not user or not user.is_authenticated:
        return False

    if _is_group_member(user, "SystemAdmin") or _is_group_member(user, "CEO"):
        return True

    profile = getattr(user, "employee_profile", None)
    if not _is_active_profile(profile):
        return False

    config = get_active_workflow_config()
    return profile.position_ref_id == config.ceo_position_id


def is_cfo_requester_profile(profile):
    if not _is_active_profile(profile):
        return False
    config = get_active_workflow_config()
    return profile.position_ref_id == config.cfo_position_id


def is_cfo_requester(user, profile=None):
    if not user or not user.is_authenticated:
        return False
    if _is_group_member(user, "CFO"):
        return True
    if profile is None:
        profile = getattr(user, "employee_profile", None)
    return is_cfo_requester_profile(profile)


class IsCFOApproverOrAdmin(BasePermission):
    def has_permission(self, request, view):
        return is_cfo_approver_user(request.user)


class IsCEOApproverOrAdmin(BasePermission):
    def has_permission(self, request, view):
        return is_ceo_approver_user(request.user)
