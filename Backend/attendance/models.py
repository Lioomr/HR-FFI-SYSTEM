from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils.translation import gettext_lazy as _

from employees.storage import PrivateUploadStorage


def attendance_late_notice_upload_to(instance, filename):
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else "pdf"
    return f"attendance_late_notices/{instance.company_id}/{instance.reference_number}.{extension}"


class AttendanceRecord(models.Model):
    class Status(models.TextChoices):
        PENDING_MANAGER = "PENDING_MGR", _("Pending Manager")
        PENDING_HR = "PENDING_HR", _("Pending HR")
        PENDING_CEO = "PENDING_CEO", _("Pending CEO")
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
    biotime_emp_code = models.CharField(max_length=50, blank=True, default="")
    biotime_terminal_sn = models.CharField(max_length=100, blank=True, default="")

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

    # CEO Decision
    ceo_decision_at = models.DateTimeField(null=True, blank=True)
    ceo_decision_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ceo_decided_attendance",
    )
    ceo_decision_note = models.TextField(blank=True, help_text=_("CEO's decision note."))

    is_overridden = models.BooleanField(default=False)
    override_reason = models.TextField(null=True, blank=True)
    notes = models.TextField(null=True, blank=True)

    # True when the check-in time was past the company late cutoff at the moment
    # the record was created. Lets approvers preserve a LATE outcome through the
    # pending -> approved workflow for employee self check-ins.
    is_late_flagged = models.BooleanField(default=False)
    # A record created by the new raw-punch projection.  Historical rows stay
    # untouched; this marker lets the compatibility layer update only rows it
    # owns without reinterpreting legacy HR/Exit Permission data.
    is_biotime_projection = models.BooleanField(default=False)

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
        indexes = [
            models.Index(fields=["date", "source", "status"], name="att_date_source_status_idx"),
        ]

    def __str__(self):
        return f"{self.employee_profile} - {self.date} ({self.status})"


class BioTimeRawPunch(models.Model):
    """Append-only evidence received from BioTime.

    ``deduplication_key`` is a SHA-256 value generated from the provider event
    ID when present, or from a canonical fingerprint of the otherwise stable
    event fields.  It deliberately is not scoped by date: a vendor event can be
    resent in a later sync window.
    """

    company = models.ForeignKey(
        "organization.OrganizationNode", on_delete=models.PROTECT, related_name="biotime_raw_punches"
    )
    employee_profile = models.ForeignKey(
        "employees.EmployeeProfile", on_delete=models.PROTECT, related_name="biotime_raw_punches"
    )
    attendance_date = models.DateField(db_index=True)
    occurred_at = models.DateTimeField(db_index=True)
    biotime_emp_code = models.CharField(max_length=50)
    provider_punch_id = models.CharField(max_length=128, blank=True, default="")
    deduplication_key = models.CharField(max_length=64, unique=True, editable=False)
    raw_punch_type = models.CharField(max_length=64, blank=True, default="")
    terminal_sn = models.CharField(max_length=100, blank=True, default="")
    provider_payload = models.JSONField(default=dict)
    received_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["occurred_at", "id"]
        indexes = [
            models.Index(fields=["employee_profile", "attendance_date", "occurred_at"], name="raw_punch_day_idx"),
            models.Index(fields=["company", "attendance_date"], name="raw_punch_company_day_idx"),
        ]

    def clean(self):
        super().clean()
        if self.employee_profile_id and self.company_id and self.employee_profile.company_id != self.company_id:
            raise ValidationError({"company": "Raw punch company must match the employee profile company."})

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValidationError("BioTime raw punches are immutable; create a derived event instead.")
        self.full_clean()
        return super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.biotime_emp_code} at {self.occurred_at.isoformat()}"


class NormalizedAttendanceEvent(models.Model):
    """Deterministic, replaceable interpretation of one immutable raw punch."""

    class EventType(models.TextChoices):
        CHECK_IN = "CHECK_IN", _("Check in")
        CHECK_OUT = "CHECK_OUT", _("Check out")
        BREAK_OUT = "BREAK_OUT", _("Break out")
        BREAK_IN = "BREAK_IN", _("Break in")

    raw_punch = models.OneToOneField(BioTimeRawPunch, on_delete=models.CASCADE, related_name="normalized_event")
    employee_profile = models.ForeignKey(
        "employees.EmployeeProfile", on_delete=models.PROTECT, related_name="normalized_attendance_events"
    )
    attendance_date = models.DateField(db_index=True)
    occurred_at = models.DateTimeField(db_index=True)
    event_type = models.CharField(max_length=16, choices=EventType.choices)
    sequence = models.PositiveIntegerField()
    used_fallback = models.BooleanField(default=False)
    normalized_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["occurred_at", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["employee_profile", "attendance_date", "sequence"], name="unique_normalized_attendance_sequence"
            )
        ]
        indexes = [models.Index(fields=["employee_profile", "attendance_date"], name="norm_event_day_idx")]


