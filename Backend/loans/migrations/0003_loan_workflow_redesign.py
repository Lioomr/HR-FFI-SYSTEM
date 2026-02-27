from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def migrate_pending_finance_to_pending_hr(apps, schema_editor):
    LoanRequest = apps.get_model("loans", "LoanRequest")
    LoanRequest.objects.filter(status="pending_finance").update(status="pending_hr")


def reverse_pending_hr_to_pending_finance(apps, schema_editor):
    LoanRequest = apps.get_model("loans", "LoanRequest")
    LoanRequest.objects.filter(status="pending_hr").update(status="pending_finance")


class Migration(migrations.Migration):

    dependencies = [
        ("loans", "0002_loanworkflowconfig_and_ceo_stage"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="loanrequest",
            name="disbursed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="loanrequest",
            name="disbursement_note",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="loanrequest",
            name="hr_recommendation",
            field=models.CharField(
                blank=True,
                choices=[("approve", "Approve"), ("reject", "Reject")],
                max_length=16,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="loanrequest",
            name="manager_recommendation",
            field=models.CharField(
                blank=True,
                choices=[("approve", "Approve"), ("reject", "Reject")],
                max_length=16,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="loanrequest",
            name="disbursed_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="disbursed_loans",
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
                    ("pending_hr", "Pending HR"),
                    ("pending_finance", "Pending Finance (Legacy)"),
                    ("pending_cfo", "Pending CFO"),
                    ("pending_ceo", "Pending CEO"),
                    ("pending_disbursement", "Pending Disbursement"),
                    ("approved", "Approved"),
                    ("rejected", "Rejected"),
                    ("cancelled", "Cancelled"),
                    ("deducted", "Deducted"),
                ],
                default="submitted",
                max_length=20,
            ),
        ),
        migrations.RunPython(
            code=migrate_pending_finance_to_pending_hr,
            reverse_code=reverse_pending_hr_to_pending_finance,
        ),
    ]
