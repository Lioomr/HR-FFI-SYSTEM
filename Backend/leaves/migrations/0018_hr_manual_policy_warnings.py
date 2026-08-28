from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("leaves", "0017_tenant_integrity"),
    ]

    operations = [
        migrations.AddField(
            model_name="leaverequest",
            name="policy_warnings",
            field=models.JSONField(
                blank=True,
                default=list,
                help_text="Warnings recorded for HR manual entries.",
            ),
        ),
    ]
