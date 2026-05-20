from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from django.contrib.contenttypes.models import ContentType
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from audit.utils import audit
from core.delegation import (
    get_active_delegation,
    get_pending_approval_roles_for_user,
    is_user_approver_for_role,
)
from core.models import WorkflowAction, WorkflowDefinition, WorkflowInstance, WorkflowStageDefinition
from core.permissions import get_role

from .pending_approval_email import get_direct_manager_user

WORKFLOW_TEMPLATES = {
    "leave_request": {
        "name": "Leave Request Workflow",
        "module_key": "leaves",
        "stages": [
            {
                "key": "delegate",
                "title": "Alternative Employee Review",
                "approver_role": "delegate",
                "order": 0,
                "is_optional": True,
            },
            {"key": "manager", "title": "Manager Review", "approver_role": "manager", "order": 1},
            {"key": "hr", "title": "HR Review", "approver_role": "hr", "order": 2},
            {"key": "ceo", "title": "CEO Review", "approver_role": "ceo", "order": 3, "is_optional": True},
        ],
    },
    "loan_request": {
        "name": "Loan Request Workflow",
        "module_key": "loans",
        "stages": [
            {"key": "manager", "title": "Manager Review", "approver_role": "manager", "order": 1},
            {"key": "hr", "title": "HR Review", "approver_role": "hr", "order": 2},
            {"key": "cfo", "title": "CFO Review", "approver_role": "cfo", "order": 3},
            {"key": "ceo", "title": "CEO Review", "approver_role": "ceo", "order": 4, "is_optional": True},
            {"key": "disbursement", "title": "Disbursement", "approver_role": "disbursement", "order": 5},
        ],
    },
    "attendance_request": {
        "name": "Attendance Request Workflow",
        "module_key": "attendance",
        "stages": [
            {"key": "manager", "title": "Manager Review", "approver_role": "manager", "order": 1, "is_optional": True},
            {"key": "hr", "title": "HR Review", "approver_role": "hr", "order": 2, "is_optional": True},
            {"key": "ceo", "title": "CEO Review", "approver_role": "ceo", "order": 3, "is_optional": True},
        ],
    },
    "asset_return_request": {
        "name": "Asset Return Request Workflow",
        "module_key": "assets",
        "stages": [
            {"key": "manager", "title": "Manager Review", "approver_role": "manager", "order": 1, "is_optional": True},
            {"key": "hr", "title": "HR Review", "approver_role": "hr", "order": 2},
            {"key": "ceo", "title": "CEO Review", "approver_role": "ceo", "order": 3, "is_optional": True},
        ],
    },
    "attendance_correction_request": {
        "name": "Attendance Correction Workflow",
        "module_key": "attendance",
        "stages": [
            {"key": "manager", "title": "Manager Review", "approver_role": "manager", "order": 1, "is_optional": True},
            {"key": "hr", "title": "HR Review", "approver_role": "hr", "order": 2},
        ],
    },
    "employee_deletion_request": {
        "name": "Employee Deletion Workflow",
        "module_key": "employees",
        "stages": [
            {"key": "ceo", "title": "CEO Review", "approver_role": "ceo", "order": 1},
        ],
    },
}


@dataclass
class WorkflowEvent:
    signature: str
    action: str
    approver_role: str
    from_status: str
    to_status: str
    from_stage: str
    to_stage: str
    actor: Any = None
    note: str = ""
    at: Any = None
    metadata: dict[str, Any] | None = None


def _build_action_url_path(workflow_key: str, role: str, object_id: int) -> str:
    route_map = {
        ("leave_request", "delegate"): f"/employee/leave/requests/{object_id}",
        ("leave_request", "manager"): f"/manager/leave/requests/{object_id}",
        ("leave_request", "hr"): f"/hr/leave/requests/{object_id}",
        ("leave_request", "ceo"): f"/ceo/leave/requests/{object_id}",
        ("loan_request", "manager"): f"/manager/loan-requests/{object_id}",
        ("loan_request", "hr"): f"/hr/loan-requests/{object_id}",
        ("loan_request", "cfo"): f"/cfo/loan-requests/{object_id}",
        ("loan_request", "ceo"): f"/ceo/loan-requests/{object_id}",
        ("loan_request", "disbursement"): f"/finance/loan-requests/{object_id}",
        ("attendance_request", "manager"): "/manager/team-requests?tab=attendance",
        ("attendance_request", "hr"): "/hr/attendance",
        ("attendance_request", "ceo"): "/ceo/attendance",
        ("attendance_correction_request", "manager"): "/manager/team-requests?tab=attendance-corrections",
        ("attendance_correction_request", "hr"): "/hr/attendance-correction-requests",
        ("asset_return_request", "manager"): "/manager/team-requests?tab=asset-returns",
        ("asset_return_request", "hr"): "/hr/assets",
        ("asset_return_request", "ceo"): "/ceo/assets/return-requests",
        ("employee_deletion_request", "ceo"): f"/ceo/employees/deletion-requests/{object_id}",
    }
    return route_map.get((workflow_key, role), "")


def _template_for(workflow_key: str) -> dict[str, Any]:
    if workflow_key not in WORKFLOW_TEMPLATES:
        raise ValueError(f"Unsupported workflow key: {workflow_key}")
    return WORKFLOW_TEMPLATES[workflow_key]


def get_or_create_workflow_definition(workflow_key: str) -> WorkflowDefinition:
    template = _template_for(workflow_key)
    definition, _ = WorkflowDefinition.objects.get_or_create(
        key=workflow_key,
        defaults={
            "name": template["name"],
            "module_key": template["module_key"],
            "is_active": True,
        },
    )
    if (
        definition.name != template["name"]
        or definition.module_key != template["module_key"]
        or not definition.is_active
    ):
        definition.name = template["name"]
        definition.module_key = template["module_key"]
        definition.is_active = True
        definition.save(update_fields=["name", "module_key", "is_active", "updated_at"])

    existing = {stage.key: stage for stage in definition.stages.all()}
    for stage_data in template["stages"]:
        stage = existing.get(stage_data["key"])
        if stage is None:
            WorkflowStageDefinition.objects.create(definition=definition, **stage_data)
            continue
        changed = False
        for field in ("title", "approver_role", "order", "is_optional"):
            if getattr(stage, field) != stage_data.get(field, getattr(stage, field)):
                setattr(stage, field, stage_data.get(field, getattr(stage, field)))
                changed = True
        if changed:
            stage.save(update_fields=["title", "approver_role", "order", "is_optional", "updated_at"])
    return definition


def _get_subject_user(instance):
    if hasattr(instance, "target_user"):
        return getattr(instance, "target_user", None)
    if hasattr(instance, "employee"):
        return instance.employee
    if hasattr(instance, "employee_profile"):
        return getattr(instance.employee_profile, "user", None)
    return None


