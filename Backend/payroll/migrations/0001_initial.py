from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="PayrollRun",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("year", models.PositiveIntegerField()),
                ("month", models.PositiveIntegerField()),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("DRAFT", "Draft"),
                            ("COMPLETED", "Completed"),
                            ("PAID", "Paid"),
                            ("CANCELLED", "Cancelled"),
                        ],
                        default="DRAFT",
                        max_length=20,
                    ),
                ),
                ("total_net", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("total_employees", models.PositiveIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "ordering": ["-year", "-month", "-id"],
            },
        ),
        migrations.CreateModel(
            name="PayrollRunItem",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("employee_id", models.CharField(max_length=20)),
                ("employee_name", models.CharField(max_length=255)),
                ("department", models.CharField(blank=True, max_length=100)),
                ("position", models.CharField(blank=True, max_length=100)),
                ("basic_salary", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("total_allowances", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("total_deductions", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("net_salary", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                (
                    "payroll_run",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE, related_name="items", to="payroll.payrollrun"
                    ),
                ),
            ],
            options={
                "ordering": ["id"],
            },
        ),
        migrations.AddConstraint(
            model_name="payrollrun",
            constraint=models.UniqueConstraint(fields=("year", "month"), name="unique_payroll_run_period"),
        ),
    ]
