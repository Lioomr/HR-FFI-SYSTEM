"""Loan requests as tamper-evident documents (see ``core.document_integrity``).

The loan form carries five decision columns (manager, HR, CFO, CEO,
disbursement). The document is frozen when the last of them completes: the
accountant's disbursement moves the loan to ``approved``, the only state payroll
deducts from. A CFO/CEO approval only reaches ``pending_disbursement`` and the
form still shows the disbursement column as pending, so it keeps rendering live.

The approval trail and the personal signers come from the decision fields the
workflow recorded - the same actors whose signatures appear on the form.
"""

from __future__ import annotations

from core.document_integrity.registry import DocumentType, StageSigner, register_document_type
from core.permissions import get_role
from organization.services import filter_queryset_by_accessible_companies

from .models import LoanRequest

DOCUMENT_TYPE = "loan_request"
FINAL_STATUS = LoanRequest.RequestStatus.APPROVED

#: Recorded actor fields of every decision on the form, in workflow order.
APPROVER_FIELDS = (
    "manager_decision_by",
    "finance_decision_by",
    "cfo_decision_by",
    "ceo_decision_by",
    "disbursed_by",
)
#: Everyone involved in a loan: the requester plus the recorded approvers.
INVOLVED_FIELDS = ("employee", *APPROVER_FIELDS)


def _render(instance: LoanRequest) -> bytes:
    from .views import _build_loan_request_pdf

    return _build_loan_request_pdf(instance)


def _reference(instance: LoanRequest) -> str:
    from core.services.request_references import public_reference_for

    return public_reference_for(instance) or f"LN-{instance.pk:05d}"


def _subject(instance: LoanRequest) -> str:
    from core.pdf_signers import profile_signer_name

    profile = instance.employee_profile
    name = profile_signer_name(profile) if profile is not None else ""
    employee_id = getattr(profile, "employee_id", "") if profile is not None else ""
    return " - ".join(part for part in (name, employee_id) if part)


def _recommendation_label(value: str | None) -> str:
    # The same words the form prints in the decision box (the trail column is narrow).
    if value == LoanRequest.Recommendation.REJECT:
        return "Rejected"
    return "Approved"


def loan_stage_signers(instance: LoanRequest) -> list[StageSigner]:
    """Completed stages in workflow order, from the recorded decision fields."""

    stages = [StageSigner("employee", "Employee", instance.employee, instance.created_at, "Submitted")]
    if instance.manager_decision_by_id and instance.manager_decision_at:
        stages.append(
            StageSigner(
                "line_manager",
                "Line manager",
                instance.manager_decision_by,
                instance.manager_decision_at,
                _recommendation_label(instance.manager_recommendation),
            )
        )
    if instance.finance_decision_by_id and instance.finance_decision_at:
        stages.append(
            StageSigner(
                "hr",
                "HR",
                instance.finance_decision_by,
                instance.finance_decision_at,
                _recommendation_label(instance.hr_recommendation),
            )
        )
    if instance.cfo_decision_by_id and instance.cfo_decision_at:
        referred = bool(instance.ceo_decision_at) or instance.status == LoanRequest.RequestStatus.PENDING_CEO
        stages.append(
            StageSigner(
                "cfo",
                "CFO",
                instance.cfo_decision_by,
                instance.cfo_decision_at,
                "Referred" if referred else "Approved",
            )
        )
    if instance.ceo_decision_by_id and instance.ceo_decision_at:
        stages.append(StageSigner("ceo", "CEO", instance.ceo_decision_by, instance.ceo_decision_at))
    if instance.disbursed_by_id and instance.disbursed_at:
        stages.append(
            StageSigner("disbursement", "Disbursement", instance.disbursed_by, instance.disbursed_at, "Disbursed")
        )
    return stages


def _approver_ids(instance: LoanRequest) -> set[int]:
    return {user_id for user_id in (getattr(instance, f"{field}_id") for field in APPROVER_FIELDS) if user_id}


def can_access_loan_document(user, instance: LoanRequest) -> bool:
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
    return filter_queryset_by_accessible_companies(LoanRequest.objects.filter(is_active=True), request)


def register() -> None:
    register_document_type(
        DocumentType(
            key=DOCUMENT_TYPE,
            label="Loan Request",
            api_type="loan",
            model=LoanRequest,
            render=_render,
            reference=_reference,
            subject=_subject,
            company=lambda instance: instance.company,
            stage_signers=loan_stage_signers,
            can_access=can_access_loan_document,
            accessible_queryset=_accessible_queryset,
            # Disbursed (frozen) and, after payroll deducted it, still the same document.
            final_statuses=(FINAL_STATUS, LoanRequest.RequestStatus.DEDUCTED),
        )
    )


def on_loan_stage_approved(instance: LoanRequest, *, role: str, actor, at=None) -> None:
    """Record a personal-mode attestation, and freeze when the loan is final.

    Both run after the surrounding transaction commits and never raise, so a
    signing or storage failure can never undo the approval.
    """

    from core.document_integrity.services import record_stage_approval, schedule_finalize

    record_stage_approval(instance, role=role, actor=actor, at=at)
    if instance.status == FINAL_STATUS and instance.is_active:
        schedule_finalize(instance, actor=actor)
