from django.core.management.base import BaseCommand

from attendance.services import SyncBioTimeService


class Command(BaseCommand):
    help = "Synchronize attendance records from the defined BioTime 8.5 ZKTeco server"

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=1, help="Number of days back to sync (default: 1)")

    def handle(self, *args, **options):
        days_back = options["days"]
        self.stdout.write(self.style.NOTICE(f"Starting BioTime Sync for the last {days_back} days..."))

        successful, result = SyncBioTimeService.execute(days_back=days_back)
        message = result.pop("message", "BioTime sync completed.")
        counts = ", ".join(f"{key}={value}" for key, value in result.items())

        if successful:
            self.stdout.write(self.style.SUCCESS(f"Sync Complete: {message} ({counts})"))
        else:
            self.stdout.write(self.style.ERROR(f"Sync Failed: {message} ({counts})"))
