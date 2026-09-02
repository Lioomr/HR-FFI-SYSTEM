"""Replay automatic absence detection over a date range.

Example:
    python manage.py backfill_absences --from 2026-08-01 --to 2026-08-31
"""

from datetime import date, timedelta

from django.core.management.base import BaseCommand, CommandError

from attendance.absence import mark_absentees_for_date


class Command(BaseCommand):
    help = "Create ABSENT attendance records for employees with no attendance in a date range."

    def add_arguments(self, parser):
        parser.add_argument("--from", dest="date_from", required=True, help="Start date (YYYY-MM-DD), inclusive.")
        parser.add_argument("--to", dest="date_to", required=True, help="End date (YYYY-MM-DD), inclusive.")
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would be created without writing (still respects working-day rules).",
        )

    def handle(self, *args, **options):
        try:
            date_from = date.fromisoformat(options["date_from"])
            date_to = date.fromisoformat(options["date_to"])
        except ValueError as exc:
            raise CommandError(f"Invalid date: {exc}") from exc
        if date_from > date_to:
            raise CommandError("--from must not be after --to.")

        totals = {"created": 0, "skipped_existing": 0, "skipped_on_leave": 0, "days": 0}
        current = date_from
        while current <= date_to:
            if options["dry_run"]:
                self.stdout.write(f"[dry-run] {current}: skipped (no writes)")
            else:
                result = mark_absentees_for_date(current, force=True)
                totals["created"] += result["created"]
                totals["skipped_existing"] += result["skipped_existing"]
                totals["skipped_on_leave"] += result["skipped_on_leave"]
                totals["days"] += 1
                self.stdout.write(
                    f"{current}: created={result['created']} "
                    f"existing={result['skipped_existing']} on_leave={result['skipped_on_leave']} "
                    f"non_working_day={result['non_working_day']}"
                )
            current += timedelta(days=1)

        if not options["dry_run"]:
            self.stdout.write(
                self.style.SUCCESS(
                    f"Done. {totals['days']} day(s) processed, {totals['created']} ABSENT record(s) created."
                )
            )
