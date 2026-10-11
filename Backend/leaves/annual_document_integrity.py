"""Annual entitlements (annual-leave settlements) as tamper-evident documents.

See ``core.document_integrity``. A settlement (``AnnualLeavePaymentRequest``) is
final when the CEO approves it: ``approved`` (paid) or ``carried_forward``
(HR chose to carry the days forward as leave only). Both are frozen. The CEO
approval also re-prices a pending payout at the live salary inside the same
transaction; the freeze runs after commit, so it sees the final figures.

The form has four signature panels; only the applicant and the HR department
correspond to recorded stages (the financial-management and accounts-officer
boxes have no recorded actor and stay blank). The form has no CEO box: the CEO
appears on the approval trail and, in ``personal`` mode, signs the PDF.
"""

from __future__ import annotations

from core.document_integrity.registry import DocumentType, StageSigner, register_document_type
from core.permissions import get_role
from organization.services import filter_queryset_by_accessible_companies

from .models import AnnualLeavePaymentRequest

DOCUMENT_TYPE = "annual_leave_payment_request"
FINAL_STATUSES = frozenset(
    {AnnualLeavePaymentRequest.Status.APPROVED, AnnualLeavePaymentRequest.Status.CARRIED_FORWARD}
)

#: Recorded actor fields of every decision, in workflow order.
APPROVER_FIELDS = ("submitted_by", "hr_reviewed_by", "ceo_decided_by")
#: Everyone involved in a settlement: the employee plus the recorded actors.
INVOLVED_FIELDS = ("employee", *APPROVER_FIELDS)


def _render(instance: AnnualLeavePaymentRequest) -> bytes:
    from .views import _build_annual_entitlements_pdf

    return _build_annual_entitlements_pdf(instance)


def _reference(instance: AnnualLeavePaymentRequest) -> str:
    # Identical to the reference printed on the form (``build_annual_entitlements_values``).
    from core.services.request_references import public_reference_for

    return public_reference_for(instance) or f"AED-{instance.pk:05d}"


def _subject(instance: AnnualLeavePaymentRequest) -> str:
    from core.pdf_signers import profile_signer_name

    profile = instance.employee_profile
    name = profile_signer_name(profile) if profile is not None else ""
    employee_id = getattr(profile, "employee_id", "") if profile is not None else ""
    return " - ".join(part for part in (name, employee_id) if part)


def _filed_by_hr(instance: AnnualLeavePaymentRequest) -> bool:
    return bool(instance.submitted_by_id and instance.submitted_by_id != instance.employee_id)


def annual_payment_stage_signers(instance: AnnualLeavePaymentRequest) -> list[StageSigner]:
    """Completed stages in workflow order, from the recorded decision fields.

    A settlement HR opened on the employee's behalf (termination, HR decision) is
    attributed to the HR filer (``hr_manual``), never to the employee.
    """

    stages = []
    if _filed_by_hr(instance):
        stages.append(
            StageSigner(
                "hr_manual", "HR (for employee)", instance.submitted_by, instance.submitted_at, "Submitted"
            )
        )
    elif instance.employee_id:
        stages.append(StageSigner("employee", "Employee", instance.employee, instance.submitted_at, "Submitted"))
    if instance.hr_reviewed_by_id and instance.hr_reviewed_at:
        stages.append(StageSigner("hr", "HR", instance.hr_reviewed_by, instance.hr_reviewed_at, "Reviewed"))
    if instance.ceo_decided_by_id and instance.ceo_decided_at:
        action = "Rejected" if instance.status == AnnualLeavePaymentRequest.Status.REJECTED else "Approved"
        stages.append(StageSigner("ceo", "CEO", instance.ceo_decided_by, instance.ceo_decided_at, action))
    return stages


def _involved_ids(instance: AnnualLeavePaymentRequest) -> set[int]:
    return {user_id for user_id in (getattr(instance, f"{field}_id") for field in INVOLVED_FIELDS) if user_id}


def can_access_annual_payment_document(user, instance: AnnualLeavePaymentRequest) -> bool:
    """The employee, the recorded filer/HR reviewer/CEO, or HR/SystemAdmin.

    HR access is additionally limited to companies the caller can access by the
    view's own queryset; this check covers the people involved in the request.
    """

    if user is None or not user.is_authenticated:
        return False
    if get_role(user) in {"SystemAdmin", "HRManager"}:
        return True
    return user.pk in _involved_ids(instance)


def _accessible_queryset(request):
    return filter_queryset_by_accessible_companies(AnnualLeavePaymentRequest.objects.all(), request)


def register() -> None:
    register_document_type(
        DocumentType(
            key=DOCUMENT_TYPE,
            label="Annual Entitlements",
            api_type="annual_entitlement",
            model=AnnualLeavePaymentRequest,
            render=_render,
            reference=_reference,
            subject=_subject,
            company=lambda instance: instance.company,
            stage_signers=annual_payment_stage_signers,
            can_access=can_access_annual_payment_document,
            accessible_queryset=_accessible_queryset,
            final_statuses=(
                AnnualLeavePaymentRequest.Status.APPROVED,
                AnnualLeavePaymentRequest.Status.CARRIED_FORWARD,
            ),
        )
    )


def on_annual_payment_stage_approved(instance: AnnualLeavePaymentRequest, *, role: str, actor, at=None) -> None:
    """Record a personal-mode attestation, and freeze when the settlement is final.

    Both run after the surrounding transaction commits and never raise, so a
    signing or storage failure can never undo the approval.
    """

    from core.document_integrity.services import record_stage_approval, schedule_finalize

    record_stage_approval(instance, role=role, actor=actor, at=at)
    if instance.status in FINAL_STATUSES:
        schedule_finalize(instance, actor=actor)
