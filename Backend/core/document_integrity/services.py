"""Freeze, seal, sign and verify approved documents.

Lifecycle (``DOCUMENT_SIGNING_MODE``):

* ``off``      nothing is stored; downloads render live.
* ``freeze``   at final approval the PDF (plus an approval-trail page) is rendered
               once, stored privately and SHA-256 hashed. Downloads serve it.
* ``seal``     as ``freeze``, then one organization seal (PAdES-B-T when a TSA
               URL is set) is applied; ``sha256`` then covers the sealed bytes.
* ``personal`` as ``seal``, but each approver first signs with their own
               certificate (incremental updates, stage order), seal last.

Failures here never undo an approval: callers schedule work after commit and
everything is logged. Requests approved before this feature are not backfilled;
they report ``not_frozen``.
"""

from __future__ import annotations

import base64
import json
import logging
import re
from io import BytesIO

from django.contrib.contenttypes.models import ContentType
from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from audit.utils import audit

from . import conf, crypto, hash_records
from .models import DocumentApprovalSignature, DocumentIntegrityEvent, FrozenDocument, SigningCertificate
from .registry import DocumentType, document_type_for_instance, registered_types

logger = logging.getLogger(__name__)

STATUS_NOT_FROZEN = "not_frozen"
STATUS_FROZEN_VALID = "frozen_valid"
STATUS_SEALED_VALID = "sealed_valid"
STATUS_SIGNED_VALID = "signed_valid"
STATUS_TAMPERED = "tampered"
STATUS_MISSING_FILE = "missing_file"
STATUS_SEAL_PENDING = "seal_pending"
STATUS_SEAL_FAILED = "seal_failed"

#: Events exposed by the API; ``seal_failed`` stays in the DB and AuditLog only.
PUBLIC_EVENTS = {"frozen", "downloaded", "verified", "sealed", "seal_retry"}
MAX_EVENTS = 100

FILE_OK = "ok"
FILE_MISSING = "missing"
FILE_MISMATCH = "mismatch"


class DocumentIntegrityError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# Lookups and small helpers
# ---------------------------------------------------------------------------


def _adapter(instance) -> DocumentType:
    adapter = document_type_for_instance(instance)
    if adapter is None:
        raise DocumentIntegrityError(f"{type(instance).__name__} is not registered for document integrity.")
    return adapter


def get_frozen_document(instance) -> FrozenDocument | None:
    content_type = ContentType.objects.get_for_model(type(instance))
    return FrozenDocument.objects.filter(content_type=content_type, object_id=instance.pk).first()


def _actor_name(user) -> str | None:
    if user is None:
        return None
    from core.pdf_signers import profile_signer_name

    return profile_signer_name(user) or str(getattr(user, "email", "") or "") or None


def _read_file(field_file) -> bytes | None:
    if not field_file or not getattr(field_file, "name", ""):
        return None
    try:
        field_file.open("rb")
        try:
            return field_file.read()
        finally:
            field_file.close()
    except (OSError, ValueError):
        return None


def _file_state(document: FrozenDocument) -> tuple[str, bytes | None]:
    data = _read_file(document.file)
    if data is None:
        return FILE_MISSING, None
    if crypto.sha256_hex(data) != document.sha256:
        return FILE_MISMATCH, data
    return FILE_OK, data


def log_event(document: FrozenDocument, event: str, *, actor=None, request=None, metadata=None) -> None:
    metadata = dict(metadata or {})
    if actor is None and request is not None and getattr(request, "user", None) is not None:
        actor = request.user if request.user.is_authenticated else None
    DocumentIntegrityEvent.objects.create(document=document, event=event, actor=actor, metadata=metadata)
    audit(
        request,
        f"document_{event}",
        entity=document.document_type,
        entity_id=document.object_id,
        metadata={
            "frozen_document_id": document.pk,
            "sha256": document.sha256,
            "reference": document.reference,
            **metadata,
        },
        actor=actor,
    )


def _storage_name(document_type: str, object_id: int, version: int, digest: str, suffix: str = "") -> str:
    return f"{document_type}/{object_id}/v{version}{suffix}_{digest[:16]}.pdf"


# ---------------------------------------------------------------------------
# Phase 1: freeze
# ---------------------------------------------------------------------------


