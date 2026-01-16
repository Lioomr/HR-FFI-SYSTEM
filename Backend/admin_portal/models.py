from django.db import models


class SystemSettings(models.Model):
    """
    Singleton settings record for Phase 1.
    Store only one row (id=1).
    """

    # Password policy
    password_min_length = models.PositiveIntegerField(default=8)
    password_require_upper = models.BooleanField(default=True)
    password_require_lower = models.BooleanField(default=True)
    password_require_number = models.BooleanField(default=True)
    password_require_special = models.BooleanField(default=False)

    # Session
    session_timeout_minutes = models.PositiveIntegerField(default=30)

    # Security
    max_login_attempts = models.PositiveIntegerField(default=5)

    # Invites
    default_invite_expiry_hours = models.PositiveIntegerField(default=72)

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "system_settings"

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(id=1)
        return obj
