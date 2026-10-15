"""Remove automatic ABSENT rows that BioTime mapping rules no longer allow.

A system absence is only valid for a BioTime-mapped employee on or after the
mapping's ``attendance_start_date``. Rows for unmapped employees, or dated
before the mapping start, were created by earlier backfills and are removed.

Downstream references:

* Rows referenced by a penalty, a starting-work acknowledgment or verification,
  or an attendance correction request are kept and reported, never deleted.
* Each row's ``core.WorkflowInstance`` (a generic-relation wrapper that does not
  cascade) is deleted with it, so no orphaned workflow is left behind.
* Payroll does not read attendance rows; stored payroll snapshots are unchanged.

Reports only, unless ``--apply`` is passed.

Example:
    python manage.py purge_premapping_absences
    python manage.py purge_premapping_absences --apply
"""

from collections import Counter

from audit.utils import audit
from core.models import WorkflowInstance
from django.contrib.contenttypes.models import ContentType
from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Q

from attendance.biotime_policy import active_biotime_mappings
from attendance.models import AttendanceRecord


def removable_absences():
    """``(removable, kept_ids)`` for system ABSENT rows outside an active mapping's window."""
    starts = dict(active_biotime_mappings().values_list("employee_profile_id", "attendance_start_date"))
    before_start = Q()
    for profile_id, start in starts.items():
        if start is not None:
            before_start |= Q(employee_profile_id=profile_id, date__lt=start)
    invalid = AttendanceRecord.objects.filter(
        source=AttendanceRecord.Source.SYSTEM, status=AttendanceRecord.Status.ABSENT
    ).filter(~Q(employee_profile_id__in=list(starts)) | before_start)
    referenced = invalid.filter(
        Q(penaltyrecord__isnull=False)
        | Q(starting_work_acknowledgment__isnull=False)
        | Q(starting_work_verifications__isnull=False)
        | Q(correction_requests__isnull=False)
    )
    kept_ids = set(referenced.values_list("pk", flat=True))
    return invalid.exclude(pk__in=kept_ids), kept_ids


def workflow_wrappers(records):
    content_type = ContentType.objects.get_for_model(AttendanceRecord)
    return WorkflowInstance.objects.filter(
        content_type=content_type, object_id__in=records.values_list("pk", flat=True)
    )


class Command(BaseCommand):
    help = "Delete system ABSENT records for unmapped employees or dated before the BioTime mapping start."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Delete the rows (default only reports them).")

    def handle(self, *args, **options):
        removable, kept_ids = removable_absences()
        workflows = workflow_wrappers(removable)
        per_profile = Counter(removable.values_list("employee_profile_id", flat=True))
        self.stdout.write(
            f"{sum(per_profile.values())} removable ABSENT record(s) across {len(per_profile)} employee(s), "
            f"with {workflows.count()} workflow instance(s); "
            f"{len(kept_ids)} kept because another record references them."
        )
        for profile_id, count in sorted(per_profile.items()):
            self.stdout.write(f"  employee_profile={profile_id}: {count}")

        if not options["apply"]:
            self.stdout.write("Dry run. Re-run with --apply to delete.")
            return
        with transaction.atomic():
            workflow_count = workflows.count()
            workflows.delete()
            record_count = removable.count()
            removable.delete()
            audit(
                None,
                "attendance.premapping_absences_purged",
                entity="attendance_absence_run",
                entity_id="premapping",
                metadata={
                    "deleted_records": record_count,
                    "deleted_workflows": workflow_count,
                    "kept_referenced": len(kept_ids),
                    "profiles": len(per_profile),
                },
            )
        self.stdout.write(self.style.SUCCESS(f"Deleted {record_count} record(s) and {workflow_count} workflow(s)."))
