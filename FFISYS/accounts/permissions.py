from rest_framework.permissions import BasePermission


class IsAdminOrHR(BasePermission):
    """
    Allows access only to users with ADMIN or HR role.
    """

    def has_permission(self, request, view):
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and user.role in ("ADMIN", "HR")
        )