class AttendanceAdjustment(models.Model):
    """Auditable future input to a calculated result, never a punch rewrite."""

    class Kind(models.TextChoices):
        LATE_PERMISSION = "late_permission", _("Late Permission")
        DURING_SHIFT_PERMISSION = "during_shift_permission", _("During Shift Permission")
        EXIT_PERMISSION = "exit_permission", _("Exit Permission")

    employee_profile = models.ForeignKey(
        "employees.EmployeeProfile", on_delete=models.PROTECT, related_name="attendance_adjustments"
    )
    company = models.ForeignKey(
        "organization.OrganizationNode", on_delete=models.PROTECT, related_name="attendance_adjustments"
    )
    date = models.DateField()
    kind = models.CharField(max_length=32, choices=Kind.choices, default=Kind.EXIT_PERMISSION)
    # Deliberately a stable reference rather than a FK to avoid a migration
    # dependency cycle between attendance and permission_requests.
    source_key = models.CharField(max_length=64, blank=True, default="")
    effective_date = models.DateField(null=True, blank=True)
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)
    approved_minutes = models.PositiveIntegerField(default=0)
    reason = models.TextField()
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="attendance_adjustments_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["date", "id"]
        indexes = [
            models.Index(fields=["employee_profile", "date"], name="att_adjustment_day_idx"),
            models.Index(fields=["kind", "source_key"], name="att_adjustment_source_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["kind", "source_key"],
                condition=~Q(source_key=""),
                name="unique_att_adjustment_source",
            )
        ]

    def clean(self):
        super().clean()
        if self.employee_profile_id and self.company_id and self.employee_profile.company_id != self.company_id:
            raise ValidationError({"company": "Adjustment company must match the employee profile company."})


class AttendanceDailyResult(models.Model):
    """Final calculated attendance projection for one employee work date."""

    employee_profile = models.ForeignKey(
        "employees.EmployeeProfile", on_delete=models.PROTECT, related_name="attendance_daily_results"
    )
    company = models.ForeignKey(
        "organization.OrganizationNode", on_delete=models.PROTECT, related_name="attendance_daily_results"
    )
    date = models.DateField()
    shift_start_at = models.DateTimeField()
    shift_end_at = models.DateTimeField()
    scheduled_minutes = models.PositiveIntegerField(default=0)
    first_check_in_at = models.DateTimeField(null=True, blank=True)
    final_check_out_at = models.DateTimeField(null=True, blank=True)
    physical_work_minutes = models.PositiveIntegerField(default=0)
    unpaid_break_minutes = models.PositiveIntegerField(default=0)
    approved_permission_minutes = models.PositiveIntegerField(default=0)
    accounted_attendance_minutes = models.PositiveIntegerField(default=0)
    missing_minutes = models.PositiveIntegerField(default=0)
    status_input = models.CharField(max_length=20, default=AttendanceRecord.Status.PRESENT)
    calculation_inputs = models.JSONField(default=dict)
    calculated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["employee_profile", "date"], name="unique_attendance_daily_result")
        ]
        indexes = [models.Index(fields=["company", "date"], name="att_result_company_day_idx")]


class AttendanceGraceUse(models.Model):
    """Deterministic monthly-grace decision for one calculated work day."""

    employee_profile = models.ForeignKey(
        "employees.EmployeeProfile", on_delete=models.PROTECT, related_name="attendance_grace_uses"
    )
    company = models.ForeignKey("organization.OrganizationNode", on_delete=models.PROTECT)
    date = models.DateField()
    month = models.DateField(help_text="First day of the calendar month.")
    result = models.OneToOneField(AttendanceDailyResult, on_delete=models.CASCADE, related_name="grace_use")
    consumed = models.BooleanField(default=False)
    reason = models.CharField(max_length=64, default="within_grace")
    decided_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["date", "id"]
        constraints = [models.UniqueConstraint(fields=["employee_profile", "date"], name="unique_att_grace_use_day")]
        indexes = [models.Index(fields=["employee_profile", "month"], name="att_grace_month_idx")]


