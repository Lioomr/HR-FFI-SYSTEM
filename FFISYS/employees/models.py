import uuid
from django.db import models
from django.conf import settings


class Employee(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    # Core identity
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100)

    # Link to User (login account)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="employee_profile",
    )

    # Employment info
    department = models.ForeignKey(
        "organization.Department",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )

    job_title = models.CharField(max_length=100, blank=True)
    employment_type = models.CharField(max_length=50, default="FULL_TIME")
    status = models.CharField(max_length=50, default="ACTIVE")

    hire_date = models.DateField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # 🔒 DOMAIN RULE ENFORCEMENT
    def save(self, *args, **kwargs):
        if self.user and self.user.role != "EMPLOYEE":
            raise ValueError(
                "Only users with role EMPLOYEE can be linked to an employee."
            )
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.first_name} {self.last_name}"
