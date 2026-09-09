"""Narrow write path for an employee's reusable signature.

``EmployeeProfile.save()`` calls ``self.clean()`` unconditionally, so any save -
even one restricted to ``update_fields=["signature"]`` - re-validates
relationships the write never touches. A profile carrying a stale
``manager_profile`` (one whose employee has no linked user account) therefore
made a perfectly valid signature upload fail with a ``ValidationError``, which
surfaced as HTTP 500.

Storing a signature is not an edit of the employment record, so it does not need
that record to be valid. These helpers write only the two signature columns with
``QuerySet.update()``, leaving every other field and all manager-assignment
validation exactly as it is for real profile edits.

Authorization, company scoping, file validation, and audit logging stay in the
view: this module is only the write, and it never decides who may perform it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)

@dataclass(frozen=True)
class SignatureWriteResult:
    stored_name: str
    previous_name: str
    replaced: bool


def _profile_rows(profile):
    """A queryset addressing exactly this profile, by primary key only."""

    return type(profile)._base_manager.filter(pk=profile.pk)


def discard_stored_file(profile, name: str) -> None:
    """Delete a private signature file, never raising into the request."""

    if not name:
        return
    try:
        profile.signature.storage.delete(name)
    except (OSError, NotImplementedError):
        # The database row is already consistent; a stale blob is not worth a 500.
        logger.warning(
            "employee_signature.file_cleanup_failed",
            extra={"employee_profile_id": str(getattr(profile, "pk", "") or "")},
        )


def store_signature(profile, upload) -> SignatureWriteResult:
    """Persist ``upload`` as this profile's signature, replacing any previous one.

    The file is written first so the database only ever points at bytes that
    exist. If the row update then fails, the file just written is removed before
    the error propagates, so a failed write leaves nothing orphaned and the
    previous signature is left untouched.
    """

    previous_name = profile.signature.name if profile.signature else ""
    field = type(profile)._meta.get_field("signature")
    target_name = field.generate_filename(profile, getattr(upload, "name", "signature.png"))
    stored_name = profile.signature.storage.save(target_name, upload)

    now = timezone.now()
    try:
        with transaction.atomic():
            updated = _profile_rows(profile).update(signature=stored_name, signature_uploaded_at=now, updated_at=now)
        if not updated:
            raise type(profile).DoesNotExist(f"Employee profile {profile.pk} no longer exists.")
    except Exception:
        # Never leave the freshly written blob behind on a failed row update.
        discard_stored_file(profile, stored_name)
        raise

    profile.signature.name = stored_name
    profile.signature_uploaded_at = now
    profile.updated_at = now
    if previous_name and previous_name != stored_name:
        discard_stored_file(profile, previous_name)
    return SignatureWriteResult(stored_name=stored_name, previous_name=previous_name, replaced=bool(previous_name))


def clear_signature(profile) -> str:
    """Remove this profile's signature. Returns the name that was cleared.

    The row is cleared before the file is deleted, so a failure mid-way leaves a
    recoverable file rather than a row pointing at nothing.
    """

    previous_name = profile.signature.name if profile.signature else ""
    now = timezone.now()
    with transaction.atomic():
        _profile_rows(profile).update(signature=None, signature_uploaded_at=None, updated_at=now)

    profile.signature = None
    profile.signature_uploaded_at = None
    profile.updated_at = now
    discard_stored_file(profile, previous_name)
    return previous_name
