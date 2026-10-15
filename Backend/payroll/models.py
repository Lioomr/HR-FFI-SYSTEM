from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils.translation import gettext_lazy as _
from organization.models import OrganizationNode

from .i18n import ENUMS


class PayrollRun(models.Model):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", _("Draft")
        COMPLETED = "COMPLETED", _("Completed")
        PAID = "PAID", _("Paid")
        CANCELLED = "CANCELLED", _("Cancelled")

    year = models.PositiveIntegerField()
    month = models.PositiveIntegerField()
    company = models.ForeignKey(
        OrganizationNode,
        on_delete=models.PROTECT,
        related_name="payroll_runs",
        null=True,
        blank=True,
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.DRAFT,
    )
    total_net = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_employees = models.PositiveIntegerField(default=0)
    revision = models.PositiveIntegerField(default=1)
    total_gross = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    total_additions = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    total_deductions = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    total_provisions = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    total_company_cost = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    cost_incomplete = models.BooleanField(default=False)
    settings_snapshot = models.JSONField(default=dict, blank=True)
    validation_snapshot = models.JSONField(default=dict, blank=True)
    calculator_version = models.CharField(max_length=32, default="legacy")
    legacy_calculation = models.BooleanField(default=True)
    calculated_at = models.DateTimeField(null=True, blank=True)
    finalized_at = models.DateTimeField(null=True, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    cancel_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-year", "-month", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["company", "year", "month"],
                condition=~models.Q(status="CANCELLED"),
                name="unique_payroll_run_period",
            )
        ]

    def __str__(self):
        return f"{self.year}-{self.month:02d}"


class PayrollRunItem(models.Model):
    is_active = models.BooleanField(default=True)
    payroll_run = models.ForeignKey(
        PayrollRun,
        on_delete=models.CASCADE,
        related_name="items",
    )
    employee_id = models.CharField(max_length=20)
    employee_name = models.CharField(max_length=255)
    department = models.CharField(max_length=100, blank=True)
    position = models.CharField(max_length=100, blank=True)
    basic_salary = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_allowances = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_deductions = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    net_salary = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    employee_profile = models.ForeignKey(
        "employees.EmployeeProfile", null=True, blank=True, on_delete=models.PROTECT, related_name="payroll_items"
    )
    company = models.ForeignKey(OrganizationNode, null=True, blank=True, on_delete=models.PROTECT)
    input_snapshot = models.JSONField(default=dict, blank=True)
    gross_salary = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    total_additions = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    total_provisions = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    total_company_cost = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    cost_incomplete = models.BooleanField(default=False)
    zero_salary_reason = models.CharField(
        max_length=24,
        null=True,
        blank=True,
        choices=[(v, v) for v in ("full_leave", "full_absence", "unpaid_leave", "not_joined", "suspended", "other")],
    )
    zero_salary_reason_detail = models.TextField(null=True, blank=True)
    suspended_pay_decision = models.CharField(
        max_length=12, null=True, blank=True, choices=[("FULL_PAY", "Full pay"), ("ZERO_PAY", "Zero pay")]
    )
    accommodation_status = models.CharField(
        max_length=12,
        default="unknown",
        choices=[("assigned", "Assigned"), ("none", "No company accommodation"), ("unknown", "Accommodation unknown")],
    )

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["payroll_run", "employee_profile"], name="unique_payroll_item_profile")
        ]


class Payslip(models.Model):
    employee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="payslips",
        null=True,
        blank=True,
    )
    payroll_run = models.ForeignKey(
        PayrollRun,
        on_delete=models.CASCADE,
        related_name="payslips",
    )
    year = models.PositiveIntegerField()
    month = models.PositiveIntegerField()
    basic_salary = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    transportation_allowance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    accommodation_allowance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    telephone_allowance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    petrol_allowance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    other_allowance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_salary = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_deductions = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    net_salary = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    payment_mode = models.CharField(max_length=100, default="Bank Transfer")
    status = models.CharField(max_length=20, choices=PayrollRun.Status.choices, default=PayrollRun.Status.DRAFT)
    employee_profile = models.ForeignKey(
        "employees.EmployeeProfile", null=True, blank=True, on_delete=models.PROTECT, related_name="profile_payslips"
    )
    payroll_run_item = models.OneToOneField(
        PayrollRunItem, null=True, blank=True, on_delete=models.PROTECT, related_name="payslip"
    )
    company = models.ForeignKey(OrganizationNode, null=True, blank=True, on_delete=models.PROTECT)
    total_additions = models.DecimalField(max_digits=18, decimal_places=2, default=0)
    calculation_version = models.CharField(max_length=32, default="legacy")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-year", "-month", "-id"]


