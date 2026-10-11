"""Per-person signing certificates issued by the internal CA (personal mode).

Certificates are issued lazily the first time a person approves something and
reused until they expire or are revoked. The subject is the person's profile
name plus their employee id and email. Revocation is recorded here (the internal
CA publishes no CRL/OCSP); verification consults this table by serial.
"""

from __future__ import annotations

import datetime as dt
import logging

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from core.pdf_signers import profile_for_user, profile_signer_name

from . import crypto
from .backends import get_signing_backend
from .models import SigningCertificate

logger = logging.getLogger(__name__)


def active_certificate(user) -> SigningCertificate | None:
    now = timezone.now()
    return (
        SigningCertificate.objects.filter(user=user, revoked_at__isnull=True, not_before__lte=now, not_after__gte=now)
        .order_by("-created_at", "-id")
        .first()
    )


def _subject_for(user):
    profile = profile_for_user(user)
    name = profile_signer_name(user) or str(getattr(user, "email", "") or f"User {user.pk}")
    employee_id = str(getattr(profile, "employee_id", "") or "") if profile is not None else ""
    email = str(getattr(user, "email", "") or "")
    return name, employee_id, email


def issue_certificate(user) -> SigningCertificate:
    """Issue a new certificate for ``user`` from the internal CA."""

    backend = get_signing_backend()
    ca_cert, ca_key = backend.certificate_authority()
    name, employee_id, email = _subject_for(user)
    organization = str(getattr(settings, "DOCUMENT_SIGNING_ORGANIZATION", "") or "")
    key = crypto.generate_key(crypto.PERSONAL_KEY_BITS)
    cert = crypto.build_certificate(
        subject=crypto.build_name(name, organization=organization, email=email, serial_number=employee_id),
        public_key=key.public_key(),
        issuer_cert=ca_cert,
        issuer_key=ca_key,
        days=max(1, int(getattr(settings, "DOCUMENT_SIGNING_PERSONAL_CERT_DAYS", 730) or 730)),
        extended_usages=crypto.DOCUMENT_SIGNING_USAGES,
    )
    record = SigningCertificate.objects.create(
        user=user,
        serial=crypto.serial_hex(cert.serial_number),
        subject_name=name,
        subject_email=email,
        employee_id=employee_id,
        certificate_pem=crypto.cert_pem(cert),
        encrypted_private_key=crypto.encrypt_private_key(key),
        key_backend="local",
        issuer_fingerprint=crypto.cert_fingerprint(ca_cert),
        not_before=cert.not_valid_before_utc,
        not_after=cert.not_valid_after_utc,
    )
    logger.info("document_signing.certificate_issued", extra={"user_id": user.pk, "serial": record.serial})
    return record


def get_or_issue_certificate(user) -> SigningCertificate | None:
    """The user's usable certificate, issuing one on first use.

    Inactive (offboarded) accounts never get a certificate.
    """

    if user is None or not getattr(user, "is_active", False):
        return None
    with transaction.atomic():
        type(user).objects.select_for_update().filter(pk=user.pk).first()
        existing = active_certificate(user)
        if existing is not None:
            return existing
        return issue_certificate(user)


def revoke_user_certificates(user, *, reason: str = "") -> int:
    """Revoke every unrevoked certificate of ``user`` (offboarding / compromise)."""

    count = SigningCertificate.objects.filter(user=user, revoked_at__isnull=True).update(
        revoked_at=timezone.now(), revocation_reason=(reason or "revoked")[:255]
    )
    if count:
        logger.info("document_signing.certificates_revoked", extra={"user_id": user.pk, "count": count})
    return count


def revocation_lookup(serials) -> dict[str, dt.datetime]:
    """``{serial_hex: revoked_at}`` for the revoked certificates among ``serials``."""

    serials = [s for s in serials if s]
    if not serials:
        return {}
    return dict(
        SigningCertificate.objects.filter(serial__in=serials, revoked_at__isnull=False).values_list(
            "serial", "revoked_at"
        )
    )
