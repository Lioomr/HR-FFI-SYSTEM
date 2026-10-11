"""Storage for frozen (tamper-evident) approved documents and signing credentials.

These models are imported by ``core.models`` so they belong to the ``core`` app.

Foreign keys to users, companies and content types use ``DO_NOTHING``: the
database constraint still refuses to delete a referenced row (evidence must not
silently lose its actor), but Django's delete collector never queries these
tables. That keeps historical-schema migration tests, which delete rows while
these tables do not exist yet, working.
"""

from __future__ import annotations

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models
from django.utils import timezone

from employees.storage import PrivateUploadStorage


class FrozenDocument(models.Model):
    """The one stored, hashed copy of an approved document.

    Once a request reaches its final approval its PDF is rendered once, stored
    privately, and hashed. Downloads serve this file instead of re-rendering, so
    later profile or signature changes can no longer alter an approved document.
    ``sha256`` always covers the exact bytes in ``file`` (the sealed PDF once a
    seal is applied); ``unsigned_sha256`` covers ``unsigned_file``, the frozen
    PDF before any digital signature.
    """

    class SealStatus(models.TextChoices):
        NONE = "none", "Not sealed"
        PENDING = "pending", "Seal pending"
        SEALED = "sealed", "Sealed"
        FAILED = "failed", "Seal failed"

    # DO_NOTHING keeps the DB foreign key (a content type in use cannot be deleted) without
    # making Django's delete collector query these tables (historical-schema migration tests).
    content_type = models.ForeignKey(ContentType, on_delete=models.DO_NOTHING)
    object_id = models.PositiveIntegerField()
    content_object = GenericForeignKey("content_type", "object_id")
    document_type = models.CharField(max_length=50)
    reference = models.CharField(max_length=80, blank=True, default="")
    company = models.ForeignKey(
        "organization.OrganizationNode", on_delete=models.DO_NOTHING, null=True, blank=True, related_name="+"
    )

    file = models.FileField(storage=PrivateUploadStorage(), upload_to="frozen_documents/", max_length=255)
    sha256 = models.CharField(max_length=64, db_index=True)
    size_bytes = models.PositiveIntegerField(default=0)
    unsigned_file = models.FileField(
        storage=PrivateUploadStorage(), upload_to="frozen_documents/", max_length=255, blank=True
    )
    unsigned_sha256 = models.CharField(max_length=64, blank=True, default="", db_index=True)

    signing_mode = models.CharField(max_length=20, default="freeze")
    version = models.PositiveIntegerField(default=1)
    frozen_at = models.DateTimeField(default=timezone.now)
    frozen_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.DO_NOTHING, null=True, blank=True, related_name="+"
    )

    seal_status = models.CharField(max_length=10, choices=SealStatus.choices, default=SealStatus.NONE)
    seal_error = models.TextField(blank=True, default="")
    seal_attempts = models.PositiveIntegerField(default=0)
    sealed_at = models.DateTimeField(null=True, blank=True)
    timestamped = models.BooleanField(default=False)
    #: Personal mode: who signs, in order, with which certificate (fixed at freeze time).
    signing_plan = models.JSONField(default=list, blank=True)
    #: Result of the last full (pyHanko) validation, reused by read-only status calls.
    last_validation = models.JSONField(default=dict, blank=True)
    last_verified_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["content_type", "object_id"], name="core_frozendoc_unique_object"),
        ]
        indexes = [models.Index(fields=["document_type", "object_id"], name="core_frozendoc_type_obj_idx")]

    def __str__(self) -> str:
        return f"{self.document_type}:{self.object_id} ({self.sha256[:12]})"


class DocumentIntegrityEvent(models.Model):
    """Append-only lifecycle trail for a frozen document (also mirrored to AuditLog)."""

    class Event(models.TextChoices):
        FROZEN = "frozen", "Frozen"
        DOWNLOADED = "downloaded", "Downloaded"
        VERIFIED = "verified", "Verified"
        SEALED = "sealed", "Sealed"
        SEAL_RETRY = "seal_retry", "Seal retry"
        SEAL_FAILED = "seal_failed", "Seal failed"

    document = models.ForeignKey(FrozenDocument, on_delete=models.CASCADE, related_name="events")
    event = models.CharField(max_length=20, choices=Event.choices)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.DO_NOTHING, null=True, blank=True, related_name="+"
    )
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [models.Index(fields=["document", "created_at"], name="core_docevent_doc_created_idx")]


class SigningCertificate(models.Model):
    """A per-person signing certificate issued by the internal (dev-grade) CA.

    The private key is stored encrypted with a Fernet key from settings. That is
    weaker custody than an HSM or KMS: anyone holding both the database and the
    encryption key can sign as this person. The internal CA is not publicly
    trusted, so PDF readers show the signer as unknown until its root is trusted.
    """

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.DO_NOTHING, related_name="signing_certificates")
    serial = models.CharField(max_length=64, unique=True)
    subject_name = models.CharField(max_length=255)
    subject_email = models.CharField(max_length=254, blank=True, default="")
    employee_id = models.CharField(max_length=64, blank=True, default="")
    certificate_pem = models.TextField()
    encrypted_private_key = models.TextField(blank=True, default="")
    key_backend = models.CharField(max_length=20, default="local")
    issuer_fingerprint = models.CharField(max_length=64, blank=True, default="")
    not_before = models.DateTimeField()
    not_after = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)
    revocation_reason = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["user", "revoked_at"], name="core_signcert_user_rev_idx")]

    def __str__(self) -> str:
        return f"{self.subject_name} ({self.serial})"

    @property
    def is_revoked(self) -> bool:
        return self.revoked_at is not None

    def is_usable(self, at=None) -> bool:
        at = at or timezone.now()
        return not self.is_revoked and self.not_before <= at <= self.not_after


class DocumentApprovalSignature(models.Model):
    """One approver's signed attestation, captured at the moment they approved.

    ``signature`` is a detached RSA signature (base64) over ``payload`` made with
    the approver's own key when the stage completed. The PDF itself is signed
    with the same credential once the document is final.
    """

    # DO_NOTHING keeps the DB foreign key (a content type in use cannot be deleted) without
    # making Django's delete collector query these tables (historical-schema migration tests).
    content_type = models.ForeignKey(ContentType, on_delete=models.DO_NOTHING)
    object_id = models.PositiveIntegerField()
    document_type = models.CharField(max_length=50)
    role = models.CharField(max_length=50)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.DO_NOTHING, related_name="+")
    certificate = models.ForeignKey(SigningCertificate, on_delete=models.PROTECT, related_name="attestations")
    approved_at = models.DateTimeField()
    payload = models.JSONField(default=dict)
    payload_sha256 = models.CharField(max_length=64)
    signature = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["approved_at", "id"]
        indexes = [models.Index(fields=["content_type", "object_id"], name="core_docappr_obj_idx")]
