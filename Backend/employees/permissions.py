from rest_framework.permissions import BasePermission
from core.permissions import get_role

class IsHRManagerOrAdmin(BasePermission):
    """
    Allows full access to SystemAdmin and HRManager.
    """
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        role = get_role(request.user)
        return role in ["SystemAdmin", "HRManager"]

class IsEmployeeOwner(BasePermission):
    """
    Allows read-only access to own profile.
    """
    def has_permission(self, request, view):
        # Allow at view level only for safe methods (GET, HEAD, OPTIONS)
        # Writes must be explicitly allowed by role (HR/Admin) or other logic
        if request.method not in ["GET", "HEAD", "OPTIONS"]:
            return False
        return request.user and request.user.is_authenticated

    def has_object_permission(self, request, view, obj):
        # obj is EmployeeProfile
        return obj.user == request.user and request.method in ["GET", "HEAD", "OPTIONS"]
