from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("invites", "0003_invite_last_delivery_metadata"),
    ]

    operations = [
        migrations.AddField(
            model_name="invite",
            name="provider_submitted",
            field=models.BooleanField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="invite",
            name="provider_status",
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name="invite",
            name="delivery_status",
            field=models.CharField(
                choices=[
                    ("unknown", "Unknown"),
                    ("queued", "Queued"),
                    ("sent", "Sent"),
                    ("delivered", "Delivered"),
                    ("read", "Read"),
                    ("failed", "Failed"),
                ],
                default="unknown",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="invite",
            name="external_message_id",
            field=models.CharField(blank=True, max_length=255),
        ),
    ]
