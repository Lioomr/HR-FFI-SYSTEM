# Generated manually for the persistent in-app notification subsystem.
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("organization", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="Notification",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("title", models.CharField(max_length=255)),
                ("message", models.TextField(blank=True)),
                ("event_key", models.CharField(db_index=True, max_length=120)),
                (
                    "category",
                    models.CharField(
                        choices=[
                            ("approval", "Approval"),
                            ("request", "Request"),
                            ("leave", "Leave"),
                            ("loan", "Loan"),
                            ("asset", "Asset"),
                            ("attendance", "Attendance"),
                            ("delegation", "Delegation"),
                            ("announcement", "Announcement"),
                            ("meeting", "Meeting"),
                            ("document", "Document"),
                            ("invite", "Invite"),
                            ("payroll", "Payroll"),
                            ("system", "System"),
                        ],
                        db_index=True,
                        default="system",
                        max_length=32,
                    ),
                ),
                ("action_url", models.CharField(blank=True, max_length=500)),
                ("related_object_type", models.CharField(blank=True, max_length=100)),
                ("related_object_id", models.CharField(blank=True, max_length=100)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("deduplication_key", models.CharField(blank=True, max_length=255)),
                ("read_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                (
                    "company",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="notifications",
                        to="organization.organizationnode",
                    ),
                ),
                (
                    "recipient",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="in_app_notifications",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ["-created_at", "-id"]},
        ),
        migrations.AddIndex(
            model_name="notification",
            index=models.Index(
                fields=["recipient", "company", "read_at", "-created_at"], name="notif_rec_comp_read_idx"
            ),
        ),
        migrations.AddIndex(
            model_name="notification",
            index=models.Index(fields=["related_object_type", "related_object_id"], name="notif_related_obj_idx"),
        ),
        migrations.AddConstraint(
            model_name="notification",
            constraint=models.UniqueConstraint(
                condition=models.Q(("deduplication_key", ""), _negated=True),
                fields=("recipient", "deduplication_key"),
                name="uniq_notification_recipient_dedupe",
            ),
        ),
    ]
