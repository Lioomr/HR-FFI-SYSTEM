"""Prepare (and inspect) the document-signing keys for the configured backend."""

from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from core.document_integrity import conf, crypto
from core.document_integrity.backends import get_signing_backend


class Command(BaseCommand):
    help = (
        "Create the dev CA and seal when none are configured, print their fingerprints, and optionally export the "
        "internal root certificate (to trust it in a PDF reader) or test the timestamp authority."
    )

    def add_arguments(self, parser):
        parser.add_argument("--export-root", help="Write the internal root CA certificate (PEM) to this path.")
        parser.add_argument("--check-tsa", action="store_true", help="Request a test timestamp from the TSA.")

    def handle(self, *args, **options):
        self.stdout.write(f"mode={conf.signing_mode()} backend={get_signing_backend().name} key_dir={conf.key_dir()}")
        backend = get_signing_backend()
        try:
            credential = backend.seal_credential()
            ca_cert, _ = backend.certificate_authority()
        except Exception as exc:
            raise CommandError(f"Signing keys are not usable: {exc}") from exc
        self.stdout.write(f"seal subject: {credential.certificate.subject.rfc4514_string()}")
        self.stdout.write(f"seal sha256 fingerprint: {crypto.cert_fingerprint(credential.certificate)}")
        self.stdout.write(f"internal root: {ca_cert.subject.rfc4514_string()}")
        self.stdout.write(f"internal root sha256 fingerprint: {crypto.cert_fingerprint(ca_cert)}")
        if options.get("export_root"):
            Path(options["export_root"]).write_text(crypto.cert_pem(ca_cert), encoding="ascii")
            self.stdout.write(f"root certificate written to {options['export_root']}")
        if options.get("check_tsa"):
            self._check_tsa()

    def _check_tsa(self):
        import asyncio
        import hashlib

        from pyhanko.sign.timestamps import HTTPTimeStamper

        url = conf.tsa_url()
        if not url:
            self.stdout.write(self.style.WARNING("No TSA configured (DOCUMENT_SIGNING_TSA_URL is empty)."))
            return
        try:
            stamper = HTTPTimeStamper(url, timeout=conf.tsa_timeout())
            token = asyncio.run(stamper.async_timestamp(hashlib.sha256(b"ffi-tsa-check").digest(), "sha256"))
        except Exception as exc:
            raise CommandError(f"TSA {url} is not usable: {exc.__class__.__name__}: {exc}") from exc
        self.stdout.write(self.style.SUCCESS(f"TSA {url} answered ({len(token.dump())} byte token)."))
