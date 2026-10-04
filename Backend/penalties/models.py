from django.db import models
from django.db.models import Q

from employees.storage import PrivateUploadStorage


class PenaltyCatalog(models.Model):
    class Period(models.TextChoices):
        MONTHLY = "monthly", "Monthly"
        CONTRACT_YEAR = "contract_year", "Contract year"
        CUMULATIVE = "cumulative", "Cumulative"

    code = models.CharField(max_length=8, unique=True)
    category = models.CharField(max_length=24)
    recurrence_group = models.CharField(max_length=24)
    title_en = models.TextField()
    title_ar = models.TextField()
    description_en = models.TextField(blank=True)
    description_ar = models.TextField(blank=True)
    count_period = models.CharField(max_length=24, choices=Period.choices)
    levels = models.JSONField(default=list)
    source_page = models.PositiveSmallIntegerField()
    source_row = models.PositiveSmallIntegerField()
    automatic = models.BooleanField(default=False)
    extra_wage_deduction = models.CharField(max_length=32, blank=True)

    class Meta:
        ordering = ["category", "source_row"]
        constraints = [models.UniqueConstraint(fields=["category", "source_row"], name="unique_penalty_source_row")]


class PenaltyRecord(models.Model):
    class Status(models.TextChoices):
        PENDING_HR_MARK = "pending_hr_mark", "Pending HR mark"
        ISSUED = "issued", "Issued"
        DISPUTED = "disputed", "Disputed"
        WAIVED = "waived", "Waived"
        APPLIED = "applied", "Applied"

    class Source(models.TextChoices):
        AUTOMATIC = "automatic", "Automatic attendance"
        HR = "hr", "HR"

    class Automation(models.TextChoices):
        # Not part of the printed schedule: W01/W02/W07 occurrences 1-3 are issued
        # by the system as warnings (services.AUTO_WARNING_ROWS).
        NONE = "", "None"
        WARNING_PENDING = "warning_pending", "Automatic warning pending"
        WARNING_ISSUED = "warning_issued", "Automatic warning issued"

    company = models.ForeignKey("organization.OrganizationNode", on_delete=models.PROTECT)
    employee_profile = models.ForeignKey("employees.EmployeeProfile", on_delete=models.PROTECT)
    catalog = models.ForeignKey(PenaltyCatalog, on_delete=models.PROTECT)
    occurred_on = models.DateField()
    occurrence_number = models.PositiveIntegerField()
    action = models.CharField(max_length=40)
    amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    extra_wage_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_deduction_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    status = models.CharField(max_length=24, choices=Status.choices)
    source = models.CharField(max_length=16, choices=Source.choices)
    attendance_result = models.ForeignKey(
        "attendance.AttendanceDailyResult", null=True, blank=True, on_delete=models.PROTECT
    )
    attendance_record = models.ForeignKey(
        "attendance.AttendanceRecord", null=True, blank=True, on_delete=models.PROTECT
    )
    source_kind = models.CharField(max_length=24, blank=True)
    automation = models.CharField(max_length=24, choices=Automation.choices, default="", blank=True, db_index=True)
    evidence = models.JSONField(default=dict)
    note = models.TextField(blank=True)
    employee_response = models.JSONField(null=True, blank=True)
    resolution = models.JSONField(null=True, blank=True)
    created_by = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-occurred_on", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["attendance_result", "source_kind"],
                condition=Q(attendance_result__isnull=False),
                name="unique_penalty_attendance_result_kind",
            ),
            models.UniqueConstraint(
                fields=["attendance_record", "source_kind"],
                condition=Q(attendance_record__isnull=False),
                name="unique_penalty_attendance_record_kind",
            ),
        ]
        indexes = [models.Index(fields=["company", "occurred_on", "status"], name="penalty_company_date_status")]


class PenaltyDeduction(models.Model):
    class Status(models.TextChoices):
        PENDING_REVIEW = "pending_review", "Pending review"
        APPROVED = "approved", "Approved"
        HELD = "held", "Held"
        CLAIMED = "claimed", "Claimed by draft"
        APPLIED = "applied", "Applied"
        VOID = "void", "Void"

    penalty = models.OneToOneField(PenaltyRecord, on_delete=models.PROTECT, related_name="deduction")
    company = models.ForeignKey("organization.OrganizationNode", on_delete=models.PROTECT)
    employee_profile = models.ForeignKey("employees.EmployeeProfile", on_delete=models.PROTECT)
    intended_year = models.PositiveIntegerField()
    intended_month = models.PositiveIntegerField()
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    claimed_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.PENDING_REVIEW)
    payroll_run = models.ForeignKey("payroll.PayrollRun", null=True, blank=True, on_delete=models.PROTECT)
    payroll_run_item = models.ForeignKey("payroll.PayrollRunItem", null=True, blank=True, on_delete=models.PROTECT)
    review_note = models.TextField(blank=True)
    reviewed_by = models.ForeignKey("accounts.User", null=True, blank=True, on_delete=models.PROTECT)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["company", "status", "intended_year", "intended_month"], name="penalty_due_idx")
        ]


def penalty_warning_notice_upload_to(instance, filename):
    return f"penalty_warning_notices/{instance.company_id}/{instance.reference_number}.pdf"


class PenaltyWarningNotice(models.Model):
    """The private PDF letter for one automatically issued warning."""

    class DeliveryStatus(models.TextChoices):
        SCHEDULED = "scheduled", "Scheduled"
        SENT = "sent", "Sent"
        FAILED = "failed", "Failed"
        SKIPPED = "skipped", "Skipped"

    penalty = models.OneToOneField(PenaltyRecord, on_delete=models.PROTECT, related_name="warning_notice")
    company = models.ForeignKey(
        "organization.OrganizationNode", on_delete=models.PROTECT, related_name="penalty_warning_notices"
    )
    employee_profile = models.ForeignKey(
        "employees.EmployeeProfile", on_delete=models.PROTECT, related_name="penalty_warning_notices"
    )
    reference_number = models.CharField(max_length=64, unique=True)
    template_name = models.CharField(max_length=128)
    template_version = models.PositiveIntegerField()
    document = models.FileField(storage=PrivateUploadStorage(), upload_to=penalty_warning_notice_upload_to, blank=True)
    notification = models.ForeignKey(
        "in_app_notifications.Notification",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="penalty_warning_notices",
    )
    delivery_status = models.CharField(max_length=16, choices=DeliveryStatus.choices, default=DeliveryStatus.SCHEDULED)
    delivery_message = models.CharField(max_length=255, blank=True)
    issued_at = models.DateTimeField(auto_now_add=True)
