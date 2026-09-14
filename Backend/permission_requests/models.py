from django.conf import settings
from django.db import models
from django.db.models import F, Q
from django.utils.translation import gettext_lazy as _

from employees.models import EmployeeProfile
from employees.storage import PrivateUploadStorage
from organization.models import OrganizationNode

#: A permission may cover at most two hours of the workday.
MAX_DURATION_MINUTES = 120
REASON_MAX_LENGTH = 1000


class PermissionRequest(models.Model):
    """An employee's request to leave work for part of the current workday.

    The model owns ``status``; the shared workflow engine only projects it.
    Approval runs Direct Manager -> HR -> approved. There is no CEO stage.
    """

    class ExitType(models.TextChoices):
        BUSINESS = "business", _("Business")
        PERSONAL = "personal", _("Personal")
        EMERGENCY = "emergency", _("Emergency")

    class PermissionType(models.TextChoices):
        EXIT = "exit", _("Exit")
        LATE = "late", _("Late")
        DURING_SHIFT = "during_shift", _("During shift")

    class Status(models.TextChoices):
        PENDING_MANAGER = "pending_manager", _("Pending Manager")
        PENDING_HR = "pending_hr", _("Pending HR")
        APPROVED = "approved", _("Approved")
        REJECTED = "rejected", _("Rejected")
        CANCELLED = "cancelled", _("Cancelled")

    class Decision(models.TextChoices):
        APPROVED = "approved", _("Approved")
        REJECTED = "rejected", _("Rejected")

    employee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="permission_requests",
    )
    employee_profile = models.ForeignKey(
        EmployeeProfile,
        on_delete=models.CASCADE,
        related_name="permission_requests",
    )
    company = models.ForeignKey(
        OrganizationNode,
        on_delete=models.PROTECT,
        related_name="permission_requests",
    )
    reference_no = models.CharField(max_length=32, unique=True)
    # Defaults to exit so all historic Exit Permission records and legacy
    # payloads retain their existing meaning.
    permission_type = models.CharField(max_length=16, choices=PermissionType.choices, default=PermissionType.EXIT)
    request_date = models.DateField()
    from_time = models.TimeField(null=True, blank=True)
    to_time = models.TimeField(null=True, blank=True)
    duration_minutes = models.PositiveSmallIntegerField(default=0)
    exit_type = models.CharField(max_length=16, choices=ExitType.choices, blank=True, default="")
    reason = models.TextField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING_MANAGER)

    manager_decision = models.CharField(max_length=16, choices=Decision.choices, null=True, blank=True)
    manager_decision_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="manager_decided_permission_requests",
    )
    manager_decision_at = models.DateTimeField(null=True, blank=True)
    manager_decision_note = models.TextField(blank=True)

    hr_decision = models.CharField(max_length=16, choices=Decision.choices, null=True, blank=True)
    hr_decision_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="hr_decided_permission_requests",
    )
    hr_decision_at = models.DateTimeField(null=True, blank=True)
    hr_decision_note = models.TextField(blank=True)

    cancelled_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["company", "employee", "request_date"], name="perm_req_co_emp_date_idx"),
            models.Index(fields=["company", "status"], name="perm_req_co_status_idx"),
            models.Index(fields=["company", "created_at"], name="perm_req_co_created_idx"),
            models.Index(
                fields=["employee", "request_date", "permission_type", "status"], name="perm_req_conflict_idx"
            ),
        ]
        constraints = [
            models.CheckConstraint(condition=Q(to_time__gt=F("from_time")), name="perm_req_to_after_from"),
            models.CheckConstraint(
                condition=Q(duration_minutes__gte=0) & Q(duration_minutes__lte=24 * 60),
                name="perm_req_duration_range",
            ),
            models.CheckConstraint(
                condition=(
                    Q(permission_type="late", duration_minutes=0, from_time__isnull=True, to_time__isnull=True)
                    | Q(
                        permission_type__in=["exit", "during_shift"],
                        duration_minutes__gte=1,
                        from_time__isnull=False,
                        to_time__isnull=False,
                    )
                ),
                name="perm_req_type_time_shape",
            ),
        ]

    def __str__(self):
        return f"{self.reference_no} ({self.status})"


class PermissionRequestAttachment(models.Model):
    """Private evidence belonging to a permission request.

    Files have no public URL.  They are only served by the authenticated
    permission-request download action after the parent request is authorized.
    """

    permission_request = models.ForeignKey(PermissionRequest, on_delete=models.CASCADE, related_name="attachments")
    file = models.FileField(storage=PrivateUploadStorage(), upload_to="permission_request_evidence/")
    original_filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=100)
    size_bytes = models.PositiveIntegerField()
    capture_metadata = models.JSONField(default=dict, blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="permission_request_attachments"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [models.Index(fields=["permission_request", "created_at"], name="perm_attachment_req_idx")]


#: Statuses that occupy the employee's workday; a new request for that day is refused.
ACTIVE_STATUSES = (
    PermissionRequest.Status.PENDING_MANAGER,
    PermissionRequest.Status.PENDING_HR,
    PermissionRequest.Status.APPROVED,
)
#: Statuses an approver can still act on and the owner can still cancel.
PENDING_STATUSES = (
    PermissionRequest.Status.PENDING_MANAGER,
    PermissionRequest.Status.PENDING_HR,
)
