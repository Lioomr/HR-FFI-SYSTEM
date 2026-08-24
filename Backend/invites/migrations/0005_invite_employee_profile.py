import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0014_alter_employeeprofile_employment_status"),
        ("invites", "0004_invite_whatsapp_delivery_status"),
    ]

    operations = [
        migrations.AddField(
            model_name="invite",
            name="employee_profile",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="account_invites",
                to="employees.employeeprofile",
            ),
        ),
    ]
