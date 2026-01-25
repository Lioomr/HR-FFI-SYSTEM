from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _

from hr_reference.models import Department, Position, TaskGroup, Sponsor


class EmployeeProfile(models.Model):
    class EmploymentStatus(models.TextChoices):
        ACTIVE = "ACTIVE", _("Active")
        SUSPENDED = "SUSPENDED", _("Suspended")
        TERMINATED = "TERMINATED", _("Terminated")

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="employee_profile",
        null=True,
        blank=True,
        help_text=_("Linked user account. Optional.")
    )

    employee_id = models.CharField(
        max_length=20,
        unique=True,
        editable=False,
        help_text=_("Unique employee identifier (e.g. EMP-00123). Generated automatically.")
    )

    full_name = models.CharField(max_length=255, blank=True)
    employee_number = models.CharField(max_length=50, blank=True)
    nationality = models.CharField(max_length=100, blank=True)
    passport_no = models.CharField(max_length=50, blank=True)
    passport_expiry = models.DateField(null=True, blank=True)
    national_id = models.CharField(max_length=50, blank=True)
    id_expiry = models.DateField(null=True, blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    mobile = models.CharField(max_length=50, blank=True)

    department = models.CharField(max_length=100, blank=True)
    job_title = models.CharField(max_length=100, blank=True)
    hire_date = models.DateField(null=True, blank=True)

    department_ref = models.ForeignKey(
        Department,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="employees",
    )
    position_ref = models.ForeignKey(
        Position,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="employees",
    )
    task_group_ref = models.ForeignKey(
        TaskGroup,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="employees",
    )
    sponsor_ref = models.ForeignKey(
        Sponsor,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="employees",
    )

    job_offer = models.CharField(max_length=255, blank=True)
    contract_date = models.DateField(null=True, blank=True)
    contract_expiry = models.DateField(null=True, blank=True)
    allowed_overtime = models.IntegerField(null=True, blank=True)

    health_card = models.CharField(max_length=100, blank=True)
    health_card_expiry = models.DateField(null=True, blank=True)

    basic_salary = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    transportation_allowance = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    accommodation_allowance = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    telephone_allowance = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    petrol_allowance = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    other_allowance = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    total_salary = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    employment_status = models.CharField(
        max_length=20,
        choices=EmploymentStatus.choices,
        default=EmploymentStatus.ACTIVE,
        help_text=_("Current employment status.")
    )

    # Manager is a direct link to a User, not another EmployeeProfile (per specs)
    manager = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="managed_employees",
        help_text=_("Direct manager (User). Optional.")
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["employee_id"]
        verbose_name = _("Employee Profile")
        verbose_name_plural = _("Employee Profiles")

    def __str__(self):
        email = self.user.email if self.user else ""
        return f"{self.employee_id} - {email}".strip()
