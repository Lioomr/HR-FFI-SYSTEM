"""Hash-only tamper evidence for system-issued letters.

Penalty warning notices and attendance late notices are rendered once at issuance,
stored privately and delivered (in-app download, WhatsApp attachment) from that
stored file. They have no approval chain, so instead of a ``FrozenDocument`` copy,
seal or signatures, the notice row itself records the SHA-256 of the exact bytes
stored at issuance (``document_sha256`` / ``document_hashed_at``).

``services.verify_uploaded_pdf`` consults this registry only after no
``FrozenDocument`` matched: an identical upload is ``frozen_valid`` and a file
that prints a hashed notice's reference with different bytes is ``tampered``.
Notices issued before the hash existed have an empty hash and are never matched.

A hash-only type needs a model with ``company``, ``reference_number``,
``document_sha256`` and ``document_hashed_at`` fields. Keep this module free of
model imports at load time: issuance code imports ``record_issued_hash``.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from django.apps import apps
from django.utils import timezone

from . import crypto

HASH_FIELDS = ("document_sha256", "document_hashed_at")


def record_issued_hash(instance, pdf_bytes: bytes) -> tuple[str, ...]:
    """Set the issuance hash of ``pdf_bytes`` on ``instance``; returns the fields to save."""

    instance.document_sha256 = crypto.sha256_hex(pdf_bytes)
    instance.document_hashed_at = timezone.now()
    return HASH_FIELDS


def _no_extra(instance) -> dict:
    return {}


@dataclass(frozen=True)
class HashOnlyRecordType:
    #: ``matched_record.type`` exposed by verify-upload.
    api_type: str
    #: ``app_label.ModelName``; resolved lazily.
    model_label: str
    #: Additive ``matched_record`` keys (for example the route id the frontend links to).
    extra: Callable[[Any], dict] = field(default=_no_extra)

    def accessible_queryset(self, request):
        """Hashed rows in the caller's accessible companies (HRManager / SystemAdmin)."""

        from organization.services import filter_queryset_by_accessible_companies

        model = apps.get_model(self.model_label)
        return filter_queryset_by_accessible_companies(model.objects.exclude(document_sha256=""), request)


@dataclass(frozen=True)
class HashOnlyMatch:
    record_type: HashOnlyRecordType
    instance: Any
    #: True when the uploaded bytes equal the issuance hash.
    exact: bool

    def matched_record(self) -> dict:
        return {
            "type": self.record_type.api_type,
            "id": self.instance.pk,
            "reference": self.instance.reference_number,
            **self.record_type.extra(self.instance),
        }


_REGISTRY: dict[str, HashOnlyRecordType] = {}


def register_hash_only_type(record_type: HashOnlyRecordType) -> None:
    _REGISTRY[record_type.api_type] = record_type


def hash_only_types() -> tuple[HashOnlyRecordType, ...]:
    return tuple(_REGISTRY.values())


register_hash_only_type(
    HashOnlyRecordType(
        api_type="warning_notice",
        model_label="penalties.PenaltyWarningNotice",
        # The letter is downloaded through the penalty: GET /api/penalties/{penalty_id}/warning-notice/.
        extra=lambda notice: {"penalty_id": notice.penalty_id},
    )
)
register_hash_only_type(HashOnlyRecordType(api_type="late_notice", model_label="attendance.AttendanceLateNotice"))


def match_by_hash(digest: str, request) -> HashOnlyMatch | None:
    """An accessible hashed notice whose issuance hash equals ``digest``."""

    for record_type in hash_only_types():
        instance = record_type.accessible_queryset(request).filter(document_sha256=digest).first()
        if instance is not None:
            return HashOnlyMatch(record_type, instance, exact=True)
    return None


def match_by_reference(references: set[str], request) -> HashOnlyMatch | None:
    """One unambiguous accessible hashed notice whose reference is printed in the upload."""

    if not references:
        return None
    matches = []
    for record_type in hash_only_types():
        rows = record_type.accessible_queryset(request).filter(reference_number__in=references)[:2]
        matches.extend(HashOnlyMatch(record_type, instance, exact=False) for instance in rows)
        if len(matches) > 1:
            return None
    return matches[0] if matches else None
