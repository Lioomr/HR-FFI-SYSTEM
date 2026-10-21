import calendar
from datetime import date, timedelta

from django.db import migrations, models


def backfill_periods(apps, schema_editor):
    PayrollRun = apps.get_model("payroll", "PayrollRun")
    for run in PayrollRun.objects.all().iterator():
        start = date(run.year, run.month, 1)
        if run.calendar_days is None:
            end = date(run.year, run.month, calendar.monthrange(run.year, run.month)[1])
            basis = "LEGACY_FULL_MONTH"
        else:
            end = date(run.year, run.month, run.calendar_days)
            basis = "DATE_RANGE"
        PayrollRun.objects.filter(pk=run.pk).update(
            period_start=start,
            period_end=end,
            period_basis=basis,
        )


class Migration(migrations.Migration):
    dependencies = [("payroll", "0013_payrollrun_calendar_days")]

    operations = [
        migrations.AlterModelOptions(
            name="payrollrun",
            options={"ordering": ["-period_end", "-period_start", "-id"]},
        ),
        migrations.AddField(
            model_name="payrollrun",
            name="period_start",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="payrollrun",
            name="period_end",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="payrollrun",
            name="period_basis",
            field=models.CharField(
                choices=[("DATE_RANGE", "Date range"), ("LEGACY_FULL_MONTH", "Legacy full month")],
                default="DATE_RANGE",
                max_length=24,
            ),
        ),
        migrations.RunPython(backfill_periods, migrations.RunPython.noop),
        migrations.RemoveConstraint(model_name="payrollrun", name="unique_payroll_run_period"),
        migrations.AddConstraint(
            model_name="payrollrun",
            constraint=models.UniqueConstraint(
                condition=~models.Q(status="CANCELLED"),
                fields=("company", "period_start", "period_end"),
                name="unique_payroll_run_date_range",
            ),
        ),
        migrations.AddConstraint(
            model_name="payrollrun",
            constraint=models.CheckConstraint(
                condition=(
                    models.Q(period_basis="LEGACY_FULL_MONTH")
                    | (
                        models.Q(period_end__gte=models.F("period_start"))
                        & models.Q(period_end__lte=models.F("period_start") + timedelta(days=29))
                    )
                ),
                name="payroll_run_date_range_length",
            ),
        ),
        migrations.AddConstraint(
            model_name="payrollrun",
            constraint=models.CheckConstraint(
                condition=(
                    models.Q(period_start__isnull=True, period_end__isnull=True)
                    | models.Q(period_start__isnull=False, period_end__isnull=False)
                ),
                name="payroll_run_date_range_pair",
            ),
        ),
    ]
