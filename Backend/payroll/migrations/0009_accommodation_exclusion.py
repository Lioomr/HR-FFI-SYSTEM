from django.db import migrations


def add_exclusion(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    schema_editor.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")
    schema_editor.execute("""
        ALTER TABLE payroll_accommodationassignment
        ADD CONSTRAINT payroll_assignment_no_overlap
        EXCLUDE USING gist (
            employee_profile_id WITH =,
            daterange(start_date, end_date, '[]') WITH &&
        ) WHERE (is_active)
    """)


def remove_exclusion(apps, schema_editor):
    if schema_editor.connection.vendor == "postgresql":
        schema_editor.execute(
            "ALTER TABLE payroll_accommodationassignment DROP CONSTRAINT IF EXISTS payroll_assignment_no_overlap"
        )


class Migration(migrations.Migration):
    dependencies = [("payroll", "0008_backfill_legacy_payroll")]
    operations = [migrations.RunPython(add_exclusion, remove_exclusion)]
