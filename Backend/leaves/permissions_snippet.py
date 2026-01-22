
class IsManagerOfEmployee(BasePermission):
    """
    Allows access if the request user is the manager of the leave request's employee.
    """
    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated

    def has_object_permission(self, request, view, obj):
        # obj is LeaveRequest
        # Check if obj.employee (User) -> employee_profile -> manager is request.user
        try:
             return obj.employee.employee_profile.manager == request.user
        except:
             return False
