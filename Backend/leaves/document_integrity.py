"""Leave requests as tamper-evident documents (see ``core.document_integrity``).

The approval trail and the personal signers come from the decision fields the
workflow recorded - the same actors whose signatures appear on the form.
"""

from __future__ import annotations

from core.document_integrity.registry import DocumentType, StageSigner, register_document_type
from core.permissions import get_role
from organization.services import filter_queryset_by_accessible_companies

from .models import LeaveRequest

DOCUMENT_TYPE = "leave_request"
FINAL_STATUS = LeaveRequest.RequestStatus.APPROVED


def _render(instance: LeaveRequest) -> bytes:
    from .views import _build_leave_request_pdf

    return _build_leave_request_pdf(instance)


def _reference(instance: LeaveRequest) -> str:
    return instance.reference_no or f"LR-{instance.pk:05d}"


def _subject(instance: LeaveRequest) -> str:
    from core.pdf_signers import profile_signer_name

    profile = instance.employee_profile
    name = profile_signer_name(profile) if profile is not None else ""
    employee_id = getattr(profile, "employee_id", "") if profile is not None else ""
    return " - ".join(part for part in (name, employee_id) if part)


def leave_stage_signers(instance: LeaveRequest) -> list[StageSigner]:
    """Completed stages in workflow order, from the recorded decision fields."""

    if instance.source == LeaveRequest.RequestSource.HR_MANUAL:
        return [
            StageSigner(
                role="hr_manual",
                role_label="HR (manual record)",
                actor=instance.entered_by or instance.decided_by,
                at=instance.decided_at or instance.created_at,
                action_label="Recorded",
            )
        ]
    stages = [StageSigner("employee", "Employee", instance.employee, instance.created_at, "Submitted")]
    if instance.delegate_decision_by_id and instance.delegate_decision_at:
        stages.append(
            StageSigner(
                "alternative_employee",
                "Alternative employee",
                instance.delegate_decision_by,
                instance.delegate_decision_at,
            )
        )
    if instance.manager_decision_by_id and instance.manager_decision_at:
        stages.append(
            StageSigner("line_manager", "Line manager", instance.manager_decision_by, instance.manager_decision_at)
        )
    if instance.decided_by_id and instance.decided_at:
        stages.append(StageSigner("hr", "HR", instance.decided_by, instance.decided_at))
    if instance.ceo_decision_by_id and instance.ceo_decision_at:
        stages.append(StageSigner("ceo", "CEO", instance.ceo_decision_by, instance.ceo_decision_at))
    if instance.hr_completed_by_id and instance.hr_completed_at:
        stages.append(
            StageSigner(
                "hr_completion", "HR completion", instance.hr_completed_by, instance.hr_completed_at, "Completed"
            )
        )
    return stages


def _approver_ids(instance: LeaveRequest) -> set[int]:
    return {
        user_id
        for user_id in (
            instance.delegate_decision_by_id,
            instance.manager_decision_by_id,
            instance.decided_by_id,
            instance.ceo_decision_by_id,
            instance.hr_completed_by_id,
            instance.entered_by_id,
        )
        if user_id
    }


def can_access_leave_document(user, instance: LeaveRequest) -> bool:
    """Owner, the alternative employee, recorded approvers, or HR/SystemAdmin.

    HR access is additionally limited to companies the caller can access by the
    view's own queryset; this check covers the people involved in the request.
    """

    if user is None or not user.is_authenticated:
        return False
    if get_role(user) in {"SystemAdmin", "HRManager"}:
        return True
    return user.pk in {instance.employee_id, instance.delegated_to_id} | _approver_ids(instance)


def _accessible_queryset(request):
    return filter_queryset_by_accessible_companies(LeaveRequest.objects.filter(is_active=True), request)


def register() -> None:
    register_document_type(
        DocumentType(
            key=DOCUMENT_TYPE,
            label="Leave Request",
            api_type="leave",
            model=LeaveRequest,
            render=_render,
            reference=_reference,
            subject=_subject,
            company=lambda instance: instance.company,
            stage_signers=leave_stage_signers,
            can_access=can_access_leave_document,
            accessible_queryset=_accessible_queryset,
            final_statuses=(FINAL_STATUS,),
        )
    )


def on_leave_stage_approved(instance: LeaveRequest, *, role: str, actor, at=None) -> None:
    """Record a personal-mode attestation, and freeze when the request is final."""

    from core.document_integrity.services import record_stage_approval, schedule_finalize

    record_stage_approval(instance, role=role, actor=actor, at=at)
    if instance.status == FINAL_STATUS and instance.is_active:
        schedule_finalize(instance, actor=actor)
