import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def infer_existing_modes(apps, schema_editor):
    ContractRating = apps.get_model("contract_ratings", "ContractRating")
    # Every row predating this migration came from the evaluation-first flow;
    # SKIP_TO_CEO did not exist yet and must never be inferred from missing data.
    ContractRating.objects.all().update(rating_mode="RATE")


class Migration(migrations.Migration):
    dependencies = [("contract_ratings", "0002_final_decision_flow")]

    operations = [
        migrations.AddField(
            model_name="contractrating",
            name="rating_mode",
            field=models.CharField(
                blank=True,
                choices=[
                    ("RATE", "Full rating - manager and employee evaluate"),
                    ("SKIP_TO_CEO", "Skip rating - CEO decides directly"),
                ],
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="contractrating",
            name="hr_gate_decided_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="contractrating",
            name="hr_gate_decided_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.RunPython(infer_existing_modes, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="contractrating",
            name="status",
            field=models.CharField(
                choices=[
                    ("PENDING_HR_GATE", "Awaiting HR: rate or send to CEO"),
                    ("PENDING_RESPONSES", "Awaiting both responses"),
                    ("WAITING_MANAGER", "Awaiting manager response"),
                    ("WAITING_EMPLOYEE", "Awaiting employee response"),
                    ("PENDING_CEO", "Pending CEO decision"),
                    ("DECIDED", "Decided"),
                    ("MANUAL_RESOLUTION_REQUIRED", "Manual resolution required"),
                ],
                db_index=True,
                default="PENDING_HR_GATE",
                max_length=32,
            ),
        ),
    ]
