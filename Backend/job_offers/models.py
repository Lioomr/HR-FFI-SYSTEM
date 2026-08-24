import secrets

from django.conf import settings
from django.db import models
from django.utils import timezone

from employees.storage import PrivateUploadStorage
from organization.models import OrganizationNode


class HiringRequest(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SUBMITTED = "submitted", "Submitted"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        CANCELLED = "cancelled", "Cancelled"
        CONVERTED = "converted", "Converted"

    company = models.ForeignKey(OrganizationNode, on_delete=models.PROTECT, related_name="hiring_requests")
    reference_number = models.CharField(max_length=100)
    candidate_full_name = models.CharField(max_length=255)
    candidate_email = models.EmailField(blank=True)
    candidate_phone_number = models.CharField(max_length=32, blank=True)
    nationality = models.CharField(max_length=100, blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    proposed_salary = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    cv_file = models.FileField(storage=PrivateUploadStorage(), upload_to="hiring_request_cvs/")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT, db_index=True)
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="requested_hires",
    )
    submitted_at = models.DateTimeField(null=True, blank=True)
    ceo_decision_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="decided_hiring_requests",
        null=True,
        blank=True,
    )
    ceo_decision_at = models.DateTimeField(null=True, blank=True)
    ceo_decision_note = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_hiring_requests",
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="updated_hiring_requests",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["company", "reference_number"], name="unique_hiring_request_reference_company"
            ),
            models.CheckConstraint(condition=~models.Q(reference_number=""), name="hiring_request_reference_not_blank"),
            models.CheckConstraint(
                condition=models.Q(proposed_salary__gte=0), name="hiring_request_salary_nonnegative"
            ),
        ]
        indexes = [
            models.Index(fields=["company", "status"]),
            models.Index(fields=["company", "created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.reference_number} - {self.candidate_full_name}"


class JobOffer(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SENT = "sent", "Sent"
        ACCEPTED = "accepted", "Accepted"
        REJECTED = "rejected", "Rejected"
        EXPIRED = "expired", "Expired"
        CANCELLED = "cancelled", "Cancelled"

    company = models.ForeignKey(OrganizationNode, on_delete=models.PROTECT, related_name="job_offers")
    employee_profile = models.ForeignKey(
        "employees.EmployeeProfile",
        on_delete=models.PROTECT,
        related_name="job_offers",
        null=True,
        blank=True,
    )
    account_invite = models.ForeignKey(
        "invites.Invite",
        on_delete=models.SET_NULL,
        related_name="job_offers",
        null=True,
        blank=True,
    )
    hiring_request = models.OneToOneField(
        HiringRequest,
        on_delete=models.PROTECT,
        related_name="job_offer",
        null=True,
        blank=True,
    )

    candidate_full_name = models.CharField(max_length=255)
    candidate_email = models.EmailField(blank=True)
    candidate_phone_number = models.CharField(max_length=32, blank=True)
    nationality = models.CharField(max_length=100, blank=True)
    id_passport_iqama_number = models.CharField(max_length=100, blank=True)
    department_ref = models.ForeignKey(
        "hr_reference.Department",
        on_delete=models.PROTECT,
        related_name="job_offers",
        null=True,
        blank=True,
    )
    position_ref = models.ForeignKey(
        "hr_reference.Position",
        on_delete=models.PROTECT,
        related_name="job_offers",
        null=True,
        blank=True,
    )
    position_title = models.CharField(max_length=150)
    classification = models.CharField(max_length=100, blank=True)
    department = models.CharField(max_length=150, blank=True)
    location = models.CharField(max_length=150, blank=True)

    basic_salary = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    housing_allowance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    transportation_allowance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    other_allowance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_salary_package = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    vacation = models.CharField(max_length=255, blank=True)
    tickets = models.CharField(max_length=255, blank=True)
    contract_status = models.CharField(max_length=100, blank=True)
    contract_type = models.CharField(max_length=100, blank=True)
    contract_duration = models.CharField(max_length=100, blank=True)
    medical_insurance = models.CharField(max_length=255, blank=True)

    offer_date = models.DateField(default=timezone.localdate)
    expiry_date = models.DateField()
    reference_number = models.CharField(max_length=100)
    hr_signer_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="signed_job_offers",
    )
    hr_signer_name = models.CharField(max_length=255, blank=True)
    hr_signer_title = models.CharField(max_length=150, blank=True)

    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT, db_index=True)
    response_token = models.CharField(max_length=64, unique=True, null=True, blank=True, db_index=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    rejected_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True)
    delivery_metadata = models.JSONField(default=dict, blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_job_offers",
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="updated_job_offers",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["company", "reference_number"], name="unique_job_offer_reference_company"),
            models.CheckConstraint(condition=~models.Q(reference_number=""), name="job_offer_reference_not_blank"),
        ]
        indexes = [
            models.Index(fields=["company", "status"]),
            models.Index(fields=["company", "expiry_date"]),
        ]

    def __str__(self) -> str:
        return f"{self.reference_number} - {self.candidate_full_name}"

    @staticmethod
    def generate_response_token() -> str:
        return secrets.token_urlsafe(32)

    def is_expired(self) -> bool:
        return self.expiry_date < timezone.localdate()


class StartingWorkAcknowledgment(models.Model):
    class Status(models.TextChoices):
        GENERATED = "generated", "Generated"

    employee_profile = models.OneToOneField(
        "employees.EmployeeProfile",
        on_delete=models.PROTECT,
        related_name="starting_work_acknowledgment",
    )
    attendance_record = models.OneToOneField(
        "attendance.AttendanceRecord",
        on_delete=models.PROTECT,
        related_name="starting_work_acknowledgment",
    )
    job_offer = models.ForeignKey(
        JobOffer,
        on_delete=models.SET_NULL,
        related_name="starting_work_acknowledgments",
        null=True,
        blank=True,
    )
    company = models.ForeignKey(
        OrganizationNode,
        on_delete=models.PROTECT,
        related_name="starting_work_acknowledgments",
    )
    reference_number = models.CharField(max_length=100)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.GENERATED, db_index=True)
    generated_at = models.DateTimeField(default=timezone.now)
    generated_by_system = models.BooleanField(default=True)
    document = models.OneToOneField(
        "employees.EmployeeDocument",
        on_delete=models.PROTECT,
        related_name="starting_work_acknowledgment",
    )

    class Meta:
        ordering = ["-generated_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["company", "reference_number"],
                name="unique_swa_reference_company",
            ),
            models.CheckConstraint(
                condition=~models.Q(reference_number=""),
                name="swa_reference_not_blank",
            ),
        ]
        indexes = [models.Index(fields=["company", "status", "generated_at"], name="swa_company_status_idx")]

    def __str__(self) -> str:
        return f"{self.reference_number} - {self.employee_profile_id}"
