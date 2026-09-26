from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0009_reseed_contract_rating_workflow"),
    ]

    operations = [
        migrations.AddField(
            model_name="delegationrule",
            name="source_reference",
            field=models.CharField(blank=True, max_length=128, null=True, unique=True),
        ),
    ]
