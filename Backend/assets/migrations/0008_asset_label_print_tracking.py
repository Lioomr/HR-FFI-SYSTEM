from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("assets", "0007_printed_label_job"),
    ]

    operations = [
        migrations.AddField(
            model_name="asset",
            name="last_label_printed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="asset",
            name="label_print_count",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddIndex(
            model_name="asset",
            index=models.Index(
                fields=["last_label_printed_at"],
                name="asset_last_label_idx",
            ),
        ),
    ]
