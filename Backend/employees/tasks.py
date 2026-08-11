from celery import shared_task

from .document_extraction import extract_document_fields
from .models import EmployeeDocument
from .notifications import notify_expiring_work_licenses


@shared_task
def send_work_license_expiry_reminders():
    return notify_expiring_work_licenses()


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
