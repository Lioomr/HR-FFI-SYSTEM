"""Shared HTTP plumbing for tamper-evident documents.

Every request type that freezes its approved PDF exposes the same download
behaviour and the same three integrity endpoints with an identical payload:

* :func:`frozen_pdf_response` - the PDF download: serve the frozen copy, 409 when
  it is missing or fails its hash, render live when nothing is frozen, HR-only
  ``?workpaper=1&tz=<IANA>`` approval-trail page, optional ``?packet=1``.
* :class:`DocumentIntegrityActionsMixin` - ``GET integrity/``,
  ``POST integrity/verify/`` and ``POST integrity/retry-seal/`` on a viewset that
  implements :meth:`~DocumentIntegrityActionsMixin.get_integrity_object`.
* :func:`resolve_integrity_object` - the usual lookup for that hook.
* :func:`request_timezone` - the viewer's ``?tz=`` zone.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable

from django.http import HttpResponse
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated

from audit.utils import audit
from core.permissions import get_role
from core.responses import error, success

HR_ROLES = frozenset({"SystemAdmin", "HRManager"})


def _to_bool(value) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "y"}


def sensitive_download(
    pdf_bytes: bytes, filename: str, *, content_type: str = "application/octet-stream"
) -> HttpResponse:
    """A private, non-sniffable attachment (the headers every PDF download uses)."""

    response = HttpResponse(pdf_bytes, content_type=content_type)
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    response["Content-Type"] = content_type
    response["X-Content-Type-Options"] = "nosniff"
    response["Cache-Control"] = "private, no-store"
    return response


def request_timezone(request):
    """The viewer's IANA timezone from ``?tz=``; ``None`` (system timezone) when absent or unknown."""

    from zoneinfo import ZoneInfo

    name = (request.query_params.get("tz") or "").strip()
    if name:
        try:
            return ZoneInfo(name)
        except Exception:
            pass
    return None


def _with_suffix(filename: str, suffix: str) -> str:
    stem, dot, extension = filename.rpartition(".")
    if not dot:
        return f"{filename}{suffix}"
    return f"{stem}{suffix}.{extension}"


def frozen_pdf_response(
    instance,
    request,
    *,
    render_live: Callable[[], bytes],
    filename: str,
    packet_pages: Callable[[], bytes | None] | None = None,
    content_type: str = "application/octet-stream",
) -> HttpResponse:
    """Serve the frozen approved copy when one exists; render live otherwise.

    ``render_live`` is only called when nothing is frozen. A frozen copy that is
    missing or no longer matches its hash is never served and never silently
    replaced by a live render (409 + AuditLog ``document_download_blocked``).

    ``?workpaper=1`` (HRManager/SystemAdmin, frozen documents only) appends a live
    approval-trail page in the ``?tz=`` zone; it is not the verifiable original
    and is never stored. ``?packet=1`` appends ``packet_pages()`` when given.
    ``content_type`` keeps a module's existing download header (default octet-stream).
    """

    from core.pdf import merge_pdfs

    from .services import FILE_OK, build_workpaper_pdf, frozen_pdf, log_download

    document, frozen_bytes, state = frozen_pdf(instance)
    if document is None:
        pdf_bytes = render_live()
    elif state != FILE_OK:
        audit(
            request,
            "document_download_blocked",
            entity=document.document_type,
            entity_id=instance.id,
            metadata={"frozen_document_id": document.id, "state": state},
        )
        return error(
            "Document unavailable",
            errors=["The approved document failed its integrity check. Contact HR."],
            status=status.HTTP_409_CONFLICT,
        )
    else:
        pdf_bytes = frozen_bytes
        log_download(document, request=request)

    download_name = filename
    if (
        document is not None
        and _to_bool(request.query_params.get("workpaper", "0"))
        and get_role(request.user) in HR_ROLES
    ):
        # HR work paper: the frozen form plus a live approval-trail page in the
        # viewer's own timezone. Not the verifiable original, so it is never
        # offered to anyone but HR and never stored.
        pdf_bytes = build_workpaper_pdf(instance, pdf_bytes, tz=request_timezone(request))
        download_name = _with_suffix(filename, "_workpaper")
    if packet_pages is not None and _to_bool(request.query_params.get("packet", "0")):
        extra = packet_pages()
        if extra:
            # A packet is a convenience bundle: merging rewrites the file, so it is
            # not the verifiable approved original (download without packet).
            pdf_bytes = merge_pdfs([pdf_bytes, extra])
            download_name = _with_suffix(filename, "_packet")
    return sensitive_download(pdf_bytes, download_name, content_type=content_type)


