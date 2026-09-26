from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("announcements", "0007_announcement_whatsapp_group_id_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="announcement",
            name="broadcast_id",
            field=models.UUIDField(blank=True, db_index=True, null=True),
        ),
    ]
