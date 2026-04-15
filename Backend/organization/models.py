from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _


class OrganizationNode(models.Model):
    class NodeType(models.TextChoices):
        HEAD_OFFICE = "head_office", _("Head Office")
        COMPANY = "company", _("Company")

    code = models.CharField(max_length=40, unique=True)
    name = models.CharField(max_length=120)
    parent = models.ForeignKey(
        "self",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="children",
    )
    node_type = models.CharField(max_length=20, choices=NodeType.choices)
    is_active = models.BooleanField(default=True)
    employee_id_prefix = models.CharField(max_length=20, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["node_type", "name", "id"]

    def __str__(self) -> str:
        return self.name


class UserOrganizationAccess(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="organization_access_entries",
    )
    organization = models.ForeignKey(
        OrganizationNode,
        on_delete=models.CASCADE,
        related_name="user_access_entries",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "organization")
        ordering = ["user_id", "organization_id"]

    def __str__(self) -> str:
        return f"{self.user_id} -> {self.organization_id}"

