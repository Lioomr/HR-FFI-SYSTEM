import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0008_employee_id_prefix_to_ffi"),
        ("leaves", "0009_leaverequest_employee_profile_nullable_employee"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterField(
            model_name="leavebalanceadjustment",
            name="employee",
            field=models.ForeignKey(
                blank=True,
                help_text="The employee whose balance is adjusted.",
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="leave_adjustments",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="leavebalanceadjustment",
            name="employee_profile",
            field=models.ForeignKey(
                blank=True,
                help_text="Employee profile for adjustments recorded without a linked user account.",
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="leave_adjustments",
                to="employees.employeeprofile",
            ),
        ),
    ]
