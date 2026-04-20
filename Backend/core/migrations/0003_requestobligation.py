from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("contenttypes", "0002_remove_content_type_name"),
        ("employees", "0009_employeeprofile_company"),
        ("organization", "0001_initial"),
        ("core", "0002_userpreference"),
    ]

    operations = [
        migrations.CreateModel(
            name="RequestObligation",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("parent_object_id", models.PositiveIntegerField()),
                ("target_object_id", models.PositiveIntegerField(blank=True, null=True)),
                (
                    "type",
                    models.CharField(
                        choices=[
                            ("asset_return", "Asset Return"),
                            ("pending_approvals", "Pending Approvals"),
                        ],
                        max_length=50,
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[("open", "Open"), ("resolved", "Resolved"), ("waived", "Waived")],
                        default="open",
                        max_length=20,
                    ),
                ),
                (
                    "severity",
                    models.CharField(
                        choices=[("blocking", "Blocking"), ("warning", "Warning")],
                        default="blocking",
                        max_length=20,
                    ),
                ),
                ("title", models.CharField(max_length=255)),
                ("description", models.TextField(blank=True)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("resolved_at", models.DateTimeField(blank=True, null=True)),
                ("resolution_note", models.TextField(blank=True)),
                ("waived_at", models.DateTimeField(blank=True, null=True)),
                ("waiver_reason", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "company",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="request_obligations",
                        to="organization.organizationnode",
                    ),
                ),
                (
                    "employee",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="request_obligations",
                        to="employees.employeeprofile",
                    ),
                ),
                (
                    "parent_content_type",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="request_obligation_parents",
                        to="contenttypes.contenttype",
                    ),
                ),
                (
                    "resolved_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="resolved_request_obligations",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "target_content_type",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="request_obligation_targets",
                        to="contenttypes.contenttype",
                    ),
                ),
                (
                    "waived_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="waived_request_obligations",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["status", "type", "id"],
                "indexes": [
                    models.Index(fields=["parent_content_type", "parent_object_id"], name="core_reqobl_parent_idx"),
                    models.Index(fields=["target_content_type", "target_object_id"], name="core_reqobl_target_idx"),
                    models.Index(fields=["company", "status"], name="core_reqobl_company_status_idx"),
                    models.Index(fields=["employee", "status"], name="core_reqobl_emp_status_idx"),
                ],
            },
        ),
    ]
