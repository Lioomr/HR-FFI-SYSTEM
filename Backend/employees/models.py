from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _


class EmployeeProfile(models.Model):
    class EmploymentStatus(models.TextChoices):
        ACTIVE = "ACTIVE", _("Active")
        SUSPENDED = "SUSPENDED", _("Suspended")
        TERMINATED = "TERMINATED", _("Terminated")

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="employee_profile",
        help_text=_("Linked user account. Immutable after creation.")
    )

    employee_id = models.CharField(
        max_length=20,
        unique=True,
        editable=False,
        help_text=_("Unique employee identifier (e.g. EMP-00123). Generated automatically.")
    )

    department = models.CharField(
        max_length=100,
        help_text=_("Department name (Phase 2 MVP: simple text).")
    )
    job_title = models.CharField(max_length=100)
    hire_date = models.DateField()

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
        return f"{self.employee_id} - {self.user.email}"
