from __future__ import annotations

import logging

from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone

from attendance.models import AttendanceRecord, BioTimeEmployeeMap
from audit.utils import audit
from employees.models import EmployeeDocument, EmployeeProfile

from .models import JobOffer, StartingWorkAcknowledgment
from .notifications import notify_starting_work_acknowledgment_ready
from .starting_work_pdf import StartingWorkAcknowledgmentData, build_starting_work_acknowledgment_pdf

logger = logging.getLogger(__name__)


def _safe_audit(action: str, acknowledgment: StartingWorkAcknowledgment, metadata: dict) -> None:
    try:
        audit(
            None,
            action,
            entity="StartingWorkAcknowledgment",
            entity_id=acknowledgment.id,
            metadata=metadata,
        )
    except Exception:
        logger.exception("starting_work_acknowledgment_audit_failed", extra={"action": action})


def _audit_metadata(acknowledgment: StartingWorkAcknowledgment) -> dict:
    return {
        "reference_number": acknowledgment.reference_number,
        "employee_profile_id": acknowledgment.employee_profile_id,
        "employee_id": acknowledgment.employee_profile.employee_id,
        "attendance_record_id": acknowledgment.attendance_record_id,
        "job_offer_id": acknowledgment.job_offer_id,
        "company_id": acknowledgment.company_id,
        "document_id": acknowledgment.document_id,
        "start_date": acknowledgment.attendance_record.date.isoformat(),
        "generated_by_system": acknowledgment.generated_by_system,
    }


def _notify_hr(acknowledgment: StartingWorkAcknowledgment) -> None:
    try:
        deliveries = notify_starting_work_acknowledgment_ready(acknowledgment)
    except Exception:
        logger.exception(
            "starting_work_acknowledgment_notification_failed",
            extra={"acknowledgment_id": acknowledgment.id},
        )
        deliveries = []

    metadata = _audit_metadata(acknowledgment)
    metadata.update(
        {
            "recipient_count": len(deliveries),
            "recipient_user_ids": [delivery["recipient_id"] for delivery in deliveries],
            "in_app_created_count": sum(bool(delivery.get("in_app_created")) for delivery in deliveries),
            "email_sent_count": sum(bool(delivery.get("email_sent")) for delivery in deliveries),
        }
    )
    _safe_audit("starting_work_acknowledgment_hr_notified", acknowledgment, metadata)


def generate_starting_work_acknowledgment(
    attendance_record: AttendanceRecord,
) -> StartingWorkAcknowledgment | None:
    """Generate and archive the first BioTime starting-work acknowledgment for an employee."""
    if (
        attendance_record.source != AttendanceRecord.Source.SYSTEM
        or attendance_record.status != AttendanceRecord.Status.PRESENT
    ):
        return None

    with transaction.atomic():
        profile = EmployeeProfile.objects.select_for_update().get(pk=attendance_record.employee_profile_id)
        if profile.is_archived or not profile.company_id:
            return None
        if not BioTimeEmployeeMap.objects.filter(employee_profile=profile).exists():
            return None

        existing = (
            StartingWorkAcknowledgment.objects.select_related("employee_profile", "attendance_record", "document")
            .filter(employee_profile=profile)
            .first()
        )
        if existing:
            return existing

        first_system_present_id = (
            AttendanceRecord.objects.filter(
                employee_profile=profile,
                source=AttendanceRecord.Source.SYSTEM,
                status=AttendanceRecord.Status.PRESENT,
            )
            .order_by("date", "id")
            .values_list("id", flat=True)
            .first()
        )
        if first_system_present_id != attendance_record.id:
            return None

        job_offer = (
            JobOffer.objects.filter(
                employee_profile=profile,
                company=profile.company,
                status=JobOffer.Status.ACCEPTED,
            )
            .order_by("-accepted_at", "-id")
            .first()
        )
        reference_number = f"SWA-{profile.employee_id}-{attendance_record.date:%Y%m%d}"
        pdf_bytes = build_starting_work_acknowledgment_pdf(
            profile,
            StartingWorkAcknowledgmentData(
                reference_no=reference_number,
                document_date=attendance_record.date,
                work_start_status="started",
                start_date=attendance_record.date,
            ),
        )
        filename = f"starting-work-acknowledgment-{profile.employee_id}-{attendance_record.date:%Y%m%d}.pdf"
        document = EmployeeDocument(
            employee_profile=profile,
            company=profile.company,
            document_type=EmployeeDocument.DocumentType.OTHER,
            custom_name="Starting Work Acknowledgment",
            original_filename=filename,
            extraction_status=EmployeeDocument.ExtractionStatus.SUCCESS,
            extracted_fields={"ocr": "skipped", "generated_by_system": True},
        )
        document.file.save(filename, ContentFile(pdf_bytes), save=False)
        document.save()
        acknowledgment = StartingWorkAcknowledgment.objects.create(
            employee_profile=profile,
            attendance_record=attendance_record,
            job_offer=job_offer,
            company=profile.company,
            reference_number=reference_number,
            status=StartingWorkAcknowledgment.Status.GENERATED,
            generated_at=timezone.now(),
            generated_by_system=True,
            document=document,
        )

    metadata = _audit_metadata(acknowledgment)
    _safe_audit("starting_work_acknowledgment_generated", acknowledgment, metadata)
    _safe_audit("starting_work_acknowledgment_document_archived", acknowledgment, metadata)
    _notify_hr(acknowledgment)
    return acknowledgment
