import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0010_delegationrule_source_reference"),
        ("employees", "0030_profile_change_requests"),
    ]

    operations = [
        migrations.AddField(
            model_name="workflowinstance",
            name="employee_profile",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="request_workflows",
                to="employees.employeeprofile",
            ),
        ),
        migrations.AddField(
            model_name="workflowinstance",
            name="reference_no",
            field=models.CharField(blank=True, editable=False, max_length=64, null=True, unique=True),
        ),
        migrations.AddField(
            model_name="workflowinstance",
            name="reference_sequence",
            field=models.PositiveIntegerField(blank=True, editable=False, null=True),
        ),
        migrations.AddConstraint(
            model_name="workflowinstance",
            constraint=models.UniqueConstraint(
                fields=("definition", "employee_profile", "reference_sequence"),
                name="core_wfinstance_unique_employee_ref_seq",
            ),
        ),
    ]
