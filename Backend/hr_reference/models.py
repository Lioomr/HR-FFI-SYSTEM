from django.db import models
from django.utils.translation import gettext_lazy as _

from organization.models import OrganizationNode


class ReferenceBase(models.Model):
    company = models.ForeignKey(
        OrganizationNode,
        on_delete=models.PROTECT,
        related_name="%(class)ss",
        null=True,
        blank=True,
    )
    code = models.CharField(max_length=20)
    name = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
        ordering = ["code"]

    def __str__(self) -> str:
        return f"{self.code} - {self.name}"


class Department(ReferenceBase):
    class Meta(ReferenceBase.Meta):
        verbose_name = _("Department")
        verbose_name_plural = _("Departments")
        constraints = [
            models.UniqueConstraint(fields=["company", "code"], name="uniq_department_company_code"),
        ]


class Position(ReferenceBase):
    class Meta(ReferenceBase.Meta):
        verbose_name = _("Position")
        verbose_name_plural = _("Positions")
        constraints = [
            models.UniqueConstraint(fields=["company", "code"], name="uniq_position_company_code"),
        ]


class TaskGroup(ReferenceBase):
    class Meta(ReferenceBase.Meta):
        verbose_name = _("Task Group")
        verbose_name_plural = _("Task Groups")
        constraints = [
            models.UniqueConstraint(fields=["company", "code"], name="uniq_task_group_company_code"),
        ]


class Sponsor(ReferenceBase):
    code = models.CharField(max_length=20)
    name = models.CharField(max_length=100, blank=True)

    class Meta(ReferenceBase.Meta):
        verbose_name = _("Sponsor")
        verbose_name_plural = _("Sponsors")
        constraints = [
            models.UniqueConstraint(fields=["company", "code"], name="uniq_sponsor_company_code"),
        ]