def freeze_document(instance, pdf_bytes: bytes, *, actor=None, request=None, mode: str | None = None, plan=None):
    """Store ``pdf_bytes`` as the frozen copy of ``instance`` and hash it.

    Re-freezing (an HR manual record edited after approval) bumps ``version``;
    the previous hash stays in the event and audit trail.
    """

    adapter = _adapter(instance)
    mode = mode or conf.signing_mode()
    digest = crypto.sha256_hex(pdf_bytes)
    content_type = ContentType.objects.get_for_model(type(instance))
    company = adapter.company(instance)
    with transaction.atomic():
        document = (
            FrozenDocument.objects.select_for_update().filter(content_type=content_type, object_id=instance.pk).first()
        )
        previous = None
        if document is None:
            document = FrozenDocument(content_type=content_type, object_id=instance.pk, version=1)
        else:
            previous = {"previous_sha256": document.sha256, "previous_version": document.version}
            if document.unsigned_sha256 and document.unsigned_sha256 != document.sha256:
                # The pre-seal copy of the superseded version may also be in circulation.
                previous["previous_unsigned_sha256"] = document.unsigned_sha256
            document.version += 1
            document.unsigned_file = ""
            document.unsigned_sha256 = ""
        document.document_type = adapter.key
        document.reference = adapter.reference(instance)[:80]
        document.company = company
        document.signing_mode = mode
        document.frozen_at = timezone.now()
        document.frozen_by = actor if getattr(actor, "is_authenticated", False) else None
        document.sha256 = digest
        document.size_bytes = len(pdf_bytes)
        document.seal_status = (
            FrozenDocument.SealStatus.PENDING if conf.sealing_enabled(mode) else FrozenDocument.SealStatus.NONE
        )
        document.seal_error = ""
        document.seal_attempts = 0
        document.sealed_at = None
        document.timestamped = False
        document.signing_plan = list(plan or [])
        document.last_validation = {}
        document.last_verified_at = None
        document.file.save(
            _storage_name(adapter.key, instance.pk, document.version, digest), ContentFile(pdf_bytes), save=False
        )
        document.save()
        log_event(
            document,
            DocumentIntegrityEvent.Event.FROZEN,
            actor=document.frozen_by,
            request=request,
            metadata={"mode": mode, "version": document.version, **(previous or {})},
        )
    return document


def _stage_rows(adapter: DocumentType, instance, certificates: dict | None = None):
    from .trail import TrailRow

    certificates = certificates or {}
    rows = []
    for stage in adapter.stage_signers(instance):
        cert = certificates.get(getattr(stage.actor, "pk", None))
        rows.append(
            TrailRow(
                role_label=stage.role_label,
                name=_actor_name(stage.actor) or "-",
                action_label=stage.action_label,
                at=stage.at,
                certificate_serial=cert.serial if cert else "",
            )
        )
    return rows


def _personal_plan(adapter: DocumentType, instance) -> tuple[list[dict], dict]:
    """Resolve (issuing lazily) each approver's certificate, fixed at freeze time."""

    from .certificates import get_or_issue_certificate

    plan, certificates = [], {}
    for stage in adapter.stage_signers(instance):
        actor = stage.actor
        if actor is None:
            continue
        if actor.pk not in certificates:
            certificates[actor.pk] = get_or_issue_certificate(actor)
        cert = certificates[actor.pk]
        plan.append(
            {
                "role": stage.role,
                "role_label": stage.role_label,
                "actor_id": actor.pk,
                "at": stage.at.isoformat() if stage.at else None,
                "certificate_id": cert.pk if cert else None,
            }
        )
    return plan, {pk: cert for pk, cert in certificates.items() if cert is not None}


def build_final_pdf(instance, *, mode: str, frozen_at=None, certificates=None) -> bytes:
    """The approved form itself, stamped with a hidden reference.

    The approval trail is deliberately not part of this file: it is an HR work
    paper built on demand (``build_workpaper_pdf``) so it can show times in the
    viewer's own timezone, and employees read the same trail in the app.
    """

    from .trail import stamp_document_reference

    adapter = _adapter(instance)
    reference = adapter.reference(instance)
    document = adapter.render(instance)
    return stamp_document_reference(
        document, reference_token=f"{adapter.key}:{instance.pk}:{reference}", title=f"{adapter.label} {reference}"
    )


