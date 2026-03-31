from django.conf import settings
from django.db import models
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

    def __str__(self):
        return f"{self.employee_profile} - {self.date} ({self.status})"

class BioTimeConfig(models.Model):
    server_ip = models.CharField(max_length=100, help_text=_("IP address or domain of the BioTime server (e.g. 192.168.1.100)"))
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
        obj, created = cls.objects.get_or_create(id=1, defaults={
            "server_ip": "127.0.0.1",
            "server_port": "8090",
            "username": "admin",
            "password": ""
        })
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

    def __str__(self):
        return f"BioTime {self.biotime_emp_code} -> {self.employee_profile}"

