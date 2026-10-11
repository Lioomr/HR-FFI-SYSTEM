"""Job offers and starting-work acknowledgements as tamper-evident documents.

See ``core.document_integrity`` and ``plans/Document Signing API Handoff.md``.

Job offer (``job_offer``)
    The form stops changing on our side when HR sends it: the HR signature date
    is the send date and the CEO box is already signed. Version 1 is frozen at
    send, and that frozen copy is what ``deliver_job_offer`` e-mails/WhatsApps to
    the candidate (and the CEO copy). The candidate's answer fills the
    acceptance block (decision, name, date, rejection reason), so it is frozen
    again as version 2 (``FrozenDocument.version`` +1, the v1 hash stays in the
    ``frozen`` event metadata, where verify-upload still recognises the
    candidate's v1 copy as a superseded version). Cancelling or expiry after
    sending keeps the frozen copy. Candidates have no account: they appear on
    the approval trail with ``actor=None`` and never sign personally.

Starting-work acknowledgement (``starting_work_acknowledgment``)
    System-generated at the employee's first BioTime punch, approved by HR. The
    approval re-renders the form into the stored ``EmployeeDocument``; the
    freeze takes exactly those bytes (no rebuild from current profile data) and
    then writes the frozen (or sealed) copy back into that ``EmployeeDocument``
    so the employee-documents copy and the frozen copy are byte-identical.
    Rejected and voided acknowledgements are never frozen.
"""

from __future__ import annotations

import logging

from django.db import transaction

from core.document_integrity.registry import DocumentType, StageSigner, register_document_type
from core.permissions import get_role
from organization.services import filter_queryset_by_accessible_companies

from .models import JobOffer, StartingWorkAcknowledgment

logger = logging.getLogger(__name__)

HR_ROLES = frozenset({"SystemAdmin", "HRManager"})

JOB_OFFER_TYPE = "job_offer"
#: Offer states after which the form is frozen: sent (v1) and answered (v2).
JOB_OFFER_FROZEN_STATUSES = frozenset({JobOffer.Status.SENT, JobOffer.Status.ACCEPTED, JobOffer.Status.REJECTED})
#: Every post-send state, for single-record recovery (``freeze_approved_document``):
#: an expired/cancelled offer keeps the document as sent (its acceptance block is empty,
#: like v1); an answered offer is recovered as the answered document (the v2 content).
#: Only offers that were actually sent qualify (a draft can also be cancelled).
JOB_OFFER_RECOVERY_STATUSES = (
    JobOffer.Status.SENT,
    JobOffer.Status.ACCEPTED,
    JobOffer.Status.REJECTED,
    JobOffer.Status.EXPIRED,
    JobOffer.Status.CANCELLED,
)
#: Recorded internal actors of an offer: the CEO who decided it and the HR sender.
JOB_OFFER_INVOLVED_FIELDS = ("ceo_decision_by", "hr_signer_user")

STARTING_WORK_TYPE = "starting_work_acknowledgment"
STARTING_WORK_FINAL_STATUS = StartingWorkAcknowledgment.Status.APPROVED
#: The acknowledgement is HR-only; its one recorded decision is the HR approval.
STARTING_WORK_INVOLVED_FIELDS = ("approved_by",)


def _is_hr(user) -> bool:
    return get_role(user) in HR_ROLES


def _subject_for(profile, fallback_name: str = "") -> str:
    from core.pdf_signers import profile_signer_name

    name = (profile_signer_name(profile) if profile is not None else "") or fallback_name
    employee_id = getattr(profile, "employee_id", "") if profile is not None else ""
    return " - ".join(part for part in (name, employee_id) if part)


# ---------------------------------------------------------------------------
# Job offer
# ---------------------------------------------------------------------------


def _render_job_offer(instance: JobOffer) -> bytes:
    from . import pdf

    return pdf.build_job_offer_pdf(instance)


def _job_offer_reference(instance: JobOffer) -> str:
    # Printed as "reference_no" on the form (also the visible text verify-upload matches).
    return instance.reference_number or f"JO-{instance.pk:05d}"


def _job_offer_subject(instance: JobOffer) -> str:
    return _subject_for(instance.employee_profile, instance.candidate_full_name)


