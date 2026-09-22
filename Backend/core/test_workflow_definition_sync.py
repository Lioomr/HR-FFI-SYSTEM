import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from core.models import WorkflowDefinition, WorkflowStageDefinition
from core.services.workflow_engine import cached_workflow_definitions, get_or_create_workflow_definition


@pytest.mark.django_db
def test_reseeds_after_template_stages_change():
    definition, _ = WorkflowDefinition.objects.update_or_create(
        key="contract_rating",
        defaults={
            "name": "Employee Contract Rating",
            "module_key": "contract_ratings",
        },
    )
    definition.stages.all().delete()
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


@pytest.mark.django_db
def test_in_sync_definition_is_read_without_writes():
    get_or_create_workflow_definition("contract_decision")

    with CaptureQueriesContext(connection) as queries:
        definition = get_or_create_workflow_definition("contract_decision")

    writes = [
        query["sql"] for query in queries if query["sql"].lstrip().upper().startswith(("UPDATE", "INSERT", "DELETE"))
    ]
    assert writes == []
    assert definition.stages.exists()


@pytest.mark.django_db
def test_changed_stage_field_is_still_repaired():
    definition = get_or_create_workflow_definition("contract_decision")
    stage = definition.stages.order_by("order").first()
    original_title = stage.title
    WorkflowStageDefinition.objects.filter(pk=stage.pk).update(title="Stale title")

    get_or_create_workflow_definition("contract_decision")

    stage.refresh_from_db()
    assert stage.title == original_title


@pytest.mark.django_db
def test_definitions_are_read_once_inside_a_cached_scope():
    get_or_create_workflow_definition("contract_decision")

    with cached_workflow_definitions():
        first = get_or_create_workflow_definition("contract_decision")
        with CaptureQueriesContext(connection) as queries:
            again = get_or_create_workflow_definition("contract_decision")

    assert again.pk == first.pk
    assert len(queries) == 0


@pytest.mark.django_db
def test_definition_cache_does_not_outlive_its_scope():
    with cached_workflow_definitions():
        get_or_create_workflow_definition("contract_decision")

    with CaptureQueriesContext(connection) as queries:
        get_or_create_workflow_definition("contract_decision")

    assert len(queries) > 0
