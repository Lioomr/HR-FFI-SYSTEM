from django.db import migrations, models
import django.db.models.deletion
from django.conf import settings
from employees.storage import PrivateUploadStorage


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0002_expand_employee_fields"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="EmployeeImport",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("original_filename", models.CharField(max_length=255)),
                ("stored_file", models.FileField(storage=PrivateUploadStorage(), upload_to="employee_imports/")),
                (
                    "errors_file",
                    models.FileField(
                        blank=True, null=True, storage=PrivateUploadStorage(), upload_to="employee_imports/errors/"
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[("success", "Success"), ("failed", "Failed")], default="failed", max_length=10
                    ),
                ),
                ("row_count", models.PositiveIntegerField(default=0)),
                ("inserted_rows", models.PositiveIntegerField(default=0)),
                ("file_hash", models.CharField(blank=True, max_length=64)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "uploader",
                    models.ForeignKey(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="employee_imports",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
                "verbose_name": "Employee Import",
                "verbose_name_plural": "Employee Imports",
            },
        ),
    ]
