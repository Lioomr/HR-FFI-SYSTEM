from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils.translation import gettext_lazy as _

from hr_reference.models import Department, Position, Sponsor, TaskGroup
from organization.models import OrganizationNode

from .storage import PrivateUploadStorage


class EmployeeProfile(models.Model):
    class EmploymentStatus(models.TextChoices):
        PREHIRE = "PREHIRE", _("Prehire")
        ACTIVE = "ACTIVE", _("Active")
        SUSPENDED = "SUSPENDED", _("Suspended")
        TERMINATED = "TERMINATED", _("Terminated")

    class DataSource(models.TextChoices):
        IMPORT_EXCEL = "IMPORT_EXCEL", _("Import Excel")
        MANUAL = "MANUAL", _("Manual")

    class ArchiveReason(models.TextChoices):
        FIRED = "FIRED", _("Fired")
        RESIGNED = "RESIGNED", _("Resigned")
        RETIRED = "RETIRED", _("Retired")
        END_OF_CONTRACT = "END_OF_CONTRACT", _("End of contract")
        DECEASED = "DECEASED", _("Deceased")
        OTHER = "OTHER", _("Other")

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
    work_license_expiry = models.DateField(null=True, blank=True)

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
    is_archived = models.BooleanField(default=False, db_index=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    archived_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="employee_profiles_archived",
    )
    archive_reason = models.CharField(max_length=30, choices=ArchiveReason.choices, null=True, blank=True)

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

    def clean(self):
        super().clean()
        errors = {}
        if not self.is_archived and self.company_id is None:
            errors["company"] = _("A non-archived employee profile must belong to a company.")
        if self.company_id and self.company.node_type != OrganizationNode.NodeType.COMPANY:
            errors["company"] = _("Employee profiles must belong to a company organization node.")
        elif not self.is_archived and self.company_id and not self.company.is_active:
            errors["company"] = _("A non-archived employee profile must belong to an active company.")

        for field_name in ["department_ref", "position_ref", "task_group_ref", "sponsor_ref"]:
            reference = getattr(self, field_name, None)
            if reference and reference.company_id != self.company_id:
                errors[field_name] = _("The selected reference must belong to the employee's company.")

        if self.manager_profile_id:
            from employees.services.manager_relationships import validate_manager_assignment

            try:
                validate_manager_assignment(self, self.manager_profile, company=self.company)
            except ValidationError as exc:
                errors["manager_profile"] = exc.messages
        if errors:
            raise ValidationError(errors)

    def __str__(self):
        email = self.user.email if self.user else ""
        return f"{self.employee_id} - {email}".strip()

    def save(self, *args, **kwargs):
        creating = self._state.adding
        update_fields = kwargs.get("update_fields")
        manager_profile_changed = creating and self.manager_profile_id is not None
        if not creating:
            if update_fields is not None:
                manager_profile_changed = bool({"manager_profile", "manager_profile_id"} & set(update_fields))
            else:
                previous_manager_profile_id = (
                    type(self).objects.filter(pk=self.pk).values_list("manager_profile_id", flat=True).first()
                )
                manager_profile_changed = previous_manager_profile_id != self.manager_profile_id

        if manager_profile_changed:
            self.manager_id = (
                type(self).objects.filter(pk=self.manager_profile_id).values_list("user_id", flat=True).first()
                if self.manager_profile_id
                else None
            )
            if update_fields is not None:
                kwargs["update_fields"] = list(set(update_fields) | {"manager"})

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

        # Enforce tenant integrity for both new records and later relationship or
        # status changes. Archived legacy profiles may remain company-less because
        # ``clean()`` explicitly permits that state.
        self.clean()
        super().save(*args, **kwargs)


