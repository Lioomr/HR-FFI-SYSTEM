import django.db.models.deletion
import employees.storage
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("assets", "0006_asset_must_return_before_travel"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("organization", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="PrintedLabelJob",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("asset_count", models.PositiveIntegerField()),
                (
                    "paper_size",
                    models.CharField(
                        choices=[
                            ("50X30", "50x30 mm"),
                            ("40X30", "40x30 mm"),
                            ("60X40", "60x40 mm"),
                            ("A4_GRID", "A4 grid"),
                        ],
                        max_length=20,
                    ),
                ),
                (
                    "pdf_file",
                    models.FileField(storage=employees.storage.PrivateUploadStorage(), upload_to="assets/labels/"),
                ),
                ("asset_codes", models.JSONField(default=list)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="printed_label_jobs",
                        to="organization.organizationnode",
                    ),
                ),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="printed_label_jobs",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="printedlabeljob",
            index=models.Index(fields=["company", "created_at"], name="asset_label_co_created_idx"),
        ),
    ]
