from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("leaves", "0020_leavebalanceadjustment_year"),
    ]

    operations = [
        migrations.AddField(
            model_name="leaverequest",
            name="will_travel",
            field=models.BooleanField(default=False, help_text="Whether the employee will travel during the leave."),
        ),
    ]
