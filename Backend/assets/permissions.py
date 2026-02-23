from rest_framework.permissions import BasePermission

from core.permissions import get_role


class IsHRManagerOrSystemAdmin(BasePermission):
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        return get_role(request.user) in ["SystemAdmin", "HRManager"]


class IsEmployeeSelfAsset(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)
