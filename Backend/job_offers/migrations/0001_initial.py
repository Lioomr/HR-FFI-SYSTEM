import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ("employees", "0014_alter_employeeprofile_employment_status"),
        ("invites", "0005_invite_employee_profile"),
        ("organization", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="JobOffer",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("candidate_full_name", models.CharField(max_length=255)),
                ("candidate_email", models.EmailField(blank=True, max_length=254)),
                ("candidate_phone_number", models.CharField(blank=True, max_length=32)),
                ("nationality", models.CharField(blank=True, max_length=100)),
                ("id_passport_iqama_number", models.CharField(blank=True, max_length=100)),
                ("position_title", models.CharField(max_length=150)),
                ("classification", models.CharField(blank=True, max_length=100)),
                ("grade", models.CharField(blank=True, max_length=100)),
                ("department", models.CharField(blank=True, max_length=150)),
                ("location", models.CharField(blank=True, max_length=150)),
                ("basic_salary", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("housing_allowance", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("transportation_allowance", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("other_allowance", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("total_salary_package", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("vacation", models.CharField(blank=True, max_length=255)),
                ("tickets", models.CharField(blank=True, max_length=255)),
                ("contract_status", models.CharField(blank=True, max_length=100)),
                ("contract_type", models.CharField(blank=True, max_length=100)),
                ("contract_duration", models.CharField(blank=True, max_length=100)),
                ("medical_insurance", models.CharField(blank=True, max_length=255)),
                ("offer_date", models.DateField(default=django.utils.timezone.localdate)),
                ("expiry_date", models.DateField()),
                ("reference_number", models.CharField(max_length=100)),
                ("hr_signer_name", models.CharField(blank=True, max_length=255)),
                ("hr_signer_title", models.CharField(blank=True, max_length=150)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("draft", "Draft"),
                            ("sent", "Sent"),
                            ("accepted", "Accepted"),
                            ("rejected", "Rejected"),
                            ("expired", "Expired"),
                            ("cancelled", "Cancelled"),
                        ],
                        db_index=True,
                        default="draft",
                        max_length=16,
                    ),
                ),
                ("response_token", models.CharField(blank=True, db_index=True, max_length=64, null=True, unique=True)),
                ("sent_at", models.DateTimeField(blank=True, null=True)),
                ("accepted_at", models.DateTimeField(blank=True, null=True)),
                ("rejected_at", models.DateTimeField(blank=True, null=True)),
                ("cancelled_at", models.DateTimeField(blank=True, null=True)),
                ("rejection_reason", models.TextField(blank=True)),
                ("delivery_metadata", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "account_invite",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="job_offers",
                        to="invites.invite",
                    ),
                ),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="job_offers",
                        to="organization.organizationnode",
                    ),
                ),
                (
                    "created_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="created_job_offers",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "employee_profile",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="job_offers",
                        to="employees.employeeprofile",
                    ),
                ),
                (
                    "updated_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="updated_job_offers",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-id"],
                "indexes": [
                    models.Index(fields=["company", "status"], name="job_offers__company_03d0e1_idx"),
                    models.Index(fields=["company", "expiry_date"], name="job_offers__company_027744_idx"),
                ],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("company", "reference_number"), name="unique_job_offer_reference_company"
                    )
                ],
            },
        ),
    ]
