from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _

from employees.models import EmployeeProfile
from payroll.models import PayrollRun


class LoanRequest(models.Model):
    class LoanType(models.TextChoices):
        OPEN = "open", _("Open Loan")
        INSTALLMENT = "installment", _("Installment Loan")

    class Recommendation(models.TextChoices):
        APPROVE = "approve", _("Approve")
        REJECT = "reject", _("Reject")

    class RequestStatus(models.TextChoices):
        SUBMITTED = "submitted", _("Submitted")
        PENDING_MANAGER = "pending_manager", _("Pending Manager")
        PENDING_HR = "pending_hr", _("Pending HR")
        PENDING_FINANCE = "pending_finance", _("Pending Finance (Legacy)")
        PENDING_CFO = "pending_cfo", _("Pending CFO")
        PENDING_CEO = "pending_ceo", _("Pending CEO")
        PENDING_DISBURSEMENT = "pending_disbursement", _("Pending Disbursement")
        APPROVED = "approved", _("Approved")
        REJECTED = "rejected", _("Rejected")
        CANCELLED = "cancelled", _("Cancelled")
        DEDUCTED = "deducted", _("Deducted")

    employee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="loan_requests",
    )
    employee_profile = models.ForeignKey(
        EmployeeProfile,
        on_delete=models.CASCADE,
        related_name="loan_requests",
    )
    requested_amount = models.DecimalField(max_digits=12, decimal_places=2)
    approved_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    loan_type = models.CharField(max_length=20, choices=LoanType.choices, default=LoanType.OPEN)
    installment_months = models.PositiveSmallIntegerField(null=True, blank=True)
    reason = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=RequestStatus.choices, default=RequestStatus.SUBMITTED)

    manager_decision_at = models.DateTimeField(null=True, blank=True)
    manager_decision_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="manager_decided_loans",
    )
    manager_decision_note = models.TextField(blank=True)
    manager_recommendation = models.CharField(
        max_length=16, choices=Recommendation.choices, null=True, blank=True
    )

    finance_decision_at = models.DateTimeField(null=True, blank=True)
    finance_decision_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="finance_decided_loans",
    )
    finance_decision_note = models.TextField(blank=True)
    hr_recommendation = models.CharField(max_length=16, choices=Recommendation.choices, null=True, blank=True)

    cfo_decision_at = models.DateTimeField(null=True, blank=True)
    cfo_decision_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="cfo_decided_loans",
    )
    cfo_decision_note = models.TextField(blank=True)

    ceo_decision_at = models.DateTimeField(null=True, blank=True)
    ceo_decision_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ceo_decided_loans",
    )
    ceo_decision_note = models.TextField(blank=True)

    deduction_payroll_run = models.ForeignKey(
        PayrollRun,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="deducted_loans",
    )
    deducted_at = models.DateTimeField(null=True, blank=True)
    deducted_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    approved_year = models.PositiveIntegerField(null=True, blank=True)
    approved_month = models.PositiveIntegerField(null=True, blank=True)
    target_deduction_year = models.PositiveIntegerField(null=True, blank=True)
    target_deduction_month = models.PositiveIntegerField(null=True, blank=True)
    disbursed_at = models.DateTimeField(null=True, blank=True)
    disbursed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="disbursed_loans",
    )
    disbursement_note = models.TextField(blank=True)

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "created_at"], name="loans_loanr_status_65deaa_idx"),
            models.Index(fields=["employee", "created_at"], name="loans_loanr_employe_2db8c2_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(requested_amount__gt=0),
                name="loan_requested_amount_gt_zero",
            )
        ]

    def __str__(self):
        return f"{self.employee.email} - {self.requested_amount} ({self.status})"


class LoanWorkflowConfig(models.Model):
    finance_department_id = models.PositiveIntegerField(default=8)
    finance_position_id = models.PositiveIntegerField(default=24)
    cfo_position_id = models.PositiveIntegerField(default=3)
    ceo_position_id = models.PositiveIntegerField(default=1)
    require_manager_stage = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-id"]

    def __str__(self):
        return (
            "Loan Workflow Config "
            f"(finance_dept={self.finance_department_id}, "
            f"finance_pos={self.finance_position_id}, "
            f"cfo_pos={self.cfo_position_id}, ceo_pos={self.ceo_position_id})"
        )
