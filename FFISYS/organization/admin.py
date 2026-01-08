from django.contrib import admin
from .models import Department, JobTitle


@admin.register(Department)
class DepartmentAdmin(admin.ModelAdmin):
    list_display = ('name', 'is_active', 'created_at')
    search_fields = ('name',)
    list_filter = ('is_active',)


@admin.register(JobTitle)
class JobTitleAdmin(admin.ModelAdmin):
    list_display = ('title', 'department', 'is_active', 'created_at')
    search_fields = ('title',)
    list_filter = ('department', 'is_active')
