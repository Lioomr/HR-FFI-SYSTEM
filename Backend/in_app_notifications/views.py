from django.db.models import Q
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from core.pagination import StandardPagination
from core.responses import error, success
from organization.models import OrganizationNode
from organization.services import get_active_organization_for_request, get_user_accessible_company_ids

from .models import Notification
from .serializers import NotificationSerializer
from .services import with_delivery_details


def _owned_notifications(request):
    queryset = Notification.objects.filter(recipient=request.user)
    active_company = get_active_organization_for_request(request)
    if active_company is not None and active_company.node_type == OrganizationNode.NodeType.COMPANY:
        return queryset.filter(Q(company=active_company) | Q(company__isnull=True))
    accessible_ids = get_user_accessible_company_ids(request.user)
    if accessible_ids:
        return queryset.filter(Q(company_id__in=accessible_ids) | Q(company__isnull=True))
    return queryset.filter(company__isnull=True)


class NotificationListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        queryset = with_delivery_details(_owned_notifications(request))
        unread = request.query_params.get("unread")
        if unread in {"true", "1"}:
            queryset = queryset.filter(read_at__isnull=True)
        elif unread in {"false", "0"}:
            queryset = queryset.filter(read_at__isnull=False)
        category = (request.query_params.get("category") or "").strip()
        if category:
            queryset = queryset.filter(category=category)
        paginator = StandardPagination()
        page = paginator.paginate_queryset(queryset, request, view=self)
        return paginator.get_paginated_response(NotificationSerializer(page, many=True, context={"request": request}).data)


class NotificationUnreadCountView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return success({"unread_count": _owned_notifications(request).filter(read_at__isnull=True).count()})


class NotificationReadView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, notification_id: int):
        notification = with_delivery_details(_owned_notifications(request)).filter(pk=notification_id).first()
        if notification is None:
            return error("Not found", errors=["Notification not found."], status=404)
        if notification.read_at is None:
            notification.read_at = timezone.now()
            notification.save(update_fields=["read_at"])
        return success(
            {
                "notification": NotificationSerializer(notification, context={"request": request}).data,
                "unread_count": _owned_notifications(request).filter(read_at__isnull=True).count(),
            }
        )


class NotificationReadAllView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        updated_count = _owned_notifications(request).filter(read_at__isnull=True).update(read_at=timezone.now())
        return success({"updated_count": updated_count, "unread_count": 0})
