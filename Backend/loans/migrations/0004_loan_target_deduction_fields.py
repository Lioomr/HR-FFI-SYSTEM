from django.db import migrations, models


def backfill_loan_target_fields(apps, schema_editor):
    LoanRequest = apps.get_model("loans", "LoanRequest")

    for loan in LoanRequest.objects.filter(approved_year__isnull=True):
        dt = loan.cfo_decision_at or loan.ceo_decision_at or loan.updated_at or loan.created_at
        if not dt:
            continue
        loan.approved_year = dt.year
        loan.approved_month = dt.month
        if loan.target_deduction_year is None:
            loan.target_deduction_year = dt.year
        if loan.target_deduction_month is None:
            loan.target_deduction_month = dt.month
        loan.save(
            update_fields=[
                "approved_year",
                "approved_month",
                "target_deduction_year",
                "target_deduction_month",
                "updated_at",
            ]
        )


def reverse_backfill_loan_target_fields(apps, schema_editor):
    LoanRequest = apps.get_model("loans", "LoanRequest")
    LoanRequest.objects.update(
        approved_year=None,
        approved_month=None,
        target_deduction_year=None,
        target_deduction_month=None,
    )


class Migration(migrations.Migration):

    dependencies = [
        ("loans", "0003_loan_workflow_redesign"),
    ]

    operations = [
        migrations.AddField(
            model_name="loanrequest",
            name="approved_year",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="loanrequest",
            name="approved_month",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="loanrequest",
            name="target_deduction_year",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="loanrequest",
            name="target_deduction_month",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.RunPython(backfill_loan_target_fields, reverse_backfill_loan_target_fields),
    ]
