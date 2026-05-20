import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import employees.storage


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("leaves", "0015_seed_business_trip_leave_type"),
        ("organization", "0001_initial"),
        ("employees", "0010_employeedeletionrequest"),
    ]

    operations = [
        migrations.CreateModel(
            name="EmployeeDocument",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "document_type",
                    models.CharField(
                        choices=[
                            ("IQAMA", "Iqama"),
                            ("PASSPORT", "Passport"),
                            ("VISA", "Visa"),
                            ("SAUDI_ID", "Saudi ID"),
                            ("OTHER", "Other"),
                        ],
                        max_length=20,
                    ),
                ),
                ("custom_name", models.CharField(blank=True, max_length=100)),
                (
                    "file",
                    models.FileField(
                        storage=employees.storage.PrivateUploadStorage(),
                        upload_to="employee_documents/",
                    ),
                ),
                ("original_filename", models.CharField(blank=True, max_length=255)),
                ("visa_number", models.CharField(blank=True, max_length=50)),
                ("exit_before", models.DateField(blank=True, null=True)),
                ("exit_before_raw", models.CharField(blank=True, max_length=50)),
                ("visa_duration", models.PositiveIntegerField(blank=True, null=True)),
                ("visa_duration_raw", models.CharField(blank=True, max_length=50)),
                ("extracted_fields", models.JSONField(blank=True, default=dict)),
                (
                    "extraction_status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("success", "Success"),
                            ("partial", "Partial"),
                            ("failed", "Failed"),
                        ],
                        default="pending",
                        max_length=20,
                    ),
                ),
                ("extraction_error", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "company",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="employee_documents",
                        to="organization.organizationnode",
                    ),
                ),
                (
                    "employee_profile",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="documents",
                        to="employees.employeeprofile",
                    ),
                ),
                (
                    "leave_request",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="employee_documents",
                        to="leaves.leaverequest",
                    ),
                ),
                (
                    "uploaded_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="uploaded_employee_documents",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-id"],
                "indexes": [
                    models.Index(fields=["employee_profile", "document_type"], name="emp_doc_profile_type_idx"),
                    models.Index(fields=["company", "document_type"], name="emp_doc_company_type_idx"),
                    models.Index(fields=["leave_request"], name="emp_doc_leave_request_idx"),
                ],
            },
        ),
    ]