def build_workpaper_pdf(instance, frozen_bytes: bytes, *, tz=None) -> bytes:
    """Frozen form + a live approval-trail page, for HR only (not the verifiable original)."""

    from .trail import append_pdf, render_trail_page

    adapter = _adapter(instance)
    document = get_frozen_document(instance)
    certificates = {}
    for sig in DocumentApprovalSignature.objects.filter(
        content_type=ContentType.objects.get_for_model(type(instance)), object_id=instance.pk
    ).select_related("certificate"):
        certificates[sig.actor_id] = sig.certificate
    trail = render_trail_page(
        _stage_rows(adapter, instance, certificates),
        title=adapter.label,
        reference=adapter.reference(instance),
        subject=adapter.subject(instance),
        frozen_at=document.frozen_at if document is not None else timezone.now(),
        mode=document.signing_mode if document is not None else conf.signing_mode(),
        tz=tz,
    )
    return append_pdf(frozen_bytes, trail)


def finalize_document(instance, *, actor=None, request=None) -> FrozenDocument | None:
    """Freeze (and, by mode, seal/sign) a request that just reached final approval."""

    mode = conf.signing_mode()
    if mode == conf.MODE_OFF:
        return None
    adapter = _adapter(instance)
    plan, certificates = ([], {})
    if conf.personal_signing_enabled(mode):
        plan, certificates = _personal_plan(adapter, instance)
    pdf_bytes = build_final_pdf(instance, mode=mode, certificates=certificates)
    document = freeze_document(instance, pdf_bytes, actor=actor, request=request, mode=mode, plan=plan)
    if conf.sealing_enabled(mode):
        schedule_seal(document)
    return document


def _safe_finalize(model, pk, actor_id):
    from django.contrib.auth import get_user_model

    try:
        instance = model._default_manager.get(pk=pk)
        actor = get_user_model().objects.filter(pk=actor_id).first() if actor_id else None
        finalize_document(instance, actor=actor)
    except Exception:
        logger.exception("document_integrity.finalize_failed", extra={"model": model.__name__, "object_id": pk})


def schedule_finalize(instance, *, actor=None) -> None:
    """Freeze ``instance`` once the surrounding transaction commits."""

    if not conf.freezing_enabled():
        return
    model, pk, actor_id = type(instance), instance.pk, getattr(actor, "pk", None)
    transaction.on_commit(lambda: _safe_finalize(model, pk, actor_id))


# ---------------------------------------------------------------------------
# Phase 2/3: seal and personal signatures
# ---------------------------------------------------------------------------


def schedule_seal(document: FrozenDocument) -> None:
    document_id = document.pk

    def _dispatch():
        if conf.seal_async():
            try:
                from core.tasks import seal_frozen_document

                seal_frozen_document.delay(document_id)
                return
            except Exception:
                logger.warning("document_integrity.seal_dispatch_failed", extra={"document_id": document_id})
        try:
            seal_document(document_id)
        except Exception:
            logger.exception("document_integrity.seal_inline_failed", extra={"document_id": document_id})

    transaction.on_commit(_dispatch)


def _apply_personal_signatures(pdf_bytes: bytes, plan: list[dict], backend) -> tuple[bytes, list[str]]:
    from .pdf_signing import approval_field_name, sign_pdf

    skipped = []
    certificates = SigningCertificate.objects.in_bulk([e["certificate_id"] for e in plan if e.get("certificate_id")])
    for index, entry in enumerate(plan, start=1):
        cert = certificates.get(entry.get("certificate_id"))
        if cert is None or not cert.is_usable():
            skipped.append(entry.get("role", ""))
            continue
        credential = backend.personal_credential(cert)
        when = entry.get("at") or ""
        pdf_bytes = sign_pdf(
            pdf_bytes,
            credential,
            field_name=approval_field_name(index, entry.get("role", "approver")),
            reason=f"{entry.get('role_label') or entry.get('role')} approval recorded {when}".strip(),
        )
    return pdf_bytes, skipped


