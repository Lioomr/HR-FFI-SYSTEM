from rest_framework.permissions import BasePermission

from core.permissions import get_role


class IsEmployeeOnly(BasePermission):
    """
    Allows access only to Employee role.
    """

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        return get_role(request.user) == "Employee"
