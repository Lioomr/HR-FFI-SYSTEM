from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def mark_existing_acknowledgments_approved(apps, schema_editor):
    StartingWorkAcknowledgment = apps.get_model("job_offers", "StartingWorkAcknowledgment")
    for acknowledgment in StartingWorkAcknowledgment.objects.filter(status="generated").iterator():
        acknowledgment.status = "approved"
        acknowledgment.approved_at = acknowledgment.generated_at
        acknowledgment.save(update_fields=["status", "approved_at"])


def restore_legacy_generated_status(apps, schema_editor):
    StartingWorkAcknowledgment = apps.get_model("job_offers", "StartingWorkAcknowledgment")
    StartingWorkAcknowledgment.objects.filter(
        status="approved",
        approved_by__isnull=True,
        approved_at=models.F("generated_at"),
    ).update(status="generated", approved_at=None)


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("attendance", "0010_worklocation"),
        ("job_offers", "0007_remove_hiringrequest_job_offers__company_be4aa4_idx_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="startingworkacknowledgment",
            name="affected_attendance_records",
            field=models.ManyToManyField(
                blank=True,
                related_name="starting_work_verifications",
                to="attendance.attendancerecord",
            ),
        ),
        migrations.AddField(
            model_name="startingworkacknowledgment",
            name="approved_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="startingworkacknowledgment",
            name="approved_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="approved_starting_work_acknowledgments",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="startingworkacknowledgment",
            name="rejected_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="startingworkacknowledgment",
            name="rejected_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="rejected_starting_work_acknowledgments",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="startingworkacknowledgment",
            name="rejection_reason",
            field=models.TextField(blank=True),
        ),
        migrations.AlterField(
            model_name="startingworkacknowledgment",
            name="status",
            field=models.CharField(
                choices=[
                    ("pending_hr", "Pending HR Verification"),
                    ("approved", "Approved"),
                    ("rejected", "Rejected"),
                ],
                db_index=True,
                default="pending_hr",
                max_length=16,
            ),
        ),
        migrations.RunPython(mark_existing_acknowledgments_approved, restore_legacy_generated_status),
    ]
