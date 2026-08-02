import os

from celery import Celery
from celery.schedules import crontab

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("ffi_hr")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

app.conf.beat_schedule = {
    "cleanup-expired-notifications-daily": {
        "task": "in_app_notifications.tasks.cleanup_expired_notifications",
        "schedule": crontab(
            hour=int(os.environ.get("NOTIFICATION_CLEANUP_HOUR", "2")),
            minute=int(os.environ.get("NOTIFICATION_CLEANUP_MINUTE", "0")),
        ),
        "kwargs": {"days": int(os.environ.get("NOTIFICATION_RETENTION_DAYS", "90"))},
    },
}
