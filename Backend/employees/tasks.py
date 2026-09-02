import logging

from celery import shared_task
from django.db import InterfaceError, OperationalError

from .contract_expiry import process_contract_expiry
from .document_extraction import extract_document_fields
from .models import EmployeeDocument
from .notifications import notify_expiring_work_licenses

logger = logging.getLogger(__name__)


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


@shared_task
def extract_employee_document(document_id: int):
    document = EmployeeDocument.objects.filter(pk=document_id).first()
    if document is None:
        return {"document_id": document_id, "status": "missing"}
    warnings = extract_document_fields(document)
    document.refresh_from_db(fields=["document_type", "extraction_status"])
    return {
        "document_id": document.id,
        "document_type": document.document_type,
        "status": document.extraction_status,
        "warnings": warnings,
    }