def _resolve_current_actor(role: str, instance):
    subject_user = _get_subject_user(instance)
    candidate = None
    if role == "delegate":
        return getattr(instance, "delegated_to", None)
    if role == "manager":
        candidate = get_direct_manager_user(subject_user) if subject_user else None
    if candidate:
        delegation = get_active_delegation(candidate)
        if delegation:
            return delegation.to_user
    return candidate


def _is_user_in_queryset(user, qs):
    if not user or not user.is_authenticated:
        return False
    return qs.filter(id=user.id).exists()


def can_user_act_on_instance(user, instance, workflow: WorkflowInstance | None = None) -> bool:
    if not user or not user.is_authenticated:
        return False
    workflow = workflow or sync_workflow(instance)
    if workflow.status not in {WorkflowInstance.Status.SUBMITTED, WorkflowInstance.Status.IN_REVIEW}:
        return False
    if workflow.current_actor_user_id and workflow.current_actor_user_id == user.id:
        return True

    role = workflow.current_approver_role
    if role == "delegate":
        return bool(getattr(instance, "delegated_to_id", None) == user.id)
    if role == "manager":
        subject_user = _get_subject_user(instance)
        direct_manager = get_direct_manager_user(subject_user) if subject_user else None
        return bool(direct_manager and direct_manager.id == user.id)
    if role in {"hr", "cfo", "ceo", "disbursement"}:
        return is_user_approver_for_role(user, role)
    return False


def _legacy_status_snapshot_for_leave(instance):
    from leaves.models import LeaveRequest

    current_stage = ""
    current_role = ""
    status = WorkflowInstance.Status.IN_REVIEW
    terminal_at = None

    if instance.source == LeaveRequest.RequestSource.HR_MANUAL:
        status = WorkflowInstance.Status.APPROVED
        terminal_at = instance.decided_at or instance.updated_at
    elif instance.status == LeaveRequest.RequestStatus.APPROVED:
        status = WorkflowInstance.Status.APPROVED
        terminal_at = (
            getattr(instance, "hr_completed_at", None)
            or instance.ceo_decision_at
            or instance.decided_at
            or instance.updated_at
        )
    elif instance.status == LeaveRequest.RequestStatus.REJECTED:
        status = WorkflowInstance.Status.REJECTED
        terminal_at = (
            instance.ceo_decision_at or instance.decided_at or instance.manager_decision_at or instance.updated_at
        )
    elif instance.status == LeaveRequest.RequestStatus.CANCELLED:
        status = WorkflowInstance.Status.CANCELLED
        terminal_at = instance.updated_at
    elif instance.status == LeaveRequest.RequestStatus.PENDING_DELEGATE:
        current_stage = "delegate"
        current_role = "delegate"
    elif instance.status == LeaveRequest.RequestStatus.PENDING_MANAGER:
        current_stage = "manager"
        current_role = "manager"
    elif instance.status in {LeaveRequest.RequestStatus.SUBMITTED, LeaveRequest.RequestStatus.PENDING_HR}:
        current_stage = "hr"
        current_role = "hr"
        status = (
            WorkflowInstance.Status.SUBMITTED
            if instance.status == LeaveRequest.RequestStatus.SUBMITTED
            else WorkflowInstance.Status.IN_REVIEW
        )
    elif instance.status == LeaveRequest.RequestStatus.PENDING_CEO:
        current_stage = "ceo"
        current_role = "ceo"
    elif instance.status == LeaveRequest.RequestStatus.PENDING_HR_COMPLETION:
        current_stage = "hr_completion"
        current_role = "hr"

    return {
        "status": status,
        "current_stage": current_stage,
        "current_role": current_role,
        "current_actor_user": _resolve_current_actor(current_role, instance) if current_role else None,
        "submitted_by": instance.employee,
        "submitted_at": instance.created_at,
        "decided_at": terminal_at
        if status in {WorkflowInstance.Status.APPROVED, WorkflowInstance.Status.REJECTED}
        else None,
        "cancelled_at": terminal_at if status == WorkflowInstance.Status.CANCELLED else None,
    }


