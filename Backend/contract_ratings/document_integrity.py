"""The CEO's contract-rating decision copy as a tamper-evident document (option B).

A contract rating prints three confidential documents from one record
(``ContractRatingViewSet.pdf`` picks one through ``viewer_role``): the
employee's self-rating copy, the manager's rating copy, and the decision copy
(the manager's rating plus the CEO's recommendation box) that HR and the CEO
get. Only the decision copy is frozen, once, when the CEO's decision makes the
rating ``DECIDED``. The employee and manager copies keep rendering live and are
never frozen, served or described here.

Access follows ``viewer_role`` exactly: the deciding CEO, and HR approvers once
the CEO asked HR for a comment (the same gate as the decision-copy download).
The rated person is only ever the ``employee`` on their own rating, so they
never reach the decision copy, whatever other role they hold.

HR may still add the requested comment after the decision ("late-safe"); the
HR name and signature are then printed on the decision copy, so a late comment
by a new HR signer re-freezes it as a new version (the earlier hash stays in the
event metadata and verify-upload reports that copy as a superseded version).
"""

from __future__ import annotations

import logging

from core.document_integrity.registry import DocumentType, StageSigner, register_document_type
from organization.services import filter_queryset_by_accessible_companies

from .models import ContractRating, ContractRatingResponse

logger = logging.getLogger(__name__)

DOCUMENT_TYPE = "contract_rating"
FINAL_STATUS = ContractRating.Status.DECIDED
#: ``viewer_role`` values that get the decision copy.
DECISION_ROLES = frozenset({"hr", "ceo"})


def _render(instance: ContractRating) -> bytes:
    # The download's own builder (looked up on the views module so a test patching it
    # there patches the freeze too), never called with a viewer: the decision copy.
    from . import views

    return views.build_contract_rating_pdf(instance, response=instance.manager_response, include_decision=True)


def _reference(instance: ContractRating) -> str:
    from core.services.request_references import public_reference_for

    # Identical to the reference printed on the form (pdf.build_contract_rating_pdf).
    return public_reference_for(instance) or f"CR-{instance.id}"


def _subject(instance: ContractRating) -> str:
    from core.pdf_signers import profile_signer_name

    profile = instance.employee_profile
    name = profile_signer_name(profile) if profile is not None else ""
    employee_id = getattr(profile, "employee_id", "") if profile is not None else ""
    return " - ".join(part for part in (name, employee_id) if part)


def contract_rating_stage_signers(instance: ContractRating) -> list[StageSigner]:
    """Manager rating, HR comment (if any), CEO decision - recorded users and times only."""

    stages = []
    response = instance.manager_response
    if (
        response is not None
        and response.status == ContractRatingResponse.Status.SUBMITTED
        and response.submitted_by_id
        and response.submitted_at
    ):
        stages.append(
            StageSigner("line_manager", "Line manager", response.submitted_by, response.submitted_at, "Rated")
        )
    if instance.hr_comment_by_id and instance.hr_comment_submitted_at:
        stages.append(StageSigner("hr", "HR", instance.hr_comment_by, instance.hr_comment_submitted_at, "Commented"))
    if instance.ceo_decided_by_id and instance.ceo_decided_at:
        stages.append(StageSigner("ceo", "CEO", instance.ceo_decided_by, instance.ceo_decided_at, "Decided"))
    return stages


def can_access_contract_rating_document(user, instance: ContractRating) -> bool:
    """Exactly the viewers of the decision copy: ``viewer_role`` hr (after a CEO
    comment request) or ceo. The employee, the manager and everyone else: no.

    The company limit is applied by the view's queryset (``get_queryset``).
    """

    from .permissions import viewer_role

    if user is None or not user.is_authenticated:
        return False
    role = viewer_role(user, instance)
    if role == "ceo":
        return True
    return role == "hr" and bool(instance.hr_comment_requested_at)


def _accessible_queryset(request):
    """Frozen ratings the caller may see the decision copy of (verify-upload matching).

    ``viewer_role`` is per object (manager relationships, delegation), so the
    candidates - frozen ratings in the caller's companies that are not their own -
    are checked one by one with the same rule as the integrity endpoints.
    """

    from django.db.models import Q

    from core.document_integrity.models import FrozenDocument

    user = request.user
    frozen_ids = FrozenDocument.objects.filter(document_type=DOCUMENT_TYPE).values_list("object_id", flat=True)
    candidates = (
        filter_queryset_by_accessible_companies(ContractRating.objects.all(), request)
        .filter(pk__in=frozen_ids)
        .filter(Q(hr_comment_requested_at__isnull=False) | Q(ceo_decided_by=user))
        .exclude(employee_profile__user=user)
        .select_related("employee_profile")
    )
    allowed = [rating.pk for rating in candidates if can_access_contract_rating_document(user, rating)]
    return ContractRating.objects.filter(pk__in=allowed)


def register() -> None:
    register_document_type(
        DocumentType(
            key=DOCUMENT_TYPE,
            label="Contract Rating Decision",
            api_type="contract_rating",
            model=ContractRating,
            render=_render,
            reference=_reference,
            subject=_subject,
            company=lambda instance: instance.company,
            stage_signers=contract_rating_stage_signers,
            can_access=can_access_contract_rating_document,
            accessible_queryset=_accessible_queryset,
            final_statuses=(FINAL_STATUS,),
        )
    )


def on_contract_rating_stage(instance: ContractRating, *, role: str, actor, at=None) -> None:
    """Personal mode: attest a manager rating, HR comment or CEO decision. Never raises."""

    from core.document_integrity.services import record_stage_approval

    record_stage_approval(instance, role=role, actor=actor, at=at)


def on_contract_rating_decided(instance: ContractRating, *, actor) -> None:
    """Attest the CEO decision and freeze the decision copy once the rating is ``DECIDED``.

    Both run after the surrounding transaction commits and never raise: a
    storage, signing or missing-template failure is logged
    (``document_integrity.finalize_failed``) and can never undo the decision.
    """

    from core.document_integrity.services import schedule_finalize

    try:
        on_contract_rating_stage(instance, role="ceo", actor=actor, at=instance.ceo_decided_at)
        if instance.status == FINAL_STATUS:
            schedule_finalize(instance, actor=actor)
    except Exception:  # pragma: no cover - scheduling only; must never undo the decision
        logger.exception(
            "document_integrity.finalize_failed", extra={"model": "ContractRating", "object_id": instance.pk}
        )


def on_contract_rating_hr_comment(instance: ContractRating, *, actor, signer_changed: bool) -> None:
    """Attest the HR comment; re-freeze an already frozen decision copy when a late
    comment changes the HR signer printed on it. Ratings decided before this
    rollout (nothing frozen) are not backfilled."""

    from core.document_integrity.services import get_frozen_document, schedule_finalize

    try:
        on_contract_rating_stage(instance, role="hr", actor=actor, at=instance.hr_comment_submitted_at)
        if signer_changed and instance.status == FINAL_STATUS and get_frozen_document(instance) is not None:
            schedule_finalize(instance, actor=actor)
    except Exception:  # pragma: no cover - scheduling only; must never undo the comment
        logger.exception(
            "document_integrity.finalize_failed", extra={"model": "ContractRating", "object_id": instance.pk}
        )
