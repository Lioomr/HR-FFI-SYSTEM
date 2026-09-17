from core.models import WorkflowInstance


def status_snapshot(instance):
    terminal = instance.status == "DECIDED"
    stage, role = {
        "PENDING_CEO": ("ceo", "ceo"),
        "PENDING_RESPONSES": ("responses", ""),
        "WAITING_MANAGER": ("responses", ""),
        "WAITING_EMPLOYEE": ("responses", ""),
        "MANUAL_RESOLUTION_REQUIRED": ("manual_resolution", ""),
    }.get(instance.status, ("", ""))
    return {
        "status": WorkflowInstance.Status.APPROVED if terminal else WorkflowInstance.Status.IN_REVIEW,
        "current_stage": stage,
        "current_role": role,
        "current_actor_user": None,
        "submitted_by": instance.employee_profile.user,
        "submitted_at": instance.created_at,
        "decided_at": instance.ceo_decided_at if terminal else None,
        "cancelled_at": None,
    }


def legacy_events(instance):
    return []
