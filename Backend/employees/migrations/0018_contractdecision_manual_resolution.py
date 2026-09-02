from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0017_contractdecision"),
    ]

    operations = [
        migrations.AlterField(
            model_name="contractdecision",
            name="status",
            field=models.CharField(
                choices=[
                    ("PENDING_HR", "Pending HR"),
                    ("PENDING_CEO", "Pending CEO"),
                    ("APPROVED", "Approved"),
                    ("AUTO_APPROVED", "Automatically approved"),
                    ("REJECTED", "Rejected"),
                    ("AUTO_RENEWED", "Automatically renewed"),
                    ("AUTO_RENEWAL_FAILED", "Automatic renewal failed"),
                    ("MANUAL_RESOLUTION_REQUIRED", "Manual resolution required"),
                ],
                db_index=True,
                default="PENDING_HR",
                max_length=32,
            ),
        ),
    ]
