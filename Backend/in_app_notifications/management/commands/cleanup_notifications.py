from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from in_app_notifications.models import Notification


class Command(BaseCommand):
    help = "Delete notifications older than the retention period (90 days by default)."

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=90)
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        days = options["days"]
        if days < 1:
            raise CommandError("--days must be at least 1.")
        cutoff = timezone.now() - timedelta(days=days)
        queryset = Notification.objects.filter(created_at__lt=cutoff)
        count = queryset.count()
        if options["dry_run"]:
            self.stdout.write(f"Would delete {count} notification(s) older than {days} days.")
            return
        deleted, _ = queryset.delete()
        self.stdout.write(self.style.SUCCESS(f"Deleted {deleted} notification(s) older than {days} days."))
