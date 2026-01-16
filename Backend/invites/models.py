from django.conf import settings
from django.db import models
from django.utils import timezone
from django.core.validators import MinValueValidator
import secrets


class Invite(models.Model):
    class Status(models.TextChoices):
        SENT = "sent", "Sent"
        ACCEPTED = "accepted", "Accepted"
        REVOKED = "revoked", "Revoked"
        EXPIRED = "expired", "Expired"

    email = models.EmailField(db_index=True)
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
