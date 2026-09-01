from __future__ import annotations

import logging

from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone

from attendance.models import AttendanceRecord, BioTimeEmployeeMap
from audit.utils import audit
from core.services.workflow_engine import sync_workflow
from employees.models import EmployeeDocument, EmployeeProfile

from .models import JobOffer, StartingWorkAcknowledgment
from .notifications import notify_starting_work_acknowledgment_ready
from .starting_work_pdf import StartingWorkAcknowledgmentData, build_starting_work_acknowledgment_pdf

logger = logging.getLogger(__name__)


def _safe_audit(action: str, acknowledgment: StartingWorkAcknowledgment, metadata: dict) -> None:
    try:
        audit(None, action, entity="StartingWorkAcknowledgment", entity_id=acknowledgment.id, metadata=metadata)
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
        "status": acknowledgment.status,
        "affected_attendance_count": acknowledgment.affected_attendance_records.count(),
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


def _biotime_mapping_for(profile: EmployeeProfile) -> BioTimeEmployeeMap | None:
    return BioTimeEmployeeMap.objects.filter(employee_profile=profile).first()


def _eligible_biotime_records(acknowledgment: StartingWorkAcknowledgment):
    mapping = _biotime_mapping_for(acknowledgment.employee_profile)
    if mapping is None:
        return AttendanceRecord.objects.none()
    return AttendanceRecord.objects.filter(
        employee_profile=acknowledgment.employee_profile,
        date__gte=acknowledgment.attendance_record.date,
        source=AttendanceRecord.Source.SYSTEM,
        is_overridden=False,
        biotime_emp_code=mapping.biotime_emp_code,
    )


def _apply_verification_hold(acknowledgment: StartingWorkAcknowledgment) -> None:
    records = _eligible_biotime_records(acknowledgment)
    if acknowledgment.status == StartingWorkAcknowledgment.Status.PENDING_HR:
        ids = list(records.values_list("id", flat=True))
        if ids:
            acknowledgment.affected_attendance_records.add(*ids)
            records.exclude(status=AttendanceRecord.Status.PENDING_HR).update(
                status=AttendanceRecord.Status.PENDING_HR,
                updated_at=timezone.now(),
            )
    elif acknowledgment.status == StartingWorkAcknowledgment.Status.REJECTED and acknowledgment.rejected_at:
        records = records.filter(date__lte=timezone.localdate(acknowledgment.rejected_at))
        ids = list(records.values_list("id", flat=True))
        if ids:
            acknowledgment.affected_attendance_records.add(*ids)
            records.exclude(status=AttendanceRecord.Status.ABSENT).update(
                status=AttendanceRecord.Status.ABSENT,
                updated_at=timezone.now(),
            )


def _is_valid_biotime_record(record: AttendanceRecord, mapping: BioTimeEmployeeMap | None) -> bool:
    return bool(
        mapping
        and record.source == AttendanceRecord.Source.SYSTEM
        and not record.is_overridden
        and record.biotime_emp_code
        and record.biotime_emp_code == mapping.biotime_emp_code
    )


def generate_starting_work_acknowledgment(
    attendance_record: AttendanceRecord,
    *,
    received_from_biotime: bool = False,
) -> StartingWorkAcknowledgment | None:
    """Create the one HR-verification archive record and enforce any current BioTime hold."""
    if attendance_record.source != AttendanceRecord.Source.SYSTEM or attendance_record.is_overridden:
        return None

    created = False
    with transaction.atomic():
        profile = EmployeeProfile.objects.select_for_update().get(pk=attendance_record.employee_profile_id)
        if profile.is_archived or not profile.company_id or not profile.company.is_active:
            return None
        mapping = _biotime_mapping_for(profile)
        if not _is_valid_biotime_record(attendance_record, mapping):
            return None

        acknowledgment = (
            StartingWorkAcknowledgment.objects.select_related("employee_profile", "attendance_record", "document")
            .filter(employee_profile=profile)
            .first()
        )
        if acknowledgment is None:
            if attendance_record.status != AttendanceRecord.Status.PRESENT and not received_from_biotime:
                return None
            first_biotime_id = (
                AttendanceRecord.objects.filter(
                    employee_profile=profile,
                    source=AttendanceRecord.Source.SYSTEM,
                    is_overridden=False,
                    biotime_emp_code=mapping.biotime_emp_code,
                )
                .order_by("date", "id")
                .values_list("id", flat=True)
                .first()
            )
            if first_biotime_id != attendance_record.id:
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
                extracted_fields={"ocr": "skipped", "generated_by_system": True, "hr_only": True},
            )
            document.file.save(filename, ContentFile(pdf_bytes), save=False)
            document.save()
            acknowledgment = StartingWorkAcknowledgment.objects.create(
                employee_profile=profile,
                attendance_record=attendance_record,
                job_offer=job_offer,
                company=profile.company,
                reference_number=reference_number,
                status=StartingWorkAcknowledgment.Status.PENDING_HR,
                generated_at=timezone.now(),
                generated_by_system=True,
                document=document,
            )
            created = True

        _apply_verification_hold(acknowledgment)

    if created:
        sync_workflow(acknowledgment)
        metadata = _audit_metadata(acknowledgment)
        _safe_audit("starting_work_acknowledgment_pending_hr_created", acknowledgment, metadata)
        _safe_audit("starting_work_acknowledgment_document_archived", acknowledgment, metadata)
        _notify_hr(acknowledgment)
    return acknowledgment


