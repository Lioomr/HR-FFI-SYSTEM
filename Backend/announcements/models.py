from django.db import models
from django.conf import settings


class Announcement(models.Model):
    """
    Announcements created by HR managers for different user roles.
    """
    title = models.CharField(max_length=200)
    content = models.TextField()
    target_roles = models.JSONField(
        help_text="List of role names that should see this announcement"
    )
    target_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="targeted_announcements",
        help_text="Optional single-user target for private announcement delivery",
    )
    
    # Publishing options
    publish_to_dashboard = models.BooleanField(
        default=True,
        help_text="Show announcement on user dashboards"
    )
    publish_to_email = models.BooleanField(
        default=False,
        help_text="Send announcement via email"
    )
    publish_to_sms = models.BooleanField(
        default=False,
        help_text="Send announcement via SMS (placeholder)"
    )
    
    # Metadata
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='announcements_created'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    is_active = models.BooleanField(default=True)
    
    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['-created_at']),
            models.Index(fields=['is_active']),
        ]
    
    def __str__(self):
        return self.title
