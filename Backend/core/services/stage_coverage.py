"""A stage the line manager's own approval already covers.

When the employee's real manager also holds the role of a later stage (HR
manager, CEO), the request must not be sent back to that same person to
approve again. Shared by every manager -> HR route (leave, exit permission,
loan, asset return); each module decides what the covered stage means for its
own status and fields.

SystemAdmin only views requests, so it never covers a stage, and neither does
a delegate or admin deciding in the manager's place.
"""

from __future__ import annotations

from core.models import WorkflowAction
from core.services.workflow_engine import TransitionStart, record_workflow_transition

# The employee's real manager, as opposed to a delegate or admin deciding for them.
MANAGER_OWN_SOURCES = frozenset({"direct_manager", "cross_company_assignment"})


def is_in_group(user, name: str) -> bool:
    return bool(user and getattr(user, "is_authenticated", False) and user.groups.filter(name=name).exists())


def manager_covers_hr(actor, actor_source: str | None) -> bool:
    """The deciding manager is the employee's real manager and an HR manager."""

    return actor_source in MANAGER_OWN_SOURCES and is_in_group(actor, "HRManager")


def record_covered_stage(
    instance,
    start,
    role: str,
    *,
    actor,
    by: str = "manager",
    source: str = "",
    action: str = WorkflowAction.Action.APPROVE,
    metadata: dict | None = None,
):
    """Write ``role``'s stage into the workflow history as completed by ``actor``."""

    covered = TransitionStart(start.workflow_id, "in_review", role, role, None)
    return record_workflow_transition(
        instance,
        covered,
        action=action,
        actor=actor,
        approver_role=role,
        metadata={"auto_satisfied_by": by, "actor_source": source, **(metadata or {})},
    )
