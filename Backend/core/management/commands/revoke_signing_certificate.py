"""Revoke a person's document-signing certificates (offboarding or key compromise)."""

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from core.document_integrity.certificates import revoke_user_certificates


class Command(BaseCommand):
    help = "Revoke every active document-signing certificate of a user."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True)
        parser.add_argument("--reason", default="revoked by administrator")

    def handle(self, *args, **options):
        user = get_user_model().objects.filter(email__iexact=options["email"]).first()
        if user is None:
            raise CommandError("No user with that email.")
        count = revoke_user_certificates(user, reason=options["reason"])
        self.stdout.write(self.style.SUCCESS(f"Revoked {count} certificate(s)."))
