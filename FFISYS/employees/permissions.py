from rest_framework.permissions import BasePermission


class IsAdminOrHR(BasePermission):
    def has_permission(self, request, view):
        return request.user.role in ("ADMIN", "HR")


class IsSelfEmployee(BasePermission):
    def has_object_permission(self, request, view, obj):
        return obj.user == request.user
