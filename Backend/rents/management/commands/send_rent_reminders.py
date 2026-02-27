from datetime import date

from django.core.management.base import BaseCommand

from rents.models import Rent
from rents.services import compute_rent_state, send_rent_notifications


class Command(BaseCommand):
    help = "Send automatic rent reminders for upcoming rent due dates."

    def add_arguments(self, parser):
        parser.add_argument("--date", dest="for_date", help="Reference date in YYYY-MM-DD")
        parser.add_argument("--dry-run", action="store_true", dest="dry_run")

    def handle(self, *args, **options):
        ref_date = date.fromisoformat(options["for_date"]) if options.get("for_date") else None
        dry_run = bool(options.get("dry_run"))

        rents = Rent.objects.filter(is_active=True).select_related("rent_type", "asset", "created_by", "updated_by")
        eligible = []
        for rent in rents:
            computed = compute_rent_state(rent, today=ref_date)
            if computed.next_due_date is None or computed.days_remaining is None:
                continue
            if computed.days_remaining <= rent.reminder_days:
                eligible.append(rent)

        if dry_run:
            self.stdout.write(self.style.SUCCESS(f"Dry run complete. Eligible rents: {len(eligible)}"))
            return

        sent = 0
        for rent in eligible:
            delivery = send_rent_notifications(rent, manual=False, today=ref_date)
            if delivery.get("announcement", {}).get("sent") or delivery.get("email", {}).get("sent"):
                sent += 1

        self.stdout.write(self.style.SUCCESS(f"Processed {len(eligible)} eligible rents. Successful sends: {sent}"))
