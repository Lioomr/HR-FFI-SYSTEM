from django.db import migrations, models


class Migration(migrations.Migration):
    """Issuance hash of the stored warning letter PDF (hash-only tamper evidence). Not backfilled."""

    dependencies = [
        ("penalties", "0005_penaltyrecord_automation_penaltywarningnotice"),
    ]

    operations = [
        migrations.AddField(
            model_name="penaltywarningnotice",
            name="document_hashed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="penaltywarningnotice",
            name="document_sha256",
            field=models.CharField(blank=True, db_index=True, max_length=64),
        ),
    ]
