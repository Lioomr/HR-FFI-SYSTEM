"""Apply the travel-based HR Completion rule to requests already waiting there.

Before ``will_travel`` existed, every CEO approval sent a leave request to HR
Completion. Rows still in ``pending_hr_completion`` are classified from the
travel evidence they carry and the employee's nationality:

* Travel evidence means the leave type code is ``BUSINESS_TRIP`` or an airplane
  ticket payer or address was recorded. It sets ``will_travel=True``; every
  other row gets ``will_travel=False``.
* A row stays in HR Completion only when it has travel evidence and its employee
  profile is non-Saudi, matching the runtime rule.
* Every other row becomes ``approved``, as if the CEO approval had been final.
  ``hr_completed_by``/``hr_completed_at`` stay empty, no visa document is created
  and no notification is sent: queryset updates bypass ``save()`` and the views.

For the approved rows the workflow projection becomes a CEO-final approval: the
instance leaves the HR pending queue and its CEO action now ends the workflow.
The CEO action's previous target is kept in its metadata.

The reverse is a no-op; the original routing is not restored.
"""

from django.db import migrations
from django.utils import timezone

MIGRATION_LABEL = "leaves.0022_reconcile_legacy_hr_completion"
PENDING_HR_COMPLETION = "pending_hr_completion"
APPROVED = "approved"


def has_travel_evidence(leave_request):
    code = (leave_request.leave_type.code or "").strip().upper()
    return (
        code == "BUSINESS_TRIP"
        or bool((leave_request.airplane_ticket_payer or "").strip())
        or bool((leave_request.airplane_ticket_address or "").strip())
    )


def _record_ceo_final_approval(apps, content_type_id, leave_request, now):
    WorkflowInstance = apps.get_model("core", "WorkflowInstance")
    WorkflowAction = apps.get_model("core", "WorkflowAction")

    workflow = WorkflowInstance.objects.filter(content_type_id=content_type_id, object_id=leave_request.pk).first()
    if workflow is None:
        # Not queued anywhere; the next sync projects the approved status directly.
        return

    workflow.status = APPROVED
    workflow.current_stage = ""
    workflow.current_approver_role = ""
    workflow.current_actor_user = None
    workflow.decided_at = leave_request.ceo_decision_at or now
    workflow.cancelled_at = None
    workflow.last_synced_at = now
    workflow.metadata = {**(workflow.metadata or {}), "reconciled_by": MIGRATION_LABEL}
    workflow.save()

    ceo_actions = list(WorkflowAction.objects.filter(workflow=workflow, metadata__legacy_signature="ceo"))
    for action in ceo_actions:
        action.metadata = {
            **(action.metadata or {}),
            "reconciled_by": MIGRATION_LABEL,
            "original_to_status": action.to_status,
            "original_to_stage": action.to_stage,
        }
        action.to_status = APPROVED
        action.to_stage = ""
        action.save(update_fields=["to_status", "to_stage", "metadata"])

    if not ceo_actions and leave_request.ceo_decision_at:
        created = WorkflowAction.objects.create(
            workflow=workflow,
            action="approve",
            actor_id=leave_request.ceo_decision_by_id,
            approver_role="ceo",
            from_status="in_review",
            to_status=APPROVED,
            from_stage="ceo",
            to_stage="",
            note=leave_request.ceo_decision_note or "",
            metadata={
                "legacy_signature": "ceo",
                "workflow_key": "leave_request",
                "reconciled_by": MIGRATION_LABEL,
            },
        )
        WorkflowAction.objects.filter(pk=created.pk).update(created_at=leave_request.ceo_decision_at)


def _employee_profile(apps, leave_request):
    if leave_request.employee_profile_id:
        return leave_request.employee_profile
    if not leave_request.employee_id:
        return None
    EmployeeProfile = apps.get_model("employees", "EmployeeProfile")
    return EmployeeProfile.objects.filter(user_id=leave_request.employee_id).first()


def reconcile_legacy_hr_completion(apps, schema_editor):
    LeaveRequest = apps.get_model("leaves", "LeaveRequest")
    ContentType = apps.get_model("contenttypes", "ContentType")

    pending_ids = []
    ceo_final_travel_ids = []
    ceo_final_requests = []
    pending_requests = LeaveRequest.objects.filter(status=PENDING_HR_COMPLETION).select_related(
        "leave_type", "employee_profile"
    )
    for leave_request in pending_requests:
        will_travel = has_travel_evidence(leave_request)
        profile = _employee_profile(apps, leave_request)
        # Same rule as LeaveRequest.requires_hr_completion(): travel and a non-Saudi profile.
        if will_travel and profile is not None and not profile.is_saudi:
            pending_ids.append(leave_request.pk)
            continue
        if will_travel:
            ceo_final_travel_ids.append(leave_request.pk)
        ceo_final_requests.append(leave_request)

    now = timezone.now()
    LeaveRequest.objects.filter(pk__in=pending_ids).update(will_travel=True)
    ceo_final_ids = [item.pk for item in ceo_final_requests]
    LeaveRequest.objects.filter(pk__in=ceo_final_ids).update(status=APPROVED, updated_at=now)
    LeaveRequest.objects.filter(pk__in=ceo_final_ids).exclude(pk__in=ceo_final_travel_ids).update(will_travel=False)
    LeaveRequest.objects.filter(pk__in=ceo_final_travel_ids).update(will_travel=True)

    if not ceo_final_requests:
        return
    content_type = ContentType.objects.filter(app_label="leaves", model="leaverequest").first()
    if content_type is None:
        return
    for leave_request in ceo_final_requests:
        _record_ceo_final_approval(apps, content_type.id, leave_request, now)


class Migration(migrations.Migration):
    dependencies = [
        ("leaves", "0021_leaverequest_will_travel"),
        ("core", "0008_alter_workflowaction_action"),
        ("contenttypes", "0002_remove_content_type_name"),
        ("employees", "0015_database_tenant_integrity"),
    ]

    operations = [
        migrations.RunPython(reconcile_legacy_hr_completion, migrations.RunPython.noop),
    ]
