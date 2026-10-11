"""Offboarding: a deactivated account's signing certificates are revoked."""

from __future__ import annotations

from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver


@receiver(post_save, sender=settings.AUTH_USER_MODEL, dispatch_uid="document_integrity_revoke_on_deactivate")
def revoke_certificates_of_deactivated_user(sender, instance, created, **kwargs):
    if created or getattr(instance, "is_active", True):
        return
    from .certificates import revoke_user_certificates

    revoke_user_certificates(instance, reason="account deactivated")
