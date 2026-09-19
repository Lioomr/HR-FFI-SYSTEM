import pytest

from core.models import WorkflowDefinition, WorkflowStageDefinition
from core.services.workflow_engine import get_or_create_workflow_definition


@pytest.mark.django_db
def test_reseeds_after_template_stages_change():
    definition = WorkflowDefinition.objects.create(
        key="contract_rating",
        name="Employee Contract Rating",
        module_key="contract_ratings",
    )
    for key, order, role in (("responses", 0, ""), ("hr", 1, "hr"), ("ceo", 2, "ceo")):
        WorkflowStageDefinition.objects.create(
            definition=definition,
            key=key,
            title=key,
            approver_role=role,
            order=order,
        )

    first = get_or_create_workflow_definition("contract_rating")
    second = get_or_create_workflow_definition("contract_rating")

    expected = [("hr_gate", 0), ("responses", 1), ("ceo", 2)]
    assert list(first.stages.order_by("order").values_list("key", "order")) == expected
    assert list(second.stages.order_by("order").values_list("key", "order")) == expected


@pytest.mark.django_db
def test_reseed_prunes_obsolete_stages_for_every_workflow():
    definition = get_or_create_workflow_definition("leave_request")
    WorkflowStageDefinition.objects.create(
        definition=definition,
        key="obsolete",
        title="Obsolete",
        approver_role="hr",
        order=99,
    )

    reseeded = get_or_create_workflow_definition("leave_request")

    assert not reseeded.stages.filter(key="obsolete").exists()
