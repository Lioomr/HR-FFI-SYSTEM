from django.db import migrations, models

import employees.storage


class Migration(migrations.Migration):
    dependencies = [("organization", "0002_organizationscope")]

    operations = [
        migrations.AddField(
            model_name="organizationnode",
            name="logo",
            field=models.FileField(
                blank=True,
                help_text="Optional company logo used on company-specific private documents.",
                storage=employees.storage.PrivateUploadStorage(),
                upload_to="organization_logos/",
            ),
        )
    ]
