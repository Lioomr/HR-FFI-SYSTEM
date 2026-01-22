from rest_framework import permissions
from core.permissions import get_role, IsHRManagerOrAdmin

class IsAttendanceOwner(permissions.BasePermission):
    """
    Custom permission to only allow employees to view their own attendance.
    """
    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated

    def has_object_permission(self, request, view, obj):
        # Read permissions are allowed to the owner
        return obj.employee_profile.user == request.user

# Re-export strict RBAC
IsHRManagerOrAdmin = IsHRManagerOrAdmin
