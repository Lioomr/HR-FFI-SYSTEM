from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("attendance", "0010_worklocation"),
    ]

    operations = [
        migrations.AddField(
            model_name="attendancerecord",
            name="is_late_flagged",
            field=models.BooleanField(default=False),
        ),
    ]
