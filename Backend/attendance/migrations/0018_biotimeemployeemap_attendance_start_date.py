from django.db import migrations, models
from django.utils import timezone


def backfill_start_dates(apps, schema_editor):
    """Existing mappings start enforcing attendance on the day they were created."""
    BioTimeEmployeeMap = apps.get_model("attendance", "BioTimeEmployeeMap")
    for mapping in BioTimeEmployeeMap.objects.filter(attendance_start_date__isnull=True).only("pk", "created_at"):
        BioTimeEmployeeMap.objects.filter(pk=mapping.pk).update(
            attendance_start_date=timezone.localdate(mapping.created_at)
        )


class Migration(migrations.Migration):
    dependencies = [
        ("attendance", "0017_attendancelatenotice_document_sha256"),
    ]

    operations = [
        migrations.AddField(
            model_name="biotimeemployeemap",
            name="attendance_start_date",
            field=models.DateField(
                blank=True,
                help_text=(
                    "First day BioTime attendance is enforced for this employee. Absences and penalties are never "
                    "raised for earlier days."
                ),
                null=True,
            ),
        ),
        migrations.RunPython(backfill_start_dates, migrations.RunPython.noop),
    ]
