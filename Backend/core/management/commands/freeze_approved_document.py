"""Explicitly freeze one approved request whose automatic freeze did not run.

Requests are frozen automatically at final approval; older requests are
deliberately not backfilled. Use this only to recover a specific record (for
example after a storage outage), never in bulk.

The statuses a record must be in come from its adapter
(``DocumentType.final_statuses`` / ``final_check``), e.g. ``approved`` and
``deducted`` for loans, ``PROCESSED`` for asset returns, ``DECIDED`` for contract
ratings.
"""

from django.core.management.base import BaseCommand, CommandError

from core.document_integrity.registry import registered_types
from core.document_integrity.services import finalize_document, get_frozen_document


class Command(BaseCommand):
    help = "Freeze (and seal per DOCUMENT_SIGNING_MODE) one approved request that has no frozen copy."

    def add_arguments(self, parser):
        parser.add_argument("--type", required=True, help="Document type, e.g. leave_request.")
        parser.add_argument("--id", type=int, required=True)
        parser.add_argument("--force", action="store_true", help="Re-freeze even when a frozen copy exists.")

    def handle(self, *args, **options):
        adapter = registered_types().get(options["type"])
        if adapter is None:
            raise CommandError(f"Unknown document type. Known: {', '.join(registered_types())}")
        instance = adapter.model._default_manager.filter(pk=options["id"]).first()
        if instance is None:
            raise CommandError("Record not found.")
        if not adapter.is_final(instance):
            raise CommandError(f"Only records in a final status ({', '.join(adapter.final_statuses)}) can be frozen.")
        if get_frozen_document(instance) is not None and not options["force"]:
            raise CommandError("Already frozen; pass --force to create a new version.")
        document = finalize_document(instance)
        if document is None:
            raise CommandError("DOCUMENT_SIGNING_MODE is off.")
        self.stdout.write(self.style.SUCCESS(f"Frozen v{document.version} sha256={document.sha256}"))
