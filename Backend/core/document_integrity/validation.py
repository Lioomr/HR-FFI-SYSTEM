"""Validate the digital signatures embedded in a PDF with pyHanko.

Trust is reported separately from cryptographic validity:

``trusted``         chains to a root in ``DOCUMENT_SIGNING_TRUSTED_ROOTS_PATH``
``untrusted_root``  chains to the internal (dev-grade) CA: cryptographically
                    valid, but no public trust - Adobe shows "unknown signer"
``unknown``         chains to no known root
"""

from __future__ import annotations

import logging
from datetime import datetime
from functools import lru_cache
from io import BytesIO
from pathlib import Path

from cryptography import x509
from django.conf import settings
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign.validation import validate_pdf_signature
from pyhanko_certvalidator import ValidationContext

from . import crypto
from .backends import get_signing_backend
from .certificates import revocation_lookup
from .pdf_signing import SEAL_FIELD, role_from_field_name

logger = logging.getLogger(__name__)

_ACCEPTABLE_MODIFICATION_LEVELS = {"NONE", "LTA_UPDATES", "FORM_FILLING"}


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _extra_trusted_roots() -> list[x509.Certificate]:
    path = str(getattr(settings, "DOCUMENT_SIGNING_TRUSTED_ROOTS_PATH", "") or "").strip()
    if not path:
        return []
    try:
        return crypto.load_pem_certificates(Path(path).read_bytes())
    except (OSError, ValueError):
        logger.warning("document_signing.trusted_roots_unreadable")
        return []


@lru_cache(maxsize=1)
def _public_tsa_roots() -> tuple:
    """Public roots (certifi) used only to judge RFC 3161 timestamp tokens."""

    try:
        import warnings

        import certifi

        with warnings.catch_warnings():
            # A few public roots carry non-RFC-5280 serials; cryptography warns on load.
            warnings.simplefilter("ignore")
            certs = crypto.load_pem_certificates(Path(certifi.where()).read_bytes())
        return tuple(crypto.to_asn1_cert(c) for c in certs)
    except Exception:
        return ()


def _internal_roots() -> list[x509.Certificate]:
    try:
        return get_signing_backend().trust_roots()
    except Exception:
        logger.warning("document_signing.internal_roots_unavailable", exc_info=True)
        return []


def _common_name(cert) -> str:
    try:
        return str(cert.subject.native.get("common_name") or "")
    except Exception:
        return ""


def _root_fingerprint(status) -> str:
    path = getattr(status, "validation_path", None)
    if path is None:
        return ""
    try:
        anchor_cert = path.trust_anchor.authority.certificate
    except Exception:
        anchor_cert = None
    if anchor_cert is None:
        try:
            anchor_cert = next(iter(path))
        except Exception:
            return ""
    return crypto.sha256_hex(anchor_cert.dump())


def _modification_ok(status) -> bool:
    if getattr(status, "docmdp_ok", None) is False:
        return False
    level = getattr(status, "modification_level", None)
    return level is None or getattr(level, "name", str(level)) in _ACCEPTABLE_MODIFICATION_LEVELS


def empty_validation() -> dict:
    return {"signature_count": 0, "signatures": [], "all_valid": None, "error": None}


def validate_pdf_bytes(pdf_bytes: bytes) -> dict:
    """Validate every embedded signature. Never raises for a malformed upload."""

    try:
        reader = PdfFileReader(BytesIO(pdf_bytes), strict=False)
        embedded = list(reader.embedded_signatures)
    except Exception as exc:
        logger.info("document_signing.pdf_unreadable", extra={"error": exc.__class__.__name__})
        return {**empty_validation(), "error": "unreadable_pdf", "all_valid": False}
    if not embedded:
        return empty_validation()

    internal = _internal_roots()
    external = _extra_trusted_roots()
    internal_fps = {crypto.sha256_hex(crypto.to_asn1_cert(c).dump()) for c in internal}
    roots = [crypto.to_asn1_cert(c) for c in internal + external]

    rows = []
    for signature in embedded:
        row = {
            "field": signature.field_name,
            "role": role_from_field_name(signature.field_name or ""),
            "is_seal": signature.field_name == SEAL_FIELD,
            "signer_name": None,
            "certificate_serial": None,
            "signed_at": None,
            "valid": False,
            "intact": False,
            "trust": "unknown",
            "timestamped": False,
            "timestamp": None,
            "timestamp_valid": None,
            "revoked": False,
            "error": None,
        }
        try:
            context = ValidationContext(trust_roots=list(roots), allow_fetching=False, revocation_mode="soft-fail")
            ts_context = ValidationContext(
                trust_roots=list(roots) + list(_public_tsa_roots()), allow_fetching=False, revocation_mode="soft-fail"
            )
            status = validate_pdf_signature(signature, context, ts_validation_context=ts_context)
        except Exception as exc:
            row["error"] = exc.__class__.__name__
            rows.append(row)
            continue

        cert = status.signing_cert
        row["signer_name"] = _common_name(cert) or None
        row["certificate_serial"] = crypto.serial_hex(cert.serial_number) if cert is not None else None
        row["intact"] = bool(status.intact)
        row["valid"] = bool(status.intact and status.valid and _modification_ok(status))
        if status.trusted:
            row["trust"] = "untrusted_root" if _root_fingerprint(status) in internal_fps else "trusted"
        ts = getattr(status, "timestamp_validity", None)
        if ts is not None:
            row["timestamped"] = True
            row["timestamp"] = _iso(getattr(ts, "timestamp", None))
            row["timestamp_valid"] = bool(ts.intact and ts.valid)
        row["signed_at"] = row["timestamp"] or _iso(getattr(status, "signer_reported_dt", None))
        rows.append(row)

    revoked = revocation_lookup([row["certificate_serial"] for row in rows if not row["is_seal"]])
    for row in rows:
        revoked_at = revoked.get(row["certificate_serial"] or "")
        if revoked_at is None:
            continue
        row["revoked"] = True
        signed_at = row["signed_at"]
        # A certificate revoked before it signed cannot vouch for that signature.
        if signed_at and datetime.fromisoformat(signed_at) >= revoked_at:
            row["valid"] = False

    return {
        "signature_count": len(rows),
        "signatures": rows,
        "all_valid": all(row["valid"] for row in rows),
        "error": None,
    }
