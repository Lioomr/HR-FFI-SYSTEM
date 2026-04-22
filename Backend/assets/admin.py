from django.contrib import admin

from .models import Asset, AssetAssignment, AssetCodeSequence, AssetDamageReport, AssetReturnRequest, PrintedLabelJob


@admin.register(Asset)
class AssetAdmin(admin.ModelAdmin):
    list_display = ["asset_code", "name_en", "name_ar", "type", "status", "vendor", "warranty_expiry"]
    search_fields = ["asset_code", "name_en", "name_ar", "serial_number", "plate_number", "mac_address"]
    list_filter = ["type", "status", "vendor"]


@admin.register(AssetAssignment)
class AssetAssignmentAdmin(admin.ModelAdmin):
    list_display = ["asset", "employee", "assigned_by", "assigned_at", "is_active"]
    list_filter = ["is_active", "assigned_at"]


admin.site.register(AssetDamageReport)
admin.site.register(AssetReturnRequest)
admin.site.register(AssetCodeSequence)


@admin.register(PrintedLabelJob)
class PrintedLabelJobAdmin(admin.ModelAdmin):
    list_display = ["id", "company", "created_by", "created_at", "asset_count", "paper_size", "pdf_file"]
    list_filter = ["company", "paper_size", "created_at"]
    search_fields = ["asset_codes", "created_by__email"]
    readonly_fields = ["company", "created_by", "created_at", "asset_count", "paper_size", "pdf_file", "asset_codes"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False
