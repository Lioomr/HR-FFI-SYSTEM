import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0027_contract_decision_cancelled"),
        ("organization", "0005_organizationnode_address_organizationnode_email_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="EmployeeIdAlias",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("old_employee_id", models.CharField(max_length=20, unique=True)),
                ("new_employee_id", models.CharField(max_length=20)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="employee_id_aliases",
                        to="organization.organizationnode",
                    ),
                ),
                (
                    "employee_profile",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="id_aliases",
                        to="employees.employeeprofile",
                    ),
                ),
            ],
        ),
    ]
