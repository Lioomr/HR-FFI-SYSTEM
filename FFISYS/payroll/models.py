from django.db import models
from employees.models import Employee


class Salary(models.Model):
    employee = models.ForeignKey(
        Employee,
        on_delete=models.CASCADE,
        related_name='salaries'
    )

    basic_salary = models.DecimalField(max_digits=10, decimal_places=2)
    allowances = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    deductions = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    net_salary = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        editable=False
    )

    effective_from = models.DateField(
        help_text="Date when this salary becomes effective"
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-effective_from']
        unique_together = ('employee', 'effective_from')

    def save(self, *args, **kwargs):
        self.net_salary = (
            self.basic_salary + self.allowances - self.deductions
        )
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.employee.employee_code} - {self.net_salary}"
