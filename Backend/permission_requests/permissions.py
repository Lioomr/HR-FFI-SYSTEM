from rest_framework.permissions import BasePermission

from core.delegation import is_user_delegated_for_role
from employees.models import EmployeeProfile
from employees.services.manager_relationships import has_manager_access

HR_APPROVER_GROUPS = ("HRManager", "SystemAdmin")


def _in_groups(user, names) -> bool:
    return bool(user and user.is_authenticated and user.groups.filter(name__in=names).exists())


def is_base_hr_approver(user) -> bool:
    """HR stage approver by role. Temporary HR delegations are deliberately excluded."""

    return _in_groups(user, HR_APPROVER_GROUPS)


def is_hr_approver_user(user) -> bool:
    """HR stage approver by role or by an active HR workflow delegation.

    Group membership is checked directly (not ``get_role``) so a user holding both
    ``CFO`` and ``HRManager`` is still an HR approver, matching the workflow engine.
    CEO membership never grants HR approval.
    """

    if not user or not user.is_authenticated:
        return False
    return is_base_hr_approver(user) or is_user_delegated_for_role(user, "hr")


def get_active_requester_profile(user):
    """The caller's employee profile when it can submit requests, otherwise ``None``."""

    if not user or not user.is_authenticated or not user.is_active:
        return None
    profile = EmployeeProfile.objects.select_related("company").filter(user=user).first()
    if (
        profile is None
        or profile.is_archived
        or profile.employment_status != EmployeeProfile.EmploymentStatus.ACTIVE
        or profile.company_id is None
    ):
        return None
    return profile


class HasActiveEmployeeProfile(BasePermission):
    message = "An active employee profile is required to submit permission requests."

    def has_permission(self, request, view):
        return get_active_requester_profile(request.user) is not None


class IsPermissionRequestManager(BasePermission):
    message = "Only direct or delegated managers can use the manager permission request queue."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and has_manager_access(request.user))


class IsPermissionRequestHRApprover(BasePermission):
    message = "Only HR workflow approvers can use the HR permission request queue."

    def has_permission(self, request, view):
        return is_hr_approver_user(request.user)