def seal_document(document_id: int, *, actor=None, request=None, retry: bool = False) -> FrozenDocument:
    """Sign the frozen PDF (personal signatures, then the seal). Idempotent."""

    from .backends import get_signing_backend
    from .pdf_signing import SEAL_FIELD, TimestampUnavailable, build_timestamper, sign_pdf
    from .validation import validate_pdf_bytes

    with transaction.atomic():
        document = FrozenDocument.objects.select_for_update().get(pk=document_id)
        if document.seal_status == FrozenDocument.SealStatus.SEALED or not conf.sealing_enabled(document.signing_mode):
            return document
        if retry:
            log_event(document, DocumentIntegrityEvent.Event.SEAL_RETRY, actor=actor, request=request)

        source_field = document.unsigned_file if document.unsigned_file else document.file
        expected = document.unsigned_sha256 or document.sha256
        source = _read_file(source_field)
        document.seal_attempts += 1
        if source is None or crypto.sha256_hex(source) != expected:
            document.seal_status = FrozenDocument.SealStatus.FAILED
            document.seal_error = "The frozen file is missing or no longer matches its recorded hash."
            document.save(update_fields=["seal_status", "seal_error", "seal_attempts", "updated_at"])
            log_event(
                document,
                DocumentIntegrityEvent.Event.SEAL_FAILED,
                actor=actor,
                request=request,
                metadata={"reason": "source_integrity"},
            )
            return document

        skipped: list[str] = []
        try:
            backend = get_signing_backend()
            signed = source
            if conf.personal_signing_enabled(document.signing_mode) and document.signing_plan:
                signed, skipped = _apply_personal_signatures(signed, document.signing_plan, backend)
            timestamper = build_timestamper()
            signed = sign_pdf(
                signed,
                backend.seal_credential(),
                field_name=SEAL_FIELD,
                reason=f"Sealed at final approval of {document.reference}".strip(),
                timestamper=timestamper,
            )
        except TimestampUnavailable as exc:
            document.seal_status = FrozenDocument.SealStatus.PENDING
            document.seal_error = f"Timestamp authority unavailable: {exc}"[:2000]
            document.save(update_fields=["seal_status", "seal_error", "seal_attempts", "updated_at"])
            log_event(
                document,
                DocumentIntegrityEvent.Event.SEAL_FAILED,
                actor=actor,
                request=request,
                metadata={"reason": "tsa_unavailable"},
            )
            return document
        except Exception as exc:
            logger.exception("document_integrity.seal_failed", extra={"document_id": document_id})
            document.seal_status = FrozenDocument.SealStatus.FAILED
            document.seal_error = f"{exc.__class__.__name__}: {exc}"[:2000]
            document.save(update_fields=["seal_status", "seal_error", "seal_attempts", "updated_at"])
            log_event(
                document,
                DocumentIntegrityEvent.Event.SEAL_FAILED,
                actor=actor,
                request=request,
                metadata={"reason": exc.__class__.__name__},
            )
            return document

        digest = crypto.sha256_hex(signed)
        if not document.unsigned_file:
            document.unsigned_file = document.file.name
            document.unsigned_sha256 = document.sha256
        document.file.save(
            _storage_name(document.document_type, document.object_id, document.version, digest, "_sealed"),
            ContentFile(signed),
            save=False,
        )
        document.sha256 = digest
        document.size_bytes = len(signed)
        document.seal_status = FrozenDocument.SealStatus.SEALED
        document.seal_error = ""
        document.sealed_at = timezone.now()
        document.timestamped = timestamper is not None
        document.last_validation = validate_pdf_bytes(signed)
        document.last_verified_at = timezone.now()
        document.save()
        log_event(
            document,
            DocumentIntegrityEvent.Event.SEALED,
            actor=actor,
            request=request,
            metadata={
                "timestamped": document.timestamped,
                "personal_signatures": document.last_validation.get("signature_count", 1) - 1,
                "skipped_roles": skipped,
            },
        )
    return document


def record_stage_approval(instance, *, role: str, actor, at=None) -> None:
    """Personal mode: capture the approver's signed attestation after commit.

    Issues the approver's certificate on their first approval. Never raises.
    """

    if not conf.personal_signing_enabled() or actor is None or instance is None:
        return
    model, pk, actor_id = type(instance), instance.pk, actor.pk
    at = at or timezone.now()

    def _run():
        from django.contrib.auth import get_user_model

        from .certificates import get_or_issue_certificate

        try:
            fresh = model._default_manager.get(pk=pk)
            user = get_user_model().objects.get(pk=actor_id)
            cert = get_or_issue_certificate(user)
            if cert is None:
                return
            adapter = _adapter(fresh)
            payload = {
                "document_type": adapter.key,
                "object_id": pk,
                "reference": adapter.reference(fresh),
                "role": role,
                "actor_id": actor_id,
                "actor_name": _actor_name(user),
                "approved_at": at.isoformat(),
                "certificate_serial": cert.serial,
            }
            canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
            signature = crypto.sign_payload(crypto.decrypt_private_key(cert.encrypted_private_key), canonical)
            DocumentApprovalSignature.objects.create(
                content_type=ContentType.objects.get_for_model(model),
                object_id=pk,
                document_type=adapter.key,
                role=role,
                actor=user,
                certificate=cert,
                approved_at=at,
                payload=payload,
                payload_sha256=crypto.sha256_hex(canonical),
                signature=base64.b64encode(signature).decode("ascii"),
            )
        except Exception:
            logger.exception("document_integrity.stage_attestation_failed", extra={"object_id": pk, "role": role})

    transaction.on_commit(_run)


