from django.contrib import admin
from .models import User, AuditLog


@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    list_display = ("email", "role", "is_active", "must_change_password")
    list_filter = ("role", "is_active")
    search_fields = ("email",)
    ordering = ("email",)


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("action", "actor", "target", "timestamp")
    list_filter = ("action", "timestamp")
    search_fields = ("actor__email", "target")
    ordering = ("-timestamp",)
