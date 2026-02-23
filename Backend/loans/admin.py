from django.contrib import admin

from .models import LoanRequest, LoanWorkflowConfig


@admin.register(LoanRequest)
class LoanRequestAdmin(admin.ModelAdmin):
    list_display = ("id", "employee", "requested_amount", "status", "created_at")
    list_filter = ("status", "created_at")
    search_fields = ("employee__email", "employee_profile__full_name")


@admin.register(LoanWorkflowConfig)
class LoanWorkflowConfigAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "is_active",
        "finance_department_id",
        "finance_position_id",
        "cfo_position_id",
        "ceo_position_id",
        "require_manager_stage",
        "updated_at",
    )
    list_filter = ("is_active", "require_manager_stage")