def job_offer_stage_signers(instance: JobOffer) -> list[StageSigner]:
    """CEO approval, HR send, then the candidate's answer (external, no account)."""

    stages = []
    if (
        instance.ceo_decision_by_id
        and instance.ceo_decision_at
        and instance.approval_status == JobOffer.ApprovalStatus.APPROVED
    ):
        stages.append(StageSigner("ceo", "CEO", instance.ceo_decision_by, instance.ceo_decision_at))
    if instance.sent_at and instance.hr_signer_user_id:
        stages.append(StageSigner("hr", "HR", instance.hr_signer_user, instance.sent_at, "Sent"))
    if instance.accepted_at:
        stages.append(StageSigner("candidate", "Candidate", None, instance.accepted_at, "Accepted"))
    elif instance.rejected_at:
        stages.append(StageSigner("candidate", "Candidate", None, instance.rejected_at, "Declined"))
    return stages


def can_access_job_offer_document(user, instance: JobOffer) -> bool:
    """HR/SystemAdmin (company limited by the view), the deciding CEO, or the HR sender.

    The candidate is external and never reaches these endpoints: integrity
    status is an internal record (event names, downloads by staff). HR checks a
    candidate's copy with ``POST /api/documents/verify-upload/``.
    """

    if user is None or not user.is_authenticated:
        return False
    if _is_hr(user):
        return True
    return user.pk in {instance.ceo_decision_by_id, instance.hr_signer_user_id} - {None}


def _job_offer_accessible_queryset(request):
    return filter_queryset_by_accessible_companies(JobOffer.objects.all(), request)


def on_job_offer_stage(instance: JobOffer, *, role: str | None, actor, at=None, freeze: bool = True) -> None:
    """Record a personal-mode attestation (internal actors only) and freeze a sent/answered offer.

    Both run after the surrounding transaction commits and never raise, so a
    signing or storage failure can never undo the approval, send or answer.
    ``freeze=False`` when the caller freezes explicitly after commit (the send,
    which must freeze before it delivers).
    """

    from core.document_integrity.services import record_stage_approval, schedule_finalize

    if role and actor is not None:
        record_stage_approval(instance, role=role, actor=actor, at=at)
    if freeze and instance.status in JOB_OFFER_FROZEN_STATUSES and instance.sent_at:
        schedule_finalize(instance, actor=actor)


def freeze_sent_job_offer(offer: JobOffer, *, actor) -> None:
    """Freeze v1 right now, after the send committed and before delivery. Never raises.

    Done explicitly instead of ``on_commit`` so the delivery below can never run
    ahead of the freeze, however the caller's transactions are nested.
    """

    from core.document_integrity import conf
    from core.document_integrity import services as integrity_services

    if not conf.freezing_enabled() or offer.status != JobOffer.Status.SENT:
        return
    try:
        integrity_services.finalize_document(offer, actor=actor)
    except Exception:
        logger.exception("document_integrity.finalize_failed", extra={"model": "JobOffer", "object_id": offer.pk})


def job_offer_pdf_for_delivery(offer: JobOffer) -> tuple[bytes, dict]:
    """The bytes sent to the candidate and CEO: the frozen copy when there is one.

    Falls back to a live render only when nothing is frozen (mode ``off``, or the
    freeze failed and was logged). A frozen copy that is missing or altered is
    never replaced by a live render: this raises and delivery reports the PDF as
    failed.
    """

    from core.document_integrity.services import FILE_OK, frozen_pdf

    from . import pdf

    document, data, state = frozen_pdf(offer)
    if document is None:
        return pdf.build_job_offer_pdf(offer), {"frozen": False, "version": None, "sha256": None}
    if state != FILE_OK:
        raise RuntimeError(f"The frozen job offer failed its integrity check ({state}).")
    return data, {"frozen": True, "version": document.version, "sha256": document.sha256}


# ---------------------------------------------------------------------------
# Starting-work acknowledgement
# ---------------------------------------------------------------------------


def _read_field_file(field_file) -> bytes:
    field_file.open("rb")
    try:
        return field_file.read()
    finally:
        field_file.close()


def _render_starting_work(instance: StartingWorkAcknowledgment) -> bytes:
    """The bytes HR approved: the stored acknowledgement written by the approval."""

    return _read_field_file(instance.document.file)


def _starting_work_reference(instance: StartingWorkAcknowledgment) -> str:
    return instance.reference_number or f"SWA-{instance.pk:05d}"


