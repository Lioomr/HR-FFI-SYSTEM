from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("in_app_notifications", "0002_notificationdelivery"),
    ]

    operations = [
        migrations.AlterField(
            model_name="notification",
            name="category",
            field=models.CharField(
                choices=[
                    ("approval", "Approval"),
                    ("request", "Request"),
                    ("leave", "Leave"),
                    ("loan", "Loan"),
                    ("asset", "Asset"),
                    ("attendance", "Attendance"),
                    ("delegation", "Delegation"),
                    ("announcement", "Announcement"),
                    ("meeting", "Meeting"),
                    ("document", "Document"),
                    ("invite", "Invite"),
                    ("payroll", "Payroll"),
                    ("penalty", "Penalty"),
                    ("system", "System"),
                ],
                db_index=True,
                default="system",
                max_length=32,
            ),
        ),
    ]