class AttendancePayrollDeduction(models.Model):
    """One claimable payroll deduction for a late violation, never rewrites a locked run.

    ``pending`` is unclaimed; ``claimed`` is inside a DRAFT run, with
    ``claimed_amount`` recording exactly what was added to its totals;
    ``applied`` is locked in a COMPLETED/PAID run; ``manual_review`` is an
    applied deduction later invalidated by attendance policy; ``void`` was
    invalidated before any payroll lock.
    """

    class Status(models.TextChoices):
        PENDING = "pending", _("Pending")
        CLAIMED = "claimed", _("Claimed by draft payroll")
        APPLIED = "applied", _("Applied")
        MANUAL_REVIEW = "manual_review", _("Manual review")
        VOID = "void", _("Void")

    violation = models.OneToOneField(
        "attendance.AttendanceLateViolation", on_delete=models.PROTECT, related_name="payroll_deduction"
    )
    employee_profile = models.ForeignKey(
        "employees.EmployeeProfile", on_delete=models.PROTECT, related_name="attendance_payroll_deductions"
    )
    company = models.ForeignKey(
        OrganizationNode, on_delete=models.PROTECT, related_name="attendance_payroll_deductions"
    )
    intended_year = models.PositiveIntegerField()
    intended_month = models.PositiveIntegerField()
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    claimed_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    claimed_exact_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.PENDING)
    payroll_run = models.ForeignKey(
        PayrollRun, null=True, blank=True, on_delete=models.PROTECT, related_name="attendance_deductions"
    )
    payroll_run_item = models.ForeignKey(
        PayrollRunItem, null=True, blank=True, on_delete=models.PROTECT, related_name="attendance_deductions"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class PayrollOwnedModel(models.Model):
    company = models.ForeignKey(OrganizationNode, on_delete=models.PROTECT)

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

    def clean(self):
        super().clean()
        if self.company_id and self.company.node_type != OrganizationNode.NodeType.COMPANY:
            raise ValidationError({"company": "company_mismatch"})
        for name in ("employee_profile", "item", "run", "origin_run", "carry", "rent"):
            related_id = getattr(self, name + "_id", None)
            if related_id and getattr(self, name).company_id != self.company_id:
                raise ValidationError({name: "company_mismatch"})
        if getattr(self, "carry_id", None) and getattr(self, "item_id", None):
            if self.carry.employee_profile_id != self.item.employee_profile_id:
                raise ValidationError({"carry": "company_mismatch"})
        if getattr(self, "run_id", None) and getattr(self, "item_id", None):
            if self.item.payroll_run_id != self.run_id:
                raise ValidationError({"item": "company_mismatch"})


class PayrollSettings(PayrollOwnedModel):
    class SalaryBase(models.TextChoices):
        BASIC = "BASIC", _("Basic")
        BASIC_HOUSING = "BASIC_HOUSING", _("Basic + Housing")
        BASIC_HOUSING_TRANSPORT = "BASIC_HOUSING_TRANSPORT", _("Basic + Housing + Transportation")
        GROSS = "GROSS", _("Gross")
        FIXED_AMOUNT = "FIXED_AMOUNT", _("Fixed amount")

    class ProvisionProration(models.TextChoices):
        FULL_MONTH = "FULL_MONTH", _("Full month")
        PRORATED_BY_DAYS = "PRORATED_BY_DAYS", _("Prorated by payable days")

    company = models.OneToOneField(OrganizationNode, on_delete=models.PROTECT, related_name="payroll_settings")
    revision = models.PositiveIntegerField(default=1)
    absence_base_type = models.CharField(max_length=32, choices=SalaryBase.choices, default=SalaryBase.GROSS)
    gosi_base_type = models.CharField(max_length=32, choices=SalaryBase.choices, default=SalaryBase.BASIC_HOUSING)
    leave_base_type = models.CharField(max_length=32, choices=SalaryBase.choices, default=SalaryBase.BASIC)
    eos_base_type = models.CharField(max_length=32, choices=SalaryBase.choices, default=SalaryBase.BASIC)
    overtime_base_type = models.CharField(max_length=32, choices=SalaryBase.choices, default=SalaryBase.BASIC)
    absence_fixed_amount = models.DecimalField(
        max_digits=18, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(0)]
    )
    gosi_fixed_amount = models.DecimalField(
        max_digits=18, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(0)]
    )
    leave_fixed_amount = models.DecimalField(
        max_digits=18, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(0)]
    )
    eos_fixed_amount = models.DecimalField(
        max_digits=18, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(0)]
    )
    overtime_fixed_amount = models.DecimalField(
        max_digits=18, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(0)]
    )
    foreign_gosi_rate = models.DecimalField(
        max_digits=8,
        decimal_places=6,
        default=Decimal("0.020000"),
        validators=[MinValueValidator(0), MaxValueValidator(1)],
    )
    saudi_gosi_rate = models.DecimalField(
        max_digits=8,
        decimal_places=6,
        default=Decimal("0.097500"),
        validators=[MinValueValidator(0), MaxValueValidator(1)],
    )
    annual_medical_invoice = models.DecimalField(
        max_digits=18, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(0)]
    )
    no_medical_insurance = models.BooleanField(default=False)
    monthly_foreign_id_cost = models.DecimalField(
        max_digits=18, decimal_places=2, default=Decimal("862.50"), validators=[MinValueValidator(0)]
    )
    annual_air_ticket = models.DecimalField(
        max_digits=18, decimal_places=2, default=Decimal("1500.00"), validators=[MinValueValidator(0)]
    )
    provision_proration = models.CharField(
        max_length=24, choices=ProvisionProration.choices, default=ProvisionProration.FULL_MONTH
    )
    require_manual_absence_confirmation = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def clean(self):
        super().clean()
        for name in ("absence", "gosi", "leave", "eos", "overtime"):
            fixed = getattr(self, name + "_fixed_amount")
            if (getattr(self, name + "_base_type") == self.SalaryBase.FIXED_AMOUNT) != (fixed is not None):
                raise ValidationError({name + "_fixed_amount": "invalid_choice"})

    def snapshot(self):
        from .calculator import default_settings

        result = default_settings()
        for name in ("absence", "gosi", "leave", "eos", "overtime"):
            value = getattr(self, name + "_fixed_amount")
            result[name + "_base"] = {
                "type": getattr(self, name + "_base_type"),
                "fixed_amount": None if value is None else f"{value:.2f}",
            }
        for name in ("foreign_gosi_rate", "saudi_gosi_rate"):
            result[name] = f"{getattr(self, name):.6f}"
        for name in ("annual_medical_invoice", "monthly_foreign_id_cost", "annual_air_ticket"):
            value = getattr(self, name)
            result[name] = None if value is None else f"{value:.2f}"
        for name in ("no_medical_insurance", "provision_proration", "require_manual_absence_confirmation"):
            result[name] = getattr(self, name)
        result.update(
            schema_version=1,
            company_id=self.company_id,
            settings_revision=self.revision,
            payroll_timezone=settings.TIME_ZONE,
        )
        return result


