from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0021_employeeprofile_signature"),
        ("organization", "0003_organizationnode_logo"),
    ]

    operations = [
        migrations.AddField(
            model_name="organizationnode",
            name="late_notice_signer",
            field=models.ForeignKey(
                blank=True,
                help_text="HR representative whose stored signature is printed on new late-attendance notices.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="companies_signed_for_late_notices",
                to="employees.employeeprofile",
            ),
        ),
    ]
