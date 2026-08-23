from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("attendance", "0007_attendancerecord_biotime_emp_code_and_more")]

    operations = [
        migrations.CreateModel(
            name="BioTimeDeviceEmployee",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("emp_code", models.CharField(max_length=50, unique=True)),
                ("first_name", models.CharField(blank=True, default="", max_length=100)),
                ("last_name", models.CharField(blank=True, default="", max_length=100)),
                ("department", models.CharField(blank=True, default="", max_length=200)),
                ("last_seen_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ["emp_code"]},
        ),
    ]
