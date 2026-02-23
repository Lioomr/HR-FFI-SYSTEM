from django.db import migrations


def backfill_employeeprofile_fields(apps, schema_editor):
    EmployeeProfile = apps.get_model("employees", "EmployeeProfile")

    user_to_profile = {}
    for profile in EmployeeProfile.objects.exclude(user=None).only("id", "user_id"):
        user_to_profile[profile.user_id] = profile.id

    for profile in EmployeeProfile.objects.all().iterator():
        update_fields = []

        if not profile.full_name_en and profile.full_name:
            profile.full_name_en = profile.full_name
            update_fields.append("full_name_en")
        if not profile.nationality_en and profile.nationality:
            profile.nationality_en = profile.nationality
            update_fields.append("nationality_en")
        if not profile.department_name_en and profile.department:
            profile.department_name_en = profile.department
            update_fields.append("department_name_en")
        if not profile.job_title_en and profile.job_title:
            profile.job_title_en = profile.job_title
            update_fields.append("job_title_en")

        if profile.manager_id and not profile.manager_profile_id:
            manager_profile_id = user_to_profile.get(profile.manager_id)
            if manager_profile_id and manager_profile_id != profile.id:
                profile.manager_profile_id = manager_profile_id
                update_fields.append("manager_profile")

        if update_fields:
            profile.save(update_fields=update_fields)


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0006_employeeprofile_contract_date_raw_and_more"),
    ]

    operations = [
        migrations.RunPython(backfill_employeeprofile_fields, migrations.RunPython.noop),
    ]
