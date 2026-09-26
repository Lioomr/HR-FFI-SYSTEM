from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("leaves", "0027_annualleavepaymentrequest_include_locked_days_in_termination_payout"),
    ]

    operations = [
        migrations.AddField(
            model_name="annualleavepaymentrequest",
            name="employee_preference",
            field=models.CharField(
                blank=True,
                choices=[
                    ("pay", "Cash"),
                    ("carry_forward", "Carry forward as leave only"),
                    ("take_as_leave", "Take as leave"),
                ],
                default="",
                max_length=20,
            ),
        ),
    ]