def verify_attestation(attestation: DocumentApprovalSignature) -> bool:
    canonical = json.dumps(attestation.payload, sort_keys=True, separators=(",", ":")).encode()
    if crypto.sha256_hex(canonical) != attestation.payload_sha256:
        return False
    cert = crypto.load_pem_certificates(attestation.certificate.certificate_pem.encode())[0]
    return crypto.verify_payload(cert, canonical, base64.b64decode(attestation.signature))


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------


def frozen_pdf(instance) -> tuple[FrozenDocument | None, bytes | None, str]:
    """Return ``(document, bytes, state)`` where state is ``not_frozen``/``ok``/``missing``/``mismatch``."""

    document = get_frozen_document(instance)
    if document is None:
        return None, None, STATUS_NOT_FROZEN
    state, data = _file_state(document)
    return document, data, state


def log_download(document: FrozenDocument, *, request=None) -> None:
    log_event(document, DocumentIntegrityEvent.Event.DOWNLOADED, request=request)


# ---------------------------------------------------------------------------
# Status / verification payloads
# ---------------------------------------------------------------------------


def _empty_seal() -> dict:
    return {
        "present": False,
        "valid": None,
        "timestamped": False,
        "timestamp": None,
        "signer": None,
        "trust": "unknown",
    }


def _seal_and_signatures(validation: dict) -> tuple[dict, list[dict]]:
    seal = _empty_seal()
    signatures = []
    for row in validation.get("signatures", []):
        if row.get("is_seal"):
            seal = {
                "present": True,
                "valid": row.get("valid"),
                "timestamped": bool(row.get("timestamped")),
                "timestamp": row.get("timestamp"),
                "signer": row.get("signer_name"),
                "trust": row.get("trust") or "unknown",
            }
            continue
        signatures.append(
            {
                "role": row.get("role") or "",
                "signer_name": row.get("signer_name") or "",
                "signed_at": row.get("signed_at"),
                "valid": row.get("valid"),
                "certificate_serial": row.get("certificate_serial"),
                "revoked": bool(row.get("revoked")),
                "trust": row.get("trust") or "unknown",
            }
        )
    return seal, signatures


def _overall_status(document: FrozenDocument, file_state: str, validation: dict) -> str:
    if file_state == FILE_MISSING:
        return STATUS_MISSING_FILE
    if file_state == FILE_MISMATCH:
        return STATUS_TAMPERED
    if document.seal_status == FrozenDocument.SealStatus.PENDING:
        return STATUS_SEAL_PENDING
    if document.seal_status == FrozenDocument.SealStatus.FAILED:
        return STATUS_SEAL_FAILED
    if document.seal_status == FrozenDocument.SealStatus.SEALED:
        if validation.get("all_valid") is False or not validation.get("signature_count"):
            return STATUS_TAMPERED
        rows = validation.get("signatures", [])
        return STATUS_SIGNED_VALID if any(not row.get("is_seal") for row in rows) else STATUS_SEALED_VALID
    return STATUS_FROZEN_VALID


def _events(document: FrozenDocument) -> list[dict]:
    rows = (
        DocumentIntegrityEvent.objects.filter(document=document, event__in=PUBLIC_EVENTS)
        .select_related("actor", "actor__employee_profile")
        .order_by("-created_at", "-id")[:MAX_EVENTS]
    )
    return [
        {
            "event": row.event,
            "at": row.created_at.isoformat(),
            "by": _actor_name(row.actor),
            "by_profile_id": _profile_id(row.actor),
        }
        for row in rows
    ]


def _profile_id(user) -> int | None:
    profile = getattr(user, "employee_profile", None) if user is not None else None
    return getattr(profile, "pk", None)


