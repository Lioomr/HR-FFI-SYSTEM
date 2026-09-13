from django.conf import settings
from django.db import models
from django.db.models import F, Q
from django.utils.translation import gettext_lazy as _

from employees.models import EmployeeProfile
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
    request_date = models.DateField()
    from_time = models.TimeField()
    to_time = models.TimeField()
    duration_minutes = models.PositiveSmallIntegerField()
    exit_type = models.CharField(max_length=16, choices=ExitType.choices)
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
        ]
        constraints = [
            # Backstop for the service rule: one active request per employee per day.
            models.UniqueConstraint(
                fields=["employee", "request_date"],
                condition=Q(status__in=["pending_manager", "pending_hr", "approved"]),
                name="perm_req_one_active_per_day",
            ),
            models.CheckConstraint(condition=Q(to_time__gt=F("from_time")), name="perm_req_to_after_from"),
            models.CheckConstraint(
                condition=Q(duration_minutes__gte=1) & Q(duration_minutes__lte=MAX_DURATION_MINUTES),
                name="perm_req_duration_range",
            ),
        ]

    def __str__(self):
        return f"{self.reference_no} ({self.status})"


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
