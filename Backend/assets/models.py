from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from employees.models import EmployeeProfile
from employees.storage import PrivateUploadStorage


class AssetCodeSequence(models.Model):
    prefix = models.CharField(max_length=3, unique=True)
    value = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["prefix"]


class Asset(models.Model):
    class AssetType(models.TextChoices):
        VEHICLE = "VEHICLE", _("Vehicle")
        LAPTOP = "LAPTOP", _("Laptop")
        OTHER = "OTHER", _("Other")

    class AssetStatus(models.TextChoices):
        AVAILABLE = "AVAILABLE", _("Available")
        ASSIGNED = "ASSIGNED", _("Assigned")
        UNDER_MAINTENANCE = "UNDER_MAINTENANCE", _("Under Maintenance")
        LOST = "LOST", _("Lost")
        DAMAGED = "DAMAGED", _("Damaged")
        RETIRED = "RETIRED", _("Retired")

    TYPE_PREFIX_MAP = {
        AssetType.VEHICLE: "VEH",
        AssetType.LAPTOP: "LAP",
        AssetType.OTHER: "AST",
    }

    asset_code = models.CharField(max_length=20, unique=True, editable=False, db_index=True)
    name_en = models.CharField(max_length=255)
    name_ar = models.CharField(max_length=255, blank=True)
    type = models.CharField(max_length=20, choices=AssetType.choices)
    status = models.CharField(max_length=30, choices=AssetStatus.choices, default=AssetStatus.AVAILABLE, db_index=True)
    serial_number = models.CharField(max_length=100, blank=True)
    purchase_date = models.DateField(null=True, blank=True)
    warranty_expiry = models.DateField(null=True, blank=True)
    asset_value = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    vendor = models.CharField(max_length=255, blank=True)
    invoice_file = models.FileField(
        storage=PrivateUploadStorage(),
        upload_to="assets/invoices/",
        null=True,
        blank=True,
    )
    notes = models.TextField(blank=True)
    flexible_attributes = models.JSONField(null=True, blank=True)

    plate_number = models.CharField(max_length=50, blank=True)
    chassis_number = models.CharField(max_length=100, blank=True)
    engine_number = models.CharField(max_length=100, blank=True)
    fuel_type = models.CharField(max_length=50, blank=True)
    insurance_expiry = models.DateField(null=True, blank=True)
    registration_expiry = models.DateField(null=True, blank=True)

    cpu = models.CharField(max_length=100, blank=True)
    ram = models.CharField(max_length=50, blank=True)
    storage = models.CharField(max_length=50, blank=True)
    mac_address = models.CharField(max_length=100, blank=True)
    operating_system = models.CharField(max_length=100, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "type"], name="assets_asset_status_type_idx"),
            models.Index(fields=["warranty_expiry"], name="assets_asset_warranty_idx"),
        ]

    def __str__(self):
        return f"{self.asset_code} - {self.name_en}"

    def clean(self):
        errors = {}
        if self.type == self.AssetType.VEHICLE:
            required_vehicle_fields = ["plate_number", "chassis_number", "engine_number", "fuel_type"]
            for field_name in required_vehicle_fields:
                if not getattr(self, field_name):
                    errors[field_name] = "This field is required for vehicle assets."

        if self.type == self.AssetType.LAPTOP:
            required_laptop_fields = ["cpu", "ram", "storage", "mac_address", "operating_system"]
            for field_name in required_laptop_fields:
                if not getattr(self, field_name):
                    errors[field_name] = "This field is required for laptop assets."

        if self.type == self.AssetType.OTHER and not self.flexible_attributes:
            errors["flexible_attributes"] = "This field is required for OTHER assets."

        if errors:
            raise ValidationError(errors)

    @classmethod
    def _next_asset_code(cls, asset_type: str) -> str:
        prefix = cls.TYPE_PREFIX_MAP[asset_type]
        with transaction.atomic():
            sequence, _ = AssetCodeSequence.objects.select_for_update().get_or_create(prefix=prefix)
            sequence.value += 1
            sequence.save(update_fields=["value", "updated_at"])
            return f"{prefix}-{sequence.value:05d}"

    def save(self, *args, **kwargs):
        self.full_clean()
        if not self.asset_code:
            self.asset_code = self._next_asset_code(self.type)
        super().save(*args, **kwargs)


