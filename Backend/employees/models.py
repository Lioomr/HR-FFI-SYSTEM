from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _

from hr_reference.models import Department, Position, Sponsor, TaskGroup
from organization.models import OrganizationNode

from .storage import PrivateUploadStorage


class EmployeeProfile(models.Model):
    class EmploymentStatus(models.TextChoices):
        ACTIVE = "ACTIVE", _("Active")
        SUSPENDED = "SUSPENDED", _("Suspended")
        TERMINATED = "TERMINATED", _("Terminated")

    class DataSource(models.TextChoices):
        IMPORT_EXCEL = "IMPORT_EXCEL", _("Import Excel")
        MANUAL = "MANUAL", _("Manual")

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="employee_profile",
        null=True,
        blank=True,
        help_text=_("Linked user account. Optional."),
    )
    company = models.ForeignKey(
        OrganizationNode,
        on_delete=models.PROTECT,
        related_name="employee_profiles",
        null=True,
        blank=True,
        help_text=_("Owning company for this employee profile."),
    )

    employee_id = models.CharField(
        max_length=20,
        unique=True,
        editable=False,
        help_text=_("Unique employee identifier (e.g. FFI-00123). Generated automatically."),
    )

    full_name = models.CharField(max_length=255, blank=True)
    full_name_en = models.CharField(max_length=255, blank=True, null=True)
    full_name_ar = models.CharField(max_length=255, blank=True, null=True)
    employee_number = models.CharField(max_length=50, blank=True)
    nationality = models.CharField(max_length=100, blank=True)
    nationality_en = models.CharField(max_length=100, blank=True, null=True)
    nationality_ar = models.CharField(max_length=100, blank=True, null=True)
    is_saudi = models.BooleanField(default=False)
    passport_no = models.CharField(max_length=50, blank=True, null=True)
    passport_expiry = models.DateField(null=True, blank=True)
    passport_expiry_raw = models.CharField(max_length=50, blank=True, null=True)
    national_id = models.CharField(max_length=50, blank=True)
    id_expiry = models.DateField(null=True, blank=True)
    id_expiry_raw = models.CharField(max_length=50, blank=True, null=True)
    date_of_birth = models.DateField(null=True, blank=True)
    date_of_birth_raw = models.CharField(max_length=50, blank=True, null=True)
    mobile = models.CharField(max_length=50, blank=True)

    department = models.CharField(max_length=100, blank=True)
    department_name_en = models.CharField(max_length=100, blank=True, null=True)
    department_name_ar = models.CharField(max_length=100, blank=True, null=True)
    job_title = models.CharField(max_length=100, blank=True)
    job_title_en = models.CharField(max_length=100, blank=True, null=True)
    job_title_ar = models.CharField(max_length=100, blank=True, null=True)
    hire_date = models.DateField(null=True, blank=True)
    hire_date_raw = models.CharField(max_length=50, blank=True, null=True)

    department_ref = models.ForeignKey(
        Department,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="employees",
    )
    position_ref = models.ForeignKey(
        Position,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="employees",
    )
    task_group_ref = models.ForeignKey(
        TaskGroup,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="employees",
    )
    sponsor_ref = models.ForeignKey(
        Sponsor,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="employees",
    )

    job_offer = models.CharField(max_length=255, blank=True)
    contract_date = models.DateField(null=True, blank=True)
    contract_date_raw = models.CharField(max_length=50, blank=True, null=True)
    contract_expiry = models.DateField(null=True, blank=True)
    contract_expiry_raw = models.CharField(max_length=50, blank=True, null=True)
    allowed_overtime = models.IntegerField(null=True, blank=True)

    health_card = models.CharField(max_length=100, blank=True)
    health_card_expiry = models.DateField(null=True, blank=True)
    health_card_expiry_raw = models.CharField(max_length=50, blank=True, null=True)

    basic_salary = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    transportation_allowance = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    accommodation_allowance = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    telephone_allowance = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    petrol_allowance = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    other_allowance = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    total_salary = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    data_source = models.CharField(max_length=20, choices=DataSource.choices, default=DataSource.MANUAL)

    employment_status = models.CharField(
        max_length=20,
        choices=EmploymentStatus.choices,
        default=EmploymentStatus.ACTIVE,
        help_text=_("Current employment status."),
    )

    # Manager is a direct link to a User, not another EmployeeProfile (per specs)
    manager = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="managed_employees",
        help_text=_("Legacy manager field (User). Prefer manager_profile."),
    )
    manager_profile = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="direct_reports",
        help_text=_("Direct manager (EmployeeProfile)."),
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["employee_id"]
        verbose_name = _("Employee Profile")
        verbose_name_plural = _("Employee Profiles")

    def __str__(self):
        email = self.user.email if self.user else ""
        return f"{self.employee_id} - {email}".strip()

    def save(self, *args, **kwargs):
        if not self.full_name_en and self.full_name:
            self.full_name_en = self.full_name
        if not self.full_name and self.full_name_en:
            self.full_name = self.full_name_en
        if not self.nationality_en and self.nationality:
            self.nationality_en = self.nationality
        if not self.nationality and self.nationality_en:
            self.nationality = self.nationality_en
        if not self.department_name_en and self.department:
            self.department_name_en = self.department
        if not self.department and self.department_name_en:
            self.department = self.department_name_en
        if not self.job_title_en and self.job_title:
            self.job_title_en = self.job_title
        if not self.job_title and self.job_title_en:
            self.job_title = self.job_title_en

        if self.data_source == self.DataSource.MANUAL and self.total_salary in (None, ""):
            allowances = [
                self.basic_salary,
                self.transportation_allowance,
                self.accommodation_allowance,
                self.telephone_allowance,
                self.petrol_allowance,
                self.other_allowance,
            ]
            self.total_salary = sum((amount or Decimal("0.00")) for amount in allowances)

        super().save(*args, **kwargs)