def approve_starting_work_acknowledgment(
    acknowledgment: StartingWorkAcknowledgment, approver
) -> StartingWorkAcknowledgment:
    with transaction.atomic():
        acknowledgment = (
            StartingWorkAcknowledgment.objects.select_for_update()
            .select_related("employee_profile", "attendance_record", "document")
            .get(pk=acknowledgment.pk)
        )
        if acknowledgment.status not in {
            StartingWorkAcknowledgment.Status.PENDING_HR,
            StartingWorkAcknowledgment.Status.REJECTED,
        }:
            raise ValueError("Only pending or rejected acknowledgements can be approved.")

        approved_at = timezone.now()
        eligible_ids = list(
            acknowledgment.affected_attendance_records.filter(
                source=AttendanceRecord.Source.SYSTEM,
                is_overridden=False,
                biotime_emp_code__gt="",
            ).values_list("id", flat=True)
        )
        AttendanceRecord.objects.filter(id__in=eligible_ids).update(
            status=AttendanceRecord.Status.PRESENT,
            updated_at=approved_at,
        )
        approver_name = (getattr(approver, "full_name", "") or getattr(approver, "email", "")).strip()
        pdf_bytes = build_starting_work_acknowledgment_pdf(
            acknowledgment.employee_profile,
            StartingWorkAcknowledgmentData(
                reference_no=acknowledgment.reference_number,
                document_date=acknowledgment.attendance_record.date,
                work_start_status="started",
                start_date=acknowledgment.attendance_record.date,
                details_approver_name=approver_name,
                details_approver_date=timezone.localdate(approved_at),
            ),
        )
        document = acknowledgment.document
        old_name = document.file.name
        filename = document.original_filename or f"starting-work-acknowledgment-{acknowledgment.id}.pdf"
        document.file.save(filename, ContentFile(pdf_bytes), save=False)
        document.extracted_fields = {
            **(document.extracted_fields or {}),
            "hr_only": True,
            "approved_by": approver_name,
            "approved_at": approved_at.isoformat(),
        }
        document.save(update_fields=["file", "extracted_fields", "updated_at"])
        new_name = document.file.name
        if old_name and old_name != new_name:
            transaction.on_commit(lambda: document.file.storage.delete(old_name))

        acknowledgment.status = StartingWorkAcknowledgment.Status.APPROVED
        acknowledgment.approved_by = approver
        acknowledgment.approved_at = approved_at
        acknowledgment.save(update_fields=["status", "approved_by", "approved_at"])

    sync_workflow(acknowledgment, actor=approver)
    return acknowledgment


def reject_starting_work_acknowledgment(
    acknowledgment: StartingWorkAcknowledgment, rejector, reason: str
) -> StartingWorkAcknowledgment:
    reason = (reason or "").strip()
    if not reason:
        raise ValueError("Rejection reason is required.")
    with transaction.atomic():
        acknowledgment = (
            StartingWorkAcknowledgment.objects.select_for_update()
            .select_related("employee_profile", "attendance_record", "document")
            .get(pk=acknowledgment.pk)
        )
        if acknowledgment.status != StartingWorkAcknowledgment.Status.PENDING_HR:
            raise ValueError("Only pending acknowledgements can be rejected.")
        rejected_at = timezone.now()
        records = _eligible_biotime_records(acknowledgment).filter(date__lte=timezone.localdate(rejected_at))
        ids = list(records.values_list("id", flat=True))
        if ids:
            acknowledgment.affected_attendance_records.add(*ids)
            records.update(status=AttendanceRecord.Status.ABSENT, updated_at=rejected_at)
        acknowledgment.status = StartingWorkAcknowledgment.Status.REJECTED
        acknowledgment.rejected_by = rejector
        acknowledgment.rejected_at = rejected_at
        acknowledgment.rejection_reason = reason
        acknowledgment.save(update_fields=["status", "rejected_by", "rejected_at", "rejection_reason"])

    sync_workflow(acknowledgment, actor=rejector)
    return acknowledgment
