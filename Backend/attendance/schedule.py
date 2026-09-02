"""Company-wide work-schedule helpers for Late / Absent classification.

The schedule is a single company-wide policy stored on
``admin_portal.SystemSettings`` (a singleton). These helpers translate that
policy into concrete decisions for a given date / check-in time.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date as date_type
from datetime import datetime, time, timedelta

from django.utils import timezone

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class WorkSchedule:
    start_time: time
    grace_minutes: int
    work_week_days: tuple
    absence_detection_enabled: bool

    def is_working_day(self, value: date_type) -> bool:
        return value.weekday() in self.work_week_days

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
    """Load the current company-wide work schedule from SystemSettings."""
    from admin_portal.models import DEFAULT_WORK_WEEK_DAYS, SystemSettings

    settings_obj = SystemSettings.get_solo()
    raw_days = settings_obj.work_week_days or list(DEFAULT_WORK_WEEK_DAYS)
    try:
        days = tuple(sorted({int(d) for d in raw_days if 0 <= int(d) <= 6}))
    except (TypeError, ValueError):
        logger.warning("Invalid work_week_days %r; falling back to default.", raw_days)
        days = tuple(DEFAULT_WORK_WEEK_DAYS)
    if not days:
        days = tuple(DEFAULT_WORK_WEEK_DAYS)
    return WorkSchedule(
        start_time=settings_obj.work_day_start_time,
        grace_minutes=int(settings_obj.late_grace_minutes or 0),
        work_week_days=days,
        absence_detection_enabled=bool(settings_obj.absence_detection_enabled),
    )


def classify_check_in(check_in_at, value: date_type, schedule=None) -> str:
    """Return ``LATE`` or ``PRESENT`` for a check-in time on a given date.

    Non-working days never produce ``LATE`` (no expected start time applies).
    """
    from .models import AttendanceRecord

    if check_in_at is None:
        return AttendanceRecord.Status.PRESENT
    schedule = schedule or get_work_schedule()
    if not schedule.is_working_day(value):
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
        match |= Q(employee_id=user_id)
    return LeaveRequest.objects.filter(
        match,
        status=LeaveRequest.RequestStatus.APPROVED,
        start_date__lte=value,
        end_date__gte=value,
    ).exists()