class EmployeeImport(models.Model):
    class Status(models.TextChoices):
        SUCCESS = "success", _("Success")
        FAILED = "failed", _("Failed")

    uploader = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="employee_imports",
    )
    original_filename = models.CharField(max_length=255)
    stored_file = models.FileField(
        storage=PrivateUploadStorage(),
        upload_to="employee_imports/",
    )
    errors_file = models.FileField(
        storage=PrivateUploadStorage(),
        upload_to="employee_imports/errors/",
        null=True,
        blank=True,
    )
    status = models.CharField(
        max_length=10,
        choices=Status.choices,
        default=Status.FAILED,
    )
    row_count = models.PositiveIntegerField(default=0)
    inserted_rows = models.PositiveIntegerField(default=0)
    file_hash = models.CharField(max_length=64, blank=True)
    error_summary = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = _("Employee Import")
        verbose_name_plural = _("Employee Imports")


class EmployeeDocument(models.Model):
    class DocumentType(models.TextChoices):
        IQAMA = "IQAMA", _("Iqama")
        PASSPORT = "PASSPORT", _("Passport")
        VISA = "VISA", _("Visa")
        SAUDI_ID = "SAUDI_ID", _("Saudi ID")
        OTHER = "OTHER", _("Other")

    class ExtractionStatus(models.TextChoices):
        PENDING = "pending", _("Pending")
        SUCCESS = "success", _("Success")
        PARTIAL = "partial", _("Partial")
        FAILED = "failed", _("Failed")

    employee_profile = models.ForeignKey(
        EmployeeProfile,
        on_delete=models.CASCADE,
        related_name="documents",
    )
    company = models.ForeignKey(
        OrganizationNode,
        on_delete=models.PROTECT,
        related_name="employee_documents",
        null=True,
        blank=True,
    )
    leave_request = models.ForeignKey(
        "leaves.LeaveRequest",
        on_delete=models.SET_NULL,
        related_name="employee_documents",
        null=True,
        blank=True,
    )
    document_type = models.CharField(max_length=20, choices=DocumentType.choices)
    custom_name = models.CharField(max_length=100, blank=True)
    file = models.FileField(
        storage=PrivateUploadStorage(),
        upload_to="employee_documents/",
    )
    original_filename = models.CharField(max_length=255, blank=True)
    visa_number = models.CharField(max_length=50, blank=True)
    exit_before = models.DateField(null=True, blank=True)
    exit_before_raw = models.CharField(max_length=50, blank=True)
    visa_duration = models.PositiveIntegerField(null=True, blank=True)
    visa_duration_raw = models.CharField(max_length=50, blank=True)
    extracted_fields = models.JSONField(default=dict, blank=True)
    extraction_status = models.CharField(
        max_length=20,
        choices=ExtractionStatus.choices,
        default=ExtractionStatus.PENDING,
    )
    extraction_error = models.TextField(blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="uploaded_employee_documents",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["employee_profile", "document_type"], name="emp_doc_profile_type_idx"),
            models.Index(fields=["company", "document_type"], name="emp_doc_company_type_idx"),
            models.Index(fields=["leave_request"], name="emp_doc_leave_request_idx"),
        ]

    def __str__(self):
        label = self.custom_name if self.document_type == self.DocumentType.OTHER else self.get_document_type_display()
        return f"{self.employee_profile_id} - {label}"


class EmployeeDeletionRequest(models.Model):
    class Status(models.TextChoices):
        PENDING_CEO = "PENDING_CEO", _("Pending CEO")
        REJECTED = "REJECTED", _("Rejected")
        EXECUTED = "EXECUTED", _("Executed")

    company = models.ForeignKey(
        OrganizationNode,
        on_delete=models.PROTECT,
        related_name="employee_deletion_requests",
    )
    employee_profile = models.ForeignKey(
        "employees.EmployeeProfile",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="deletion_requests",
    )
    target_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="employee_deletion_targets",
    )
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="employee_deletion_requests_created",
    )
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="employee_deletion_requests_approved",
    )
    rejected_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="employee_deletion_requests_rejected",
    )
    reason = models.TextField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING_CEO)
    request_snapshot = models.JSONField(default=dict, blank=True)
    execution_snapshot = models.JSONField(default=dict, blank=True)
    rejection_reason = models.TextField(blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    rejected_at = models.DateTimeField(null=True, blank=True)
    executed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["company", "status"], name="emp_delreq_company_status_idx"),
            models.Index(fields=["employee_profile", "status"], name="emp_delreq_profile_status_idx"),
        ]

    def __str__(self):
        employee_id = self.request_snapshot.get("employee_id") or self.employee_profile_id or "unknown"
        return f"Delete:{employee_id}:{self.status}"