def for_viewer(payload: dict, request) -> dict:
    """Keep profile ids only for viewers who have a profile page to open.

    HR managers and system admins can open ``/hr/employees/:id``; for everyone
    else an id would be an id they cannot use, so it is removed.  Signers are
    resolved from the certificate that signed, so the link always points at the
    person whose key was used.
    """

    from core.permissions import get_role

    user = getattr(request, "user", None)
    allowed = user is not None and user.is_authenticated and get_role(user) in {"HRManager", "SystemAdmin"}
    for event in payload.get("events") or []:
        if not allowed:
            event.pop("by_profile_id", None)
    signatures = payload.get("signatures") or []
    serials = [row.get("certificate_serial") for row in signatures if row.get("certificate_serial")]
    owners = {}
    if allowed and serials:
        owners = {
            cert.serial: _profile_id(cert.user)
            for cert in SigningCertificate.objects.filter(serial__in=serials).select_related("user__employee_profile")
        }
    for row in signatures:
        profile_id = owners.get(row.get("certificate_serial"))
        if profile_id:
            row["profile_id"] = profile_id
    return payload


def _document_payload(document: FrozenDocument | None, *, revalidate: bool, include_events: bool) -> dict:
    from .validation import validate_pdf_bytes

    payload = {
        "status": STATUS_NOT_FROZEN,
        "frozen_at": None,
        "sha256": None,
        "signing_mode": conf.signing_mode(),
        "seal": _empty_seal(),
        "signatures": [],
    }
    if include_events:
        payload["events"] = []
    if document is None:
        return payload

    file_state, data = _file_state(document)
    validation = document.last_validation or {}
    if file_state == FILE_OK and document.seal_status == FrozenDocument.SealStatus.SEALED:
        if revalidate or not validation:
            validation = validate_pdf_bytes(data)
            FrozenDocument.objects.filter(pk=document.pk).update(
                last_validation=validation, last_verified_at=timezone.now()
            )
            document.last_validation = validation
    seal, signatures = _seal_and_signatures(validation if file_state == FILE_OK else {})
    payload.update(
        {
            "status": _overall_status(document, file_state, validation),
            "frozen_at": document.frozen_at.isoformat(),
            "sha256": document.sha256,
            "signing_mode": document.signing_mode,
            "seal": seal,
            "signatures": signatures,
        }
    )
    if include_events:
        payload["events"] = _events(document)
    return payload


def integrity_payload(instance, *, include_events: bool = True) -> dict:
    """Current status: re-hashes the stored file, reuses the last signature validation."""

    return _document_payload(get_frozen_document(instance), revalidate=False, include_events=include_events)


def verify_instance(instance, *, request=None) -> dict:
    """Re-hash and fully re-validate the stored file, recording a ``verified`` event."""

    document = get_frozen_document(instance)
    if document is not None:
        result = _document_payload(document, revalidate=True, include_events=False)
        log_event(
            document,
            DocumentIntegrityEvent.Event.VERIFIED,
            request=request,
            metadata={"result": result["status"], "source": "stored_file"},
        )
    return _document_payload(document, revalidate=False, include_events=True)


def retry_seal(instance, *, request=None) -> FrozenDocument:
    document = get_frozen_document(instance)
    if document is None:
        raise DocumentIntegrityError("This document has not been frozen.")
    if document.seal_status not in (FrozenDocument.SealStatus.PENDING, FrozenDocument.SealStatus.FAILED):
        raise DocumentIntegrityError("Only documents whose seal is pending or failed can be retried.")
    actor = request.user if request is not None and request.user.is_authenticated else None
    return seal_document(document.pk, actor=actor, request=request, retry=True)


def _reference_token(pdf_bytes: bytes) -> str:
    try:
        from pypdf import PdfReader

        metadata = PdfReader(BytesIO(pdf_bytes), strict=False).metadata or {}
        return str(metadata.get("/FFIDocumentRef") or "")
    except Exception:
        return ""


#: ``LR-00012`` style fallbacks and real public references such as ``LV-FFI-000101`` or
#: ``LN-EDL-900201`` (prefix, sequential employee code, request sequence).
_VISIBLE_REFERENCE_RE = re.compile(r"\b[A-Z]{1,8}(?:-[A-Z][A-Z0-9_]*)?-\d{3,}\b")


def _visible_references(pdf_bytes: bytes) -> set[str]:
    """Reference-shaped strings printed on the first two pages (empty when unreadable)."""

    try:
        from pypdf import PdfReader

        reader = PdfReader(BytesIO(pdf_bytes), strict=False)
        text = "\n".join((page.extract_text() or "") for page in list(reader.pages)[:2])
    except Exception:
        return set()
    return set(_VISIBLE_REFERENCE_RE.findall(text))


