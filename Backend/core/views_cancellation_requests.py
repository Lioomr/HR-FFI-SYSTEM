"""HR inbox for employee cancellation requests on approved requests (``/api/core/cancellation-requests/``).

Employees file and withdraw them on each request's own detail route; see
``core.services.cancellation_requests``.
"""

from organization.services import filter_queryset_by_accessible_companies
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from core.models import CancellationRequest
from core.pagination import StandardPagination
from core.permissions import IsHRManagerOrAdmin
from core.responses import error, success
from core.services.cancellation_requests import (
    KINDS,
    CancellationRequestError,
    audit_cancellation,
    confirm_cancellation_request,
    decline_cancellation_request,
    inbox_item,
    notify_employee_of_cancellation_decision,
)

Status = CancellationRequest.Status


def _scoped_queryset(request):
    return filter_queryset_by_accessible_companies(
        CancellationRequest.objects.select_related(
            "content_type",
            "requested_by",
            "requested_by__employee_profile",
            "decided_by",
            "decided_by__employee_profile",
        ),
        request,
    )


class CancellationRequestListView(APIView):
    """``GET ?status=pending|confirmed|declined|withdrawn|all&kind=<kind>``; default ``pending``."""

    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def get(self, request):
        queryset = _scoped_queryset(request)
        errors = {}
        status_param = (request.query_params.get("status") or Status.PENDING).strip()
        if status_param != "all":
            if status_param in Status.values:
                queryset = queryset.filter(status=status_param)
            else:
                errors["status"] = [f"Unsupported status. Use one of: {', '.join(Status.values)}, all."]
        kind = (request.query_params.get("kind") or "").strip()
        if kind:
            if kind in KINDS:
                queryset = queryset.filter(kind=kind)
            else:
                errors["kind"] = [f"Unsupported kind. Use one of: {', '.join(KINDS)}."]
        if errors:
            return error("Validation error", errors=errors, status=422)

        queryset = queryset.prefetch_related("target").order_by("-requested_at", "-id")
        paginator = StandardPagination()
        page = paginator.paginate_queryset(queryset, request, view=self)
        rows = page if page is not None else list(queryset)
        items = [inbox_item(row, request.user) for row in rows]
        if page is not None:
            return paginator.get_paginated_response(items)
        return success({"items": items, "page": 1, "page_size": len(items), "count": len(items), "total_pages": 1})


class _CancellationRequestDecisionView(APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]
    audit_action = ""

    def decide(self, row, request):
        raise NotImplementedError

    def post(self, request, pk):
        row = _scoped_queryset(request).filter(pk=pk).first()
        if row is None:
            return error("Not found", errors=["Not found."], status=404)
        try:
            outcome = self.decide(row, request)
        except CancellationRequestError as exc:
            return exc.to_response()
        audit_cancellation(request, self.audit_action, outcome)
        notify_employee_of_cancellation_decision(outcome)
        fresh = _scoped_queryset(request).get(pk=row.pk)
        return success(inbox_item(fresh, request.user))


class CancellationRequestConfirmView(_CancellationRequestDecisionView):
    """``POST {id}/confirm/`` with an optional ``comment``: the request is cancelled through its module."""

    audit_action = "cancellation_confirmed"

    def decide(self, row, request):
        return confirm_cancellation_request(row, actor=request.user, comment=request.data.get("comment", ""))


class CancellationRequestDeclineView(_CancellationRequestDecisionView):
    """``POST {id}/decline/`` with a required ``comment``: the request stays approved."""

    audit_action = "cancellation_declined"

    def decide(self, row, request):
        return decline_cancellation_request(row, actor=request.user, comment=request.data.get("comment"))
