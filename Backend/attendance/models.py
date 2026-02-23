from django.db import models
from django.conf import settings
from django.utils.translation import gettext_lazy as _


class AttendanceRecord(models.Model):
    class Status(models.TextChoices):
        PENDING_MANAGER = "PENDING_MGR", _("Pending Manager")
        PENDING_HR = "PENDING_HR", _("Pending HR")
        PRESENT = "PRESENT", _("Present")
        ABSENT = "ABSENT", _("Absent")
        LATE = "LATE", _("Late")
        REJECTED = "REJECTED", _("Rejected")
        # Legacy/Fallback
        PENDING = "PENDING", _("Pending (Legacy)")

    class Source(models.TextChoices):
        EMPLOYEE = "EMPLOYEE", _("Employee")
        HR = "HR", _("HR")
        SYSTEM = "SYSTEM", _("System")

    employee_profile = models.ForeignKey(
        "employees.EmployeeProfile", on_delete=models.PROTECT, related_name="attendance_records"
    )
    date = models.DateField()
    check_in_at = models.DateTimeField(null=True, blank=True)
    check_out_at = models.DateTimeField(null=True, blank=True)

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)

    source = models.CharField(max_length=10, choices=Source.choices, default=Source.SYSTEM)

    # Manager Decision
    manager_decision_at = models.DateTimeField(null=True, blank=True)
    manager_decision_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="manager_decided_attendance",
    )
    manager_decision_note = models.TextField(blank=True, help_text=_("Manager's note."))

    is_overridden = models.BooleanField(default=False)
    override_reason = models.TextField(null=True, blank=True)
    notes = models.TextField(null=True, blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="attendance_created"
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="attendance_updated"
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["employee_profile", "date"], name="unique_attendance_per_day")]
        ordering = ["-date"]

    def __str__(self):
        return f"{self.employee_profile} - {self.date} ({self.status})"
