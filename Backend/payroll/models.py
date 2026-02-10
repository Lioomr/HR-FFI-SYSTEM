from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _


class PayrollRun(models.Model):
    class Status(models.TextChoices):
        DRAFT = "DRAFT", _("Draft")
        COMPLETED = "COMPLETED", _("Completed")
        PAID = "PAID", _("Paid")
        CANCELLED = "CANCELLED", _("Cancelled")

    year = models.PositiveIntegerField()
    month = models.PositiveIntegerField()
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.DRAFT,
    )
    total_net = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_employees = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-year", "-month", "-id"]
        constraints = [models.UniqueConstraint(fields=["year", "month"], name="unique_payroll_run_period")]

    def __str__(self):
        return f"{self.year}-{self.month:02d}"


class PayrollRunItem(models.Model):
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

    class Meta:
        ordering = ["id"]


class Payslip(models.Model):
    employee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="payslips",
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
    status = models.CharField(max_length=20, default="PAID")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-year", "-month", "-id"]