def _legacy_events_for_leave(instance) -> list[WorkflowEvent]:
    from leaves.models import LeaveRequest

    events = [
        WorkflowEvent(
            signature=f"leave:submitted:{instance.id}:{instance.created_at.isoformat()}",
            action=WorkflowAction.Action.SUBMIT,
            approver_role="",
            from_status="draft",
            to_status="submitted",
            from_stage="",
            to_stage=(
                "delegate"
                if instance.status == LeaveRequest.RequestStatus.PENDING_DELEGATE or instance.delegate_decision_at
                else "manager"
                if instance.status == LeaveRequest.RequestStatus.PENDING_MANAGER or instance.manager_decision_at
                else "hr"
            ),
            actor=instance.employee,
            note=instance.reason or "",
            at=instance.created_at,
            metadata={"legacy_signature": "submitted", "workflow_key": "leave_request"},
        )
    ]
    if instance.delegate_decision_at:
        events.append(
            WorkflowEvent(
                signature=f"leave:delegate:{instance.id}:{instance.delegate_decision_at.isoformat()}",
                action=WorkflowAction.Action.REJECT
                if instance.status == LeaveRequest.RequestStatus.REJECTED
                and not instance.decided_at
                and not instance.ceo_decision_at
                else WorkflowAction.Action.APPROVE,
                approver_role="delegate",
                from_status="in_review",
                to_status="rejected"
                if instance.status == LeaveRequest.RequestStatus.REJECTED
                and not instance.decided_at
                and not instance.ceo_decision_at
                else "in_review",
                from_stage="delegate",
                to_stage=""
                if instance.status == LeaveRequest.RequestStatus.REJECTED
                and not instance.decided_at
                and not instance.ceo_decision_at
                else "hr",
                actor=instance.delegate_decision_by,
                note=instance.delegate_decision_note or "",
                at=instance.delegate_decision_at,
                metadata={"legacy_signature": "delegate", "workflow_key": "leave_request"},
            )
        )
    if instance.manager_decision_at:
        next_stage = "hr" if instance.status != LeaveRequest.RequestStatus.REJECTED else ""
        events.append(
            WorkflowEvent(
                signature=f"leave:manager:{instance.id}:{instance.manager_decision_at.isoformat()}",
                action=WorkflowAction.Action.REJECT
                if instance.status == LeaveRequest.RequestStatus.REJECTED and not instance.decided_at
                else WorkflowAction.Action.APPROVE,
                approver_role="manager",
                from_status="in_review",
                to_status="rejected"
                if instance.status == LeaveRequest.RequestStatus.REJECTED and not instance.decided_at
                else "in_review",
                from_stage="manager",
                to_stage=next_stage,
                actor=instance.manager_decision_by,
                note=instance.manager_decision_note or "",
                at=instance.manager_decision_at,
                metadata={"legacy_signature": "manager", "workflow_key": "leave_request"},
            )
        )
    if instance.decided_at:
        action = WorkflowAction.Action.APPROVE
        to_status = "approved"
        to_stage = ""
        if instance.status == LeaveRequest.RequestStatus.PENDING_CEO:
            action = WorkflowAction.Action.ADVANCE
            to_status = "in_review"
            to_stage = "ceo"
        elif instance.status == LeaveRequest.RequestStatus.REJECTED:
            action = WorkflowAction.Action.REJECT
            to_status = "rejected"
        events.append(
            WorkflowEvent(
                signature=f"leave:hr:{instance.id}:{instance.decided_at.isoformat()}",
                action=action,
                approver_role="hr",
                from_status="in_review",
                to_status=to_status,
                from_stage="hr",
                to_stage=to_stage,
                actor=instance.decided_by,
                note=instance.hr_decision_note or instance.decision_reason or "",
                at=instance.decided_at,
                metadata={"legacy_signature": "hr", "workflow_key": "leave_request"},
            )
        )
    if instance.ceo_decision_at:
        events.append(
            WorkflowEvent(
                signature=f"leave:ceo:{instance.id}:{instance.ceo_decision_at.isoformat()}",
                action=WorkflowAction.Action.REJECT
                if instance.status == LeaveRequest.RequestStatus.REJECTED
                else WorkflowAction.Action.APPROVE,
                approver_role="ceo",
                from_status="in_review",
                to_status="rejected" if instance.status == LeaveRequest.RequestStatus.REJECTED else "in_review",
                from_stage="ceo",
                to_stage="" if instance.status == LeaveRequest.RequestStatus.REJECTED else "hr_completion",
                actor=instance.ceo_decision_by,
                note=instance.ceo_decision_note or "",
                at=instance.ceo_decision_at,
                metadata={"legacy_signature": "ceo", "workflow_key": "leave_request"},
            )
        )
    if getattr(instance, "hr_completed_at", None):
        events.append(
            WorkflowEvent(
                signature=f"leave:hr-completion:{instance.id}:{instance.hr_completed_at.isoformat()}",
                action=WorkflowAction.Action.APPROVE,
                approver_role="hr",
                from_status="in_review",
                to_status="approved",
                from_stage="hr_completion",
                to_stage="",
                actor=instance.hr_completed_by,
                note=instance.hr_completion_note or "",
                at=instance.hr_completed_at,
                metadata={"legacy_signature": "hr_completion", "workflow_key": "leave_request"},
            )
        )
    if instance.status == LeaveRequest.RequestStatus.CANCELLED:
        events.append(
            WorkflowEvent(
                signature=f"leave:cancel:{instance.id}:{instance.updated_at.isoformat()}",
                action=WorkflowAction.Action.CANCEL,
                approver_role="",
                from_status="in_review",
                to_status="cancelled",
                from_stage="",
                to_stage="",
                actor=instance.employee,
                note="",
                at=instance.updated_at,
                metadata={"legacy_signature": "cancel", "workflow_key": "leave_request"},
            )
        )
    return events


def _legacy_status_snapshot_for_loan(instance):
    from loans.models import LoanRequest

    current_map = {
        LoanRequest.RequestStatus.PENDING_MANAGER: ("manager", "manager"),
        LoanRequest.RequestStatus.PENDING_HR: ("hr", "hr"),
        LoanRequest.RequestStatus.PENDING_FINANCE: ("hr", "hr"),
        LoanRequest.RequestStatus.PENDING_CFO: ("cfo", "cfo"),
        LoanRequest.RequestStatus.PENDING_CEO: ("ceo", "ceo"),
        LoanRequest.RequestStatus.PENDING_DISBURSEMENT: ("disbursement", "disbursement"),
    }
    status = WorkflowInstance.Status.IN_REVIEW
    current_stage, current_role = current_map.get(instance.status, ("", ""))
    terminal_at = None
    if instance.status == LoanRequest.RequestStatus.SUBMITTED:
        status = WorkflowInstance.Status.SUBMITTED
        current_stage = current_stage or "hr"
        current_role = current_role or "hr"
    elif instance.status in {
        LoanRequest.RequestStatus.APPROVED,
        LoanRequest.RequestStatus.DEDUCTED,
    }:
        status = WorkflowInstance.Status.APPROVED
        terminal_at = (
            instance.deducted_at or instance.disbursed_at or instance.ceo_decision_at or instance.cfo_decision_at
        )
        current_stage, current_role = "", ""
    elif instance.status == LoanRequest.RequestStatus.REJECTED:
        status = WorkflowInstance.Status.REJECTED
        terminal_at = (
            instance.ceo_decision_at
            or instance.cfo_decision_at
            or instance.finance_decision_at
            or instance.manager_decision_at
        )
        current_stage, current_role = "", ""
    elif instance.status == LoanRequest.RequestStatus.CANCELLED:
        status = WorkflowInstance.Status.CANCELLED
        terminal_at = instance.updated_at
        current_stage, current_role = "", ""
    current_actor_user = _resolve_current_actor(current_role, instance) if current_role else None
    return {
        "status": status,
        "current_stage": current_stage,
        "current_role": current_role,
        "current_actor_user": current_actor_user,
        "submitted_by": instance.employee,
        "submitted_at": instance.created_at,
        "decided_at": terminal_at
        if status in {WorkflowInstance.Status.APPROVED, WorkflowInstance.Status.REJECTED}
        else None,
        "cancelled_at": terminal_at if status == WorkflowInstance.Status.CANCELLED else None,
    }


