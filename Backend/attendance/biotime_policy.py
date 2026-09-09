"""BioTime-only attendance policy helpers.

Business rule
-------------
BioTime agent ingestion is the *only* writer of attendance punch records, and an
active :class:`~attendance.models.BioTimeEmployeeMap` is the *only* attendance
eligibility marker. Employees without a mapping (construction-site and visitor
staff, for example) stay full HR employees but have no attendance access, no
attendance records, and no automatic absence records.

"Active mapping" means a ``BioTimeEmployeeMap`` row whose employee profile is
not archived and belongs to an active COMPANY node. ``BioTimeEmployeeMap`` has
no ``is_active`` column of its own; ``BioTimeEmployeeMap.clean()`` already
refuses to save a mapping that fails those two conditions, so re-checking them
here keeps read paths correct for rows that drifted (an employee archived after
being mapped, or a company deactivated).
"""

from __future__ import annotations

from rest_framework import status

from core.responses import error

from .models import BioTimeEmployeeMap

#: Single response message used by every retired manual-attendance endpoint.
MANUAL_ATTENDANCE_RETIRED_MESSAGE = (
    "Manual attendance is no longer available. Attendance is recorded through BioTime."
)

#: Response message for a signed-in employee who has no BioTime mapping yet.
ATTENDANCE_UNAVAILABLE_UNMAPPED_MESSAGE = (
    "Attendance is unavailable until your BioTime mapping is completed. "
    "Contact HR to be registered on a BioTime device."
)


def manual_attendance_gone():
    """HTTP 410 response for a permanently retired manual-attendance action."""
    return error(MANUAL_ATTENDANCE_RETIRED_MESSAGE, status=status.HTTP_410_GONE)


def attendance_unavailable_unmapped():
    """HTTP 403 response for an employee without an active BioTime mapping."""
    return error(ATTENDANCE_UNAVAILABLE_UNMAPPED_MESSAGE, status=status.HTTP_403_FORBIDDEN)


def active_biotime_mappings():
    """Mappings that currently grant attendance eligibility."""
    return BioTimeEmployeeMap.objects.filter(
        employee_profile__is_archived=False,
        employee_profile__company__isnull=False,
        employee_profile__company__node_type="company",
        employee_profile__company__is_active=True,
    )


def mapped_employee_profile_ids():
    """Profile ids with an active BioTime mapping (as a subquery-friendly queryset)."""
    return active_biotime_mappings().values("employee_profile_id")


def has_active_biotime_mapping(profile) -> bool:
    if profile is None or not getattr(profile, "pk", None):
        return False
    return active_biotime_mappings().filter(employee_profile_id=profile.pk).exists()


def limit_to_mapped_employees(queryset, *, profile_field="employee_profile"):
    """Restrict an attendance queryset to employees with an active BioTime mapping."""
    return queryset.filter(**{f"{profile_field}_id__in": mapped_employee_profile_ids()})
