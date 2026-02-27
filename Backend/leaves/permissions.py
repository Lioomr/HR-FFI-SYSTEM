from rest_framework.permissions import SAFE_METHODS, BasePermission

from core.permissions import get_role


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
        return (
            request.user and request.user.is_authenticated and request.user.is_active and request.method in SAFE_METHODS
        )


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
        # Check if obj.employee (User) -> employee_profile -> manager_profile.user is request.user
        if not hasattr(obj.employee, "employee_profile"):
            return False
        profile = obj.employee.employee_profile
        manager_profile = profile.manager_profile
        if manager_profile and manager_profile.user_id == request.user.id:
            return True
        if (
            hasattr(request.user, "employee_profile")
            and manager_profile
            and manager_profile.id == request.user.employee_profile.id
        ):
            return True
        return bool(profile.manager_id == request.user.id)


class IsEmployeeOnly(BasePermission):
    """
    Allows access to self-service leave submission roles.
    """

    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated and get_role(request.user) in ["Employee", "Manager"]
