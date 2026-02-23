from rest_framework.permissions import BasePermission


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
        return request.user.is_authenticated and get_role(request.user) in ["SystemAdmin", "HRManager", "Manager", "CEO"]


class IsCEO(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and get_role(request.user) == "CEO"


class IsCFO(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and get_role(request.user) == "CFO"
