"""Permission requests (incl. exit permission) as tamper-evident documents.

See ``core.document_integrity``. The form has three signature panels: the
employee (by submitting), the direct manager and HR. The request is final - and
its PDF frozen - when it reaches ``approved``: either at the HR decision, or at
the manager decision when there is no HR stage (an HR approver's own request) or
the manager is an HR manager who covers it. Only pending requests can be
cancelled, so an approved request never changes state again.

The approval trail and the personal signers come from the recorded decision
fields - the same actors whose signatures appear on the form.
"""

from __future__ import annotations

from core.document_integrity.registry import DocumentType, StageSigner, register_document_type
from core.permissions import get_role
from organization.services import filter_queryset_by_accessible_companies

from .models import PermissionRequest

DOCUMENT_TYPE = "permission_request"
FINAL_STATUS = PermissionRequest.Status.APPROVED

#: Recorded actor fields of every decision on the form, in workflow order.
APPROVER_FIELDS = ("manager_decision_by", "hr_decision_by")
#: Everyone involved in a request: the requester plus the recorded approvers.
INVOLVED_FIELDS = ("employee", *APPROVER_FIELDS)


def _render(instance: PermissionRequest) -> bytes:
    # The same builder the download renders live (patchable as ``permission_requests.views.build_permission_request_pdf``).
    from .views import build_permission_request_pdf

    return build_permission_request_pdf(instance)


def _reference(instance: PermissionRequest) -> str:
    # The form prints the native reference number.
    return instance.reference_no or f"PERM-{instance.pk:05d}"


def _subject(instance: PermissionRequest) -> str:
    from core.pdf_signers import profile_signer_name

    profile = instance.employee_profile
    name = profile_signer_name(profile) if profile is not None else ""
    employee_id = getattr(profile, "employee_id", "") if profile is not None else ""
    return " - ".join(part for part in (name, employee_id) if part)


def _decision_label(value: str | None) -> str:
    return "Rejected" if value == PermissionRequest.Decision.REJECTED else "Approved"


def permission_stage_signers(instance: PermissionRequest) -> list[StageSigner]:
    """Completed stages in workflow order, from the recorded decision fields."""

    stages = [StageSigner("employee", "Employee", instance.employee, instance.created_at, "Submitted")]
    if instance.manager_decision_by_id and instance.manager_decision_at:
        stages.append(
            StageSigner(
                "line_manager",
                "Line manager",
                instance.manager_decision_by,
                instance.manager_decision_at,
                _decision_label(instance.manager_decision),
            )
        )
    if instance.hr_decision_by_id and instance.hr_decision_at:
        stages.append(
            StageSigner(
                "hr", "HR", instance.hr_decision_by, instance.hr_decision_at, _decision_label(instance.hr_decision)
            )
        )
    return stages


def _approver_ids(instance: PermissionRequest) -> set[int]:
    return {user_id for user_id in (getattr(instance, f"{field}_id") for field in APPROVER_FIELDS) if user_id}


def can_access_permission_document(user, instance: PermissionRequest) -> bool:
    """Owner, recorded approvers, or HR/SystemAdmin.

    HR access is additionally limited to companies the caller can access by the
    view's own queryset; this check covers the people involved in the request.
    """

    if user is None or not user.is_authenticated:
        return False
    if get_role(user) in {"SystemAdmin", "HRManager"}:
        return True
    return user.pk in {instance.employee_id} | _approver_ids(instance)


def _accessible_queryset(request):
    return filter_queryset_by_accessible_companies(PermissionRequest.objects.all(), request)


def register() -> None:
    register_document_type(
        DocumentType(
            key=DOCUMENT_TYPE,
            label="Permission Request",
            api_type="permission",
            model=PermissionRequest,
            render=_render,
            reference=_reference,
            subject=_subject,
            company=lambda instance: instance.company,
            stage_signers=permission_stage_signers,
            can_access=can_access_permission_document,
            accessible_queryset=_accessible_queryset,
            final_statuses=(FINAL_STATUS,),
        )
    )


def on_permission_stage_approved(instance: PermissionRequest, *, role: str, actor, at=None, finalize=True) -> None:
    """Record a personal-mode attestation, and freeze when the request is approved.

    ``finalize=False`` records the attestation only: a manager approval that also
    covers the HR stage records two attestations but must freeze once.
    Both run after the surrounding transaction commits and never raise, so a
    signing or storage failure can never undo the approval.
    """

    from core.document_integrity.services import record_stage_approval, schedule_finalize

    record_stage_approval(instance, role=role, actor=actor, at=at)
    if finalize and instance.status == FINAL_STATUS:
        schedule_finalize(instance, actor=actor)
