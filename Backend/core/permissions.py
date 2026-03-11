from django.db.models import Q
from rest_framework.permissions import BasePermission

from employees.models import EmployeeProfile


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
    if not user or not user.is_authenticated:
        return False

    manager_profile = getattr(user, "employee_profile", None)
    manager_match = Q(manager=user)
    if manager_profile:
        manager_match = manager_match | Q(manager_profile=manager_profile)

    return EmployeeProfile.objects.filter(manager_match).exists()


class IsSystemAdmin(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and get_role(request.user) == "SystemAdmin"


class IsHRManagerOrAdmin(BasePermission):
    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated and get_role(request.user) in ["SystemAdmin", "HRManager"]


class IsManager(BasePermission):
    def has_permission(self, request, view):
        # Allow SystemAdmin/HRManager to act as manager if needed, or strictly manager
        # Usually Managers are distinct, but let's allow Admin for override
        return request.user.is_authenticated and (
            get_role(request.user) in [
                "SystemAdmin",
                "HRManager",
                "Manager",
                "CFO",
                "CEO",
            ]
            or has_direct_reports(request.user)
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

    profile = getattr(user, "employee_profile", None)
    if not profile:
        return False

    return (
        profile.employment_status == EmployeeProfile.EmploymentStatus.ACTIVE
        and profile.department_ref_id == CEO_APPROVER_DEPARTMENT_ID
    )


class IsDepartmentCEOApprover(BasePermission):
    def has_permission(self, request, view):
        return is_department_ceo_approver_user(request.user)
