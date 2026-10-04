# Replaces the unshipped v1 EmployeeDocumentChangeRequest (dev data only) with
# per-field profile change requests and their OCR-read attachments.

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import employees.storage


def drop_v1_workflow_rows(apps, schema_editor):
    """Remove the v1 content type so its workflow instances/actions cascade away with it."""

    ContentType = apps.get_model("contenttypes", "ContentType")
    ContentType.objects.filter(app_label="employees", model="employeedocumentchangerequest").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0029_employee_document_change_request"),
        ("organization", "0005_organizationnode_address_organizationnode_email_and_more"),
        ("contenttypes", "0002_remove_content_type_name"),
        ("core", "0010_delegationrule_source_reference"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RunPython(drop_v1_workflow_rows, migrations.RunPython.noop),
        migrations.DeleteModel(name="EmployeeDocumentChangeRequest"),
        migrations.AddField(
            model_name="employeeprofile",
            name="passport_issue_date",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name="ProfileChangeRequest",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("PENDING_HR", "Pending HR"),
                            ("APPROVED", "Approved"),
                            ("PARTIALLY_APPROVED", "Partially approved"),
                            ("REJECTED", "Rejected"),
                            ("CANCELLED", "Cancelled"),
                        ],
                        default="PENDING_HR",
                        max_length=20,
                    ),
                ),
                ("items", models.JSONField(blank=True, default=list)),
                ("decided_at", models.DateTimeField(blank=True, null=True)),
                ("decision_note", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="employee_profile_change_requests",
                        to="organization.organizationnode",
                    ),
                ),
                (
                    "decided_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="profile_change_requests_decided",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "employee_profile",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="profile_change_requests",
                        to="employees.employeeprofile",
                    ),
                ),
                (
                    "submitted_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="profile_change_requests_submitted",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-id"],
                "indexes": [models.Index(fields=["company", "status"], name="emp_profile_change_company_idx")],
                "constraints": [
                    models.UniqueConstraint(
                        condition=models.Q(("status", "PENDING_HR")),
                        fields=("employee_profile",),
                        name="emp_profile_change_one_pending",
                    )
                ],
            },
        ),
        migrations.CreateModel(
            name="ProfileChangeAttachment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "document_type",
                    models.CharField(choices=[("PASSPORT", "Passport"), ("SAUDI_ID", "Saudi ID")], max_length=20),
                ),
                (
                    "file",
                    models.FileField(
                        storage=employees.storage.PrivateUploadStorage(), upload_to="employee_change_attachments/"
                    ),
                ),
                ("original_filename", models.CharField(blank=True, max_length=255)),
                ("extracted_fields", models.JSONField(blank=True, default=dict)),
                ("extraction_raw_text", models.TextField(blank=True)),
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
                ("extraction_warnings", models.JSONField(blank=True, default=list)),
                ("extraction_confidence", models.FloatField(blank=True, null=True)),
                ("extraction_metadata", models.JSONField(blank=True, default=dict)),
                ("extraction_task_id", models.CharField(blank=True, max_length=64)),
                ("extraction_completed_at", models.DateTimeField(blank=True, null=True)),
                ("extraction_attempts", models.PositiveSmallIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "applied_document",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="profile_change_attachments",
                        to="employees.employeedocument",
                    ),
                ),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="employee_profile_change_attachments",
                        to="organization.organizationnode",
                    ),
                ),
                (
                    "employee_profile",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="profile_change_attachments",
                        to="employees.employeeprofile",
                    ),
                ),
                (
                    "request",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="attachments",
                        to="employees.profilechangerequest",
                    ),
                ),
                (
                    "uploaded_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="profile_change_attachments_uploaded",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-id"],
                "indexes": [models.Index(fields=["request", "created_at"], name="emp_profile_attach_req_idx")],
            },
        ),
    ]
