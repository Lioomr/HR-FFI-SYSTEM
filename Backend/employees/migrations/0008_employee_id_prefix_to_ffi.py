from django.db import migrations, models


def migrate_employee_ids_to_ffi(apps, schema_editor):
    EmployeeProfile = apps.get_model("employees", "EmployeeProfile")

    for profile in EmployeeProfile.objects.filter(employee_id__startswith="EMP-").only("id", "employee_id").iterator():
        EmployeeProfile.objects.filter(pk=profile.pk).update(employee_id=f"FFI-{profile.employee_id[4:]}")


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0007_backfill_hr_aligned_employee_fields"),
    ]

    operations = [
        migrations.RunPython(migrate_employee_ids_to_ffi, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="employeeprofile",
            name="employee_id",
            field=models.CharField(
                editable=False,
                help_text="Unique employee identifier (e.g. FFI-00123). Generated automatically.",
                max_length=20,
                unique=True,
            ),
        ),
    ]
