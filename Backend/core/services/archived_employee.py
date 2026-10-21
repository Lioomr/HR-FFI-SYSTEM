"""Shared rules for requests that belong to an archived (resigned or terminated) employee.

Archiving closes the employee's still-open requests (each domain service owns its own
cancel, see ``employees.services.archiving``) and from then on nobody may approve or
advance them. Rejecting and cancelling stay allowed so a stale request can always be closed.
"""

from __future__ import annotations

CANCEL_NOTE = "Archived employee ({reason}): open {label} cancelled automatically."


def archived_cancel_note(label: str, reason: str = "") -> str:
    """The history note written when archiving cancels an open request of type ``label``."""

    return CANCEL_NOTE.format(reason=reason or "archived", label=label)


def is_profile_archived(profile_id) -> bool:
    """Whether the employee profile is archived (the default manager is bypassed on purpose)."""

    from employees.models import EmployeeProfile

    return bool(profile_id) and EmployeeProfile._base_manager.filter(pk=profile_id, is_archived=True).exists()


# Request models filed by the employee about themselves, with the attribute that holds
# their profile. Archive requests, contract decisions and job offers are deliberately
# absent: they are about the very departure that archives the employee.
_OWNER_PROFILE_ATTR = {
    "leaves.LeaveRequest": "employee_profile",
    "leaves.AnnualLeavePaymentRequest": "employee_profile",
    "loans.LoanRequest": "employee_profile",
    "permission_requests.PermissionRequest": "employee_profile",
    "employees.ProfileChangeRequest": "employee_profile",
    "assets.AssetReturnRequest": "employee",
}


def is_stale_request_of_archived_employee(obj) -> bool:
    """Whether ``obj`` is an employee request that approvers should no longer see.

    Used to keep the pending-approval inbox free of requests nobody may approve any more.
    A termination settlement stays visible: HR raises and decides it after the archive.
    """

    attr = _OWNER_PROFILE_ATTR.get(getattr(obj, "_meta", None) and obj._meta.label)
    if not attr or getattr(obj, "is_termination_settlement", False):
        return False
    profile = getattr(obj, attr, None)
    return bool(profile is not None and profile.is_archived)
