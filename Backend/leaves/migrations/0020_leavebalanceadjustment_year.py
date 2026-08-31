from django.db import migrations, models


def backfill_adjustment_year(apps, schema_editor):
    adjustment_model = apps.get_model("leaves", "LeaveBalanceAdjustment")
    for adjustment in adjustment_model.objects.only("id", "created_at").iterator():
        adjustment_model.objects.filter(pk=adjustment.pk).update(year=adjustment.created_at.year)


class Migration(migrations.Migration):
    dependencies = [
        ("leaves", "0019_annual_leave_payment"),
    ]

    operations = [
        migrations.AddField(
            model_name="leavebalanceadjustment",
            name="year",
            field=models.IntegerField(null=True, help_text="Leave year to which this adjustment applies."),
        ),
        migrations.RunPython(backfill_adjustment_year, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="leavebalanceadjustment",
            name="year",
            field=models.IntegerField(help_text="Leave year to which this adjustment applies."),
        ),
    ]