def resolve_integrity_object(
    request,
    pk,
    *,
    hr_queryset,
    involved_queryset: Callable[[], object],
    can_access: Callable[[object, object], bool],
):
    """Look up the record behind an integrity endpoint, or ``None`` (-> 404).

    HR/SystemAdmin search ``hr_queryset`` (already limited to their accessible
    companies); everyone else searches ``involved_queryset()`` (the records they
    own, were delegated or recorded a decision on). ``can_access`` is the
    adapter's final say. ``None`` hides existence from everyone else.
    """

    user = request.user
    qs = hr_queryset if get_role(user) in HR_ROLES else involved_queryset()
    instance = qs.filter(pk=pk).first()
    if instance is None or not can_access(user, instance):
        return None
    return instance


def involved_q(user, fields: Iterable[str]):
    """``Q(field_a=user) | Q(field_b=user) | ...`` for the recorded actor fields."""

    from django.db.models import Q

    condition = Q(pk__in=[])
    for field in fields:
        condition |= Q(**{field: user})
    return condition


def _not_found():
    return error("Not found", errors=["Not found."], status=404)


class DocumentIntegrityActionsMixin:
    """``integrity/``, ``integrity/verify/`` and ``integrity/retry-seal/`` for a viewset.

    Implement :meth:`get_integrity_object` with the same access rules as the
    module's PDF download (plus recorded approvers). Payloads are identical for
    every document type.
    """

    def get_integrity_object(self):  # pragma: no cover - required hook
        raise NotImplementedError("Return the record (or None for 404) for the integrity endpoints.")

    @action(detail=True, methods=["get"], url_path="integrity", permission_classes=[IsAuthenticated])
    def integrity(self, request, pk=None):
        from .services import for_viewer, integrity_payload

        instance = self.get_integrity_object()
        if instance is None:
            return _not_found()
        return success(for_viewer(integrity_payload(instance), request))

    @action(detail=True, methods=["post"], url_path="integrity/verify", permission_classes=[IsAuthenticated])
    def integrity_verify(self, request, pk=None):
        from .services import for_viewer, verify_instance

        instance = self.get_integrity_object()
        if instance is None:
            return _not_found()
        return success(for_viewer(verify_instance(instance, request=request), request))

    @action(detail=True, methods=["post"], url_path="integrity/retry-seal", permission_classes=[IsAuthenticated])
    def integrity_retry_seal(self, request, pk=None):
        from employees.permissions import IsHRManagerOrAdmin

        from .services import DocumentIntegrityError, for_viewer, integrity_payload, retry_seal

        # Enforced here as well as by any get_permissions() override, so a viewset
        # whose override falls back to IsAuthenticated cannot open retry to everyone.
        gate = IsHRManagerOrAdmin()
        if not gate.has_permission(request, self):
            self.permission_denied(request, message=getattr(gate, "message", None))
        instance = self.get_integrity_object()
        if instance is None:
            return _not_found()
        try:
            retry_seal(instance, request=request)
        except DocumentIntegrityError as exc:
            return error("Validation error", errors=[str(exc)], status=422)
        return success(for_viewer(integrity_payload(instance), request))
