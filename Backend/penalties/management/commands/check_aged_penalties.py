"""Bounded HR queue signal for the existing operational scheduler/log sink."""

import logging
from datetime import datetime, timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from penalties.models import PenaltyRecord

logger = logging.getLogger("penalties.monitoring")


def pending_since(record):
    """Time entered pending_hr_mark: reopen timestamp, else creation."""
    reopened_at = (record.resolution or {}).get("reopened_at")
    return datetime.fromisoformat(reopened_at) if reopened_at else record.created_at


class Command(BaseCommand):
    help = "Report up to 100 HR penalty candidates pending for at least seven days."

    def handle(self, **options):
        cutoff = timezone.now() - timedelta(days=7)
        rows = []
        # Reopening never precedes creation, so created_at bounds the scan.
        for record in (
            PenaltyRecord.objects.filter(status=PenaltyRecord.Status.PENDING_HR_MARK, created_at__lte=cutoff)
            # Automatic warnings awaiting the system are not in the HR queue.
            .exclude(automation=PenaltyRecord.Automation.WARNING_PENDING)
            .only("id", "company_id", "created_at", "resolution")
            .order_by("created_at", "pk")
            .iterator()
        ):
            if pending_since(record) <= cutoff:
                rows.append({"id": record.pk, "company_id": record.company_id})
                if len(rows) == 100:
                    break
        if rows:
            logger.warning("penalty_hr_candidates_aged", extra={"candidates": rows, "limit": 100, "age_days": 7})
        self.stdout.write(f"Aged penalty candidates: {len(rows)} (limit 100).")
