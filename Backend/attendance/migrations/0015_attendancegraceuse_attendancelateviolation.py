# Generated manually; additive policy ledger migration.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("attendance", "0014_attendanceadjustment_effective_date_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="AttendanceGraceUse",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("date", models.DateField()),
                ("month", models.DateField(help_text="First day of the calendar month.")),
                ("consumed", models.BooleanField(default=False)),
                ("reason", models.CharField(default="within_grace", max_length=64)),
                ("decided_at", models.DateTimeField(auto_now=True)),
                ("company", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="organization.organizationnode")),
                ("employee_profile", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="attendance_grace_uses", to="employees.employeeprofile")),
                ("result", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="grace_use", to="attendance.attendancedailyresult")),
            ],
            options={"ordering": ["date", "id"]},
        ),
        migrations.CreateModel(
            name="AttendanceLateViolation",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("date", models.DateField()),
                ("occurrence_number", models.PositiveIntegerField()),
                ("daily_rate", models.DecimalField(decimal_places=2, max_digits=12)),
                ("penalty_percent", models.DecimalField(decimal_places=4, max_digits=5)),
                ("penalty_amount", models.DecimalField(decimal_places=2, max_digits=12)),
                ("lifecycle", models.CharField(choices=[("active", "Active"), ("void", "Void"), ("manual_review", "Manual review"), ("applied", "Applied to payroll")], default="active", max_length=24)),
                ("reason", models.CharField(default="late_arrival", max_length=128)),
                ("void_reason", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("company", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to="organization.organizationnode")),
                ("employee_profile", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="attendance_late_violations", to="employees.employeeprofile")),
                ("result", models.OneToOneField(on_delete=django.db.models.deletion.PROTECT, related_name="late_violation", to="attendance.attendancedailyresult")),
            ],
            options={"ordering": ["date", "id"]},
        ),
        migrations.AddConstraint(model_name="attendancegraceuse", constraint=models.UniqueConstraint(fields=("employee_profile", "date"), name="unique_att_grace_use_day")),
        migrations.AddIndex(model_name="attendancegraceuse", index=models.Index(fields=["employee_profile", "month"], name="att_grace_month_idx")),
        migrations.AddConstraint(model_name="attendancelateviolation", constraint=models.UniqueConstraint(fields=("employee_profile", "date"), name="unique_att_late_violation_day")),
        migrations.AddIndex(model_name="attendancelateviolation", index=models.Index(fields=["company", "date", "lifecycle"], name="att_late_violation_idx")),
    ]