def _document_for_visible_reference(pdf_bytes: bytes) -> FrozenDocument | None:
    """Match an edited copy by the reference number printed on its first page.

    Editors such as Canva rewrite the PDF metadata, which drops the hidden
    ``/FFIDocumentRef`` tag, but the visible reference survives.  A single
    unambiguous match is enough to say "this claims to be that document".
    """

    candidates = _visible_references(pdf_bytes)
    if not candidates:
        return None
    matches = list(FrozenDocument.objects.filter(reference__in=candidates)[:2])
    return matches[0] if len(matches) == 1 else None


def _document_for_token(token: str) -> FrozenDocument | None:
    parts = token.split(":", 2)
    if len(parts) < 2 or parts[0] not in registered_types() or not parts[1].isdigit():
        return None
    return FrozenDocument.objects.filter(document_type=parts[0], object_id=int(parts[1])).first()


def _authorized(document: FrozenDocument, request) -> bool:
    adapter = registered_types().get(document.document_type)
    if adapter is None:
        return False
    try:
        return adapter.accessible_queryset(request).filter(pk=document.object_id).exists()
    except Exception:
        logger.exception("document_integrity.authorization_check_failed")
        return False


SUMMARIES = {
    STATUS_NOT_FROZEN: "No matching approved document was found and the file carries no digital signatures.",
    STATUS_FROZEN_VALID: "The file is identical to the approved document stored by the system.",
    STATUS_SEALED_VALID: "The file is sealed and unchanged since the organization seal was applied.",
    STATUS_SIGNED_VALID: "The file carries valid approver signatures and seal, and is unchanged since signing.",
    STATUS_TAMPERED: "The file does not match the approved document: it was modified after approval or signing.",
    STATUS_MISSING_FILE: "The stored approved copy of this document is missing.",
    STATUS_SEAL_PENDING: "The file matches the approved document; its digital seal is still pending.",
    STATUS_SEAL_FAILED: "The file matches the approved document, but applying its digital seal failed.",
}


SUPERSEDED_SUMMARY = (
    "The file is an earlier approved version of this document; it is unchanged, "
    "but a newer version has since been issued."
)


def _superseded_frozen_event(digest: str) -> DocumentIntegrityEvent | None:
    """The re-freeze event that replaced a version whose (sealed or pre-seal) hash is ``digest``."""

    return (
        DocumentIntegrityEvent.objects.filter(event=DocumentIntegrityEvent.Event.FROZEN)
        .filter(Q(metadata__previous_sha256=digest) | Q(metadata__previous_unsigned_sha256=digest))
        .select_related("document")
        .order_by("-id")
        .first()
    )


def _superseded_version(event: DocumentIntegrityEvent) -> int | None:
    version = (event.metadata or {}).get("previous_version")
    return version if isinstance(version, int) else None


def _superseded_frozen_at(event: DocumentIntegrityEvent) -> str | None:
    version = _superseded_version(event)
    if version is None:
        return None
    original = (
        DocumentIntegrityEvent.objects.filter(
            document_id=event.document_id, event=DocumentIntegrityEvent.Event.FROZEN, metadata__version=version
        )
        .order_by("id")
        .first()
    )
    return original.created_at.isoformat() if original is not None else None


HASH_ONLY_SIGNING_MODE = "hash_only"
HASH_ONLY_SUMMARIES = {
    STATUS_FROZEN_VALID: (
        "The file is identical to the notice issued by the system. Hash-verified only: "
        "the notice carries no digital signatures or seal."
    ),
    STATUS_TAMPERED: (
        "The file carries this notice's reference but does not match the issued notice: "
        "it was modified after issuance. Hash-verified only: the notice carries no digital signatures or seal."
    ),
}


def _hash_only_result(match, *, digest: str, validation: dict, request) -> dict:
    """verify-upload response for a notice row that stores only its issuance hash."""

    seal, signatures = _seal_and_signatures(validation)
    status = STATUS_FROZEN_VALID if match.exact else STATUS_TAMPERED
    hashed_at = match.instance.document_hashed_at
    matched = match.matched_record()
    audit(
        request,
        "document_upload_verified",
        entity=matched["type"],
        entity_id=matched["id"],
        metadata={"upload_sha256": digest, "matched": True, "result": status, "verification": HASH_ONLY_SIGNING_MODE},
    )
    return {
        "matched_record": matched,
        "integrity": {
            "status": status,
            "frozen_at": hashed_at.isoformat() if hashed_at else None,
            "sha256": digest,
            "signing_mode": HASH_ONLY_SIGNING_MODE,
            "seal": seal,
            "signatures": signatures,
        },
        "summary": HASH_ONLY_SUMMARIES[status],
    }


