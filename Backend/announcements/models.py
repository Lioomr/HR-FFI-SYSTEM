from django.conf import settings
from django.core.validators import FileExtensionValidator
from django.db import models

from employees.storage import PrivateUploadStorage
from organization.models import OrganizationNode


class Announcement(models.Model):
    """
    Announcements created by HR managers for different user roles.
    """

    class AnnouncementType(models.TextChoices):
        GENERAL = "GENERAL", "General"
        MEETING = "MEETING", "Meeting"

    title = models.CharField(max_length=200)
    content = models.TextField()
    announcement_type = models.CharField(
        max_length=20,
        choices=AnnouncementType.choices,
        default=AnnouncementType.GENERAL,
    )
    company = models.ForeignKey(
        OrganizationNode,
        on_delete=models.PROTECT,
        related_name="announcements",
        null=True,
        blank=True,
    )
    target_roles = models.JSONField(help_text="List of role names that should see this announcement")
    target_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="targeted_announcements",
        help_text="Optional single-user target for private announcement delivery",
    )

    # Publishing options
    publish_to_dashboard = models.BooleanField(default=True, help_text="Show announcement on user dashboards")
    publish_to_email = models.BooleanField(default=False, help_text="Send announcement via email")
    publish_to_sms = models.BooleanField(default=False, help_text="Send announcement via SMS (placeholder)")
    attachment = models.FileField(
        storage=PrivateUploadStorage(),
        upload_to="announcement_attachments/",
        null=True,
        blank=True,
        validators=[FileExtensionValidator(allowed_extensions=["pdf"])],
        help_text="Optional PDF attachment for dashboard preview and email delivery.",
    )

    # Meeting details. Used only when announcement_type=MEETING.
    meeting_starts_at = models.DateTimeField(null=True, blank=True)
    meeting_duration_minutes = models.PositiveIntegerField(null=True, blank=True)
    meeting_location = models.CharField(max_length=255, blank=True)
    meeting_agenda = models.TextField(blank=True)
    google_meet_url = models.URLField(max_length=500, blank=True)
    microsoft_teams_url = models.URLField(max_length=500, blank=True)
    zoom_url = models.URLField(max_length=500, blank=True)

    # Metadata
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="announcements_created"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["-created_at"]),
            models.Index(fields=["is_active"]),
        ]

    def __str__(self):
        return self.title
