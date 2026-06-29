import secrets

from django.conf import settings
from django.db import models
from django.utils import timezone


class Invite(models.Model):
    class Status(models.TextChoices):
        SENT = "sent", "Sent"
        ACCEPTED = "accepted", "Accepted"
        REVOKED = "revoked", "Revoked"
        EXPIRED = "expired", "Expired"

    class Channel(models.TextChoices):
        EMAIL = "email", "Email"
        WHATSAPP = "whatsapp", "WhatsApp"

    class DeliveryStatus(models.TextChoices):
        UNKNOWN = "unknown", "Unknown"
        QUEUED = "queued", "Queued"
        SENT = "sent", "Sent"
        DELIVERED = "delivered", "Delivered"
        READ = "read", "Read"
        FAILED = "failed", "Failed"

    email = models.EmailField(db_index=True, null=True, blank=True)
    phone_number = models.CharField(max_length=32, db_index=True, null=True, blank=True)
    channel = models.CharField(max_length=16, choices=Channel.choices, default=Channel.EMAIL)
    role = models.CharField(max_length=32)  # SystemAdmin | HRManager | Employee
    token = models.CharField(max_length=64, unique=True, db_index=True)

    status = models.CharField(max_length=16, choices=Status.choices, default=Status.SENT)

    sent_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_invites",
    )
    revoked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="revoked_invites",
    )
    revoked_at = models.DateTimeField(null=True, blank=True)

    resend_count = models.PositiveIntegerField(default=0)
    last_resent_at = models.DateTimeField(null=True, blank=True)

    last_delivery_channel = models.CharField(max_length=16, choices=Channel.choices, blank=True)
    last_delivery_sent = models.BooleanField(null=True, blank=True)
    last_delivery_provider = models.CharField(max_length=64, blank=True)
    last_delivery_status_code = models.PositiveIntegerField(null=True, blank=True)
    last_delivery_message_id = models.CharField(max_length=255, blank=True)
    last_delivery_error = models.CharField(max_length=500, blank=True)
    last_delivery_at = models.DateTimeField(null=True, blank=True)
    provider_submitted = models.BooleanField(null=True, blank=True)
    provider_status = models.CharField(max_length=64, blank=True)
    delivery_status = models.CharField(
        max_length=16,
        choices=DeliveryStatus.choices,
        default=DeliveryStatus.UNKNOWN,
    )
    external_message_id = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-sent_at"]
        indexes = [
            models.Index(fields=["status"]),
            models.Index(fields=["expires_at"]),
        ]

    @staticmethod
    def generate_token() -> str:
        # URL-safe token
        return secrets.token_urlsafe(32)

    def is_expired(self) -> bool:
        return timezone.now() >= self.expires_at

    def refresh_expired_status_if_needed(self) -> bool:
        """Returns True if status was changed."""
        if self.status == self.Status.SENT and self.is_expired():
            self.status = self.Status.EXPIRED
            self.save(update_fields=["status"])
            return True
        return False
