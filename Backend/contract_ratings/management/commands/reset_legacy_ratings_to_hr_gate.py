"""Send pre-HR-gate contract ratings back through the HR gate.

Migration 0003_hr_rating_gate backfilled every existing ContractRating with
rating_mode="RATE" because SKIP_TO_CEO did not exist yet, but that left rows
created before the gate shipped stuck in the full-rating flow with no way for
HR to route them to CEO instead. This command resets the ones that have not
progressed (no manager/employee response submitted yet) so HR can decide.

Example:
    python manage.py reset_legacy_ratings_to_hr_gate --dry-run
    python manage.py reset_legacy_ratings_to_hr_gate
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from contract_ratings.models import ContractRating


class Command(BaseCommand):
    help = "Reset untouched pre-HR-gate ContractRating rows back to PENDING_HR_GATE."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report which rows would be reset without writing.",
        )

    def handle(self, *args, **options):
        candidates = ContractRating.objects.filter(
            status__in=[
                ContractRating.Status.PENDING_RESPONSES,
                ContractRating.Status.WAITING_MANAGER,
                ContractRating.Status.WAITING_EMPLOYEE,
            ],
            manager_response__isnull=True,
            employee_response__isnull=True,
            hr_gate_decided_at__isnull=True,
        )

        if not candidates.exists():
            self.stdout.write("No legacy ratings need resetting.")
            return

        for rating in candidates:
            self.stdout.write(f"  rating #{rating.id} ({rating.status} -> PENDING_HR_GATE)")

        if options["dry_run"]:
            self.stdout.write(self.style.WARNING(f"Dry run: {candidates.count()} row(s) would be reset."))
            return

        with transaction.atomic():
            updated = candidates.update(status=ContractRating.Status.PENDING_HR_GATE, rating_mode="")

        self.stdout.write(self.style.SUCCESS(f"Reset {updated} row(s) to PENDING_HR_GATE."))
