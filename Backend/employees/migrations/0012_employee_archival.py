import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("employees", "0011_employeedocument"),
    ]

    operations = [
        migrations.AddField(
            model_name="employeeprofile",
            name="is_archived",
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="archived_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="archive_reason",
            field=models.CharField(
                blank=True,
                choices=[
                    ("FIRED", "Fired"),
                    ("RESIGNED", "Resigned"),
                    ("RETIRED", "Retired"),
                    ("END_OF_CONTRACT", "End of contract"),
                    ("DECEASED", "Deceased"),
                    ("OTHER", "Other"),
                ],
                max_length=30,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="archived_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="employee_profiles_archived",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="employeedeletionrequest",
            name="archive_reason",
            field=models.CharField(
                choices=[
                    ("FIRED", "Fired"),
                    ("RESIGNED", "Resigned"),
                    ("RETIRED", "Retired"),
                    ("END_OF_CONTRACT", "End of contract"),
                    ("DECEASED", "Deceased"),
                    ("OTHER", "Other"),
                ],
                default="OTHER",
                max_length=30,
            ),
        ),
    ]
