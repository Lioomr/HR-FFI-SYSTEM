from django.conf import settings
from django.core.exceptions import ValidationError
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


class OrganizationScope(models.Model):
    """An explicit, auditable set of companies under one approved operating scope."""

    code = models.CharField(max_length=60, unique=True)
    name = models.CharField(max_length=160)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="organization_scopes_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "id"]

    def __str__(self) -> str:
        return self.name


class OrganizationScopeMembership(models.Model):
    scope = models.ForeignKey(
        OrganizationScope,
        on_delete=models.CASCADE,
        related_name="memberships",
    )
    company = models.ForeignKey(
        OrganizationNode,
        on_delete=models.PROTECT,
        related_name="organization_scope_memberships",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["scope", "company"], name="organization_scope_company_unique")]
        ordering = ["scope_id", "company_id"]

    def clean(self):
        super().clean()
        if self.company_id and self.company.node_type != OrganizationNode.NodeType.COMPANY:
            raise ValidationError({"company": "Organization scopes can contain COMPANY nodes only."})
        if self.company_id and not self.company.is_active:
            raise ValidationError({"company": "Organization scopes can contain active companies only."})

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)