def _legacy_events_for_loan(instance) -> list[WorkflowEvent]:
    from loans.models import LoanRequest

    events = [
        WorkflowEvent(
            signature=f"loan:submitted:{instance.id}:{instance.created_at.isoformat()}",
            action=WorkflowAction.Action.SUBMIT,
            approver_role="",
            from_status="draft",
            to_status="submitted",
            from_stage="",
            to_stage="manager" if instance.status == LoanRequest.RequestStatus.PENDING_MANAGER else "hr",
            actor=instance.employee,
            note=instance.reason or "",
            at=instance.created_at,
            metadata={"legacy_signature": "submitted", "workflow_key": "loan_request"},
        )
    ]
    if instance.manager_decision_at:
        events.append(
            WorkflowEvent(
                signature=f"loan:manager:{instance.id}:{instance.manager_decision_at.isoformat()}",
                action=WorkflowAction.Action.ADVANCE,
                approver_role="manager",
                from_status="in_review",
                to_status="in_review",
                from_stage="manager",
                to_stage="hr",
                actor=instance.manager_decision_by,
                note=instance.manager_decision_note or "",
                at=instance.manager_decision_at,
                metadata={
                    "legacy_signature": "manager",
                    "workflow_key": "loan_request",
                    "recommendation": instance.manager_recommendation or "",
                },
            )
        )
    if instance.finance_decision_at:
        events.append(
            WorkflowEvent(
                signature=f"loan:hr:{instance.id}:{instance.finance_decision_at.isoformat()}",
                action=WorkflowAction.Action.ADVANCE,
                approver_role="hr",
                from_status="in_review",
                to_status="in_review",
                from_stage="hr",
                to_stage="cfo",
                actor=instance.finance_decision_by,
                note=instance.finance_decision_note or "",
                at=instance.finance_decision_at,
                metadata={
                    "legacy_signature": "hr",
                    "workflow_key": "loan_request",
                    "recommendation": instance.hr_recommendation or "",
                },
            )
        )
    if instance.cfo_decision_at:
        action = WorkflowAction.Action.ADVANCE
        to_status = "in_review"
        to_stage = "ceo" if instance.status == LoanRequest.RequestStatus.PENDING_CEO else "disbursement"
        if instance.status == LoanRequest.RequestStatus.REJECTED and not instance.ceo_decision_at:
            action = WorkflowAction.Action.REJECT
            to_status = "rejected"
            to_stage = ""
        events.append(
            WorkflowEvent(
                signature=f"loan:cfo:{instance.id}:{instance.cfo_decision_at.isoformat()}",
                action=action,
                approver_role="cfo",
                from_status="in_review",
                to_status=to_status,
                from_stage="cfo",
                to_stage=to_stage,
                actor=instance.cfo_decision_by,
                note=instance.cfo_decision_note or "",
                at=instance.cfo_decision_at,
                metadata={"legacy_signature": "cfo", "workflow_key": "loan_request"},
            )
        )
    if instance.ceo_decision_at:
        events.append(
            WorkflowEvent(
                signature=f"loan:ceo:{instance.id}:{instance.ceo_decision_at.isoformat()}",
                action=WorkflowAction.Action.REJECT
                if instance.status == LoanRequest.RequestStatus.REJECTED
                else WorkflowAction.Action.APPROVE,
                approver_role="ceo",
                from_status="in_review",
                to_status="rejected" if instance.status == LoanRequest.RequestStatus.REJECTED else "in_review",
                from_stage="ceo",
                to_stage="" if instance.status == LoanRequest.RequestStatus.REJECTED else "disbursement",
                actor=instance.ceo_decision_by,
                note=instance.ceo_decision_note or "",
                at=instance.ceo_decision_at,
                metadata={"legacy_signature": "ceo", "workflow_key": "loan_request"},
            )
        )
    if instance.disbursed_at:
        events.append(
            WorkflowEvent(
                signature=f"loan:disbursed:{instance.id}:{instance.disbursed_at.isoformat()}",
                action=WorkflowAction.Action.DISBURSE,
                approver_role="disbursement",
                from_status="in_review",
                to_status="approved",
                from_stage="disbursement",
                to_stage="",
                actor=instance.disbursed_by,
                note=instance.disbursement_note or "",
                at=instance.disbursed_at,
                metadata={"legacy_signature": "disbursed", "workflow_key": "loan_request"},
            )
        )
    if instance.deducted_at:
        events.append(
            WorkflowEvent(
                signature=f"loan:deducted:{instance.id}:{instance.deducted_at.isoformat()}",
                action=WorkflowAction.Action.DEDUCT,
                approver_role="",
                from_status="approved",
                to_status="approved",
                from_stage="",
                to_stage="",
                actor=None,
                note=f"Deducted amount: {instance.deducted_amount}",
                at=instance.deducted_at,
                metadata={"legacy_signature": "deducted", "workflow_key": "loan_request"},
            )
        )
    if instance.status == LoanRequest.RequestStatus.CANCELLED:
        events.append(
            WorkflowEvent(
                signature=f"loan:cancel:{instance.id}:{instance.updated_at.isoformat()}",
                action=WorkflowAction.Action.CANCEL,
                approver_role="",
                from_status="in_review",
                to_status="cancelled",
                from_stage="",
                to_stage="",
                actor=instance.employee,
                note="",
                at=instance.updated_at,
                metadata={"legacy_signature": "cancel", "workflow_key": "loan_request"},
            )
        )
    return events


def _legacy_status_snapshot_for_attendance(instance):
    from attendance.models import AttendanceRecord

    current_stage = ""
    current_role = ""
    status = WorkflowInstance.Status.IN_REVIEW
    terminal_at = None
    if instance.status == AttendanceRecord.Status.PENDING:
        status = WorkflowInstance.Status.SUBMITTED
        current_stage = "hr"
        current_role = "hr"
    elif instance.status == AttendanceRecord.Status.PENDING_MANAGER:
        current_stage = "manager"
        current_role = "manager"
    elif instance.status == AttendanceRecord.Status.PENDING_HR:
        current_stage = "hr"
        current_role = "hr"
    elif instance.status == AttendanceRecord.Status.PENDING_CEO:
        current_stage = "ceo"
        current_role = "ceo"
    elif instance.status == AttendanceRecord.Status.REJECTED:
        status = WorkflowInstance.Status.REJECTED
        terminal_at = instance.ceo_decision_at or instance.manager_decision_at or instance.updated_at
    elif instance.status in {
        AttendanceRecord.Status.PRESENT,
        AttendanceRecord.Status.ABSENT,
        AttendanceRecord.Status.LATE,
    }:
        status = WorkflowInstance.Status.APPROVED
        terminal_at = instance.ceo_decision_at or instance.updated_at
    current_actor_user = _resolve_current_actor(current_role, instance) if current_role else None
    return {
        "status": status,
        "current_stage": current_stage,
        "current_role": current_role,
        "current_actor_user": current_actor_user,
        "submitted_by": getattr(instance.employee_profile, "user", None),
        "submitted_at": instance.created_at,
        "decided_at": terminal_at if status == WorkflowInstance.Status.APPROVED else None,
        "cancelled_at": None,
    }


