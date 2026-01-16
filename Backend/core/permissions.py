from rest_framework.permissions import BasePermission

def get_role(user):
    g = user.groups.first()
    return g.name if g else "Employee"

class IsSystemAdmin(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and get_role(request.user) == "SystemAdmin"
