from __future__ import annotations

from datetime import datetime, time
from typing import Any

from django.contrib.contenttypes.models import ContentType
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from audit.utils import audit
from core.models import DelegationRule, RequestObligation


BUSINESS_TRIP_CODE = "BUSINESS_TRIP"


def is_business_trip_leave(leave_request) -> bool:
    leave_type = getattr(leave_request, "leave_type", None)
    code = str(getattr(leave_type, "code", "") or "").strip().upper()
    return code == BUSINESS_TRIP_CODE


def _aware_start(value):
    dt = datetime.combine(value, time.min)
    return timezone.make_aware(dt) if timezone.is_naive(dt) else dt


def _aware_end(value):
    dt = datetime.combine(value, time.max)
    return timezone.make_aware(dt) if timezone.is_naive(dt) else dt


def _parent_content_type(instance):
    return ContentType.objects.get_for_model(instance.__class__)


def _target_identity(target) -> tuple[ContentType | None, int | None]:
    if target is None:
        return None, None
    return ContentType.objects.get_for_model(target.__class__), target.pk


def _profile_for_leave(leave_request):
    profile = getattr(leave_request, "employee_profile", None)
    if profile:
        return profile
    employee = getattr(leave_request, "employee", None)
    return getattr(employee, "employee_profile", None) if employee else None


def _open_obligations_for(parent):
    return RequestObligation.objects.filter(
        parent_content_type=_parent_content_type(parent),
        parent_object_id=parent.pk,
        status=RequestObligation.Status.OPEN,
    )


def _upsert_obligation(
    *,
    parent,
    obligation_type: str,
    title: str,
    description: str = "",
    target=None,
    employee=None,
    company=None,
    metadata: dict[str, Any] | None = None,
) -> RequestObligation:
    parent_ct = _parent_content_type(parent)
    target_ct, target_id = _target_identity(target)
    qs = RequestObligation.objects.filter(
        parent_content_type=parent_ct,
        parent_object_id=parent.pk,
        type=obligation_type,
        target_content_type=target_ct,
        target_object_id=target_id,
    )
    obligation = qs.order_by("-id").first()
    values = {
        "company": company,
        "employee": employee,
        "severity": RequestObligation.Severity.BLOCKING,
        "title": title,
        "description": description,
        "metadata": metadata or {},
    }
    if obligation is None:
        return RequestObligation.objects.create(
            parent_content_type=parent_ct,
            parent_object_id=parent.pk,
            target_content_type=target_ct,
            target_object_id=target_id,
            type=obligation_type,
            **values,
        )
    if obligation.status == RequestObligation.Status.RESOLVED:
        values.update({"status": RequestObligation.Status.OPEN, "resolved_at": None, "resolution_note": ""})
    for field, value in values.items():
        setattr(obligation, field, value)
    obligation.save()
    return obligation


def _resolve_obligation(obligation: RequestObligation, *, note: str, actor=None) -> None:
    if obligation.status != RequestObligation.Status.OPEN:
        return
    obligation.status = RequestObligation.Status.RESOLVED
    obligation.resolved_at = timezone.now()
    obligation.resolved_by = actor
    obligation.resolution_note = note
    obligation.save(update_fields=["status", "resolved_at", "resolved_by", "resolution_note", "updated_at"])


def ensure_leave_delegation_rule(leave_request, *, actor=None) -> DelegationRule | None:
    employee = getattr(leave_request, "employee", None)
    delegated_to = getattr(leave_request, "delegated_to", None)
    if not employee or not delegated_to:
        return None
    start_at = _aware_start(leave_request.start_date)
    end_value = leave_request.date_of_rejoin or leave_request.end_date
    end_at = _aware_end(end_value)
    reason = f"Business Trip leave request #{leave_request.pk}"
    rule, created = DelegationRule.objects.update_or_create(
        from_user=employee,
        to_user=delegated_to,
        start_at=start_at,
        defaults={
            "end_at": end_at,
            "reason": reason,
            "is_active": True,
            "created_by": actor or employee,
        },
    )
    if not created and (rule.end_at != end_at or rule.reason != reason or not rule.is_active):
        rule.end_at = end_at
        rule.reason = reason
        rule.is_active = True
        if actor:
            rule.created_by = rule.created_by or actor
        rule.save(update_fields=["end_at", "reason", "is_active", "created_by", "updated_at"])
    return rule


def has_covering_delegation_for_leave(leave_request) -> bool:
    employee = getattr(leave_request, "employee", None)
    if not employee:
        return True
    start_at = _aware_start(leave_request.start_date)
    end_at = _aware_end(leave_request.date_of_rejoin or leave_request.end_date)
    return DelegationRule.objects.filter(
        from_user=employee,
        is_active=True,
        start_at__lte=start_at,
    ).filter(Q(end_at__isnull=True) | Q(end_at__gte=end_at)).exists()


def get_pending_approval_workflows_for_user(user, *, exclude_parent=None):
    if not user:
        return []

    from core.services.workflow_engine import get_pending_approvals_for_user

    workflows = get_pending_approvals_for_user(user, limit=200)
    if exclude_parent is not None:
        parent_ct = _parent_content_type(exclude_parent)
        workflows = [
            workflow
            for workflow in workflows
            if workflow.content_type_id != parent_ct.id or workflow.object_id != exclude_parent.pk
        ]
    return workflows


