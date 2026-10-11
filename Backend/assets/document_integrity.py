"""Asset return requests and asset damage reports as tamper-evident documents.

See ``core.document_integrity``. Both PDFs come from the generic
``core.pdf.render_request_pdf`` (names only, no signature images).

* **Return request**: the form's last row is "Processed" (HR received the asset),
  so it is frozen when ``mark_return_request_processed`` moves it to
  ``PROCESSED``. ``APPROVED`` still shows that row empty and keeps rendering live.
  HR can also receive an asset whose request is still pending; that request is
  processed (and frozen) with only the stages that actually happened.
* **Damage report**: frozen when the CEO approves it (``APPROVED``), the last
  decision on the form.

The approval trail and the personal signers come from the recorded decision
fields only - the same names the form prints.
"""

from __future__ import annotations

from core.document_integrity.registry import DocumentType, StageSigner, register_document_type
from core.permissions import get_role
from organization.services import filter_queryset_by_accessible_companies

from .models import AssetDamageReport, AssetReturnRequest

RETURN_DOCUMENT_TYPE = "asset_return_request"
RETURN_FINAL_STATUS = AssetReturnRequest.RequestStatus.PROCESSED
DAMAGE_DOCUMENT_TYPE = "asset_damage_report"
DAMAGE_FINAL_STATUS = AssetDamageReport.RequestStatus.APPROVED

#: Recorded actor fields of every decision on the return form, in workflow order.
RETURN_APPROVER_FIELDS = ("manager_decision_by", "hr_decision_by", "ceo_decision_by", "processed_by")
RETURN_INVOLVED_FIELDS = ("employee__user", *RETURN_APPROVER_FIELDS)
DAMAGE_APPROVER_FIELDS = ("hr_decision_by", "ceo_decision_by")
DAMAGE_INVOLVED_FIELDS = ("employee__user", *DAMAGE_APPROVER_FIELDS)

_HR_ROLES = {"SystemAdmin", "HRManager"}


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _subject(instance) -> str:
    from core.pdf_signers import profile_signer_name

    profile = instance.employee
    name = profile_signer_name(profile) if profile is not None else ""
    employee_id = getattr(profile, "employee_id", "") if profile is not None else ""
    return " - ".join(part for part in (name, employee_id) if part)


def _company(instance):
    return getattr(instance.asset, "company", None)


def _can_access(user, instance, approver_fields) -> bool:
    """Owner, recorded approvers, or HR/SystemAdmin.

    HR access is additionally limited to the companies the caller can access by
    the view's own queryset; this check covers the people involved.
    """

    if user is None or not user.is_authenticated:
        return False
    if get_role(user) in _HR_ROLES:
        return True
    involved = {getattr(instance.employee, "user_id", None)}
    involved |= {getattr(instance, f"{field}_id") for field in approver_fields}
    involved.discard(None)
    return user.pk in involved


def _schedule(instance, *, role: str, actor, at, final_status) -> None:
    from core.document_integrity.services import record_stage_approval, schedule_finalize

    record_stage_approval(instance, role=role, actor=actor, at=at)
    if instance.status == final_status:
        schedule_finalize(instance, actor=actor)


# ---------------------------------------------------------------------------
# Asset return request
# ---------------------------------------------------------------------------


def _render_return(instance: AssetReturnRequest) -> bytes:
    from .views import _build_return_request_pdf

    return _build_return_request_pdf(instance)


def _return_reference(instance: AssetReturnRequest) -> str:
    # Identical to the reference printed by ``_build_return_request_pdf``.
    from core.services.request_references import public_reference_for

    return public_reference_for(instance) or str(instance.pk)


