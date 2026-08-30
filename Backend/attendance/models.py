from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils.translation import gettext_lazy as _


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
            models.CheckConstraint(condition=Q(latitude__gte=-90) & Q(latitude__lte=90), name="work_location_latitude_range"),
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