def _starting_work_subject(instance: StartingWorkAcknowledgment) -> str:
    return _subject_for(instance.employee_profile)


def starting_work_stage_signers(instance: StartingWorkAcknowledgment) -> list[StageSigner]:
    """System generation (first BioTime punch), then the HR approval."""

    stages = [StageSigner("system", "System", None, instance.generated_at, "Generated")]
    if instance.approved_by_id and instance.approved_at:
        stages.append(StageSigner("hr", "HR", instance.approved_by, instance.approved_at))
    return stages


def can_access_starting_work_document(user, instance: StartingWorkAcknowledgment) -> bool:
    """HR/SystemAdmin (company limited by the view) or the recorded HR approver.

    The employee is deliberately excluded: the acknowledgement is an HR-only
    document (hidden from the employee's documents and download).
    """

    if user is None or not user.is_authenticated:
        return False
    if _is_hr(user):
        return True
    return bool(instance.approved_by_id) and user.pk == instance.approved_by_id


def _starting_work_accessible_queryset(request):
    return filter_queryset_by_accessible_companies(StartingWorkAcknowledgment.objects.all(), request)


def _sync_employee_document(acknowledgment_id: int) -> None:
    """Write the frozen (sealed when sealing ran) copy back into the stored ``EmployeeDocument``."""

    from django.core.files.base import ContentFile

    from core.document_integrity.services import FILE_OK, frozen_pdf

    try:
        acknowledgment = StartingWorkAcknowledgment.objects.select_related("document").get(pk=acknowledgment_id)
        document, data, state = frozen_pdf(acknowledgment)
        if document is None or state != FILE_OK:
            return
        employee_document = acknowledgment.document
        if _read_field_file(employee_document.file) == data:
            return
        old_name = employee_document.file.name
        filename = employee_document.original_filename or f"starting-work-acknowledgment-{acknowledgment.pk}.pdf"
        employee_document.file.save(filename, ContentFile(data), save=False)
        employee_document.extracted_fields = {
            **(employee_document.extracted_fields or {}),
            "frozen_document_id": document.pk,
            "frozen_sha256": document.sha256,
        }
        employee_document.save(update_fields=["file", "extracted_fields", "updated_at"])
        if old_name and old_name != employee_document.file.name:
            employee_document.file.storage.delete(old_name)
    except Exception:
        logger.exception("document_integrity.starting_work_sync_failed", extra={"acknowledgment_id": acknowledgment_id})


def on_starting_work_approved(instance: StartingWorkAcknowledgment, *, actor, at=None) -> None:
    """Attest (personal mode), freeze, then sync the stored document - all after commit, never raising."""

    from core.document_integrity import conf
    from core.document_integrity.services import record_stage_approval, schedule_finalize

    record_stage_approval(instance, role="hr", actor=actor, at=at)
    if instance.status != STARTING_WORK_FINAL_STATUS or not conf.freezing_enabled():
        return
    schedule_finalize(instance, actor=actor)
    acknowledgment_id = instance.pk
    # Deferred twice so it runs after the seal that the freeze itself schedules on commit.
    transaction.on_commit(lambda: transaction.on_commit(lambda: _sync_employee_document(acknowledgment_id)))


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------


def register() -> None:
    register_document_type(
        DocumentType(
            key=JOB_OFFER_TYPE,
            label="Job Offer",
            api_type="job_offer",
            model=JobOffer,
            render=_render_job_offer,
            reference=_job_offer_reference,
            subject=_job_offer_subject,
            company=lambda instance: instance.company,
            stage_signers=job_offer_stage_signers,
            can_access=can_access_job_offer_document,
            accessible_queryset=_job_offer_accessible_queryset,
            final_statuses=JOB_OFFER_RECOVERY_STATUSES,
            final_check=lambda instance: bool(instance.sent_at),
        )
    )
    register_document_type(
        DocumentType(
            key=STARTING_WORK_TYPE,
            label="Starting Work Acknowledgment",
            api_type="starting_work",
            model=StartingWorkAcknowledgment,
            render=_render_starting_work,
            reference=_starting_work_reference,
            subject=_starting_work_subject,
            company=lambda instance: instance.company,
            stage_signers=starting_work_stage_signers,
            can_access=can_access_starting_work_document,
            accessible_queryset=_starting_work_accessible_queryset,
            final_statuses=(STARTING_WORK_FINAL_STATUS,),
        )
    )