def asset_return_stage_signers(instance: AssetReturnRequest) -> list[StageSigner]:
    """Completed stages in workflow order, from the recorded decision fields.

    A processed request never passed a rejection (rejected requests are closed),
    so every recorded decision on it moved the request on.
    """

    stages = [
        StageSigner(
            "employee", "Employee", getattr(instance.employee, "user", None), instance.requested_at, "Submitted"
        )
    ]
    if instance.manager_decision_by_id and instance.manager_decision_at:
        stages.append(
            StageSigner("line_manager", "Line manager", instance.manager_decision_by, instance.manager_decision_at)
        )
    if instance.hr_decision_by_id and instance.hr_decision_at:
        stages.append(StageSigner("hr", "HR", instance.hr_decision_by, instance.hr_decision_at))
    if instance.ceo_decision_by_id and instance.ceo_decision_at:
        stages.append(StageSigner("ceo", "CEO", instance.ceo_decision_by, instance.ceo_decision_at))
    if instance.processed_by_id and instance.processed_at:
        stages.append(
            StageSigner("asset_received", "Asset received", instance.processed_by, instance.processed_at, "Processed")
        )
    return stages


def can_access_asset_return_document(user, instance: AssetReturnRequest) -> bool:
    return _can_access(user, instance, RETURN_APPROVER_FIELDS)


def _return_accessible_queryset(request):
    return filter_queryset_by_accessible_companies(
        AssetReturnRequest.objects.all(), request, field_name="asset__company_id"
    )


def on_asset_return_stage_approved(instance: AssetReturnRequest, *, role: str, actor, at=None) -> None:
    """Record a personal-mode attestation, and freeze once HR processed the return.

    Both run after the surrounding transaction commits and never raise, so a
    signing or storage failure can never undo the business action.
    """

    _schedule(instance, role=role, actor=actor, at=at, final_status=RETURN_FINAL_STATUS)


# ---------------------------------------------------------------------------
# Asset damage report
# ---------------------------------------------------------------------------


def _render_damage(instance: AssetDamageReport) -> bytes:
    from .views import _build_damage_report_pdf

    return _build_damage_report_pdf(instance)


def _damage_reference(instance: AssetDamageReport) -> str:
    # The damage report has no workflow reference: the form prints its id.
    return str(instance.pk)


def asset_damage_stage_signers(instance: AssetDamageReport) -> list[StageSigner]:
    stages = [
        StageSigner("employee", "Employee", getattr(instance.employee, "user", None), instance.reported_at, "Reported")
    ]
    if instance.hr_decision_by_id and instance.hr_decision_at:
        stages.append(StageSigner("hr", "HR", instance.hr_decision_by, instance.hr_decision_at))
    if instance.ceo_decision_by_id and instance.ceo_decision_at:
        label = "Rejected" if instance.status == AssetDamageReport.RequestStatus.REJECTED else "Approved"
        stages.append(StageSigner("ceo", "CEO", instance.ceo_decision_by, instance.ceo_decision_at, label))
    return stages


def can_access_asset_damage_document(user, instance: AssetDamageReport) -> bool:
    return _can_access(user, instance, DAMAGE_APPROVER_FIELDS)


def _damage_accessible_queryset(request):
    return filter_queryset_by_accessible_companies(
        AssetDamageReport.objects.all(), request, field_name="asset__company_id"
    )


def on_asset_damage_stage_approved(instance: AssetDamageReport, *, role: str, actor, at=None) -> None:
    """Record a personal-mode attestation, and freeze once the CEO approved the report."""

    _schedule(instance, role=role, actor=actor, at=at, final_status=DAMAGE_FINAL_STATUS)


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------


def register() -> None:
    register_document_type(
        DocumentType(
            key=RETURN_DOCUMENT_TYPE,
            label="Asset Return Request",
            api_type="asset_return",
            model=AssetReturnRequest,
            render=_render_return,
            reference=_return_reference,
            subject=_subject,
            company=_company,
            stage_signers=asset_return_stage_signers,
            can_access=can_access_asset_return_document,
            accessible_queryset=_return_accessible_queryset,
            final_statuses=(RETURN_FINAL_STATUS,),
        )
    )
    register_document_type(
        DocumentType(
            key=DAMAGE_DOCUMENT_TYPE,
            label="Asset Damage Report",
            api_type="asset_damage",
            model=AssetDamageReport,
            render=_render_damage,
            reference=_damage_reference,
            subject=_subject,
            company=_company,
            stage_signers=asset_damage_stage_signers,
            can_access=can_access_asset_damage_document,
            accessible_queryset=_damage_accessible_queryset,
            final_statuses=(DAMAGE_FINAL_STATUS,),
        )
    )