class ContractDecision(models.Model):
    class DecisionType(models.TextChoices):
        RENEW = "RENEW", _("Renew")
        RENEW_WITH_CHANGES = "RENEW_WITH_CHANGES", _("Renew with changes")
        TERMINATE = "TERMINATE", _("Terminate")

    class Status(models.TextChoices):
        PENDING_HR = "PENDING_HR", _("Pending HR")
        PENDING_CEO = "PENDING_CEO", _("Pending CEO")
        APPROVED = "APPROVED", _("Approved")
        AUTO_APPROVED = "AUTO_APPROVED", _("Automatically approved")
        REJECTED = "REJECTED", _("Rejected")
        AUTO_RENEWED = "AUTO_RENEWED", _("Automatically renewed")
        AUTO_RENEWAL_FAILED = "AUTO_RENEWAL_FAILED", _("Automatic renewal failed")
        MANUAL_RESOLUTION_REQUIRED = "MANUAL_RESOLUTION_REQUIRED", _("Manual resolution required")

    company = models.ForeignKey(
        OrganizationNode,
        on_delete=models.PROTECT,
        related_name="contract_decisions",
    )
    employee_profile = models.ForeignKey(
        EmployeeProfile,
        on_delete=models.PROTECT,
        related_name="contract_decisions",
    )
    decision_type = models.CharField(max_length=32, choices=DecisionType.choices, blank=True)
    status = models.CharField(max_length=32, choices=Status.choices, default=Status.PENDING_HR, db_index=True)
    original_contract_date = models.DateField(null=True, blank=True)
    original_contract_expiry = models.DateField(db_index=True)
    proposed_contract_date = models.DateField(null=True, blank=True)
    proposed_contract_expiry = models.DateField(null=True, blank=True)
    original_terms = models.JSONField(default=dict, blank=True)
    proposed_terms = models.JSONField(default=dict, blank=True)
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="contract_decisions_requested",
    )
    ceo_decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="contract_decisions_decided",
    )
    finalized_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="contract_decisions_finalized",
    )
    hr_comment = models.TextField(blank=True)
    ceo_comment = models.TextField(blank=True)
    failure_reason = models.TextField(blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    ceo_deadline = models.DateTimeField(null=True, blank=True, db_index=True)
    ceo_decided_at = models.DateTimeField(null=True, blank=True)
    last_ceo_reminder_at = models.DateTimeField(null=True, blank=True)
    ceo_reminder_count = models.PositiveSmallIntegerField(default=0)
    finalized_at = models.DateTimeField(null=True, blank=True)
    finalized_by_system = models.BooleanField(default=False)
    automatic_renewal = models.BooleanField(default=False)
    automatic_renewal_reason = models.TextField(blank=True)
    final_notification_sent_at = models.DateTimeField(null=True, blank=True)
    final_notification_attempts = models.PositiveSmallIntegerField(default=0)
    last_final_notification_attempt_at = models.DateTimeField(null=True, blank=True)
    notification_milestones = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["original_contract_expiry", "-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["employee_profile", "original_contract_expiry"],
                name="employee_contract_decision_cycle_unique",
            ),
        ]
        indexes = [
            models.Index(fields=["company", "status"], name="contract_dec_comp_status_idx"),
            models.Index(fields=["status", "ceo_deadline"], name="contract_dec_deadline_idx"),
        ]

    def __str__(self):
        return f"Contract:{self.employee_profile_id}:{self.original_contract_expiry}:{self.status}"


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
    company = models.ForeignKey(
        OrganizationNode,
        on_delete=models.PROTECT,
        related_name="employee_imports",
        null=True,
        blank=True,
        help_text=_("Company selected when this import was executed."),
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

    @property
    def display_name(self):
        labels = {
            self.DocumentType.PASSPORT: "Passport",
            self.DocumentType.IQAMA: "Iqama",
            self.DocumentType.SAUDI_ID: "Saudi ID",
            self.DocumentType.VISA: "Visa",
        }
        if self.document_type == self.DocumentType.OTHER:
            return self.custom_name
        return labels.get(self.document_type, self.get_document_type_display())

    def __str__(self):
        return f"{self.employee_profile_id} - {self.display_name}"


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
    archive_reason = models.CharField(
        max_length=30,
        choices=EmployeeProfile.ArchiveReason.choices,
        default=EmployeeProfile.ArchiveReason.OTHER,
    )
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
        return f"Archive:{employee_id}:{self.status}"
