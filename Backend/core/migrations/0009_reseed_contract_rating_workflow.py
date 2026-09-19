from django.db import migrations


def reseed_contract_rating_workflow(apps, schema_editor):
    from core.services.workflow_engine import get_or_create_workflow_definition

    get_or_create_workflow_definition("contract_rating")


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0008_alter_workflowaction_action"),
    ]

    operations = [
        migrations.RunPython(reseed_contract_rating_workflow, migrations.RunPython.noop),
    ]
