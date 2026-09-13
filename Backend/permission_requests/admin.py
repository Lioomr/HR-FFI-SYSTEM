from django.contrib import admin

from .models import PermissionRequest


@admin.register(PermissionRequest)
class PermissionRequestAdmin(admin.ModelAdmin):
    """Read-only: every change must go through the API so workflow and audit stay in step."""

    list_display = ("reference_no", "employee", "company", "request_date", "from_time", "to_time", "status")
    list_filter = ("status", "exit_type", "company")
    search_fields = ("reference_no", "employee__email", "employee_profile__full_name")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
