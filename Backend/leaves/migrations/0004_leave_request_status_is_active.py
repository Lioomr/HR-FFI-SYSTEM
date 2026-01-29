from django.db import migrations, models


def map_statuses(apps, schema_editor):
    LeaveRequest = apps.get_model("leaves", "LeaveRequest")
    status_map = {
        "PENDING_MANAGER": "submitted",
        "PENDING_HR": "submitted",
        "APPROVED": "approved",
        "REJECTED": "rejected",
        "CANCELLED": "cancelled",
        "submitted": "submitted",
        "approved": "approved",
        "rejected": "rejected",
        "cancelled": "cancelled",
    }
    for req in LeaveRequest.objects.all().iterator():
        mapped = status_map.get(req.status, "submitted")
        if req.status != mapped:
            req.status = mapped
            req.save(update_fields=["status"])


class Migration(migrations.Migration):
    dependencies = [
        ("leaves", "0003_leaverequest_hr_decision_note_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="leaverequest",
            name="is_active",
            field=models.BooleanField(default=True),
        ),
        migrations.AlterField(
            model_name="leaverequest",
            name="status",
            field=models.CharField(choices=[("submitted", "Submitted"), ("approved", "Approved"), ("rejected", "Rejected"), ("cancelled", "Cancelled")], default="submitted", max_length=20),
        ),
        migrations.RunPython(map_statuses, migrations.RunPython.noop),
    ]