def _legacy_events_for_attendance(instance) -> list[WorkflowEvent]:
    events = [
        WorkflowEvent(
            signature=f"attendance:submitted:{instance.id}:{instance.created_at.isoformat()}",
            action=WorkflowAction.Action.SUBMIT,
            approver_role="",
            from_status="draft",
            to_status="submitted",
            from_stage="",
            to_stage="manager" if instance.status == "PENDING_MGR" else "hr",
            actor=getattr(instance.employee_profile, "user", None),
            note=instance.notes or "",
            at=instance.created_at,
            metadata={"legacy_signature": "submitted", "workflow_key": "attendance_request"},
        )
    ]
    if instance.manager_decision_at:
        events.append(
            WorkflowEvent(
                signature=f"attendance:manager:{instance.id}:{instance.manager_decision_at.isoformat()}",
                action=WorkflowAction.Action.REJECT if instance.status == "REJECTED" else WorkflowAction.Action.ADVANCE,
                approver_role="manager",
                from_status="in_review",
                to_status="rejected" if instance.status == "REJECTED" else "in_review",
                from_stage="manager",
                to_stage="" if instance.status == "REJECTED" else "hr",
                actor=instance.manager_decision_by,
                note=instance.manager_decision_note or "",
                at=instance.manager_decision_at,
                metadata={"legacy_signature": "manager", "workflow_key": "attendance_request"},
            )
        )
    if instance.source == "HR" and instance.is_overridden and instance.updated_by_id:
        events.append(
            WorkflowEvent(
                signature=f"attendance:hr:{instance.id}:{instance.updated_at.isoformat()}",
                action=WorkflowAction.Action.OVERRIDE,
                approver_role="hr",
                from_status="in_review",
                to_status="approved" if instance.status in {"PRESENT", "ABSENT", "LATE"} else "rejected",
                from_stage="hr",
                to_stage="",
                actor=instance.updated_by,
                note=instance.override_reason or instance.notes or "",
                at=instance.updated_at,
                metadata={"legacy_signature": "hr_override", "workflow_key": "attendance_request"},
            )
        )
    if instance.ceo_decision_at:
        events.append(
            WorkflowEvent(
                signature=f"attendance:ceo:{instance.id}:{instance.ceo_decision_at.isoformat()}",
                action=WorkflowAction.Action.REJECT if instance.status == "REJECTED" else WorkflowAction.Action.APPROVE,
                approver_role="ceo",
                from_status="in_review",
                to_status="rejected" if instance.status == "REJECTED" else "approved",
                from_stage="ceo",
                to_stage="",
                actor=instance.ceo_decision_by,
                note=instance.ceo_decision_note or "",
                at=instance.ceo_decision_at,
                metadata={"legacy_signature": "ceo", "workflow_key": "attendance_request"},
            )
        )
    return events


def _legacy_status_snapshot_for_attendance_correction(instance):
    from attendance.models import AttendanceCorrectionRequest

    current_map = {
        AttendanceCorrectionRequest.Status.PENDING_MANAGER: ("manager", "manager"),
        AttendanceCorrectionRequest.Status.PENDING_HR: ("hr", "hr"),
    }
    current_stage, current_role = current_map.get(instance.status, ("", ""))
    status = WorkflowInstance.Status.IN_REVIEW
    terminal_at = None

    if instance.status == AttendanceCorrectionRequest.Status.DRAFT:
        status = WorkflowInstance.Status.DRAFT
    elif instance.status == AttendanceCorrectionRequest.Status.PENDING_MANAGER:
        status = WorkflowInstance.Status.SUBMITTED
    elif instance.status == AttendanceCorrectionRequest.Status.APPROVED:
        status = WorkflowInstance.Status.APPROVED
        terminal_at = instance.decided_at or instance.hr_decision_at or instance.updated_at
    elif instance.status == AttendanceCorrectionRequest.Status.REJECTED:
        status = WorkflowInstance.Status.REJECTED
        terminal_at = (
            instance.decided_at or instance.hr_decision_at or instance.manager_decision_at or instance.updated_at
        )
    elif instance.status == AttendanceCorrectionRequest.Status.CANCELLED:
        status = WorkflowInstance.Status.CANCELLED
        terminal_at = instance.cancelled_at or instance.updated_at

    return {
        "status": status,
        "current_stage": current_stage,
        "current_role": current_role,
        "current_actor_user": _resolve_current_actor(current_role, instance) if current_role else None,
        "submitted_by": getattr(instance.employee_profile, "user", None),
        "submitted_at": instance.submitted_at or instance.created_at,
        "decided_at": terminal_at
        if status in {WorkflowInstance.Status.APPROVED, WorkflowInstance.Status.REJECTED}
        else None,
        "cancelled_at": terminal_at if status == WorkflowInstance.Status.CANCELLED else None,
    }


def _legacy_events_for_attendance_correction(instance) -> list[WorkflowEvent]:
    from attendance.models import AttendanceCorrectionRequest

    events = []
    if instance.submitted_at:
        events.append(
            WorkflowEvent(
                signature=f"attendance-correction:submitted:{instance.id}:{instance.submitted_at.isoformat()}",
                action=WorkflowAction.Action.SUBMIT,
                approver_role="",
                from_status="draft",
                to_status="submitted",
                from_stage="",
                to_stage="manager"
                if instance.status == AttendanceCorrectionRequest.Status.PENDING_MANAGER or instance.manager_decision_at
                else "hr",
                actor=instance.created_by or getattr(instance.employee_profile, "user", None),
                note=instance.reason or "",
                at=instance.submitted_at,
                metadata={"legacy_signature": "submitted", "workflow_key": "attendance_correction_request"},
            )
        )
    if instance.manager_decision_at:
        events.append(
            WorkflowEvent(
                signature=f"attendance-correction:manager:{instance.id}:{instance.manager_decision_at.isoformat()}",
                action=WorkflowAction.Action.REJECT
                if instance.status == AttendanceCorrectionRequest.Status.REJECTED and not instance.hr_decision_at
                else WorkflowAction.Action.ADVANCE,
                approver_role="manager",
                from_status="submitted",
                to_status="rejected"
                if instance.status == AttendanceCorrectionRequest.Status.REJECTED and not instance.hr_decision_at
                else "in_review",
                from_stage="manager",
                to_stage=""
                if instance.status == AttendanceCorrectionRequest.Status.REJECTED and not instance.hr_decision_at
                else "hr",
                actor=instance.manager_decision_by,
                note=instance.manager_decision_note or "",
                at=instance.manager_decision_at,
                metadata={"legacy_signature": "manager", "workflow_key": "attendance_correction_request"},
            )
        )
    if instance.hr_decision_at:
        events.append(
            WorkflowEvent(
                signature=f"attendance-correction:hr:{instance.id}:{instance.hr_decision_at.isoformat()}",
                action=WorkflowAction.Action.REJECT
                if instance.status == AttendanceCorrectionRequest.Status.REJECTED
                else WorkflowAction.Action.APPROVE,
                approver_role="hr",
                from_status="in_review",
                to_status="rejected" if instance.status == AttendanceCorrectionRequest.Status.REJECTED else "approved",
                from_stage="hr",
                to_stage="",
                actor=instance.hr_decision_by,
                note=instance.hr_decision_note or "",
                at=instance.hr_decision_at,
                metadata={"legacy_signature": "hr", "workflow_key": "attendance_correction_request"},
            )
        )
    if instance.cancelled_at:
        events.append(
            WorkflowEvent(
                signature=f"attendance-correction:cancelled:{instance.id}:{instance.cancelled_at.isoformat()}",
                action=WorkflowAction.Action.CANCEL,
                approver_role="",
                from_status="submitted",
                to_status="cancelled",
                from_stage="",
                to_stage="",
                actor=instance.updated_by,
                note="",
                at=instance.cancelled_at,
                metadata={"legacy_signature": "cancelled", "workflow_key": "attendance_correction_request"},
            )
        )
    return events


