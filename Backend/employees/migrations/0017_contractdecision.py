import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("employees", "0016_merge_0014_alter_employeeprofile_employment_status_0015_database_tenant_integrity"),
        ("organization", "0002_organizationscope"),
    ]

    operations = [
        migrations.CreateModel(
            name="ContractDecision",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("decision_type", models.CharField(blank=True, choices=[("RENEW", "Renew"), ("RENEW_WITH_CHANGES", "Renew with changes"), ("TERMINATE", "Terminate")], max_length=32)),
                ("status", models.CharField(choices=[("PENDING_HR", "Pending HR"), ("PENDING_CEO", "Pending CEO"), ("APPROVED", "Approved"), ("AUTO_APPROVED", "Automatically approved"), ("REJECTED", "Rejected"), ("AUTO_RENEWED", "Automatically renewed"), ("AUTO_RENEWAL_FAILED", "Automatic renewal failed")], db_index=True, default="PENDING_HR", max_length=32)),
                ("original_contract_date", models.DateField(blank=True, null=True)),
                ("original_contract_expiry", models.DateField(db_index=True)),
                ("proposed_contract_date", models.DateField(blank=True, null=True)),
                ("proposed_contract_expiry", models.DateField(blank=True, null=True)),
                ("original_terms", models.JSONField(blank=True, default=dict)),
                ("proposed_terms", models.JSONField(blank=True, default=dict)),
                ("hr_comment", models.TextField(blank=True)),
                ("ceo_comment", models.TextField(blank=True)),
                ("failure_reason", models.TextField(blank=True)),
                ("submitted_at", models.DateTimeField(blank=True, null=True)),
                ("ceo_deadline", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("ceo_decided_at", models.DateTimeField(blank=True, null=True)),
                ("last_ceo_reminder_at", models.DateTimeField(blank=True, null=True)),
                ("ceo_reminder_count", models.PositiveSmallIntegerField(default=0)),
                ("finalized_at", models.DateTimeField(blank=True, null=True)),
                ("finalized_by_system", models.BooleanField(default=False)),
                ("notification_milestones", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("ceo_decided_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="contract_decisions_decided", to=settings.AUTH_USER_MODEL)),
                ("company", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="contract_decisions", to="organization.organizationnode")),
                ("employee_profile", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="contract_decisions", to="employees.employeeprofile")),
                ("finalized_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="contract_decisions_finalized", to=settings.AUTH_USER_MODEL)),
                ("requested_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="contract_decisions_requested", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "ordering": ["original_contract_expiry", "-created_at", "-id"],
                "indexes": [
                    models.Index(fields=["company", "status"], name="contract_dec_comp_status_idx"),
                    models.Index(fields=["status", "ceo_deadline"], name="contract_dec_deadline_idx"),
                ],
                "constraints": [
                    models.UniqueConstraint(fields=("employee_profile", "original_contract_expiry"), name="employee_contract_decision_cycle_unique"),
                ],
            },
        ),
    ]
