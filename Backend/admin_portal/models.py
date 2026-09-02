from datetime import time

from django.db import models

# Python weekday(): Monday=0 .. Sunday=6. Default working week: Sunday–Thursday.
DEFAULT_WORK_WEEK_DAYS = [6, 0, 1, 2, 3]


def default_work_week_days():
    return list(DEFAULT_WORK_WEEK_DAYS)


class SystemSettings(models.Model):
    """
    Singleton settings record for Phase 1.
    Store only one row (id=1).
    """

    # Password policy
    password_min_length = models.PositiveIntegerField(default=8)
    password_require_upper = models.BooleanField(default=True)
    password_require_lower = models.BooleanField(default=True)
    password_require_number = models.BooleanField(default=True)
    password_require_special = models.BooleanField(default=False)

    # Session
    session_timeout_minutes = models.PositiveIntegerField(default=30)

    # Security
    max_login_attempts = models.PositiveIntegerField(default=5)

    # Invites
    default_invite_expiry_hours = models.PositiveIntegerField(default=72)

    # Attendance
    geofence_attendance_enabled = models.BooleanField(default=False)
    # Company-wide work schedule used to classify Late arrivals and detect Absences.
    work_day_start_time = models.TimeField(default=time(9, 0))
    late_grace_minutes = models.PositiveIntegerField(default=15)
    absence_detection_enabled = models.BooleanField(default=True)
    # List of Python weekday() ints (Mon=0 .. Sun=6) considered working days.
    work_week_days = models.JSONField(default=default_work_week_days, blank=True)

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "system_settings"

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(id=1)
        return obj
