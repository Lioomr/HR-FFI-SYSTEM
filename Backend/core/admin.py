from django.contrib import admin

from .models import DelegationRule, WorkflowAction, WorkflowDefinition, WorkflowInstance, WorkflowStageDefinition


@admin.register(WorkflowDefinition)
class WorkflowDefinitionAdmin(admin.ModelAdmin):
    list_display = ("key", "name", "module_key", "is_active", "updated_at")
    list_filter = ("module_key", "is_active")
    search_fields = ("key", "name", "module_key")


@admin.register(WorkflowStageDefinition)
class WorkflowStageDefinitionAdmin(admin.ModelAdmin):
    list_display = ("definition", "order", "key", "approver_role", "is_optional", "is_terminal")
    list_filter = ("definition", "approver_role", "is_optional", "is_terminal")
    search_fields = ("definition__key", "key", "title")


@admin.register(WorkflowInstance)
class WorkflowInstanceAdmin(admin.ModelAdmin):
    list_display = ("definition", "object_id", "status", "current_stage", "current_approver_role", "updated_at")
    list_filter = ("definition", "status", "current_approver_role")
    search_fields = ("definition__key", "object_id")
    raw_id_fields = ("current_actor_user", "submitted_by")


@admin.register(WorkflowAction)
class WorkflowActionAdmin(admin.ModelAdmin):
    list_display = ("workflow", "action", "approver_role", "from_stage", "to_stage", "created_at")
    list_filter = ("action", "approver_role")
    search_fields = ("workflow__definition__key", "workflow__object_id", "action")
    raw_id_fields = ("workflow", "actor")


@admin.register(DelegationRule)
class DelegationRuleAdmin(admin.ModelAdmin):
    list_display = ("from_user", "to_user", "start_at", "end_at", "is_active")
    list_filter = ("is_active",)
    search_fields = ("from_user__email", "to_user__email")
    raw_id_fields = ("from_user", "to_user", "created_by")
