from django.db import models
from django.conf import settings
from django.utils.translation import gettext_lazy as _

class AttendanceRecord(models.Model):
    class Status(models.TextChoices):
        PRESENT = "PRESENT", _("Present")
        ABSENT = "ABSENT", _("Absent")
        LATE = "LATE", _("Late")

    class Source(models.TextChoices):
        EMPLOYEE = "EMPLOYEE", _("Employee")
        HR = "HR", _("HR")
        SYSTEM = "SYSTEM", _("System")

    employee_profile = models.ForeignKey(
        "employees.EmployeeProfile",
        on_delete=models.PROTECT,
        related_name="attendance_records"
    )
    date = models.DateField()
    check_in_at = models.DateTimeField(null=True, blank=True)
    check_out_at = models.DateTimeField(null=True, blank=True)
    
    status = models.CharField(
        max_length=10,
        choices=Status.choices,
        default=Status.ABSENT
    )
    
    source = models.CharField(
        max_length=10,
        choices=Source.choices,
        default=Source.SYSTEM
    )
    
    is_overridden = models.BooleanField(default=False)
    override_reason = models.TextField(null=True, blank=True)
    notes = models.TextField(null=True, blank=True)
    
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="attendance_created"
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="attendance_updated"
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["employee_profile", "date"], name="unique_attendance_per_day")
        ]
        ordering = ["-date"]

    def __str__(self):
        return f"{self.employee_profile} - {self.date} ({self.status})"
