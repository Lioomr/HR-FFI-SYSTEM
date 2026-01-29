from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("payroll", "0002_payslip"),
    ]

    operations = [
        migrations.AddField(
            model_name="payslip",
            name="is_active",
            field=models.BooleanField(default=True),
        ),
    ]
