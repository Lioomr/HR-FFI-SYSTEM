"""Per-document-type adapters: how to render, describe and authorize a document."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass(frozen=True)
class StageSigner:
    """One completed stage on the approval trail, taken from recorded DB fields."""

    role: str
    role_label: str
    actor: Any
    at: datetime | None
    action_label: str = "Approved"


@dataclass(frozen=True)
class DocumentType:
    key: str
    label: str
    #: Short type name exposed by the API (``matched_record.type``).
    api_type: str
    model: type
    render: Callable[[Any], bytes]
    reference: Callable[[Any], str]
    #: Who the document is about (printed on the approval-trail page).
    subject: Callable[[Any], str]
    company: Callable[[Any], Any]
    stage_signers: Callable[[Any], list[StageSigner]]
    #: ``can_access(user, instance)`` for the integrity endpoints.
    can_access: Callable[[Any, Any], bool]
    #: ``accessible_queryset(request)`` for matching an uploaded PDF to a record.
    accessible_queryset: Callable[[Any], Any]
    #: ``status`` values in which the document is final (frozen). The single source
    #: of truth for ``manage.py freeze_approved_document``, which refuses any other.
    final_statuses: tuple[str, ...] = ("approved",)
    #: Optional extra recovery condition beyond the status (e.g. a job offer was sent).
    final_check: Callable[[Any], bool] | None = None

    def is_final(self, instance) -> bool:
        """Whether ``instance`` is in a state its frozen document belongs to."""

        if getattr(instance, "status", None) not in self.final_statuses:
            return False
        return self.final_check is None or bool(self.final_check(instance))


_REGISTRY: dict[str, DocumentType] = {}


def register_document_type(document_type: DocumentType) -> None:
    _REGISTRY[document_type.key] = document_type


def get_document_type(key: str) -> DocumentType:
    return _REGISTRY[key]


def document_type_for_instance(instance) -> DocumentType | None:
    for document_type in _REGISTRY.values():
        if isinstance(instance, document_type.model):
            return document_type
    return None


def registered_types() -> dict[str, DocumentType]:
    return dict(_REGISTRY)
