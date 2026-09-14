from django.contrib import admin

from .models import OrganizationNode, UserOrganizationAccess


@admin.register(OrganizationNode)
class OrganizationNodeAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "code", "node_type", "parent", "employee_id_prefix", "late_notice_signer", "is_active")
    list_select_related = ("late_notice_signer",)
    list_filter = ("node_type", "is_active")
    search_fields = ("name", "code")


@admin.register(UserOrganizationAccess)
class UserOrganizationAccessAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "organization", "created_at")
    list_select_related = ("user", "organization")
    search_fields = ("user__email", "organization__name", "organization__code")