class AssetAssignment(models.Model):
    asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name="assignments")
    employee = models.ForeignKey(EmployeeProfile, on_delete=models.CASCADE, related_name="asset_assignments")
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="asset_assignments_made",
    )
    assigned_at = models.DateTimeField(auto_now_add=True)
    returned_at = models.DateTimeField(null=True, blank=True)
    return_note = models.TextField(blank=True)
    condition_on_return = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-assigned_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["asset"],
                condition=Q(is_active=True),
                name="unique_active_assignment_per_asset",
            )
        ]
        indexes = [
            models.Index(fields=["employee", "is_active"], name="assets_asg_emp_active_idx"),
            models.Index(fields=["asset", "is_active"], name="assets_asg_asset_active_idx"),
        ]

    def __str__(self):
        return f"{self.asset.asset_code} -> {self.employee.employee_id}"


class AssetDamageReport(models.Model):
    class RequestStatus(models.TextChoices):
        PENDING_HR = "PENDING_HR", _("Pending HR")
        PENDING_CEO = "PENDING_CEO", _("Pending CEO")
        APPROVED = "APPROVED", _("Approved")
        REJECTED = "REJECTED", _("Rejected")

    asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name="damage_reports")
    employee = models.ForeignKey(EmployeeProfile, on_delete=models.CASCADE, related_name="asset_damage_reports")
    description = models.TextField()
    status = models.CharField(max_length=20, choices=RequestStatus.choices, default=RequestStatus.PENDING_HR)
    reported_at = models.DateTimeField(auto_now_add=True)
    hr_decision_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="hr_decided_asset_damage_reports",
    )
    hr_decision_at = models.DateTimeField(null=True, blank=True)
    hr_decision_note = models.TextField(blank=True)
    ceo_decision_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ceo_decided_asset_damage_reports",
    )
    ceo_decision_at = models.DateTimeField(null=True, blank=True)
    ceo_decision_note = models.TextField(blank=True)

    class Meta:
        ordering = ["-reported_at"]


class AssetReturnRequest(models.Model):
    class RequestStatus(models.TextChoices):
        PENDING = "PENDING", _("Pending")
        PENDING_CEO = "PENDING_CEO", _("Pending CEO")
        APPROVED = "APPROVED", _("Approved")
        PROCESSED = "PROCESSED", _("Processed")
        REJECTED = "REJECTED", _("Rejected")

    asset = models.ForeignKey(Asset, on_delete=models.CASCADE, related_name="return_requests")
    employee = models.ForeignKey(EmployeeProfile, on_delete=models.CASCADE, related_name="asset_return_requests")
    requested_at = models.DateTimeField(auto_now_add=True)
    note = models.TextField()
    status = models.CharField(max_length=20, choices=RequestStatus.choices, default=RequestStatus.PENDING)
    processed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="processed_asset_return_requests",
    )
    processed_at = models.DateTimeField(null=True, blank=True)
    hr_decision_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="hr_decided_asset_return_requests",
    )
    hr_decision_at = models.DateTimeField(null=True, blank=True)
    hr_decision_note = models.TextField(blank=True)
    ceo_decision_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ceo_decided_asset_return_requests",
    )
    ceo_decision_at = models.DateTimeField(null=True, blank=True)
    ceo_decision_note = models.TextField(blank=True)

    class Meta:
        ordering = ["-requested_at"]
        indexes = [
            models.Index(fields=["status", "requested_at"], name="assets_ret_req_status_idx"),
        ]

    def mark_processed(self, user):
        self.status = self.RequestStatus.PROCESSED
        self.processed_by = user
        self.processed_at = timezone.now()
        self.save(update_fields=["status", "processed_by", "processed_at"])
