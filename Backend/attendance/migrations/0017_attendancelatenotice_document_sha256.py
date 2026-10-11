from django.db import migrations, models


class Migration(migrations.Migration):
    """Issuance hash of the stored notice PDF (hash-only tamper evidence). Not backfilled."""

    dependencies = [
        ("attendance", "0016_attendancelatenotice"),
    ]

    operations = [
        migrations.AddField(
            model_name="attendancelatenotice",
            name="document_hashed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="attendancelatenotice",
            name="document_sha256",
            field=models.CharField(blank=True, db_index=True, max_length=64),
        ),
    ]
