"""Retry sealing frozen documents whose seal is pending (e.g. TSA was unreachable)."""

from django.core.management.base import BaseCommand

from core.document_integrity.models import FrozenDocument
from core.document_integrity.services import seal_document


class Command(BaseCommand):
    help = "Retry the organization seal for frozen documents with a pending (or, with --include-failed, failed) seal."

    def add_arguments(self, parser):
        parser.add_argument("--document-id", type=int, action="append", default=[], help="Only this FrozenDocument id.")
        parser.add_argument("--include-failed", action="store_true", help="Also retry documents whose seal failed.")
        parser.add_argument("--limit", type=int, default=200)

    def handle(self, *args, **options):
        statuses = [FrozenDocument.SealStatus.PENDING]
        if options["include_failed"]:
            statuses.append(FrozenDocument.SealStatus.FAILED)
        queryset = FrozenDocument.objects.filter(seal_status__in=statuses).order_by("frozen_at")
        if options["document_id"]:
            queryset = queryset.filter(pk__in=options["document_id"])
        results = {}
        for document_id in queryset.values_list("pk", flat=True)[: options["limit"]]:
            status = seal_document(document_id, retry=True).seal_status
            results[status] = results.get(status, 0) + 1
            self.stdout.write(f"document {document_id}: {status}")
        self.stdout.write(self.style.SUCCESS(f"Done: {results or 'nothing to retry'}"))
