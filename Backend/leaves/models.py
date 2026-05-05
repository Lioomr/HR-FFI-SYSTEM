from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _

from employees.storage import PrivateUploadStorage
from organization.models import OrganizationNode


class LeaveType(models.Model):
    company = models.ForeignKey(
        OrganizationNode,
        on_delete=models.PROTECT,
        related_name="leave_types",
        null=True,
        blank=True,
    )
    name = models.CharField(max_length=50)
    code = models.CharField(max_length=20, blank=True, help_text=_("Optional code (e.g. ANNUAL, SICK)"))
    is_paid = models.BooleanField(default=True)
    requires_attachment = models.BooleanField(default=False)
    requires_ceo_approval = models.BooleanField(default=False, help_text=_("If true, requires CEO approval after HR."))
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

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["company", "name"], name="uniq_leave_type_company_name"),
            models.UniqueConstraint(fields=["company", "code"], name="uniq_leave_type_company_code"),
        ]


class LeaveRequest(models.Model):
    class RequestSource(models.TextChoices):
        EMPLOYEE = "employee", _("Employee")
        HR_MANUAL = "hr_manual", _("HR Manual")

    class RequestStatus(models.TextChoices):
        SUBMITTED = "submitted", _("Submitted")
        PENDING_DELEGATE = "pending_delegate", _("Pending Alternative Employee")
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
        null=True,
        blank=True,
        help_text=_("The employee requesting leave."),
    )
    company = models.ForeignKey(
        OrganizationNode,
        on_delete=models.PROTECT,
        related_name="leave_requests",
        null=True,
        blank=True,
    )
    employee_profile = models.ForeignKey(
        "employees.EmployeeProfile",
        on_delete=models.CASCADE,
        related_name="leave_requests",
        null=True,
        blank=True,
        help_text=_("Employee profile for requests recorded without a linked user account."),
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
    source = models.CharField(max_length=20, choices=RequestSource.choices, default=RequestSource.EMPLOYEE)
    manual_entry_reason = models.TextField(blank=True, help_text=_("Reason entered by HR for manual records."))
    source_document_ref = models.CharField(
        max_length=255,
        blank=True,
        help_text=_("Reference to source document for manual HR entries."),
    )
    entered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="hr_entered_leaves",
        help_text=_("HR user who entered this record manually."),
    )

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

    # Travel & leave details
    other_leave_description = models.CharField(max_length=255, blank=True)
    date_of_rejoin = models.DateField(null=True, blank=True)
    po_box = models.CharField(max_length=100, blank=True)
    full_address = models.TextField(blank=True)
    airplane_ticket_payer = models.CharField(
        max_length=20,
        blank=True,
        choices=[("company", _("Company")), ("employee", _("Employee"))],
        help_text=_("Who pays for the airplane ticket."),
    )
    airplane_ticket_address = models.CharField(max_length=255, blank=True)

    # Work delegation
    delegated_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="delegated_leave_requests",
        help_text=_("Employee delegated to handle duties during leave."),
    )
    delegation_note = models.TextField(blank=True)
    delegate_decision_at = models.DateTimeField(null=True, blank=True)
    delegate_decision_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="delegate_decided_leaves",
    )
    delegate_decision_note = models.TextField(blank=True, help_text=_("Delegated employee's decision note."))

    is_active = models.BooleanField(default=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="deleted_leave_requests",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = _("Leave Request")
        verbose_name_plural = _("Leave Requests")

    def __str__(self):
        employee_label = "-"
        if self.employee:
            employee_label = self.employee.email
        elif self.employee_profile:
            employee_label = self.employee_profile.full_name or self.employee_profile.employee_id
        return f"{employee_label} - {self.leave_type.code} ({self.status})"


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
        null=True,
        blank=True,
        help_text=_("The employee whose balance is adjusted."),
    )
    company = models.ForeignKey(
        OrganizationNode,
        on_delete=models.PROTECT,
        related_name="leave_balance_adjustments",
        null=True,
        blank=True,
    )
    employee_profile = models.ForeignKey(
        "employees.EmployeeProfile",
        on_delete=models.CASCADE,
        related_name="leave_adjustments",
        null=True,
        blank=True,
        help_text=_("Employee profile for adjustments recorded without a linked user account."),
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
        employee_label = self.employee or self.employee_profile or "-"
        return f"{employee_label} - {self.leave_type} ({self.adjustment_days})"
