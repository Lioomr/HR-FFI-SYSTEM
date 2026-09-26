from __future__ import annotations

from datetime import datetime, time
from typing import Any

from django.contrib.contenttypes.models import ContentType
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from audit.utils import audit
from core.models import DelegationRule, RequestObligation
from organization.models import OrganizationScope

BUSINESS_TRIP_CODE = "BUSINESS_TRIP"


def _business_trip_delegation_reference(leave_request, delegated_to_id=None) -> str:
    suffix = f":{delegated_to_id}" if delegated_to_id else ""
    return f"business_trip_leave:{leave_request.pk}{suffix}"


def _revoke_business_trip_delegations(leave_request, *, actor=None, note: str, exclude_rule_id=None) -> None:
    employee = getattr(leave_request, "employee", None)
    if not employee or not leave_request.pk:
        return
    reference = _business_trip_delegation_reference(leave_request)
    legacy_reason = f"Business Trip leave request #{leave_request.pk}"
    rules = DelegationRule.objects.filter(from_user=employee, is_active=True).filter(
        Q(source_reference__startswith=f"{reference}:") | Q(reason=legacy_reason)
    )
    if exclude_rule_id:
        rules = rules.exclude(pk=exclude_rule_id)
    for rule in rules:
        rule.is_active = False
        rule.revoked_at = timezone.now()
        rule.revoked_by = actor
        rule.save(update_fields=["is_active", "revoked_at", "revoked_by", "updated_at"])
        audit(
            None,
            "delegation_rule_revoked",
            entity="delegation_rule",
            entity_id=rule.id,
            metadata={
                "from_user_id": rule.from_user_id,
                "to_user_id": rule.to_user_id,
                "source_reference": reference,
                "reason": note,
            },
            actor=actor,
        )


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
    qs = RequestObligation.objects.select_for_update().filter(
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
    reference = _business_trip_delegation_reference(leave_request, delegated_to.pk)
    employee_company_id = getattr(_profile_for_leave(leave_request), "company_id", None)
    delegate_company_id = getattr(getattr(delegated_to, "employee_profile", None), "company_id", None)
    scope = None
    if employee_company_id != delegate_company_id:
        if not employee_company_id or not delegate_company_id:
            return None
        from core.permissions import get_role

        if not actor or get_role(actor) not in {"HRManager", "SystemAdmin"}:
            return None
        scope = (
            OrganizationScope.objects.filter(
                is_active=True,
                memberships__company_id=employee_company_id,
            )
            .filter(memberships__company_id=delegate_company_id)
            .order_by("id")
            .first()
        )
        # A Business Trip's alternative reviewer is not by itself authority to
        # approve the employee's other workflows across company boundaries.
        if scope is None:
            return None
    rule = DelegationRule.objects.filter(source_reference=reference).first()
    if rule is None:
        # Adopt the pre-reference row on existing systems so the first update
        # after deployment does not leave its old grant active.
        rule = (
            DelegationRule.objects.filter(
                from_user=employee,
                to_user=delegated_to,
                reason=reason,
            )
            .order_by("-id")
            .first()
        )
    if rule is None:
        rule = DelegationRule.objects.create(
            from_user=employee,
            to_user=delegated_to,
            start_at=start_at,
            source_reference=reference,
            scope=scope,
            created_by=actor or employee,
            capabilities=[DelegationRule.Capability.WORKFLOW_APPROVE],
            reason=reason,
            end_at=end_at,
        )
    else:
        rule.from_user = employee
        rule.to_user = delegated_to
        rule.start_at = start_at
        rule.end_at = end_at
        rule.source_reference = reference
        rule.scope = scope
        rule.reason = reason
        rule.is_active = True
        rule.revoked_at = None
        rule.revoked_by = None
        rule.capabilities = [DelegationRule.Capability.WORKFLOW_APPROVE]
        if actor:
            rule.created_by = rule.created_by or actor
        rule.save(
            update_fields=[
                "from_user",
                "to_user",
                "start_at",
                "end_at",
                "source_reference",
                "scope",
                "reason",
                "is_active",
                "revoked_at",
                "revoked_by",
                "capabilities",
                "created_by",
                "updated_at",
            ]
        )
    # Retire any duplicate legacy rows left by earlier delegate replacements.
    _revoke_business_trip_delegations(
        leave_request,
        actor=actor,
        note="Replaced by the current Business Trip delegation.",
        exclude_rule_id=rule.pk,
    )
    return rule


def close_leave_obligations(leave_request, *, note: str, actor=None) -> None:
    """Resolve a cancelled leave's open obligations and end the delegation it created."""

    parent_ct = _parent_content_type(leave_request)
    for obligation in RequestObligation.objects.filter(
        parent_content_type=parent_ct, parent_object_id=leave_request.pk
    ):
        _resolve_obligation(obligation, note=note, actor=actor)
    _revoke_business_trip_delegations(leave_request, actor=actor, note=note)


def has_covering_delegation_for_leave(leave_request) -> bool:
    employee = getattr(leave_request, "employee", None)
    if not employee:
        return True
    start_at = _aware_start(leave_request.start_date)
    end_at = _aware_end(leave_request.date_of_rejoin or leave_request.end_date)
    return (
        DelegationRule.objects.filter(
            from_user=employee,
            is_active=True,
            capabilities__contains=[DelegationRule.Capability.WORKFLOW_APPROVE],
            start_at__lte=start_at,
        )
        .filter(Q(end_at__isnull=True) | Q(end_at__gte=end_at))
        .exists()
    )


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
        for obligation in RequestObligation.objects.filter(
            parent_content_type=parent_ct, parent_object_id=leave_request.pk
        ):
            _resolve_obligation(obligation, note="Not a Business Trip request.", actor=actor)
        _revoke_business_trip_delegations(
            leave_request,
            actor=actor,
            note="Leave request is no longer a Business Trip.",
        )
        return get_obligations_summary(leave_request)

    if getattr(leave_request, "delegated_to_id", None):
        trip_rule = ensure_leave_delegation_rule(leave_request, actor=actor)
        if trip_rule is None:
            _revoke_business_trip_delegations(
                leave_request,
                actor=actor,
                note="No valid approval delegation is available for this Business Trip.",
            )
    else:
        _revoke_business_trip_delegations(
            leave_request,
            actor=actor,
            note="Business Trip delegation was removed.",
        )

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
        note = (
            "Delegation covers the Business Trip period." if delegation_covers_trip else "No pending approvals remain."
        )
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


def get_obligations_summaries(parents) -> dict[int, dict[str, Any]]:
    """Return obligation summaries for multiple parents with one read query."""
    parents = list(parents)
    if not parents:
        return {}
    parent_content_type = _parent_content_type(parents[0])
    parent_ids = [parent.pk for parent in parents]
    rows = RequestObligation.objects.filter(
        parent_content_type=parent_content_type,
        parent_object_id__in=parent_ids,
    ).values_list("parent_object_id", "status", "severity")
    summaries = {
        parent_id: {"total": 0, "open": 0, "resolved": 0, "waived": 0, "blocking_open": 0, "can_final_approve": True}
        for parent_id in parent_ids
    }
    for parent_id, status, severity in rows:
        summary = summaries[parent_id]
        summary["total"] += 1
        summary[status] += 1
        if status == RequestObligation.Status.OPEN:
            if severity == RequestObligation.Severity.BLOCKING:
                summary["blocking_open"] += 1
                summary["can_final_approve"] = False
    return summaries


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
