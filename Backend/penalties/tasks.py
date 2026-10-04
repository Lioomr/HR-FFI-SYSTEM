"""Issue settled automatic late warnings (W01/W02/W07 occurrences 1-3 in a month)."""

import logging
from collections import Counter
from datetime import datetime, time, timedelta

from celery import shared_task
from django.db import transaction
from django.utils import timezone

from audit.utils import audit
from employees.models import EmployeeProfile

from .models import PenaltyRecord
from .services import (
    EXTRA_AUTO_WARNINGS,
    _next_occurrence,
    auto_warning_settle_hours,
    auto_warnings_effective_from,
    issue,
)
from .warning_notices import create_notice, deliver

logger = logging.getLogger("penalties.monitoring")

MAX_AUTO_WARNING_FAILURES = 3
Automation = PenaltyRecord.Automation


def _settles_at(record):
    result = record.attendance_result
    if result is not None and result.shift_end_at:
        return result.shift_end_at
    return timezone.make_aware(datetime.combine(record.occurred_on + timedelta(days=1), time.min))


def _record_failure(record_id, exc):
    record = PenaltyRecord.objects.get(pk=record_id)
    resolution = dict(record.resolution or {})
    failures = int(resolution.get("auto_warning_failures", 0)) + 1
    resolution["auto_warning_failures"] = failures
    update_fields = ["resolution", "updated_at"]
    released = failures >= MAX_AUTO_WARNING_FAILURES
    if released:
        # Stop retrying and show the candidate in the HR queue.
        resolution["auto_warning_note"] = "The automatic warning could not be issued. HR review is required."
        record.automation = Automation.NONE
        update_fields.append("automation")
    record.resolution = resolution
    record.save(update_fields=update_fields)
    details = {"failures": failures, "error_type": type(exc).__name__, "released_to_hr": released}
    audit(None, "penalty_auto_warning_failed", "PenaltyRecord", record.pk, details)
    logger.warning("penalty_auto_warning_failed", extra={"penalty_id": record.pk, **details})


def _issue_for_profile(profile_id, cutoff):
    counts = Counter()
    with transaction.atomic():
        # Lock order: profile, penalty records, deductions. A profile busy with an
        # HR action or another worker is retried on the next run.
        profile = EmployeeProfile.objects.select_for_update(skip_locked=True).filter(pk=profile_id).first()
        if profile is None:
            counts["skipped"] += 1
            return counts
        records = list(
            PenaltyRecord.objects.select_for_update(of=("self",))
            .select_related("catalog", "attendance_result", "company", "employee_profile__user")
            .filter(
                employee_profile=profile,
                automation=Automation.WARNING_PENDING,
                status=PenaltyRecord.Status.PENDING_HR_MARK,
            )
            .order_by("occurred_on", "pk")
        )
        for record in records:
            if _settles_at(record) > cutoff:
                break  # Later candidates wait so occurrences stay chronological.
            occurrence = _next_occurrence(profile, record.catalog, record.occurred_on, exclude_id=record.pk)
            if occurrence > EXTRA_AUTO_WARNINGS + 1:
                record.automation = Automation.NONE
                record.save(update_fields=["automation", "updated_at"])
                audit(
                    None, "penalty_auto_warning_released_to_hr", "PenaltyRecord", record.pk, {"occurrence": occurrence}
                )
                counts["released"] += 1
                continue
            try:
                with transaction.atomic():
                    issue(record, marker={"decision": "auto_warning", "resolved_at": timezone.now().isoformat()})
                    record.automation = Automation.WARNING_ISSUED
                    record.save(update_fields=["automation", "updated_at"])
                    deliver(create_notice(record))
            except Exception as exc:
                _record_failure(record.pk, exc)
                counts["failed"] += 1
                break  # Keep chronological order; the next run retries this candidate first.
            counts["issued"] += 1
    return counts


@shared_task
def issue_auto_warnings():
    """Idempotent: only settled ``warning_pending`` candidates are issued, each once."""
    if auto_warnings_effective_from() is None:
        return {}
    cutoff = timezone.now() - timedelta(hours=auto_warning_settle_hours())
    profile_ids = (
        PenaltyRecord.objects.filter(automation=Automation.WARNING_PENDING, status=PenaltyRecord.Status.PENDING_HR_MARK)
        .order_by("employee_profile_id")
        .values_list("employee_profile_id", flat=True)
        .distinct()
    )
    counts = Counter()
    for profile_id in list(profile_ids):
        try:
            counts.update(_issue_for_profile(profile_id, cutoff))
        except Exception:
            counts["failed"] += 1
            logger.exception("penalty_auto_warning_profile_failed", extra={"employee_profile_id": profile_id})
    logger.info("penalty_auto_warnings_processed", extra=dict(counts))
    return dict(counts)
