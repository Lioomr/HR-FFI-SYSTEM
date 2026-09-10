"""Reusable employee signature storage.

This also drops an orphaned ``signature_image`` column. An earlier migration
named ``0021_employee_profile_signature_image`` was applied to some databases
and then deleted from the codebase, leaving those databases with a NOT NULL
column Django no longer knows about - which made every ``EmployeeProfile``
insert fail. The drop is guarded by ``IF EXISTS`` so it is a no-op on a fresh
database and a repair on an upgraded one. It is not reversible because the
column carried no data and no migration state describes it.
"""

from django.db import migrations, models

import employees.storage

DROP_ORPHANED_SIGNATURE_COLUMN = """
ALTER TABLE employees_employeeprofile DROP COLUMN IF EXISTS signature_image;
"""


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0020_contractdecision_final_notification_state"),
    ]

    operations = [
        migrations.RunSQL(
            sql=DROP_ORPHANED_SIGNATURE_COLUMN,
            reverse_sql=migrations.RunSQL.noop,
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="signature",
            field=models.FileField(
                blank=True,
                help_text="Reusable signature image (PNG/JPG) applied to generated request forms.",
                null=True,
                storage=employees.storage.PrivateUploadStorage(),
                upload_to="employee_signatures/",
            ),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="signature_uploaded_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
