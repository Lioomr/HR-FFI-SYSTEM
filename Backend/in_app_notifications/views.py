from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from core.pagination import StandardPagination
from core.responses import error, success
from organization.services import filter_queryset_by_company_scope

from .models import Notification
from .serializers import NotificationSerializer
from .services import with_delivery_details


def _owned_notifications(request):
    queryset = Notification.objects.filter(recipient=request.user)
    return filter_queryset_by_company_scope(queryset, request)


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
        return paginator.get_paginated_response(
            NotificationSerializer(page, many=True, context={"request": request}).data
        )


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
