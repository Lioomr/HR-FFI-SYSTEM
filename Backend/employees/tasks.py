import logging

from celery import shared_task
from celery.exceptions import MaxRetriesExceededError, SoftTimeLimitExceeded
from django.conf import settings
from django.db import InterfaceError, OperationalError
from django.utils import timezone

from .contract_expiry import process_contract_expiry
from .models import EmployeeDocument
from .notifications import notify_expiring_work_licenses
from .ocr import TransientExtractionError
from .ocr.pipeline import GENERIC_FAILURE_MESSAGE, extract_document_fields

logger = logging.getLogger(__name__)

OCR_SOFT_TIME_LIMIT = int(getattr(settings, "EMPLOYEE_DOCUMENT_OCR_SOFT_TIME_LIMIT_SECONDS", 240))
OCR_TIME_LIMIT = int(getattr(settings, "EMPLOYEE_DOCUMENT_OCR_TIME_LIMIT_SECONDS", 300))
OCR_MAX_RETRIES = int(getattr(settings, "EMPLOYEE_DOCUMENT_OCR_MAX_RETRIES", 3))
OCR_TIMEOUT_MESSAGE = "OCR timed out for this document. Upload a smaller or clearer scan, then re-run extraction."


@shared_task
def send_work_license_expiry_reminders():
    return notify_expiring_work_licenses()


@shared_task(
    bind=True,
    autoretry_for=(OperationalError, InterfaceError),
    retry_backoff=True,
    retry_backoff_max=600,
    retry_jitter=True,
    max_retries=3,
    acks_late=True,
)
def process_contract_expiry_notifications(_task):
    result = process_contract_expiry()
    logger.info("contract_expiry_scheduler_completed", extra=result)
    if (
        result.get("profile_failures")
        or result.get("renewal_failures")
        or result.get("manual_resolutions")
        or result.get("notification_failures")
    ):
        logger.error("contract_expiry_scheduler_requires_attention", extra=result)
    return result


@shared_task(
    bind=True,
    autoretry_for=(OperationalError, InterfaceError),
    retry_backoff=True,
    max_retries=3,
    acks_late=True,
)
def reconcile_employee_document_deletions(_task):
    """Finish or revert document deletions interrupted between their two phases.

    A filesystem delete cannot be undone by a database rollback, so a crash or a
    failed row delete can leave a document flagged mid-deletion. Such rows are
    hidden from every read path until this sweep resolves them.
    """

    from .services.document_jobs import reconcile_pending_document_deletions

    result = reconcile_pending_document_deletions()
    summary = {key: len(value) for key, value in result.items()}
    if summary["finished"] or summary["restored"]:
        logger.info("employee_document_deletion_reconciled", extra=summary)
    if summary["failed"]:
        logger.error("employee_document_deletion_reconcile_requires_attention", extra=summary)
    for snapshot in result["finished"]:
        audit_system_document_deletion(snapshot)
    return summary


def audit_system_document_deletion(snapshot: dict) -> None:
    """Audit a deletion completed by the reconciliation sweep, with no actor."""

    from audit.utils import audit

    try:
        audit(
            None,
            "employee_document_deleted",
            entity="employee_document",
            entity_id=snapshot["document_id"],
            metadata={
                "employee_profile_id": snapshot["employee_profile_id"],
                "document_id": snapshot["document_id"],
                "document_type": snapshot["document_type"],
                "original_filename": snapshot["original_filename"],
                "company_id": snapshot["company_id"],
                "reconciled": True,
            },
        )
    except Exception:
        logger.exception("employee_document_deletion_audit_failed", extra={"document_id": snapshot["document_id"]})


def _record_permanent_failure(document: EmployeeDocument, message: str) -> None:
    document.extraction_status = EmployeeDocument.ExtractionStatus.FAILED
    document.extraction_error = message
    document.extraction_warnings = [message]
    document.extraction_completed_at = timezone.now()
    document.save(
        update_fields=[
            "extraction_status",
            "extraction_error",
            "extraction_warnings",
            "extraction_completed_at",
            "updated_at",
        ]
    )


@shared_task(
    bind=True,
    autoretry_for=(TransientExtractionError, OperationalError, InterfaceError),
    retry_backoff=True,
    retry_backoff_max=300,
    retry_jitter=True,
    max_retries=OCR_MAX_RETRIES,
    acks_late=True,
    soft_time_limit=OCR_SOFT_TIME_LIMIT,
    time_limit=OCR_TIME_LIMIT,
)
def extract_employee_document(self, document_id: int):
    document = EmployeeDocument.objects.filter(pk=document_id, deletion_started_at__isnull=True).first()
    if document is None:
        return {"document_id": document_id, "status": "missing"}

    task_id = getattr(self.request, "id", None)
    claimed_task_id = (document.extraction_task_id or "").strip()
    if claimed_task_id and task_id and claimed_task_id != task_id and self.request.retries == 0:
        # A newer HR re-run superseded this job; it must not overwrite the newer result.
        logger.info(
            "employee_document_ocr_superseded",
            extra={"document_id": document.id, "task_id": task_id, "claimed_task_id": claimed_task_id},
        )
        return {"document_id": document.id, "status": "superseded"}

    EmployeeDocument.objects.filter(pk=document.pk).update(extraction_attempts=document.extraction_attempts + 1)
    try:
        warnings = extract_document_fields(document)
    except SoftTimeLimitExceeded:
        logger.error("employee_document_ocr_timed_out", extra={"document_id": document.id})
        _record_permanent_failure(document, OCR_TIMEOUT_MESSAGE)
        return {"document_id": document.id, "status": document.extraction_status, "warnings": [OCR_TIMEOUT_MESSAGE]}
    except (TransientExtractionError, OperationalError, InterfaceError) as exc:
        logger.warning(
            "employee_document_ocr_transient_failure",
            extra={"document_id": document.id, "retries": self.request.retries},
        )
        try:
            raise self.retry(exc=exc)
        except MaxRetriesExceededError:
            message = str(exc) or GENERIC_FAILURE_MESSAGE
            _record_permanent_failure(document, message)
            return {"document_id": document.id, "status": document.extraction_status, "warnings": [message]}

    document.refresh_from_db(fields=["document_type", "extraction_status", "extraction_attempts"])
    return {
        "document_id": document.id,
        "document_type": document.document_type,
        "status": document.extraction_status,
        "attempts": document.extraction_attempts,
        "warnings": warnings,
    }
