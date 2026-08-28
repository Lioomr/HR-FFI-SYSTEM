import os

from celery import Celery
from celery.schedules import crontab

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("ffi_hr")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

app.conf.beat_schedule = {
    "send-work-license-expiry-reminders-daily": {
        "task": "employees.tasks.send_work_license_expiry_reminders",
        "schedule": crontab(
            hour=int(os.environ.get("WORK_LICENSE_REMINDER_HOUR", "8")),
            minute=int(os.environ.get("WORK_LICENSE_REMINDER_MINUTE", "0")),
        ),
    },
    "cleanup-expired-notifications-daily": {
        "task": "in_app_notifications.tasks.cleanup_expired_notifications",
        "schedule": crontab(
            hour=int(os.environ.get("NOTIFICATION_CLEANUP_HOUR", "2")),
            minute=int(os.environ.get("NOTIFICATION_CLEANUP_MINUTE", "0")),
        ),
        "kwargs": {"days": int(os.environ.get("NOTIFICATION_RETENTION_DAYS", "90"))},
    },
    "send-annual-leave-year-end-notifications-daily": {
        "task": "leaves.tasks.send_annual_leave_year_end_notifications",
        "schedule": crontab(
            hour=int(os.environ.get("ANNUAL_LEAVE_REMINDER_HOUR", "8")),
            minute=int(os.environ.get("ANNUAL_LEAVE_REMINDER_MINUTE", "5")),
        ),
    },
    "sync-biotime-attendance-morning": {
        "task": "attendance.tasks.sync_biotime_attendance",
        "schedule": crontab(
            hour=int(os.environ.get("BIOTIME_SYNC_MORNING_HOUR", "9")),
            minute=int(os.environ.get("BIOTIME_SYNC_MORNING_MINUTE", "0")),
        ),
        "kwargs": {"days_back": int(os.environ.get("BIOTIME_SYNC_DAYS_BACK", "1"))},
    },
    "sync-biotime-attendance-evening": {
        "task": "attendance.tasks.sync_biotime_attendance",
        "schedule": crontab(
            hour=int(os.environ.get("BIOTIME_SYNC_EVENING_HOUR", "22")),
            minute=int(os.environ.get("BIOTIME_SYNC_EVENING_MINUTE", "0")),
        ),
        "kwargs": {"days_back": int(os.environ.get("BIOTIME_SYNC_DAYS_BACK", "1"))},
    },
}
