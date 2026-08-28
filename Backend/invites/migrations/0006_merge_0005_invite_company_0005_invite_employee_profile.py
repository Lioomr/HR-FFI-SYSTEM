# Generated manually to join independent migration branches after merge.
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("invites", "0005_invite_company"),
        ("invites", "0005_invite_employee_profile"),
    ]

    operations = []
