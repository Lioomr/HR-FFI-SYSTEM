"""Work-schedule helpers for Late / Absent classification.

Shift times and the grace window are a single company-wide policy stored on
``admin_portal.SystemSettings`` (a singleton). The working *week*, by contrast,
is fixed in code and decided per employee by nationality -- see
:func:`is_working_day`. These helpers translate both into concrete decisions for
a given date / check-in time.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date as date_type
from datetime import datetime, time, timedelta

from django.utils import timezone

# Python weekday(): Monday=0 .. Sunday=6.
FRIDAY = 4
SATURDAY = 5


def is_working_day(profile, value: date_type) -> bool:
    """Fixed weekly schedule, decided per employee by nationality.

    Friday is a day off for everyone. Saudi employees are also off on Saturday,
    so they work Sunday-Thursday; everyone else works Saturday-Thursday. The
    rule is deliberately not configurable: ``EmployeeProfile.is_saudi`` (the
    "Saudi Citizen" toggle) is the only input, never the free-text nationality
    fields.
    """
    weekday = value.weekday()
    if weekday == FRIDAY:
        return False
    if weekday == SATURDAY:
        return not bool(getattr(profile, "is_saudi", False))
    return True


def is_rest_day_for_everyone(value: date_type) -> bool:
    """True when no employee works ``value``, whatever their nationality."""
    return value.weekday() == FRIDAY


@dataclass(frozen=True)
class WorkSchedule:
    start_time: time
    grace_minutes: int
    absence_detection_enabled: bool

    def cutoff_for(self, value: date_type) -> datetime:
        """Timezone-aware datetime after which a check-in counts as late."""
        tz = timezone.get_current_timezone()
        naive = datetime.combine(value, self.start_time) + timedelta(minutes=self.grace_minutes)
        return timezone.make_aware(naive, tz)

    def late_minutes(self, check_in_at: datetime, value: date_type) -> int:
        """Whole minutes past the grace cutoff, clamped at 0."""
        if check_in_at is None:
            return 0
        local_check_in = timezone.localtime(check_in_at)
        delta = local_check_in - self.cutoff_for(value)
        return max(0, int(delta.total_seconds() // 60))


def get_work_schedule() -> WorkSchedule:
    """Load the current company-wide shift times from SystemSettings.

    The working week is not part of this: it is fixed per employee by
    :func:`is_working_day`.
    """
    from admin_portal.models import SystemSettings

    settings_obj = SystemSettings.get_solo()
    return WorkSchedule(
        start_time=settings_obj.work_day_start_time,
        # grace_window_minutes is canonical. late_grace_minutes remains a
        # response/request alias for legacy clients and is synchronized by the
        # settings serializer.
        grace_minutes=int(settings_obj.grace_window_minutes or 0),
        absence_detection_enabled=bool(settings_obj.absence_detection_enabled),
    )


def classify_check_in(check_in_at, value: date_type, profile, schedule=None) -> str:
    """Return ``LATE`` or ``PRESENT`` for a check-in time on a given date.

    ``profile`` decides the working week, so a punch on that employee's own day
    off never produces ``LATE`` (no expected start time applies).
    """
    from .models import AttendanceRecord

    if check_in_at is None:
        return AttendanceRecord.Status.PRESENT
    schedule = schedule or get_work_schedule()
    if not is_working_day(profile, value):
        return AttendanceRecord.Status.PRESENT
    if timezone.localtime(check_in_at) > schedule.cutoff_for(value):
        return AttendanceRecord.Status.LATE
    return AttendanceRecord.Status.PRESENT


def employee_on_leave(employee_profile, value: date_type) -> bool:
    """True when the employee has an approved leave request covering ``value``."""
    try:
        from leaves.models import LeaveRequest
    except Exception:  # pragma: no cover - leaves app always installed
        return False

    from django.db.models import Q

    match = Q(employee_profile=employee_profile)
    user_id = getattr(employee_profile, "user_id", None)
    if user_id:
        match |= Q(employee_profile__isnull=True, employee_id=user_id)
    return LeaveRequest.objects.filter(
        match,
        company_id=employee_profile.company_id,
        status=LeaveRequest.RequestStatus.APPROVED,
        is_active=True,
        start_date__lte=value,
        end_date__gte=value,
    ).exists()
