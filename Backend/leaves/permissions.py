from rest_framework.permissions import BasePermission, SAFE_METHODS
from core.permissions import get_role, IsHRManagerOrAdmin

class IsLeaveRequestOwner(BasePermission):
    """
    Allows employees to view and cancel their own requests.
    """
    def has_permission(self, request, view):
        # Allow at view level, strict filtering in queryset
        return request.user and request.user.is_authenticated

    def has_object_permission(self, request, view, obj):
        # obj is LeaveRequest
        return obj.employee == request.user

class IsActiveEmployee(BasePermission):
    """
    Allows active employees to view available leave types.
    """
    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated and request.user.is_active and request.method in SAFE_METHODS

class IsOwnerOrHR(BasePermission):
    """
    Allows access to HR/Admin OR the owner.
    """
    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated

    def has_object_permission(self, request, view, obj):
        if get_role(request.user) in ["SystemAdmin", "HRManager"]:
            return True
        return obj.employee == request.user

class IsManagerOfEmployee(BasePermission):
    """
    Allows access if the request user is the manager of the leave request's employee.
    """
    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated

    def has_object_permission(self, request, view, obj):
        # obj is LeaveRequest
        # Check if obj.employee (User) -> employee_profile -> manager is request.user
        if not hasattr(obj.employee, 'employee_profile'):
            return False
        return obj.employee.employee_profile.manager == request.user
