from rest_framework.permissions import BasePermission

from employees.models import EmployeeProfile
from employees.services.manager_relationships import has_manager_access

CEO_APPROVER_DEPARTMENT_ID = 1


def get_role(user):
    # If user has multiple groups, prioritize
    group_names = list(user.groups.values_list("name", flat=True))
    if "SystemAdmin" in group_names:
        return "SystemAdmin"
    if "CFO" in group_names:
        return "CFO"
    if "HRManager" in group_names:
        return "HRManager"
    if "Manager" in group_names:
        return "Manager"
    if "CEO" in group_names:
        return "CEO"
    return "Employee"


def has_direct_reports(user):
    return has_manager_access(user)


class IsSystemAdmin(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and get_role(request.user) == "SystemAdmin"


class IsHRManagerOrAdmin(BasePermission):
    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated and get_role(request.user) in ["SystemAdmin", "HRManager"]


class IsManager(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and (
            get_role(request.user) == "SystemAdmin" or has_manager_access(request.user)
        )


class IsCEO(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and get_role(request.user) == "CEO"


class IsCFO(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and get_role(request.user) == "CFO"


def is_department_ceo_approver_user(user):
    """
    CEO approver identity is department-based:
    active authenticated users whose active employee profile is in department 1.
    """
    if not user or not user.is_authenticated:
        return False
    if get_role(user) in ["CEO", "SystemAdmin"]:
        return True

    profile = getattr(user, "employee_profile", None)
    if not profile:
        return _is_delegated_role_user(user, "ceo")

    return (
        profile.employment_status == EmployeeProfile.EmploymentStatus.ACTIVE
        and profile.department_ref_id == CEO_APPROVER_DEPARTMENT_ID
    ) or _is_delegated_role_user(user, "ceo")


def is_hr_workflow_approver_user(user):
    if not user or not user.is_authenticated:
        return False
    return get_role(user) in ["SystemAdmin", "HRManager"] or _is_delegated_role_user(user, "hr")


def _is_delegated_role_user(user, role: str) -> bool:
    from core.delegation import is_user_delegated_for_role

    return is_user_delegated_for_role(user, role)


class IsDepartmentCEOApprover(BasePermission):
    def has_permission(self, request, view):
        return is_department_ceo_approver_user(request.user)


class IsHRWorkflowApprover(BasePermission):
    def has_permission(self, request, view):
        return is_hr_workflow_approver_user(request.user)
