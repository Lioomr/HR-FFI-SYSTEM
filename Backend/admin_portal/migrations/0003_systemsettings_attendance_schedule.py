from datetime import time

from django.db import migrations, models


def default_work_week_days():
    """Historical default for the removed ``work_week_days`` field.

    Kept local to this migration so the model module no longer has to carry a
    callable that only migration history references.
    """
    return [6, 0, 1, 2, 3]


class Migration(migrations.Migration):

    dependencies = [
        ("admin_portal", "0002_systemsettings_geofence_attendance_enabled"),
    ]

    operations = [
        migrations.AddField(
            model_name="systemsettings",
            name="work_day_start_time",
            field=models.TimeField(default=time(9, 0)),
        ),
        migrations.AddField(
            model_name="systemsettings",
            name="late_grace_minutes",
            field=models.PositiveIntegerField(default=15),
        ),
        migrations.AddField(
            model_name="systemsettings",
            name="absence_detection_enabled",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="systemsettings",
            name="work_week_days",
            field=models.JSONField(
                blank=True, default=default_work_week_days
            ),
        ),
    ]
