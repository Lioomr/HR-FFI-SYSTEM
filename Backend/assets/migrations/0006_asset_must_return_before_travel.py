from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("assets", "0005_asset_company"),
    ]

    operations = [
        migrations.AddField(
            model_name="asset",
            name="must_return_before_travel",
            field=models.BooleanField(default=False),
        ),
    ]
