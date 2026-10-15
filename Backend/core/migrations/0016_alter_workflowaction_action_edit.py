from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0015_document_integrity"),
    ]

    operations = [
        migrations.AlterField(
            model_name="workflowaction",
            name="action",
            field=models.CharField(
                choices=[
                    ("submit", "Submit"),
                    ("approve", "Approve"),
                    ("request_changes", "Request Changes"),
                    ("reject", "Reject"),
                    ("cancel", "Cancel"),
                    ("advance", "Advance"),
                    ("reassign", "Reassign"),
                    ("skip", "Skip"),
                    ("override", "Override"),
                    ("disburse", "Disburse"),
                    ("deduct", "Deduct"),
                    ("edit", "Edit"),
                ],
                max_length=20,
            ),
        ),
    ]
