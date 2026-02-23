from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _
from employees.storage import PrivateUploadStorage


class LeaveType(models.Model):
    name = models.CharField(max_length=50, unique=True)
    code = models.CharField(max_length=20, unique=True, blank=True, help_text=_("Optional code (e.g. ANNUAL, SICK)"))
    is_paid = models.BooleanField(default=True)
    requires_attachment = models.BooleanField(default=False)
    requires_ceo_approval = models.BooleanField(
        default=False, help_text=_("If true, requires CEO approval after HR.")
    )
    is_active = models.BooleanField(default=True)

    # Quota and Carry-over (Phase 2.4)
    annual_quota = models.DecimalField(
        max_digits=5, decimal_places=2, default=0.0, help_text=_("Annual quota in days (e.g. 21.0)")
    )
    allow_carry_over = models.BooleanField(
        default=False, help_text=_("If true, unused balance carries over to next year")
    )
    max_carry_over = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        help_text=_("Max days to carry over. If null, unlimited."),
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name


class LeaveRequest(models.Model):
    class RequestStatus(models.TextChoices):
        SUBMITTED = "submitted", _("Submitted")
        PENDING_MANAGER = "pending_manager", _("Pending Manager")
        PENDING_HR = "pending_hr", _("Pending HR")
        PENDING_CEO = "pending_ceo", _("Pending CEO")
        APPROVED = "approved", _("Approved")
        REJECTED = "rejected", _("Rejected")
        CANCELLED = "cancelled", _("Cancelled")

    employee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="leave_requests",
        help_text=_("The employee requesting leave."),
    )
    leave_type = models.ForeignKey(LeaveType, on_delete=models.PROTECT, related_name="requests")
    start_date = models.DateField()
    end_date = models.DateField()
    reason = models.TextField(blank=True)
    document = models.FileField(
        storage=PrivateUploadStorage(),
        upload_to="leave_documents/",
        null=True,
        blank=True,
        help_text=_("Supporting document for leave request."),
    )

    status = models.CharField(max_length=20, choices=RequestStatus.choices, default=RequestStatus.SUBMITTED)

    # Manager Decision
    manager_decision_at = models.DateTimeField(null=True, blank=True)
    manager_decision_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="manager_decided_leaves",
    )
    manager_decision_note = models.TextField(blank=True, help_text=_("Manager's note."))

    # CEO Decision
    ceo_decision_at = models.DateTimeField(null=True, blank=True)
    ceo_decision_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ceo_decided_leaves",
    )
    ceo_decision_note = models.TextField(blank=True, help_text=_("CEO's decision note."))

    # HR Decision
    # and maybe deprecate `decision_reason` or map it.

    hr_decision_note = models.TextField(blank=True, help_text=_("HR's decision note."))  # Explicit new field

    # Existing fields used for HR/Final decision
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="hr_decided_leaves",
        help_text=_("HR user who made the final decision."),
    )
    decided_at = models.DateTimeField(null=True, blank=True, help_text=_("Time of final (HR) decision."))

    # Existing generic field, assume it maps to HR reason for now unless we migrate it.
    decision_reason = models.TextField(blank=True, help_text=_("Reason for rejection or approval note (Legacy/HR)."))

    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = _("Leave Request")
        verbose_name_plural = _("Leave Requests")

    def __str__(self):
        return f"{self.employee.email} - {self.leave_type.code} ({self.status})"


class LeaveBalanceSnapshot(models.Model):
    employee_profile = models.ForeignKey(
        "employees.EmployeeProfile", on_delete=models.CASCADE, related_name="leave_balance_snapshots"
    )
    leave_type = models.ForeignKey(LeaveType, on_delete=models.CASCADE, related_name="snapshots")
    year = models.IntegerField()

    opening_balance = models.DecimalField(max_digits=6, decimal_places=2, default=0.0)
    used = models.DecimalField(max_digits=6, decimal_places=2, default=0.0)
    remaining = models.DecimalField(max_digits=6, decimal_places=2, default=0.0)

    calculated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["employee_profile", "leave_type", "year"], name="unique_balance_snapshot")
        ]
        verbose_name = _("Leave Balance Snapshot")
        verbose_name_plural = _("Leave Balance Snapshots")

    def __str__(self):
        return f"{self.employee_profile} - {self.leave_type} ({self.year})"


class LeaveBalanceAdjustment(models.Model):
    employee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="leave_adjustments",
        help_text=_("The employee whose balance is adjusted."),
    )
    leave_type = models.ForeignKey(LeaveType, on_delete=models.CASCADE, related_name="adjustments")
    adjustment_days = models.DecimalField(
        max_digits=5, decimal_places=2, help_text=_("Number of days to add (positive) or deduct (negative).")
    )
    reason = models.TextField(help_text=_("Reason for adjustment."))
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="created_balance_adjustments"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.employee} - {self.leave_type} ({self.adjustment_days})"
