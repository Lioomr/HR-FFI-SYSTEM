from datetime import time

from django.db import migrations, models

import admin_portal.models


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
                blank=True, default=admin_portal.models.default_work_week_days
            ),
        ),
    ]
