from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("payroll", "0012_payrollrunitem_is_active")]

    operations = [
        migrations.AddField(
            model_name="payrollrun",
            name="calendar_days",
            field=models.PositiveSmallIntegerField(
                blank=True,
                null=True,
                validators=[MinValueValidator(1), MaxValueValidator(30)],
            ),
        ),
        migrations.AddConstraint(
            model_name="payrollrun",
            constraint=models.CheckConstraint(
                condition=(
                    models.Q(calendar_days__isnull=True)
                    | (models.Q(calendar_days__gte=1) & models.Q(calendar_days__lte=30))
                ),
                name="payroll_run_calendar_days_range",
            ),
        ),
    ]
