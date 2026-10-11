"""PAdES signing with pyHanko: incremental per-person signatures and the seal."""

from __future__ import annotations

import asyncio
from io import BytesIO

from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.sign import fields, signers, timestamps

from .backends import SigningCredential
from .conf import tsa_timeout, tsa_url

SEAL_FIELD = "FFI_Organization_Seal"
APPROVAL_FIELD_PREFIX = "FFI_Approval_"


class TimestampUnavailable(RuntimeError):
    """The timestamp authority could not be reached or refused the request."""


def approval_field_name(index: int, role: str) -> str:
    safe_role = "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in role)[:40]
    return f"{APPROVAL_FIELD_PREFIX}{index:02d}_{safe_role}"


def role_from_field_name(field_name: str) -> str:
    if field_name == SEAL_FIELD:
        return "organization_seal"
    if field_name.startswith(APPROVAL_FIELD_PREFIX):
        return field_name[len(APPROVAL_FIELD_PREFIX) :].split("_", 1)[-1]
    return field_name


def build_timestamper() -> timestamps.TimeStamper | None:
    url = tsa_url()
    if not url:
        return None
    return timestamps.HTTPTimeStamper(url, timeout=tsa_timeout())


def _is_timestamp_failure(exc: BaseException) -> bool:
    try:
        import aiohttp  # noqa: PLC0415
    except ImportError:  # pragma: no cover
        aiohttp = None
    from pyhanko.sign.timestamps.common_utils import TimestampRequestError  # noqa: PLC0415

    seen = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, (TimestampRequestError, TimeoutError, asyncio.TimeoutError, ConnectionError)):
            return True
        if aiohttp is not None and isinstance(current, aiohttp.ClientError):
            return True
        current = current.__cause__ or current.__context__
    return False


def sign_pdf(
    pdf_bytes: bytes,
    credential: SigningCredential,
    *,
    field_name: str,
    reason: str,
    location: str = "",
    timestamper: timestamps.TimeStamper | None = None,
) -> bytes:
    """Add one PAdES signature as an incremental update (earlier revisions untouched)."""

    meta = signers.PdfSignatureMetadata(
        field_name=field_name,
        md_algorithm="sha256",
        reason=reason[:200],
        location=location[:100] or None,
        name=credential.common_name or None,
        subfilter=fields.SigSeedSubFilter.PADES,
    )
    writer = IncrementalPdfFileWriter(BytesIO(pdf_bytes))
    try:
        output = signers.PdfSigner(meta, credential.signer, timestamper=timestamper).sign_pdf(writer)
    except Exception as exc:
        if timestamper is not None and _is_timestamp_failure(exc):
            raise TimestampUnavailable(str(exc) or exc.__class__.__name__) from exc
        raise
    return output.getvalue()
