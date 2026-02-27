from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("loans", "0004_loan_target_deduction_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="loanrequest",
            name="loan_type",
            field=models.CharField(
                choices=[("open", "Open Loan"), ("installment", "Installment Loan")],
                default="open",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="loanrequest",
            name="installment_months",
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
    ]
