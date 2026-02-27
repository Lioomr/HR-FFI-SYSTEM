import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("payroll", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Payslip",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("year", models.PositiveIntegerField()),
                ("month", models.PositiveIntegerField()),
                ("basic_salary", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("transportation_allowance", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("accommodation_allowance", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("telephone_allowance", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("petrol_allowance", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("other_allowance", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("total_salary", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("total_deductions", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("net_salary", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("payment_mode", models.CharField(default="Bank Transfer", max_length=100)),
                ("status", models.CharField(default="PAID", max_length=20)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "employee",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="payslips",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "payroll_run",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, related_name="payslips", to="payroll.payrollrun"
                    ),
                ),
            ],
            options={
                "ordering": ["-year", "-month", "-id"],
            },
        ),
    ]
