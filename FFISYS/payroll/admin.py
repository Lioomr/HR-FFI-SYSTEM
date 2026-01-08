from django.contrib import admin
from .models import Salary


@admin.register(Salary)
class SalaryAdmin(admin.ModelAdmin):
    list_display = (
        "employee",
        "basic_salary",
        "allowances",
        "deductions",
        "net_salary",
        "effective_from",
    )

    readonly_fields = ("net_salary", "created_at")

    # 🔐 PERMISSIONS LOGIC

    def has_add_permission(self, request):
        return request.user.role in ("ADMIN", "HR")

    def has_change_permission(self, request, obj=None):
        return request.user.role in ("ADMIN", "HR")

    def has_delete_permission(self, request, obj=None):
        return request.user.role == "ADMIN"
