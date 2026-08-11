from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0012_employee_archival"),
    ]

    operations = [
        migrations.AddField(
            model_name="employeeprofile",
            name="work_license_expiry",
            field=models.DateField(blank=True, null=True),
        ),
    ]
