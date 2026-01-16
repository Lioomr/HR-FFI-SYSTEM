import csv
from django.http import HttpResponse
from django.utils.dateparse import parse_datetime
from django.db.models import Q, Count

from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.pagination import PageNumberPagination

from core.permissions import IsSystemAdmin
from core.responses import success, error

from .models import AuditLog
from .serializers import AuditLogSerializer


class AuditPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    page_query_param = "page"
    max_page_size = 200

    def get_paginated_response(self, data):
        return success({
            "items": data,
            "page": self.page.number,
            "page_size": self.get_page_size(self.request),
            "count": self.page.paginator.count,
            "total_pages": self.page.paginator.num_pages,
        })


def apply_filters(qs, params):
    """
    Supported filters:
    - action (exact)
    - actor_email (contains)
    - entity (exact)
    - entity_id (exact)
    - from (ISO datetime)
    - to (ISO datetime)
    - search (icontains across action/entity/entity_id/actor_email)
    """
    action = params.get("action")
    if action:
        qs = qs.filter(action__iexact=action)

    entity = params.get("entity")
    if entity:
        qs = qs.filter(entity__iexact=entity)

    entity_id = params.get("entity_id")
    if entity_id:
        qs = qs.filter(entity_id=str(entity_id))

    actor_email = params.get("actor_email")
    if actor_email:
        qs = qs.filter(actor__email__icontains=actor_email)

    dt_from = params.get("from")
    if dt_from:
        parsed = parse_datetime(dt_from)
        if parsed:
            qs = qs.filter(created_at__gte=parsed)

    dt_to = params.get("to")
    if dt_to:
        parsed = parse_datetime(dt_to)
        if parsed:
            qs = qs.filter(created_at__lte=parsed)

    search = params.get("search")
    if search:
        qs = qs.filter(
            Q(action__icontains=search) |
            Q(entity__icontains=search) |
            Q(entity_id__icontains=search) |
            Q(actor__email__icontains=search)
        )

    return qs


class AuditLogsListView(APIView):
    permission_classes = [IsAuthenticated, IsSystemAdmin]

    def get(self, request):
        qs = AuditLog.objects.select_related("actor").all()
        qs = apply_filters(qs, request.query_params)

        # Support dashboard shortcut: /audit-logs?limit=10
        limit = request.query_params.get("limit")
        if limit:
            try:
                limit_int = max(1, min(int(limit), 100))
                data = AuditLogSerializer(qs[:limit_int], many=True).data
                return success({"items": data})
            except ValueError:
                return error("Validation error", errors={"limit": ["Must be an integer."]}, status=422)

        paginator = AuditPagination()
        page = paginator.paginate_queryset(qs, request)
        data = AuditLogSerializer(page, many=True).data
        return paginator.get_paginated_response(data)


class AuditLogsExportView(APIView):
    permission_classes = [IsAuthenticated, IsSystemAdmin]

    def get(self, request):
        qs = AuditLog.objects.select_related("actor").all()
        qs = apply_filters(qs, request.query_params)

        resp = HttpResponse(content_type="text/csv")
        resp["Content-Disposition"] = 'attachment; filename="audit_logs.csv"'

        writer = csv.writer(resp)
        writer.writerow([
            "id",
            "timestamp",
            "actor_email",
            "action",
            "entity",
            "entity_id",
            "ip_address",
        ])

        for log in qs.iterator(chunk_size=2000):
            writer.writerow([
                log.id,
                log.created_at.isoformat(),
                log.actor.email if log.actor else "",
                log.action,
                log.entity,
                log.entity_id,
                log.ip_address or "",
            ])

        return resp
