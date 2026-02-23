from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("employees", "0007_backfill_hr_aligned_employee_fields"),
        ("payroll", "0003_payslip_is_active"),
    ]

    operations = [
        migrations.CreateModel(
            name="LoanRequest",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("requested_amount", models.DecimalField(decimal_places=2, max_digits=12)),
                ("approved_amount", models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ("reason", models.TextField(blank=True)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("submitted", "Submitted"),
                            ("pending_manager", "Pending Manager"),
                            ("pending_finance", "Pending Finance"),
                            ("pending_cfo", "Pending CFO"),
                            ("approved", "Approved"),
                            ("rejected", "Rejected"),
                            ("cancelled", "Cancelled"),
                            ("deducted", "Deducted"),
                        ],
                        default="submitted",
                        max_length=20,
                    ),
                ),
                ("manager_decision_at", models.DateTimeField(blank=True, null=True)),
                ("manager_decision_note", models.TextField(blank=True)),
                ("finance_decision_at", models.DateTimeField(blank=True, null=True)),
                ("finance_decision_note", models.TextField(blank=True)),
                ("cfo_decision_at", models.DateTimeField(blank=True, null=True)),
                ("cfo_decision_note", models.TextField(blank=True)),
                ("deducted_at", models.DateTimeField(blank=True, null=True)),
                ("deducted_amount", models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "cfo_decision_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="cfo_decided_loans",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "deduction_payroll_run",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="deducted_loans",
                        to="payroll.payrollrun",
                    ),
                ),
                (
                    "employee",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="loan_requests",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "employee_profile",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="loan_requests",
                        to="employees.employeeprofile",
                    ),
                ),
                (
                    "finance_decision_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="finance_decided_loans",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "manager_decision_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="manager_decided_loans",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.AddIndex(
            model_name="loanrequest",
            index=models.Index(fields=["status", "created_at"], name="loans_loanr_status_65deaa_idx"),
        ),
        migrations.AddIndex(
            model_name="loanrequest",
            index=models.Index(fields=["employee", "created_at"], name="loans_loanr_employe_2db8c2_idx"),
        ),
        migrations.AddConstraint(
            model_name="loanrequest",
            constraint=models.CheckConstraint(
                condition=models.Q(("requested_amount__gt", 0)),
                name="loan_requested_amount_gt_zero",
            ),
        ),
    ]