def _legacy_status_snapshot_for_asset_return(instance):
    from assets.models import AssetReturnRequest

    current_map = {
        AssetReturnRequest.RequestStatus.PENDING_MANAGER: ("manager", "manager"),
        AssetReturnRequest.RequestStatus.PENDING: ("hr", "hr"),
        AssetReturnRequest.RequestStatus.PENDING_CEO: ("ceo", "ceo"),
    }
    status = WorkflowInstance.Status.IN_REVIEW
    current_stage, current_role = current_map.get(instance.status, ("", ""))
    terminal_at = None
    if instance.status == AssetReturnRequest.RequestStatus.PENDING_MANAGER:
        status = WorkflowInstance.Status.SUBMITTED
    elif instance.status in {AssetReturnRequest.RequestStatus.APPROVED, AssetReturnRequest.RequestStatus.PROCESSED}:
        status = WorkflowInstance.Status.APPROVED
        terminal_at = (
            instance.processed_at or instance.ceo_decision_at or instance.hr_decision_at or instance.updated_at
        )
    elif instance.status == AssetReturnRequest.RequestStatus.REJECTED:
        status = WorkflowInstance.Status.REJECTED
        terminal_at = (
            instance.ceo_decision_at or instance.hr_decision_at or instance.manager_decision_at or instance.updated_at
        )
    current_actor_user = _resolve_current_actor(current_role, instance) if current_role else None
    return {
        "status": status,
        "current_stage": current_stage,
        "current_role": current_role,
        "current_actor_user": current_actor_user,
        "submitted_by": getattr(instance.employee, "user", None),
        "submitted_at": instance.requested_at,
        "decided_at": terminal_at
        if status in {WorkflowInstance.Status.APPROVED, WorkflowInstance.Status.REJECTED}
        else None,
        "cancelled_at": None,
    }


def _legacy_events_for_asset_return(instance) -> list[WorkflowEvent]:
    from assets.models import AssetReturnRequest

    initial_stage = "hr"
    if instance.status == AssetReturnRequest.RequestStatus.PENDING_MANAGER or instance.manager_decision_at:
        initial_stage = "manager"
    elif instance.status == AssetReturnRequest.RequestStatus.PENDING_CEO or instance.ceo_decision_at:
        initial_stage = "ceo" if not instance.hr_decision_at else "manager"

    events = [
        WorkflowEvent(
            signature=f"asset-return:submitted:{instance.id}:{instance.requested_at.isoformat()}",
            action=WorkflowAction.Action.SUBMIT,
            approver_role="",
            from_status="draft",
            to_status="submitted",
            from_stage="",
            to_stage=initial_stage,
            actor=getattr(instance.employee, "user", None),
            note=instance.note or "",
            at=instance.requested_at,
            metadata={"legacy_signature": "submitted", "workflow_key": "asset_return_request"},
        )
    ]
    if instance.manager_decision_at:
        events.append(
            WorkflowEvent(
                signature=f"asset-return:manager:{instance.id}:{instance.manager_decision_at.isoformat()}",
                action=WorkflowAction.Action.REJECT
                if instance.status == AssetReturnRequest.RequestStatus.REJECTED
                and not instance.hr_decision_at
                and not instance.ceo_decision_at
                else WorkflowAction.Action.ADVANCE,
                approver_role="manager",
                from_status="in_review",
                to_status="rejected"
                if instance.status == AssetReturnRequest.RequestStatus.REJECTED
                and not instance.hr_decision_at
                and not instance.ceo_decision_at
                else "in_review",
                from_stage="manager",
                to_stage=""
                if instance.status == AssetReturnRequest.RequestStatus.REJECTED
                and not instance.hr_decision_at
                and not instance.ceo_decision_at
                else "hr",
                actor=instance.manager_decision_by,
                note=instance.manager_decision_note or "",
                at=instance.manager_decision_at,
                metadata={"legacy_signature": "manager", "workflow_key": "asset_return_request"},
            )
        )
    if instance.hr_decision_at:
        events.append(
            WorkflowEvent(
                signature=f"asset-return:hr:{instance.id}:{instance.hr_decision_at.isoformat()}",
                action=WorkflowAction.Action.REJECT
                if instance.status == AssetReturnRequest.RequestStatus.REJECTED and not instance.ceo_decision_at
                else WorkflowAction.Action.APPROVE,
                approver_role="hr",
                from_status="in_review",
                to_status="rejected"
                if instance.status == AssetReturnRequest.RequestStatus.REJECTED and not instance.ceo_decision_at
                else "approved",
                from_stage="hr",
                to_stage="",
                actor=instance.hr_decision_by,
                note=instance.hr_decision_note or "",
                at=instance.hr_decision_at,
                metadata={"legacy_signature": "hr", "workflow_key": "asset_return_request"},
            )
        )
    if instance.ceo_decision_at:
        events.append(
            WorkflowEvent(
                signature=f"asset-return:ceo:{instance.id}:{instance.ceo_decision_at.isoformat()}",
                action=WorkflowAction.Action.REJECT
                if instance.status == AssetReturnRequest.RequestStatus.REJECTED
                else WorkflowAction.Action.APPROVE,
                approver_role="ceo",
                from_status="in_review",
                to_status="rejected" if instance.status == AssetReturnRequest.RequestStatus.REJECTED else "approved",
                from_stage="ceo",
                to_stage="",
                actor=instance.ceo_decision_by,
                note=instance.ceo_decision_note or "",
                at=instance.ceo_decision_at,
                metadata={"legacy_signature": "ceo", "workflow_key": "asset_return_request"},
            )
        )
    return events


