from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("job_offers", "0008_startingworkacknowledgment_hr_verification"),
    ]

    operations = [
        migrations.AddField(
            model_name="startingworkacknowledgment",
            name="void_reason",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="startingworkacknowledgment",
            name="voided_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="startingworkacknowledgment",
            name="voided_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="voided_starting_work_acknowledgments",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AlterField(
            model_name="startingworkacknowledgment",
            name="status",
            field=models.CharField(
                choices=[
                    ("pending_hr", "Pending HR Verification"),
                    ("approved", "Approved"),
                    ("rejected", "Rejected"),
                    ("voided", "Voided"),
                ],
                db_index=True,
                default="pending_hr",
                max_length=16,
            ),
        ),
    ]
