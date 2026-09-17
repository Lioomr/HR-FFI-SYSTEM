from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _

from employees.models import ContractDecision

from .criteria import RatingGrade, Recommendation


class ContractRating(models.Model):
    class Status(models.TextChoices):
        PENDING_RESPONSES = "PENDING_RESPONSES", _("Awaiting both responses")
        WAITING_MANAGER = "WAITING_MANAGER", _("Awaiting manager response")
        WAITING_EMPLOYEE = "WAITING_EMPLOYEE", _("Awaiting employee response")
        PENDING_HR = "PENDING_HR", _("Pending HR review")
        PENDING_CEO = "PENDING_CEO", _("Pending CEO approval")
        APPROVED = "APPROVED", _("Approved")
        REJECTED = "REJECTED", _("Rejected")
        MANUAL_RESOLUTION_REQUIRED = "MANUAL_RESOLUTION_REQUIRED", _("Manual resolution required")

    contract_decision = models.OneToOneField(
        "employees.ContractDecision", on_delete=models.PROTECT, related_name="rating"
    )
    employee_profile = models.ForeignKey(
        "employees.EmployeeProfile", on_delete=models.PROTECT, related_name="contract_ratings"
    )
    company = models.ForeignKey(
        "organization.OrganizationNode", on_delete=models.PROTECT, related_name="contract_ratings"
    )
    status = models.CharField(max_length=32, choices=Status.choices, default=Status.PENDING_RESPONSES, db_index=True)

    manager_response = models.OneToOneField(
        "ContractRatingResponse", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    employee_response = models.OneToOneField(
        "ContractRatingResponse", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    manager_at_creation = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    department_snapshot = models.CharField(max_length=255, blank=True)
    section_snapshot = models.CharField(max_length=255, blank=True)
    job_title_snapshot = models.CharField(max_length=255, blank=True)
    evaluation_period_from = models.DateField(null=True, blank=True)
    evaluation_period_to = models.DateField(null=True, blank=True)

    comparison_summary = models.JSONField(default=dict, blank=True)

    hr_reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    hr_comment = models.TextField(blank=True)
    hr_decided_at = models.DateTimeField(null=True, blank=True)

    class CeoAction(models.TextChoices):
        ACCEPT = "ACCEPT", _("Accept")
        RETURN_TO_HR = "RETURN_TO_HR", _("Return to HR")
        DECLINE = "DECLINE", _("Decline")
        DECLINE_WITH_ALTERNATIVE = "DECLINE_WITH_ALTERNATIVE", _("Decline and select alternative")

    ceo_action = models.CharField(max_length=32, choices=CeoAction.choices, blank=True)
    ceo_selected_option = models.CharField(max_length=32, choices=ContractDecision.DecisionType.choices, blank=True)
    ceo_decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    ceo_comment = models.TextField(blank=True)
    ceo_decided_at = models.DateTimeField(null=True, blank=True)

    salary_change_proposed = models.BooleanField(default=False)
    salary_before_snapshot = models.JSONField(default=dict, blank=True)
    ceo_approved_terms = models.JSONField(default=dict, blank=True)
    ceo_salary_override_reason = models.TextField(blank=True)
    salary_effective_date = models.DateField(null=True, blank=True)
    salary_change_applied_at = models.DateTimeField(null=True, blank=True)
    salary_after_snapshot = models.JSONField(default=dict, blank=True)

    scheduled_termination = models.BooleanField(default=False)
    employee_notified_of_termination_at = models.DateTimeField(null=True, blank=True)
    employee_notified_of_termination_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    termination_processed_at = models.DateTimeField(null=True, blank=True)

    notification_milestones = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=["company", "status"])]


class ContractRatingResponse(models.Model):
    class RaterType(models.TextChoices):
        MANAGER = "MANAGER", _("Manager")
        EMPLOYEE = "EMPLOYEE", _("Employee")

    class Status(models.TextChoices):
        SUBMITTED = "SUBMITTED", _("Submitted")
        RETURNED = "RETURNED", _("Returned for correction")

    rating = models.ForeignKey(ContractRating, on_delete=models.CASCADE, related_name="responses")
    rater_type = models.CharField(max_length=10, choices=RaterType.choices)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.SUBMITTED)
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)

    criterion_ratings = models.JSONField(default=dict)
    average_score = models.DecimalField(max_digits=5, decimal_places=2, editable=False)
    overall_grade = models.CharField(max_length=32, choices=RatingGrade.choices, editable=False)
    overall_remark = models.TextField(blank=True)

    recommendation = models.CharField(max_length=32, choices=Recommendation.choices, blank=True)
    recommended_change_types = models.JSONField(default=list, blank=True)
    proposed_terms = models.JSONField(default=dict, blank=True)
    proposed_job_title = models.CharField(max_length=100, blank=True)
    proposed_position_id = models.IntegerField(null=True, blank=True)
    other_change_notes = models.TextField(blank=True)

    submitted_at = models.DateTimeField(null=True, blank=True)
    returned_at = models.DateTimeField(null=True, blank=True)
    returned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    return_reason = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["rating", "rater_type"], name="one_response_per_rater_per_cycle")
        ]