def _legacy_status_snapshot_for_employee_deletion(instance):
    from employees.models import EmployeeDeletionRequest

    status = WorkflowInstance.Status.SUBMITTED
    current_stage = "ceo"
    current_role = "ceo"
    terminal_at = None

    if instance.status == EmployeeDeletionRequest.Status.REJECTED:
        status = WorkflowInstance.Status.REJECTED
        current_stage = ""
        current_role = ""
        terminal_at = instance.rejected_at or instance.updated_at
    elif instance.status == EmployeeDeletionRequest.Status.EXECUTED:
        status = WorkflowInstance.Status.APPROVED
        current_stage = ""
        current_role = ""
        terminal_at = instance.executed_at or instance.approved_at or instance.updated_at

    return {
        "status": status,
        "current_stage": current_stage,
        "current_role": current_role,
        "current_actor_user": _resolve_current_actor(current_role, instance) if current_role else None,
        "submitted_by": instance.requested_by,
        "submitted_at": instance.created_at,
        "decided_at": terminal_at
        if status in {WorkflowInstance.Status.APPROVED, WorkflowInstance.Status.REJECTED}
        else None,
        "cancelled_at": None,
    }


def _legacy_events_for_employee_deletion(instance) -> list[WorkflowEvent]:
    from employees.models import EmployeeDeletionRequest

    events = [
        WorkflowEvent(
            signature=f"employee-delete:submitted:{instance.id}:{instance.created_at.isoformat()}",
            action=WorkflowAction.Action.SUBMIT,
            approver_role="",
            from_status="draft",
            to_status="submitted",
            from_stage="",
            to_stage="ceo",
            actor=instance.requested_by,
            note=instance.reason or "",
            at=instance.created_at,
            metadata={"legacy_signature": "submitted", "workflow_key": "employee_deletion_request"},
        )
    ]

    if instance.status == EmployeeDeletionRequest.Status.REJECTED and instance.rejected_at:
        events.append(
            WorkflowEvent(
                signature=f"employee-delete:rejected:{instance.id}:{instance.rejected_at.isoformat()}",
                action=WorkflowAction.Action.REJECT,
                approver_role="ceo",
                from_status="submitted",
                to_status="rejected",
                from_stage="ceo",
                to_stage="",
                actor=instance.rejected_by,
                note=instance.rejection_reason or "",
                at=instance.rejected_at,
                metadata={"legacy_signature": "ceo", "workflow_key": "employee_deletion_request"},
            )
        )
    elif instance.status == EmployeeDeletionRequest.Status.EXECUTED and instance.executed_at:
        events.append(
            WorkflowEvent(
                signature=f"employee-delete:approved:{instance.id}:{instance.executed_at.isoformat()}",
                action=WorkflowAction.Action.APPROVE,
                approver_role="ceo",
                from_status="submitted",
                to_status="approved",
                from_stage="ceo",
                to_stage="",
                actor=instance.approved_by,
                note=instance.reason or "",
                at=instance.executed_at,
                metadata={"legacy_signature": "ceo", "workflow_key": "employee_deletion_request"},
            )
        )

    return events


def _adapter_for_instance(instance):
    class_name = instance.__class__.__name__
    if class_name == "LeaveRequest":
        return "leave_request", _legacy_status_snapshot_for_leave, _legacy_events_for_leave
    if class_name == "LoanRequest":
        return "loan_request", _legacy_status_snapshot_for_loan, _legacy_events_for_loan
    if class_name == "AttendanceRecord":
        return "attendance_request", _legacy_status_snapshot_for_attendance, _legacy_events_for_attendance
    if class_name == "AttendanceCorrectionRequest":
        return (
            "attendance_correction_request",
            _legacy_status_snapshot_for_attendance_correction,
            _legacy_events_for_attendance_correction,
        )
    if class_name == "AssetReturnRequest":
        return "asset_return_request", _legacy_status_snapshot_for_asset_return, _legacy_events_for_asset_return
    if class_name == "EmployeeDeletionRequest":
        return (
            "employee_deletion_request",
            _legacy_status_snapshot_for_employee_deletion,
            _legacy_events_for_employee_deletion,
        )
    raise ValueError(f"Unsupported workflow instance class: {class_name}")


@transaction.atomic
def sync_workflow(instance, *, actor=None, workflow_key: str | None = None) -> WorkflowInstance:
    resolved_workflow_key, snapshot_builder, events_builder = _adapter_for_instance(instance)
    if workflow_key and workflow_key != resolved_workflow_key:
        raise ValueError("workflow_key does not match instance adapter")
    workflow_key = resolved_workflow_key
    definition = get_or_create_workflow_definition(workflow_key)
    content_type = ContentType.objects.get_for_model(instance.__class__)
    workflow, _ = WorkflowInstance.objects.get_or_create(
        content_type=content_type,
        object_id=instance.pk,
        defaults={"definition": definition},
    )

    snapshot = snapshot_builder(instance)
    workflow.definition = definition
    workflow.status = snapshot["status"]
    workflow.current_stage = snapshot["current_stage"]
    workflow.current_approver_role = snapshot["current_role"]
    workflow.current_actor_user = snapshot["current_actor_user"]
    workflow.submitted_by = snapshot["submitted_by"]
    workflow.submitted_at = snapshot["submitted_at"]
    workflow.decided_at = snapshot["decided_at"]
    workflow.cancelled_at = snapshot["cancelled_at"]
    workflow.last_synced_at = timezone.now()
    workflow.metadata = {
        **(workflow.metadata or {}),
        "workflow_key": workflow_key,
        "entity": instance.__class__.__name__,
        "entity_id": instance.pk,
    }
    workflow.save()

    existing_signatures = {(action.metadata or {}).get("legacy_signature"): action for action in workflow.actions.all()}
    for event in events_builder(instance):
        signature_key = (event.metadata or {}).get("legacy_signature")
        if signature_key in existing_signatures:
            continue
        created = WorkflowAction.objects.create(
            workflow=workflow,
            action=event.action,
            actor=event.actor,
            approver_role=event.approver_role,
            from_status=event.from_status,
            to_status=event.to_status,
            from_stage=event.from_stage,
            to_stage=event.to_stage,
            note=event.note,
            metadata={**(event.metadata or {}), "legacy_signature": signature_key},
        )
        if event.at:
            WorkflowAction.objects.filter(pk=created.pk).update(created_at=event.at)
            created.created_at = event.at
        audit(
            None,
            "workflow_transition",
            entity=instance.__class__.__name__,
            entity_id=instance.pk,
            metadata={
                "workflow_key": workflow_key,
                "workflow_instance_id": workflow.id,
                "workflow_action_id": created.id,
                "action": created.action,
                "from_status": created.from_status,
                "to_status": created.to_status,
                "from_stage": created.from_stage,
                "to_stage": created.to_stage,
                "acting_user_id": created.actor_id,
                "delegated": bool(
                    workflow.current_actor_user_id
                    and created.actor_id
                    and workflow.current_actor_user_id != created.actor_id
                ),
            },
            actor=created.actor or actor,
        )
    return workflow


