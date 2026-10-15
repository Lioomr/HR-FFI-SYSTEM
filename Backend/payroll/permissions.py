from core.permissions import get_role
from rest_framework.permissions import BasePermission

PAYROLL_MANAGER_ROLES = frozenset({"SystemAdmin", "HRManager", "CFO"})


class IsPayrollManager(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and get_role(request.user) in PAYROLL_MANAGER_ROLES)


class IsEmployeeOnly(BasePermission):
    """
    Allows access only to Employee role.
    """

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        return get_role(request.user) == "Employee"
