import logging
from datetime import date as date_type
from datetime import timedelta

from celery import shared_task
from django.core.cache import cache
from django.utils import timezone

from .absence import mark_absentees_for_date
from .services import SyncBioTimeService

logger = logging.getLogger(__name__)

_ABSENCE_LOCK_KEY = "attendance:mark_daily_absentees:lock"
_ABSENCE_LOCK_TTL = 600  # seconds; long enough for one run, short enough to self-heal


@shared_task(name="attendance.tasks.sync_biotime_attendance")
def sync_biotime_attendance(days_back=1):
    """
    Import BioTime punches on a schedule.

    ``days_back`` only applies to the very first run: once ``last_sync_time``
    is set, SyncBioTimeService pulls incrementally from that timestamp and
    ignores the window. Punches for device codes without a BioTimeEmployeeMap
    are counted as ``unmapped`` and dropped, so keep the mappings current.
    """
    successful, result = SyncBioTimeService.execute(days_back=days_back)
    message = result.pop("message", "BioTime sync completed.")

    if successful:
        logger.info("Scheduled BioTime sync completed: %s (%s)", message, result)
    else:
        logger.error("Scheduled BioTime sync failed: %s (%s)", message, result)

    return {"successful": successful, "message": message, **result}


@shared_task(name="attendance.tasks.mark_daily_absentees")
def mark_daily_absentees(target_date=None):
    """Mark employees with no attendance as ABSENT for a given day.

    ``target_date`` defaults to yesterday (ISO ``YYYY-MM-DD`` string or None).
    Runs after the evening + morning BioTime syncs so late punches are counted.
    Honours the ``absence_detection_enabled`` system setting.
    """
    if target_date is None:
        resolved = timezone.localdate() - timedelta(days=1)
    elif isinstance(target_date, str):
        resolved = date_type.fromisoformat(target_date)
    else:
        resolved = target_date

    # Overlap guard: the unique (employee, date) constraint prevents duplicate
    # rows, but not duplicate work / conflicting logs if two runs overlap.
    lock_key = f"{_ABSENCE_LOCK_KEY}:{resolved.isoformat()}"
    if not cache.add(lock_key, "1", _ABSENCE_LOCK_TTL):
        logger.warning("Absence detection for %s already running; skipping this invocation.", resolved)
        return {"date": resolved.isoformat(), "skipped_locked": True}

    try:
        result = mark_absentees_for_date(resolved)
    finally:
        cache.delete(lock_key)
    logger.info("Scheduled absence detection completed: %s", result)
    return result
