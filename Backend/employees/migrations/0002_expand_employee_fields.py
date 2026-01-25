from django.db import migrations, models
import django.db.models.deletion
from django.conf import settings


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0001_initial"),
        ("hr_reference", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterField(
            model_name="employeeprofile",
            name="user",
            field=models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="employee_profile", to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="full_name",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="employee_number",
            field=models.CharField(blank=True, max_length=50),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="nationality",
            field=models.CharField(blank=True, max_length=100),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="passport_no",
            field=models.CharField(blank=True, max_length=50),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="passport_expiry",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="national_id",
            field=models.CharField(blank=True, max_length=50),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="id_expiry",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="date_of_birth",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="mobile",
            field=models.CharField(blank=True, max_length=50),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="department_ref",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="employees", to="hr_reference.department"),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="position_ref",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="employees", to="hr_reference.position"),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="task_group_ref",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="employees", to="hr_reference.taskgroup"),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="sponsor_ref",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="employees", to="hr_reference.sponsor"),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="job_offer",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="contract_date",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="contract_expiry",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="allowed_overtime",
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="health_card",
            field=models.CharField(blank=True, max_length=100),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="health_card_expiry",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="basic_salary",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="transportation_allowance",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="accommodation_allowance",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="telephone_allowance",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="petrol_allowance",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="other_allowance",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True),
        ),
        migrations.AddField(
            model_name="employeeprofile",
            name="total_salary",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True),
        ),
        migrations.AlterField(
            model_name="employeeprofile",
            name="department",
            field=models.CharField(blank=True, max_length=100),
        ),
        migrations.AlterField(
            model_name="employeeprofile",
            name="job_title",
            field=models.CharField(blank=True, max_length=100),
        ),
        migrations.AlterField(
            model_name="employeeprofile",
            name="hire_date",
            field=models.DateField(blank=True, null=True),
        ),
    ]