class PayrollLine(PayrollOwnedModel):
    item = models.ForeignKey(PayrollRunItem, on_delete=models.CASCADE, related_name="lines")
    category = models.CharField(
        max_length=16, choices=[(v, v) for v in ("SALARY", "ADDITION", "DEDUCTION", "PROVISION")]
    )
    type = models.CharField(max_length=40, choices=[(entry["value"], entry["label"]) for entry in ENUMS["line_type"]])
    source_key = models.CharField(max_length=160)
    source_kind = models.CharField(
        max_length=40,
        choices=[
            (value, value)
            for value in (
                "employee_salary",
                "attendance_absence",
                "unpaid_leave",
                "manual_adjustment",
                "loan",
                "attendance_penalty",
                "penalty",
                "carry_forward",
                "company_settings",
                "rent_allocation",
                "legacy",
            )
        ],
    )
    source_id = models.CharField(max_length=64, null=True, blank=True)
    source_year = models.PositiveIntegerField(null=True, blank=True)
    source_month = models.PositiveIntegerField(null=True, blank=True)
    quantity = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    amount = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    requested_amount = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    collected_amount = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    uncollected_amount = models.DecimalField(max_digits=18, decimal_places=2, null=True, blank=True)
    carried_in = models.BooleanField(default=False)
    calculation_snapshot = models.JSONField(default=dict, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["item", "source_key"], name="unique_payroll_line_source"),
            models.CheckConstraint(
                condition=models.Q(category="PROVISION") | models.Q(amount__isnull=False),
                name="payroll_line_known_salary",
            ),
        ]


