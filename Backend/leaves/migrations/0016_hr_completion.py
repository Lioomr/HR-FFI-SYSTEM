import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("leaves", "0015_seed_business_trip_leave_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="leaverequest",
            name="hr_completed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="leaverequest",
            name="hr_completed_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="hr_completed_leaves",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="leaverequest",
            name="hr_completion_note",
            field=models.TextField(blank=True),
        ),
        migrations.AlterField(
            model_name="leaverequest",
            name="status",
            field=models.CharField(
                choices=[
                    ("submitted", "Submitted"),
                    ("pending_delegate", "Pending Alternative Employee"),
                    ("pending_manager", "Pending Manager"),
                    ("pending_hr", "Pending HR"),
                    ("pending_ceo", "Pending CEO"),
                    ("pending_hr_completion", "Pending HR Completion"),
                    ("approved", "Approved"),
                    ("rejected", "Rejected"),
                    ("cancelled", "Cancelled"),
                ],
                default="submitted",
                max_length=30,
            ),
        ),
    ]
