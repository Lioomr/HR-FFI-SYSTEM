from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("loans", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="LoanWorkflowConfig",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("finance_department_id", models.PositiveIntegerField(default=8)),
                ("finance_position_id", models.PositiveIntegerField(default=24)),
                ("cfo_position_id", models.PositiveIntegerField(default=3)),
                ("ceo_position_id", models.PositiveIntegerField(default=1)),
                ("require_manager_stage", models.BooleanField(default=True)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ["-updated_at", "-id"]},
        ),
        migrations.AddField(
            model_name="loanrequest",
            name="ceo_decision_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="loanrequest",
            name="ceo_decision_note",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="loanrequest",
            name="ceo_decision_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="ceo_decided_loans",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AlterField(
            model_name="loanrequest",
            name="status",
            field=models.CharField(
                choices=[
                    ("submitted", "Submitted"),
                    ("pending_manager", "Pending Manager"),
                    ("pending_finance", "Pending Finance"),
                    ("pending_cfo", "Pending CFO"),
                    ("pending_ceo", "Pending CEO"),
                    ("approved", "Approved"),
                    ("rejected", "Rejected"),
                    ("cancelled", "Cancelled"),
                    ("deducted", "Deducted"),
                ],
                default="submitted",
                max_length=20,
            ),
        ),
    ]
