from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0013_employeeprofile_work_license_expiry"),
    ]

    operations = [
        migrations.AlterField(
            model_name="employeeprofile",
            name="employment_status",
            field=models.CharField(
                choices=[
                    ("PREHIRE", "Prehire"),
                    ("ACTIVE", "Active"),
                    ("SUSPENDED", "Suspended"),
                    ("TERMINATED", "Terminated"),
                ],
                default="ACTIVE",
                help_text="Current employment status.",
                max_length=20,
            ),
        ),
    ]
