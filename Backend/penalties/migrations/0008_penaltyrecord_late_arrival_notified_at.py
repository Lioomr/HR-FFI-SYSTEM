from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("penalties", "0007_payroll_rebuild_foundation")]

    operations = [
        migrations.AddField(
            model_name="penaltyrecord",
            name="late_arrival_notified_at",
            field=models.DateTimeField(blank=True, editable=False, null=True),
        ),
    ]
