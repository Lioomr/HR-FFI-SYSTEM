import pytest

from contract_ratings.services import ensure_contract_rating
from core.models import WorkflowInstance
from core.services.workflow_engine import sync_workflow


@pytest.mark.django_db
def test_sync_workflow_replaces_stale_removed_stage_from_rating_status(world):
    rating, _ = ensure_contract_rating(world.profile)
    workflow = sync_workflow(rating)
    WorkflowInstance.objects.filter(pk=workflow.pk).update(
        current_stage="hr",
        current_approver_role="hr",
    )

    repaired = sync_workflow(rating)

    assert repaired.current_stage == "hr_gate"
    assert repaired.current_approver_role == "hr"
