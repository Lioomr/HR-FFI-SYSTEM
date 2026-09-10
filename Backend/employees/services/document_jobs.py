"""Queueing and permanent deletion for employee document extraction jobs.

Queueing is guarded by a database claim so a double-clicked upload or a repeated
HR re-run cannot put two OCR jobs on the same pending document. The claim has a
lease: once it expires the document is assumed orphaned by a dead worker and HR
can queue it again.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import ProtectedError, Q
from django.utils import timezone

from ..models import EmployeeDocument

logger = logging.getLogger(__name__)

ALREADY_QUEUED_WARNING = "Extraction is already running for this document. Wait for it to finish before re-running."
QUEUE_FAILED_WARNING = "The document was saved, but OCR could not be queued. Re-run extraction from the archive."
QUEUE_FAILED_ERROR = "OCR worker is unavailable. Re-run extraction once the worker is back."
STORAGE_DELETE_ERROR = "The document file could not be deleted from storage. Nothing was removed; try again."
SYSTEM_GENERATED_ERROR = "System-generated documents cannot be deleted."
LINKED_RECORD_ERROR = "This document is linked to another record and cannot be deleted."
ALREADY_DELETING_ERROR = "This document is already being deleted."
CLEANUP_PENDING_ERROR = (
    "The document file was permanently removed, but the archive entry could not be cleared. "
    "It is hidden and will be cleaned up automatically."
)


@dataclass(frozen=True)
class QueueOutcome:
    queued: bool
    warnings: list[str]
    reason: str = ""


def _lease_seconds() -> int:
    return int(getattr(settings, "EMPLOYEE_DOCUMENT_OCR_QUEUE_LEASE_SECONDS", 900))


def claim_document_for_extraction(document: EmployeeDocument) -> bool:
    """Atomically take ownership of the next extraction run for this document.

    Returns False when another job already holds a live claim, which is what
    keeps duplicate jobs off the queue.
    """

    now = timezone.now()
    stale_before = now - timedelta(seconds=_lease_seconds())
    claimable = Q(extraction_queued_at__isnull=True) | Q(extraction_queued_at__lt=stale_before)
    claimable |= ~Q(extraction_status=EmployeeDocument.ExtractionStatus.PENDING)

    claimed = (
        EmployeeDocument.objects.filter(pk=document.pk)
        .filter(claimable)
        .update(
            extraction_status=EmployeeDocument.ExtractionStatus.PENDING,
            extraction_error="",
            extraction_warnings=[],
            extraction_queued_at=now,
            extraction_task_id="",
            ocr_reviewed_at=None,
            ocr_reviewed_by=None,
            updated_at=now,
        )
    )
    if claimed:
        document.extraction_status = EmployeeDocument.ExtractionStatus.PENDING
        document.extraction_error = ""
        document.extraction_warnings = []
        document.extraction_queued_at = now
        document.extraction_task_id = ""
        document.ocr_reviewed_at = None
        document.ocr_reviewed_by = None
    return bool(claimed)


def queue_document_extraction(document: EmployeeDocument) -> QueueOutcome:
    """Queue OCR for one document, or explain why it was not queued."""

    from ..ocr.pipeline import OCR_DOCUMENT_TYPES, extract_document_fields
    from ..tasks import extract_employee_document

    if document.document_type not in OCR_DOCUMENT_TYPES:
        return QueueOutcome(queued=False, warnings=extract_document_fields(document), reason="not_applicable")

    if not claim_document_for_extraction(document):
        return QueueOutcome(queued=False, warnings=[ALREADY_QUEUED_WARNING], reason="already_queued")

    try:
        async_result = extract_employee_document.apply_async(args=[document.id], retry=False)
    except Exception:
        logger.exception("employee_document_ocr_queue_failed", extra={"document_id": document.id})
        document.extraction_status = EmployeeDocument.ExtractionStatus.FAILED
        document.extraction_error = QUEUE_FAILED_ERROR
        document.extraction_warnings = [QUEUE_FAILED_WARNING]
        document.extraction_queued_at = None
        document.save(
            update_fields=[
                "extraction_status",
                "extraction_error",
                "extraction_warnings",
                "extraction_queued_at",
                "updated_at",
            ]
        )
        return QueueOutcome(queued=False, warnings=[QUEUE_FAILED_WARNING], reason="queue_failed")

    task_id = str(getattr(async_result, "id", "") or "")[:64]
    if task_id:
        EmployeeDocument.objects.filter(pk=document.pk).update(extraction_task_id=task_id)
        document.extraction_task_id = task_id
    return QueueOutcome(queued=True, warnings=[], reason="queued")


class DocumentDeletionError(RuntimeError):
    """Deletion was refused or could not be completed."""

    def __init__(self, message: str, *, status_code: int = 500, file_removed: bool = False):
        super().__init__(message)
        self.status_code = status_code
        # True when the private file is already gone, so the caller must not
        # present the document as still archived.
        self.file_removed = file_removed


def document_snapshot(document: EmployeeDocument) -> dict:
    """Identity of a document, with no file contents and no OCR text."""

    return {
        "document_id": document.id,
        "employee_profile_id": document.employee_profile_id,
        "company_id": document.company_id,
        "document_type": document.document_type,
        "original_filename": document.original_filename or "",
    }


def delete_document_permanently(document: EmployeeDocument, *, actor=None) -> dict:
    """Permanently remove the private file and the record.

    A filesystem delete cannot be rolled back by a database transaction, so this
    is a two-phase operation rather than one atomic block.

    Invariant: **no EmployeeDocument is ever visible while its source file is
    missing.** Every read path filters on `deletion_started_at__isnull=True`, and
    that flag is committed *before* the file is touched. The three outcomes are:

    1. Storage delete fails and the file is still there -> the flag is cleared,
       the record is fully restored and visible, and no deletion audit is written.
    2. File deleted, row deleted -> the normal success path.
    3. File deleted, row delete fails -> the row stays flagged and invisible, and
       `reconcile_pending_document_deletions` finishes it. It is never shown to HR
       in the meantime.

    A crash between phases leaves a flagged row, which the same reconciliation
    task resolves: file gone -> finish the delete; file intact -> restore the row.
    """

    if document.is_system_generated:
        raise DocumentDeletionError(SYSTEM_GENERATED_ERROR, status_code=403)
    if document.is_pending_deletion:
        raise DocumentDeletionError(ALREADY_DELETING_ERROR, status_code=409)

    snapshot = document_snapshot(document)
    file_name = document.file.name or ""
    storage = document.file.storage

    # A PROTECT relation must be rejected before the file is touched, otherwise a
    # protected document would lose its file and keep its row.
    _reject_if_protected(document, snapshot)

    # Phase 1 - commit the intent. From here the row is invisible to every reader.
    claimed = EmployeeDocument.objects.filter(pk=document.pk, deletion_started_at__isnull=True).update(
        deletion_started_at=timezone.now(),
        deletion_requested_by=actor if actor is not None and actor.is_authenticated else None,
        updated_at=timezone.now(),
    )
    if not claimed:
        raise DocumentDeletionError(ALREADY_DELETING_ERROR, status_code=409)

    # Phase 2 - the irreversible step.
    if file_name:
        try:
            storage.delete(file_name)
            still_present = storage.exists(file_name)
        except Exception as exc:
            logger.exception("employee_document_file_delete_failed", extra={"document_id": snapshot["document_id"]})
            if _file_is_gone(storage, file_name):
                # The file went away despite the error; finishing is the only way
                # to keep the invariant, so fall through to phase 3.
                pass
            else:
                _restore(document)
                raise DocumentDeletionError(STORAGE_DELETE_ERROR, status_code=500) from exc
        else:
            if still_present:
                _restore(document)
                raise DocumentDeletionError(STORAGE_DELETE_ERROR, status_code=500)

    # Phase 3 - drop the row. The file is gone; a failure here is repaired by the
    # reconciliation task, and the row stays hidden until then.
    try:
        delete_document_row(document.pk)
    except Exception as exc:
        logger.exception("employee_document_row_delete_failed", extra={"document_id": snapshot["document_id"]})
        raise DocumentDeletionError(CLEANUP_PENDING_ERROR, status_code=500, file_removed=True) from exc

    return snapshot


def delete_document_row(pk) -> None:
    """Remove the row. Isolated so the post-file-delete failure path is testable."""

    EmployeeDocument.objects.filter(pk=pk).delete()


def _reject_if_protected(document: EmployeeDocument, snapshot: dict) -> None:
    """Probe PROTECT relations without committing anything."""

    try:
        with transaction.atomic():
            EmployeeDocument.objects.filter(pk=document.pk).delete()
            raise _Rollback
    except _Rollback:
        return
    except ProtectedError as exc:
        logger.warning("employee_document_delete_protected", extra={"document_id": snapshot["document_id"]})
        raise DocumentDeletionError(LINKED_RECORD_ERROR, status_code=409) from exc


class _Rollback(Exception):
    """Internal signal used to undo the PROTECT probe."""


def _file_is_gone(storage, file_name: str) -> bool:
    try:
        return not storage.exists(file_name)
    except Exception:  # pragma: no cover - a storage that cannot even be queried
        return False


def _restore(document: EmployeeDocument) -> None:
    """Undo phase 1 so the document is archived and visible again."""

    EmployeeDocument.objects.filter(pk=document.pk).update(
        deletion_started_at=None,
        deletion_requested_by=None,
        updated_at=timezone.now(),
    )
    document.deletion_started_at = None
    document.deletion_requested_by = None


def reconcile_pending_document_deletions(*, grace_seconds: int | None = None) -> dict:
    """Finish or revert deletions that were interrupted between phases.

    Returns counts so the Celery task can log an actionable summary.
    """

    grace = (
        grace_seconds
        if grace_seconds is not None
        else int(getattr(settings, "EMPLOYEE_DOCUMENT_DELETION_RECONCILE_GRACE_SECONDS", 300))
    )
    cutoff = timezone.now() - timedelta(seconds=grace)
    stale = EmployeeDocument.objects.filter(
        deletion_started_at__isnull=False, deletion_started_at__lt=cutoff
    ).select_related("employee_profile")

    finished, restored, failed = [], [], []
    for document in stale:
        snapshot = document_snapshot(document)
        file_name = document.file.name or ""
        storage = document.file.storage
        try:
            if file_name and not _file_is_gone(storage, file_name):
                # Phase 2 never happened - the archive entry is intact.
                _restore(document)
                restored.append(snapshot)
                continue
            delete_document_row(document.pk)
            finished.append(snapshot)
        except Exception:
            logger.exception(
                "employee_document_deletion_reconcile_failed", extra={"document_id": snapshot["document_id"]}
            )
            failed.append(snapshot)

    return {"finished": finished, "restored": restored, "failed": failed}
