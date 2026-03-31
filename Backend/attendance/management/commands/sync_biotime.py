from django.core.management.base import BaseCommand
from django.utils import timezone
from attendance.services import SyncBioTimeService

class Command(BaseCommand):
    help = 'Synchronize attendance records from the defined BioTime 8.5 ZKTeco server'

    def add_arguments(self, parser):
        parser.add_argument('--days', type=int, default=1, help='Number of days back to sync (default: 1)')

    def handle(self, *args, **options):
        days_back = options['days']
        self.stdout.write(self.style.NOTICE(f'Starting BioTime Sync for the last {days_back} days...'))
        
        success, message = SyncBioTimeService.execute(days_back=days_back)
        
        if success:
            self.stdout.write(self.style.SUCCESS(f'Sync Complete: {message}'))
        else:
            self.stdout.write(self.style.ERROR(f'Sync Failed: {message}'))
