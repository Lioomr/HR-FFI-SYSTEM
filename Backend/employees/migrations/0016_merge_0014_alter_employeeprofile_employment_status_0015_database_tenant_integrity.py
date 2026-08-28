# Generated manually to join independent migration branches after merge.
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0014_alter_employeeprofile_employment_status"),
        ("employees", "0015_database_tenant_integrity"),
    ]

    operations = []
