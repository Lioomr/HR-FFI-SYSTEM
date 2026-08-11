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
}
