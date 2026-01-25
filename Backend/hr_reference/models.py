from django.db import models
from django.utils.translation import gettext_lazy as _


class ReferenceBase(models.Model):
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


class Position(ReferenceBase):
    class Meta(ReferenceBase.Meta):
        verbose_name = _("Position")
        verbose_name_plural = _("Positions")


class TaskGroup(ReferenceBase):
    class Meta(ReferenceBase.Meta):
        verbose_name = _("Task Group")
        verbose_name_plural = _("Task Groups")


class Sponsor(ReferenceBase):
    code = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=100, blank=True)

    class Meta(ReferenceBase.Meta):
        verbose_name = _("Sponsor")
        verbose_name_plural = _("Sponsors")
