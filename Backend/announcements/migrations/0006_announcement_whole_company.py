from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("announcements", "0005_announcement_meeting_fields")]
    operations = [
        migrations.AddField(model_name="announcement", name="whole_company", field=models.BooleanField(default=False))
    ]