class PayrollAdjustment(PayrollOwnedModel):
    audit_log = models.OneToOneField("audit.AuditLog", on_delete=models.PROTECT)
    run = models.ForeignKey(PayrollRun, null=True, blank=True, on_delete=models.PROTECT)
    item = models.ForeignKey(PayrollRunItem, null=True, blank=True, on_delete=models.PROTECT)
    type = models.CharField(max_length=32)
    changed_fields = models.JSONField(default=list)
    original_value = models.JSONField(null=True, blank=True)
    new_value = models.JSONField(blank=True)
    reason = models.TextField()
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)
    input_revision = models.PositiveIntegerField()

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValidationError("field_not_editable")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("field_not_editable")


class PayrollCarryForward(PayrollOwnedModel):
    employee_profile = models.ForeignKey("employees.EmployeeProfile", on_delete=models.PROTECT)
    origin_run = models.ForeignKey(PayrollRun, on_delete=models.PROTECT)
    source_key = models.CharField(max_length=160)
    type = models.CharField(max_length=40, choices=[("ABSENCE", "Absence"), ("GOSI_EMPLOYEE", "Employee GOSI")])
    original_authorized_amount = models.DecimalField(max_digits=18, decimal_places=2, validators=[MinValueValidator(0)])
    remaining_amount = models.DecimalField(max_digits=18, decimal_places=2, validators=[MinValueValidator(0)])
    source_year = models.PositiveIntegerField()
    source_month = models.PositiveIntegerField()
    status = models.CharField(
        max_length=16, default="PENDING", choices=[("PENDING", "Pending"), ("SETTLED", "Settled")]
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["company", "employee_profile", "type", "origin_run", "source_key"],
                name="unique_payroll_carry_source",
            ),
            models.CheckConstraint(
                condition=models.Q(remaining_amount__gte=0)
                & models.Q(remaining_amount__lte=models.F("original_authorized_amount")),
                name="payroll_carry_balance_range",
            ),
        ]


class PayrollCarryForwardCollection(PayrollOwnedModel):
    carry = models.ForeignKey(PayrollCarryForward, on_delete=models.PROTECT)
    run = models.ForeignKey(PayrollRun, on_delete=models.PROTECT)
    item = models.ForeignKey(PayrollRunItem, on_delete=models.PROTECT)
    amount = models.DecimalField(max_digits=18, decimal_places=2, validators=[MinValueValidator(0)])
    state = models.CharField(max_length=16, choices=[(v, v) for v in ("CLAIMED", "APPLIED", "RELEASED")])
    audit_log = models.ForeignKey("audit.AuditLog", on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["carry", "run"], name="unique_payroll_carry_run")]


class AccommodationAssignment(PayrollOwnedModel):
    employee_profile = models.ForeignKey(
        "employees.EmployeeProfile", on_delete=models.PROTECT, related_name="payroll_accommodation_assignments"
    )
    rent = models.ForeignKey("rents.Rent", on_delete=models.PROTECT, null=True, blank=True)
    status = models.CharField(
        max_length=12,
        choices=[("assigned", "Assigned"), ("none", "No company accommodation"), ("unknown", "Accommodation unknown")],
    )
    start_date = models.DateField()
    end_date = models.DateField()
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="payroll_assignments_created",
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="payroll_assignments_updated",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(end_date__gte=models.F("start_date")), name="payroll_assignment_date_order"
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(status="assigned", rent__isnull=False)
                    | models.Q(status__in=["none", "unknown"], rent__isnull=True)
                ),
                name="payroll_assignment_rent_status",
            ),
        ]


class PayrollRentAllocation(PayrollOwnedModel):
    run = models.ForeignKey(PayrollRun, on_delete=models.PROTECT, related_name="rent_allocations")
    rent = models.ForeignKey("rents.Rent", on_delete=models.PROTECT)
    annual_rent = models.DecimalField(max_digits=18, decimal_places=2)
    slot_inputs = models.JSONField(default=list, blank=True)
    resident_allocations = models.JSONField(default=list, blank=True)
    monthly_rent = models.JSONField()
    vacant_unallocated_raw = models.JSONField()
    not_in_payroll_raw = models.JSONField()
    rounding_difference = models.JSONField()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["run", "rent"], name="unique_payroll_run_rent")]
