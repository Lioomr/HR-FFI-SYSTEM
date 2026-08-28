import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0013_employeeprofile_work_license_expiry"),
        ("organization", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="employeeimport",
            name="company",
            field=models.ForeignKey(
                blank=True,
                help_text="Company selected when this import was executed.",
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="employee_imports",
                to="organization.organizationnode",
            ),
        ),
    ]