@transaction.atomic
def sync_leave_obligations(leave_request, *, actor=None) -> dict[str, Any]:
    parent_ct = _parent_content_type(leave_request)
    profile = _profile_for_leave(leave_request)
    company = getattr(leave_request, "company", None) or getattr(profile, "company", None)

    if not is_business_trip_leave(leave_request):
        for obligation in RequestObligation.objects.filter(parent_content_type=parent_ct, parent_object_id=leave_request.pk):
            _resolve_obligation(obligation, note="Not a Business Trip request.", actor=actor)
        return get_obligations_summary(leave_request)

    if getattr(leave_request, "delegated_to_id", None):
        ensure_leave_delegation_rule(leave_request, actor=actor)

    from assets.models import AssetAssignment

    active_assignments = AssetAssignment.objects.select_related("asset", "employee").filter(
        employee=profile,
        is_active=True,
        asset__must_return_before_travel=True,
    )
    active_asset_ids = set()
    for assignment in active_assignments:
        asset = assignment.asset
        active_asset_ids.add(asset.id)
        _upsert_obligation(
            parent=leave_request,
            obligation_type=RequestObligation.ObligationType.ASSET_RETURN,
            target=asset,
            employee=profile,
            company=company,
            title=f"Return asset {asset.asset_code}",
            description="This asset is marked as must be returned before Business Trip final approval.",
            metadata={
                "asset_id": asset.id,
                "asset_code": asset.asset_code,
                "asset_name": asset.name_en or asset.name_ar,
                "assignment_id": assignment.id,
            },
        )

    stale_asset_obligations = RequestObligation.objects.filter(
        parent_content_type=parent_ct,
        parent_object_id=leave_request.pk,
        type=RequestObligation.ObligationType.ASSET_RETURN,
        status=RequestObligation.Status.OPEN,
    )
    for obligation in stale_asset_obligations:
        asset_id = (obligation.metadata or {}).get("asset_id")
        if asset_id not in active_asset_ids:
            _resolve_obligation(obligation, note="Required asset is no longer actively assigned.", actor=actor)

    pending_workflows = get_pending_approval_workflows_for_user(
        getattr(leave_request, "employee", None),
        exclude_parent=leave_request,
    )
    pending_count = len(pending_workflows)
    delegation_covers_trip = has_covering_delegation_for_leave(leave_request)
    pending_obligation = RequestObligation.objects.filter(
        parent_content_type=parent_ct,
        parent_object_id=leave_request.pk,
        type=RequestObligation.ObligationType.PENDING_APPROVALS,
        target_content_type__isnull=True,
        target_object_id__isnull=True,
        status=RequestObligation.Status.OPEN,
    ).first()
    if pending_count and not delegation_covers_trip:
        _upsert_obligation(
            parent=leave_request,
            obligation_type=RequestObligation.ObligationType.PENDING_APPROVALS,
            employee=profile,
            company=company,
            title="Delegate pending approvals",
            description="The employee has pending approvals and must delegate responsibility for the trip period.",
            metadata={"pending_count": pending_count},
        )
    elif pending_obligation:
        note = "Delegation covers the Business Trip period." if delegation_covers_trip else "No pending approvals remain."
        _resolve_obligation(pending_obligation, note=note, actor=actor)

    return get_obligations_summary(leave_request)


def get_obligations_summary(parent) -> dict[str, Any]:
    obligations = list(
        RequestObligation.objects.filter(
            parent_content_type=_parent_content_type(parent),
            parent_object_id=parent.pk,
        ).order_by("status", "type", "id")
    )
    open_blockers = [
        obligation
        for obligation in obligations
        if obligation.status == RequestObligation.Status.OPEN
        and obligation.severity == RequestObligation.Severity.BLOCKING
    ]
    return {
        "total": len(obligations),
        "open": sum(1 for item in obligations if item.status == RequestObligation.Status.OPEN),
        "resolved": sum(1 for item in obligations if item.status == RequestObligation.Status.RESOLVED),
        "waived": sum(1 for item in obligations if item.status == RequestObligation.Status.WAIVED),
        "blocking_open": len(open_blockers),
        "can_final_approve": len(open_blockers) == 0,
    }


def waive_open_blocking_obligations(parent, *, actor, reason: str, request=None) -> list[RequestObligation]:
    reason = (reason or "").strip()
    if not reason:
        return []
    waived = []
    for obligation in _open_obligations_for(parent).filter(severity=RequestObligation.Severity.BLOCKING):
        obligation.status = RequestObligation.Status.WAIVED
        obligation.waived_at = timezone.now()
        obligation.waived_by = actor
        obligation.waiver_reason = reason
        obligation.save(update_fields=["status", "waived_at", "waived_by", "waiver_reason", "updated_at"])
        audit(
            request,
            "request_obligation_waived",
            entity="RequestObligation",
            entity_id=obligation.id,
            metadata={
                "parent_entity": parent.__class__.__name__,
                "parent_id": parent.pk,
                "type": obligation.type,
                "reason": reason,
            },
        )
        waived.append(obligation)
    return waived
