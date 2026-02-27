from django.db.models import Q
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated

from audit.utils import audit
from core.pagination import StandardPagination
from core.permissions import get_role
from core.responses import error, success
from employees.permissions import IsHRManagerOnly

from .models import Rent, RentType
from .serializers import RentReadSerializer, RentTypeSerializer, RentTypeWriteSerializer, RentWriteSerializer
from .services import compute_rent_state, send_rent_notifications


class RentTypeViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsHRManagerOnly]
    queryset = RentType.objects.filter(is_active=True).order_by("code")

    def get_serializer_class(self):
        if self.action in ["create", "update", "partial_update"]:
            return RentTypeWriteSerializer
        return RentTypeSerializer

    def list(self, request, *args, **kwargs):
        serializer = self.get_serializer(self.get_queryset(), many=True)
        return success(serializer.data)

    def retrieve(self, request, *args, **kwargs):
        serializer = self.get_serializer(self.get_object())
        return success(serializer.data)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=serializer.errors, status=422)
        instance = serializer.save()
        audit(request, "rent_type_created", entity="rent_type", entity_id=instance.id, metadata=serializer.data)
        return success(RentTypeSerializer(instance).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        if not serializer.is_valid():
            return error("Validation error", errors=serializer.errors, status=422)
        updated = serializer.save()
        audit(request, "rent_type_updated", entity="rent_type", entity_id=updated.id, metadata=serializer.data)
        return success(RentTypeSerializer(updated).data)

    def update(self, request, *args, **kwargs):
        return self.partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])
        audit(request, "rent_type_deleted", entity="rent_type", entity_id=instance.id, metadata={"code": instance.code})
        return success({})


class RentViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsHRManagerOnly]
    pagination_class = StandardPagination
    queryset = Rent.objects.filter(is_active=True).select_related("rent_type", "asset", "created_by", "updated_by")

    def get_serializer_class(self):
        if self.action in ["create", "update", "partial_update"]:
            return RentWriteSerializer
        return RentReadSerializer

    def _apply_query_filters(self, queryset):
        params = self.request.query_params
        search = (params.get("search") or "").strip()
        if search:
            queryset = queryset.filter(
                Q(rent_type__name_en__icontains=search)
                | Q(rent_type__name_ar__icontains=search)
                | Q(rent_type__code__icontains=search)
                | Q(asset__name_en__icontains=search)
                | Q(asset__name_ar__icontains=search)
                | Q(property_name_en__icontains=search)
                | Q(property_name_ar__icontains=search)
            )

        rent_type_id = params.get("rent_type")
        if rent_type_id:
            queryset = queryset.filter(rent_type_id=rent_type_id)

        return queryset.order_by("id")

    def _filter_by_status(self, queryset):
        status_filter = (self.request.query_params.get("status") or "all").strip().lower()
        if status_filter not in {"all", "upcoming", "overdue"}:
            return None, error("Validation error", errors={"status": ["Must be one of: all, upcoming, overdue."]}, status=422)

        items = []
        for rent in queryset:
            computed = compute_rent_state(rent)
            if status_filter == "upcoming" and computed.status != "UPCOMING":
                continue
            if status_filter == "overdue" and computed.status != "OVERDUE":
                continue
            items.append(rent)
        return items, None

    def list(self, request, *args, **kwargs):
        queryset = self._apply_query_filters(self.get_queryset())
        filtered, err = self._filter_by_status(queryset)
        if err:
            return err

        page = self.paginate_queryset(filtered)
        serializer = self.get_serializer(page if page is not None else filtered, many=True)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return success({"items": serializer.data, "count": len(serializer.data), "page": 1, "page_size": len(serializer.data), "total_pages": 1})

    def retrieve(self, request, *args, **kwargs):
        serializer = self.get_serializer(self.get_object())
        return success(serializer.data)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=serializer.errors, status=422)
        instance = serializer.save(created_by=request.user, updated_by=request.user)
        audit(
            request,
            "rent_created",
            entity="rent",
            entity_id=instance.id,
            metadata={"rent_type": instance.rent_type.name_en},
        )
        return success(RentReadSerializer(instance).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        if not serializer.is_valid():
            return error("Validation error", errors=serializer.errors, status=422)
        updated = serializer.save(updated_by=request.user)
        audit(
            request,
            "rent_updated",
            entity="rent",
            entity_id=updated.id,
            metadata={"rent_type": updated.rent_type.name_en},
        )
        return success(RentReadSerializer(updated).data)

    def update(self, request, *args, **kwargs):
        return self.partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        instance.is_active = False
        instance.updated_by = request.user
        instance.save(update_fields=["is_active", "updated_by", "updated_at"])
        audit(
            request,
            "rent_deleted",
            entity="rent",
            entity_id=instance.id,
            metadata={"rent_type": instance.rent_type.name_en},
        )
        return success({})

    @action(detail=True, methods=["post"], url_path="notify")
    def notify(self, request, pk=None):
        if get_role(request.user) != "HRManager":
            return error("Forbidden", status=status.HTTP_403_FORBIDDEN)

        rent = self.get_object()
        delivery = send_rent_notifications(rent, manual=True)
        audit(request, "rent_manual_notified", entity="rent", entity_id=rent.id, metadata={"delivery": delivery})
        return success({"delivery": delivery})
