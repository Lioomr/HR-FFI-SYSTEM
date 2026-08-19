import logging

from celery import shared_task

from .services import SyncBioTimeService

logger = logging.getLogger(__name__)


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
