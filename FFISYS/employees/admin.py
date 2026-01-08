from django.contrib import admin
from .models import Employee


@admin.register(Employee)
class EmployeeAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "first_name",
        "last_name",
        "department",
        "status",
    )

    list_filter = ("status", "department")
    search_fields = ("first_name", "last_name")
    ordering = ("first_name",)