def get_workflow_snapshot(instance, *, actor=None) -> dict[str, Any]:
    workflow = sync_workflow(instance, actor=actor)
    history = [
        {
            "id": action.id,
            "action": action.action,
            "stage": action.from_stage or action.to_stage or action.approver_role,
            "approver_role": action.approver_role,
            "actor": {
                "id": action.actor_id,
                "email": getattr(action.actor, "email", None),
                "full_name": getattr(action.actor, "full_name", None),
            }
            if action.actor_id
            else None,
            "at": action.created_at,
            "note": action.note,
            "from_status": action.from_status,
            "to_status": action.to_status,
            "from_stage": action.from_stage,
            "to_stage": action.to_stage,
            "metadata": action.metadata,
        }
        for action in workflow.actions.all().order_by("created_at", "id")
    ]
    current_actor = None
    if workflow.current_actor_user_id:
        current_actor = {
            "id": workflow.current_actor_user_id,
            "email": workflow.current_actor_user.email,
            "full_name": workflow.current_actor_user.full_name,
        }
    elif actor and can_user_act_on_instance(actor, instance, workflow):
        current_actor = {
            "id": actor.id,
            "email": actor.email,
            "full_name": actor.full_name,
        }
    return {
        "status": workflow.status,
        "current_stage": workflow.current_stage,
        "current_actor": current_actor,
        "current_approver_role": workflow.current_approver_role,
        "can_approve": can_user_act_on_instance(actor, instance, workflow) if actor else False,
        "can_reject": can_user_act_on_instance(actor, instance, workflow) if actor else False,
        "can_cancel": bool(
            actor
            and actor.is_authenticated
            and workflow.status in {WorkflowInstance.Status.SUBMITTED, WorkflowInstance.Status.IN_REVIEW}
            and getattr(_get_subject_user(instance), "id", None) == actor.id
        ),
        "history": history,
    }


def get_pending_approvals_for_role(role: str, *, limit: int | None = 10) -> list[WorkflowInstance]:
    qs = (
        WorkflowInstance.objects.select_related("definition", "current_actor_user", "submitted_by")
        .filter(
            status__in=[WorkflowInstance.Status.SUBMITTED, WorkflowInstance.Status.IN_REVIEW],
            current_approver_role=role,
        )
        .order_by("-updated_at", "-id")
    )
    if limit is not None:
        qs = qs[:limit]
    return list(qs)


def get_pending_approvals_for_user(user, *, limit: int | None = 10) -> list[WorkflowInstance]:
    if not user or not user.is_authenticated:
        return []

    filters = Q(current_actor_user=user)
    for role in get_pending_approval_roles_for_user(user):
        filters |= Q(current_actor_user__isnull=True, current_approver_role=role)

    qs = (
        WorkflowInstance.objects.select_related("definition", "current_actor_user", "submitted_by")
        .filter(status__in=[WorkflowInstance.Status.SUBMITTED, WorkflowInstance.Status.IN_REVIEW])
        .filter(filters)
        .order_by("-updated_at", "-id")
    )
    if limit is not None:
        qs = qs[:limit]
    return list(qs)


def normalize_role_for_pending_approvals(user) -> str:
    role = get_role(user)
    if role in {"HRManager", "SystemAdmin"}:
        return "hr"
    if role == "CFO":
        return "cfo"
    if role == "CEO":
        return "ceo"
    return ""


def _pending_item_submitted_time(workflow: WorkflowInstance, obj) -> str:
    value = (
        getattr(obj, "submitted_at", None)
        or getattr(obj, "requested_at", None)
        or workflow.submitted_at
        or getattr(obj, "created_at", None)
        or workflow.created_at
    )
    return value.isoformat() if hasattr(value, "isoformat") else str(value or "")


def build_pending_approval_item(workflow: WorkflowInstance) -> dict[str, Any] | None:
    obj = workflow.content_object
    if obj is None:
        return None
    workflow_key = workflow.definition.key
    label_map = {
        "leave_request": "Leave",
        "loan_request": "Loan",
        "attendance_request": "Attendance",
        "attendance_correction_request": "Attendance Correction",
        "asset_return_request": "Asset Return",
        "employee_deletion_request": "Employee Deletion",
    }
    review_path = _build_action_url_path(workflow_key, workflow.current_approver_role, obj.pk)
    if workflow_key == "leave_request":
        profile = getattr(getattr(obj, "employee", None), "employee_profile", None)
        name = getattr(profile, "full_name", "") or getattr(
            getattr(obj, "employee", None), "email", f"Request #{obj.pk}"
        )
        action = f"Leave: {getattr(getattr(obj, 'leave_type', None), 'name', 'Request')}"
        request_type = "LEAVE"
    elif workflow_key == "loan_request":
        profile = getattr(obj, "employee_profile", None)
        employee = getattr(obj, "employee", None)
        name = getattr(profile, "full_name", "") or getattr(employee, "email", f"Request #{obj.pk}")
        action = f"Loan: {getattr(obj, 'requested_amount', '')}"
        request_type = "LOAN"
    elif workflow_key == "asset_return_request":
        employee = getattr(obj, "employee", None)
        user = getattr(employee, "user", None)
        name = getattr(employee, "full_name", "") or getattr(user, "email", f"Request #{obj.pk}")
        asset = getattr(obj, "asset", None)
        action = f"Asset Return: {getattr(asset, 'asset_code', obj.pk)}"
        request_type = "ASSET"
    elif workflow_key == "attendance_correction_request":
        profile = getattr(obj, "employee_profile", None)
        user = getattr(profile, "user", None)
        name = getattr(profile, "full_name", "") or getattr(user, "email", f"Request #{obj.pk}")
        action = f"Attendance correction: {getattr(obj, 'date', '')}"
        request_type = "ATTENDANCE"
    elif workflow_key == "employee_deletion_request":
        snapshot = getattr(obj, "request_snapshot", {}) or {}
        name = snapshot.get("full_name") or snapshot.get("employee_id") or f"Request #{obj.pk}"
        action = "Employee hard delete request"
        request_type = "EMPLOYEE_DELETION"
    else:
        profile = getattr(obj, "employee_profile", None)
        user = getattr(profile, "user", None)
        name = getattr(profile, "full_name", "") or getattr(user, "email", f"Request #{obj.pk}")
        action = "Attendance: Check-in/out review"
        request_type = "ATTENDANCE"
    return {
        "id": obj.pk,
        "workflow_id": workflow.id,
        "name": name,
        "request_type": request_type,
        "request_type_label": label_map.get(workflow_key, "Request"),
        "action": action,
        "time": _pending_item_submitted_time(workflow, obj),
        "avatar": "",
        "review_path": review_path,
        "current_approver_role": workflow.current_approver_role,
    }