class AttendanceLateViolation(models.Model):
    """Auditable late-policy result.  Payroll consumes only active rows."""

    class Lifecycle(models.TextChoices):
        ACTIVE = "active", _("Active")
        VOID = "void", _("Void")
        MANUAL_REVIEW = "manual_review", _("Manual review")
        APPLIED = "applied", _("Applied to payroll")

    employee_profile = models.ForeignKey(
        "employees.EmployeeProfile", on_delete=models.PROTECT, related_name="attendance_late_violations"
    )
    company = models.ForeignKey("organization.OrganizationNode", on_delete=models.PROTECT)
    date = models.DateField()
    result = models.OneToOneField(AttendanceDailyResult, on_delete=models.PROTECT, related_name="late_violation")
    occurrence_number = models.PositiveIntegerField()
    daily_rate = models.DecimalField(max_digits=12, decimal_places=2)
    penalty_percent = models.DecimalField(max_digits=5, decimal_places=4)
    penalty_amount = models.DecimalField(max_digits=12, decimal_places=2)
    lifecycle = models.CharField(max_length=24, choices=Lifecycle.choices, default=Lifecycle.ACTIVE)
    reason = models.CharField(max_length=128, default="late_arrival")
    void_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["date", "id"]
        constraints = [models.UniqueConstraint(fields=["employee_profile", "date"], name="unique_att_late_violation_day")]
        indexes = [models.Index(fields=["company", "date", "lifecycle"], name="att_late_violation_idx")]


class AttendanceLateNotice(models.Model):
    """The single private PDF notice issued for a newly-created active late violation.

    ``level`` selects one approved template/map pair; ``template_name`` and
    ``template_version`` record exactly which pair rendered the stored document.
    Penalty and occurrence values are policy snapshots at issuance.
    """

    class DeliveryStatus(models.TextChoices):
        SCHEDULED = "scheduled", _("Scheduled")
        SENT = "sent", _("Sent")
        FAILED = "failed", _("Failed")
        SKIPPED = "skipped", _("Skipped")

    violation = models.OneToOneField(AttendanceLateViolation, on_delete=models.PROTECT, related_name="late_notice")
    employee_profile = models.ForeignKey(
        "employees.EmployeeProfile", on_delete=models.PROTECT, related_name="attendance_late_notices"
    )
    company = models.ForeignKey(
        "organization.OrganizationNode", on_delete=models.PROTECT, related_name="attendance_late_notices"
    )
    reference_number = models.CharField(max_length=64, unique=True)
    level = models.PositiveSmallIntegerField()
    occurrence_number = models.PositiveIntegerField()
    template_name = models.CharField(max_length=128)
    template_version = models.PositiveIntegerField()
    penalty_percent = models.DecimalField(max_digits=5, decimal_places=4)
    penalty_amount = models.DecimalField(max_digits=12, decimal_places=2)
    company_logo_configured = models.BooleanField(default=False)
    document = models.FileField(storage=PrivateUploadStorage(), upload_to=attendance_late_notice_upload_to, blank=True)
    notification = models.ForeignKey(
        "in_app_notifications.Notification",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="attendance_late_notices",
    )
    delivery_status = models.CharField(
        max_length=16, choices=DeliveryStatus.choices, default=DeliveryStatus.SCHEDULED
    )
    delivery_message = models.CharField(max_length=255, blank=True)
    issued_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-issued_at", "-id"]
        constraints = [
            models.CheckConstraint(condition=Q(level__gte=1) & Q(level__lte=4), name="att_late_notice_level_range"),
        ]
        indexes = [
            models.Index(fields=["company", "-issued_at"], name="att_notice_company_idx"),
            models.Index(fields=["employee_profile", "-issued_at"], name="att_notice_employee_idx"),
        ]


class WorkLocation(models.Model):
    """A company-owned site at which mobile attendance may be recorded."""

    company = models.ForeignKey(
        "organization.OrganizationNode", on_delete=models.PROTECT, related_name="attendance_work_locations"
    )
    name = models.CharField(max_length=120)
    latitude = models.DecimalField(max_digits=9, decimal_places=6)
    longitude = models.DecimalField(max_digits=9, decimal_places=6)
    radius_meters = models.PositiveIntegerField()
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "id"]
        constraints = [
            models.CheckConstraint(
                condition=Q(latitude__gte=-90) & Q(latitude__lte=90), name="work_location_latitude_range"
            ),
            models.CheckConstraint(
                condition=Q(longitude__gte=-180) & Q(longitude__lte=180), name="work_location_longitude_range"
            ),
            models.CheckConstraint(condition=Q(radius_meters__gt=0), name="work_location_positive_radius"),
            models.UniqueConstraint(
                fields=["company", "name"],
                condition=Q(is_active=True),
                name="unique_active_work_location_name",
            ),
        ]

    def __str__(self):
        return f"{self.company} - {self.name}"

    def clean(self):
        super().clean()
        if not self.company_id:
            raise ValidationError({"company": "A company is required."})
        if self.company.node_type != self.company.NodeType.COMPANY or not self.company.is_active:
            raise ValidationError({"company": "Work locations must belong to an active company."})
        if not -90 <= self.latitude <= 90:
            raise ValidationError({"latitude": "Latitude must be between -90 and 90."})
        if not -180 <= self.longitude <= 180:
            raise ValidationError({"longitude": "Longitude must be between -180 and 180."})
        if self.radius_meters <= 0:
            raise ValidationError({"radius_meters": "Radius must be greater than zero."})

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)


