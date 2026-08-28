import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("invites", "0004_invite_whatsapp_delivery_status"),
        ("organization", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="invite",
            name="company",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="invites",
                to="organization.organizationnode",
            ),
        ),
    ]
