"""Automatic absence detection.

For a given date, any *active* employee who has no attendance record and is not
on approved leave gets an ``ABSENT`` record (``source=SYSTEM``). Runs daily via
Celery and can be replayed over a date range with the ``backfill_absences``
management command.

Workflow / audit policy
-----------------------
System-generated ``ABSENT`` rows are **not** individual workflow decisions:
they are not routed through ``sync_workflow()`` / per-row ``audit()`` the way
manager/CEO/HR actions are. Instead each run writes a single summary
``AuditLog`` entry (``attendance.absence_detection_run``) so the batch is
traceable, and every row is self-describing (``source=SYSTEM``,
``created_by=NULL``, explanatory ``notes``). Reporting and history treat these
as terminal states with no approver.
"""

from __future__ import annotations

import logging
from datetime import date as date_type

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from audit.utils import audit
from employees.models import EmployeeProfile
from organization.models import OrganizationNode

from .models import AttendanceRecord
from .schedule import get_work_schedule

logger = logging.getLogger(__name__)


def _active_employee_profiles():
    """Profiles eligible for absence marking.

    Eligibility = archived is False, owning company is an active COMPANY node,
    employment status is ACTIVE, and (no linked user OR the user is enabled).
    Prehire / suspended / terminated / disabled-login profiles are excluded.
    """
    return (
        EmployeeProfile.objects.filter(
            is_archived=False,
            company__isnull=False,
            company__node_type=OrganizationNode.NodeType.COMPANY,
            company__is_active=True,
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        .filter(Q(user__isnull=True) | Q(user__is_active=True))
        .select_related("company", "user")
    )


def _profiles_on_leave(profiles, value: date_type) -> set:
    """One query: profile ids with an approved leave covering ``value``."""
    try:
        from leaves.models import LeaveRequest
    except Exception:  # pragma: no cover - leaves app always installed
        return set()

    profile_ids = [p.id for p in profiles]
    user_to_profile = {p.user_id: p.id for p in profiles if p.user_id}

    rows = (
        LeaveRequest.objects.filter(
            status=LeaveRequest.RequestStatus.APPROVED,
            start_date__lte=value,
            end_date__gte=value,
        )
        .filter(Q(employee_profile_id__in=profile_ids) | Q(employee_id__in=list(user_to_profile.keys())))
        .values_list("employee_profile_id", "employee_id")
    )

    on_leave: set = set()
    for profile_id, user_id in rows:
        if profile_id:
            on_leave.add(profile_id)
        elif user_id in user_to_profile:
            on_leave.add(user_to_profile[user_id])
    return on_leave


def mark_absentees_for_date(target_date: date_type, *, force: bool = False) -> dict:
    """Create ABSENT records for employees with no attendance on ``target_date``.

    ``force`` bypasses the ``absence_detection_enabled`` setting (used by the
    manual backfill command). Non-working days are always skipped.
    """
    result = {
        "date": target_date.isoformat(),
        "eligible": 0,
        "created": 0,
        "prepared": 0,
        "skipped_existing": 0,
        "skipped_on_leave": 0,
        "non_working_day": False,
        "disabled": False,
    }

    schedule = get_work_schedule()
    if not force and not schedule.absence_detection_enabled:
        result["disabled"] = True
        logger.info("Absence detection disabled; skipping %s.", target_date)
        return result
    if not schedule.is_working_day(target_date):
        result["non_working_day"] = True
        logger.info("%s is not a working day; skipping absence detection.", target_date)
        return result

    profiles = list(_active_employee_profiles())
    existing_ids = set(
        AttendanceRecord.objects.filter(
            date=target_date, employee_profile__in=profiles
        ).values_list("employee_profile_id", flat=True)
    )
    on_leave_ids = _profiles_on_leave(profiles, target_date)

    to_create = []
    now = timezone.now()
    for profile in profiles:
        result["eligible"] += 1
        if profile.id in existing_ids:
            result["skipped_existing"] += 1
            continue
        if profile.id in on_leave_ids:
            result["skipped_on_leave"] += 1
            continue
        to_create.append(
            AttendanceRecord(
                employee_profile=profile,
                date=target_date,
                status=AttendanceRecord.Status.ABSENT,
                source=AttendanceRecord.Source.SYSTEM,
                created_by=None,
                updated_by=None,
                notes="Auto-marked absent: no attendance recorded.",
                created_at=now,
                updated_at=now,
            )
        )

    result["prepared"] = len(to_create)
    if to_create:
        with transaction.atomic():
            # ignore_conflicts guards against a race with a late BioTime punch
            # creating the same (employee, date) row.
            AttendanceRecord.objects.bulk_create(to_create, ignore_conflicts=True)
        # Count what is actually in the table now, so a lost race is not
        # reported as a creation.
        result["created"] = AttendanceRecord.objects.filter(
            date=target_date,
            source=AttendanceRecord.Source.SYSTEM,
            status=AttendanceRecord.Status.ABSENT,
            employee_profile_id__in=[r.employee_profile_id for r in to_create],
        ).count()

    audit(
        None,
        "attendance.absence_detection_run",
        entity="attendance_absence_run",
        entity_id=target_date.isoformat(),
        metadata={k: v for k, v in result.items() if k != "date"},
    )
    logger.info("Absence detection for %s: %s", target_date, result)
    return result
