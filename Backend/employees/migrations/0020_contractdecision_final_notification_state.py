from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0019_contractdecision_automatic_renewal_metadata"),
    ]

    operations = [
        migrations.AddField(
            model_name="contractdecision",
            name="final_notification_attempts",
            field=models.PositiveSmallIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="contractdecision",
            name="final_notification_sent_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="contractdecision",
            name="last_final_notification_attempt_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