class AttendanceCorrectionRequest(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", _("Draft")
        PENDING_MANAGER = "pending_manager", _("Pending Manager")
        PENDING_HR = "pending_hr", _("Pending HR")
        APPROVED = "approved", _("Approved")
        REJECTED = "rejected", _("Rejected")
        CANCELLED = "cancelled", _("Cancelled")

    employee_profile = models.ForeignKey(
        "employees.EmployeeProfile",
        on_delete=models.PROTECT,
        related_name="attendance_correction_requests",
    )
    attendance_record = models.ForeignKey(
        AttendanceRecord,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="correction_requests",
    )
    date = models.DateField()
    requested_check_in_at = models.DateTimeField(null=True, blank=True)
    requested_check_out_at = models.DateTimeField(null=True, blank=True)
    requested_status = models.CharField(max_length=20, choices=AttendanceRecord.Status.choices, blank=True)
    reason = models.TextField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)

    manager_decision_at = models.DateTimeField(null=True, blank=True)
    manager_decision_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="manager_decided_attendance_corrections",
    )
    manager_decision_note = models.TextField(blank=True)
    hr_decision_at = models.DateTimeField(null=True, blank=True)
    hr_decision_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="hr_decided_attendance_corrections",
    )
    hr_decision_note = models.TextField(blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="attendance_corrections_created",
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="attendance_corrections_updated",
    )
    submitted_at = models.DateTimeField(null=True, blank=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["employee_profile", "date"], name="att_corr_emp_date_idx"),
            models.Index(fields=["status", "created_at"], name="att_corr_status_created_idx"),
        ]

    def __str__(self):
        return f"{self.employee_profile} - {self.date} correction ({self.status})"


class BioTimeConfig(models.Model):
    server_ip = models.CharField(
        max_length=100, help_text=_("IP address or domain of the BioTime server (e.g. 192.168.1.100)")
    )
    server_port = models.CharField(max_length=10, default="8090", help_text=_("Port for BioTime server (e.g. 8090)"))
    username = models.CharField(max_length=100, help_text=_("BioTime device/API username"))
    password = models.CharField(max_length=100, help_text=_("BioTime device/API password"))
    is_active = models.BooleanField(default=False, help_text=_("Enable/disable automatic syncing"))
    last_sync_time = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("BioTime Configuration")
        verbose_name_plural = _("BioTime Configuration")

    def __str__(self):
        return f"BioTime Settings ({self.server_ip}:{self.server_port})"

    @classmethod
    def get_solo(cls):
        # Singleton pattern implementation
        obj, created = cls.objects.get_or_create(
            id=1, defaults={"server_ip": "127.0.0.1", "server_port": "8090", "username": "admin", "password": ""}
        )
        return obj


class BioTimeEmployeeMap(models.Model):
    employee_profile = models.ForeignKey(
        "employees.EmployeeProfile", on_delete=models.CASCADE, related_name="biotime_mapping"
    )
    biotime_emp_code = models.CharField(
        max_length=50, unique=True, help_text=_("Employee code (ID) as set inside the ZKTeco BioTime device")
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("BioTime Employee Mapping")
        verbose_name_plural = _("BioTime Employee Mappings")
        constraints = [
            models.UniqueConstraint(fields=["employee_profile"], name="unique_biotime_mapping_per_employee"),
        ]

    def __str__(self):
        return f"BioTime {self.biotime_emp_code} -> {self.employee_profile}"

    def clean(self):
        super().clean()
        profile = self.employee_profile
        if (
            not profile.company_id
            or profile.company.node_type != profile.company.NodeType.COMPANY
            or not profile.company.is_active
        ):
            raise ValidationError({"employee_profile": "Mapped employees must belong to an active company."})
        if profile.is_archived:
            raise ValidationError({"employee_profile": "Archived employees cannot be mapped to BioTime."})

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)


class BioTimeDeviceEmployee(models.Model):
    emp_code = models.CharField(max_length=50, unique=True)
    first_name = models.CharField(max_length=100, blank=True, default="")
    last_name = models.CharField(max_length=100, blank=True, default="")
    department = models.CharField(max_length=200, blank=True, default="")
    last_seen_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["emp_code"]

    def __str__(self):
        return f"BioTime device employee {self.emp_code}"
