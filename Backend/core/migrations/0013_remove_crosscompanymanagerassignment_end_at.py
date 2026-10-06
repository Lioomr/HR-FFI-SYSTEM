"""Drop ``CrossCompanyManagerAssignment.end_at`` and allow one active assignment per employee.

Runs after 0012 has ended expired/duplicate rows and removed ``end_at`` from the
trigger functions and the column-scoped guard trigger.
"""

from django.db import migrations, models

# Reverse only: give re-added rows a far end date so the old NOT NULL column holds
# and the restored "no expiry" meaning is kept.
RESTORE_END_AT_SQL = r"""
UPDATE core_crosscompanymanagerassignment
SET end_at = start_at + INTERVAL '100 years'
WHERE end_at IS NULL;
"""


class Migration(migrations.Migration):
    dependencies = [("core", "0012_cross_company_manager_single_active_no_expiry")]

    operations = [
        migrations.AlterField(
            model_name="crosscompanymanagerassignment",
            name="end_at",
            field=models.DateTimeField(null=True, blank=True),
        ),
        migrations.RunSQL(migrations.RunSQL.noop, RESTORE_END_AT_SQL),
        migrations.RemoveField(model_name="crosscompanymanagerassignment", name="end_at"),
        migrations.AddConstraint(
            model_name="crosscompanymanagerassignment",
            constraint=models.UniqueConstraint(
                condition=models.Q(is_active=True, revoked_at__isnull=True),
                fields=("employee",),
                name="core_cross_mgr_one_active_per_employee",
            ),
        ),
    ]
