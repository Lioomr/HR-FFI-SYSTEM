import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("attendance", "0015_attendancegraceuse_attendancelateviolation"), ("payroll", "0004_remove_payrollrun_unique_payroll_run_period_and_more")]

    operations = [
        migrations.CreateModel(
            name="AttendancePayrollDeduction",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("intended_year", models.PositiveIntegerField()), ("intended_month", models.PositiveIntegerField()),
                ("amount", models.DecimalField(decimal_places=2, max_digits=12)),
                ("status", models.CharField(choices=[("pending", "Pending"), ("applied", "Applied"), ("manual_review", "Manual review")], default="pending", max_length=24)),
                ("created_at", models.DateTimeField(auto_now_add=True)), ("updated_at", models.DateTimeField(auto_now=True)),
                ("company", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="attendance_payroll_deductions", to="organization.organizationnode")),
                ("employee_profile", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="attendance_payroll_deductions", to="employees.employeeprofile")),
                ("payroll_run", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="attendance_deductions", to="payroll.payrollrun")),
                ("payroll_run_item", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="attendance_deductions", to="payroll.payrollrunitem")),
                ("violation", models.OneToOneField(on_delete=django.db.models.deletion.PROTECT, related_name="payroll_deduction", to="attendance.attendancelateviolation")),
            ],
        )
    ]
