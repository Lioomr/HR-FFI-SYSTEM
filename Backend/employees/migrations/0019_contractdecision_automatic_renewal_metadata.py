from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0018_contractdecision_manual_resolution"),
    ]

    operations = [
        migrations.AddField(
            model_name="contractdecision",
            name="automatic_renewal",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="contractdecision",
            name="automatic_renewal_reason",
            field=models.TextField(blank=True),
        ),
    ]
