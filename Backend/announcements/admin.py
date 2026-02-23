from django.contrib import admin
from .models import Announcement


@admin.register(Announcement)
class AnnouncementAdmin(admin.ModelAdmin):
    list_display = ['title', 'created_by', 'created_at', 'is_active', 'publish_to_dashboard', 'publish_to_email', 'publish_to_sms']
    list_filter = ['is_active', 'publish_to_dashboard', 'publish_to_email', 'publish_to_sms', 'created_at']
    search_fields = ['title', 'content']
    readonly_fields = ['created_at', 'updated_at']
    
    fieldsets = (
        ('Content', {
            'fields': ('title', 'content', 'target_roles')
        }),
        ('Publishing Options', {
            'fields': ('publish_to_dashboard', 'publish_to_email', 'publish_to_sms')
        }),
        ('Metadata', {
            'fields': ('created_by', 'is_active', 'created_at', 'updated_at')
        }),
    )
