from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0003_employee_import"),
    ]

    operations = [
        migrations.AddField(
            model_name="employeeimport",
            name="error_summary",
            field=models.JSONField(blank=True, null=True),
        ),
    ]