def verify_uploaded_pdf(data: bytes, *, request) -> dict:
    """Independently verify an uploaded PDF, matching it to a stored record when allowed."""

    from .validation import validate_pdf_bytes

    digest = crypto.sha256_hex(data)
    validation = validate_pdf_bytes(data)
    document = FrozenDocument.objects.filter(Q(sha256=digest) | Q(unsigned_sha256=digest)).first()
    superseded = None
    if document is None:
        # An earlier version of a re-frozen document (e.g. the job offer the candidate
        # received before answering): genuine, but no longer the current copy.
        superseded = _superseded_frozen_event(digest)
        document = superseded.document if superseded is not None else None
    exact = document is not None
    hash_only = None
    if document is None:
        # System-issued letters (warning / late notices) keep only an issuance hash on their row.
        hash_only = hash_records.match_by_hash(digest, request)
    if document is None and hash_only is None:
        document = _document_for_token(_reference_token(data)) or _document_for_visible_reference(data)
    if document is not None and not _authorized(document, request):
        document, exact, superseded = None, False, None
    if document is None and hash_only is None:
        hash_only = hash_records.match_by_reference(_visible_references(data), request)
    if hash_only is not None:
        return _hash_only_result(hash_only, digest=digest, validation=validation, request=request)

    seal, signatures = _seal_and_signatures(validation)
    integrity = {
        "status": STATUS_NOT_FROZEN,
        "frozen_at": None,
        "sha256": digest,
        "signing_mode": conf.signing_mode(),
        "seal": seal,
        "signatures": signatures,
    }
    if document is not None:
        integrity["frozen_at"] = document.frozen_at.isoformat()
        integrity["signing_mode"] = document.signing_mode
        if not exact:
            integrity["status"] = STATUS_TAMPERED
        elif superseded is not None:
            integrity["frozen_at"] = _superseded_frozen_at(superseded) or integrity["frozen_at"]
            if validation.get("signature_count"):
                integrity["status"] = (
                    (STATUS_SIGNED_VALID if signatures else STATUS_SEALED_VALID)
                    if validation.get("all_valid")
                    else STATUS_TAMPERED
                )
            else:
                integrity["status"] = STATUS_FROZEN_VALID
        elif digest == document.sha256:
            stored = _document_payload(document, revalidate=False, include_events=False)
            integrity["status"] = stored["status"]
            if validation.get("all_valid") is False:
                integrity["status"] = STATUS_TAMPERED
        else:
            # The pre-seal frozen copy: identical to what was approved, not yet sealed.
            integrity["status"] = (
                STATUS_SEAL_PENDING
                if document.seal_status == FrozenDocument.SealStatus.PENDING
                else STATUS_FROZEN_VALID
            )
        log_event(
            document,
            DocumentIntegrityEvent.Event.VERIFIED,
            request=request,
            metadata={
                "result": integrity["status"],
                "source": "upload",
                "upload_sha256": digest,
                **({"superseded_version": _superseded_version(superseded)} if superseded is not None else {}),
            },
        )
    elif validation.get("signature_count"):
        if validation.get("all_valid"):
            integrity["status"] = STATUS_SIGNED_VALID if signatures else STATUS_SEALED_VALID
        else:
            integrity["status"] = STATUS_TAMPERED
    if validation.get("error") == "unreadable_pdf":
        integrity["status"] = STATUS_TAMPERED if document is not None else STATUS_NOT_FROZEN

    matched = None
    if document is not None:
        adapter = registered_types()[document.document_type]
        matched = {"type": adapter.api_type, "id": document.object_id, "reference": document.reference}
        if superseded is not None:
            # ADDITIVE, only for an earlier version: the version the uploaded file is.
            matched["superseded_version"] = _superseded_version(superseded)
    audit(
        request,
        "document_upload_verified",
        entity=document.document_type if document else "document",
        entity_id=document.object_id if document else "",
        metadata={"upload_sha256": digest, "matched": matched is not None, "result": integrity["status"]},
    )
    summary = SUMMARIES[integrity["status"]]
    if superseded is not None and integrity["status"] != STATUS_TAMPERED:
        summary = SUPERSEDED_SUMMARY
    return {"matched_record": matched, "integrity": integrity, "summary": summary}
