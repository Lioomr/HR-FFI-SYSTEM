from datetime import timedelta

from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated

from audit.utils import audit
from core.pagination import StandardPagination
from core.permissions import get_role
from core.responses import error, success
from employees.models import EmployeeProfile

from .models import Asset, AssetAssignment, AssetDamageReport, AssetReturnRequest
from .permissions import IsEmployeeSelfAsset, IsHRManagerOrSystemAdmin
from .serializers import (
    AssetAssignmentCreateSerializer,
    AssetDamageReportCreateSerializer,
    AssetReturnRequestCreateSerializer,
    AssetReturnSerializer,
    AssetSerializer,
)


class AssetViewSet(viewsets.ModelViewSet):
    serializer_class = AssetSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPagination
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter, filters.SearchFilter]
    filterset_fields = ["type", "status", "vendor", "purchase_date", "warranty_expiry"]
    search_fields = ["asset_code", "name", "serial_number", "plate_number", "mac_address"]
    ordering_fields = ["created_at", "updated_at", "warranty_expiry", "asset_code"]
    ordering = ["-created_at"]

    def get_permissions(self):
        if self.action in [
            "list",
            "retrieve",
            "create",
            "update",
            "partial_update",
            "destroy",
            "assign",
            "return_asset",
            "dashboard_summary",
        ]:
            permission_classes = [IsAuthenticated, IsHRManagerOrSystemAdmin]
        elif self.action in ["my_assets", "damage_report", "return_request"]:
            permission_classes = [IsAuthenticated, IsEmployeeSelfAsset]
        else:
            permission_classes = [IsAuthenticated]
        return [permission() for permission in permission_classes]

    def get_queryset(self):
        return Asset.objects.all().prefetch_related("assignments")

    @staticmethod
    def _asset_snapshot(asset: Asset):
        return {
            "id": asset.id,
            "asset_code": asset.asset_code,
            "name": asset.name,
            "type": asset.type,
            "status": asset.status,
            "serial_number": asset.serial_number,
            "vendor": asset.vendor,
            "warranty_expiry": str(asset.warranty_expiry) if asset.warranty_expiry else None,
        }

    def _get_request_profile(self):
        try:
            return EmployeeProfile.objects.get(user=self.request.user)
        except EmployeeProfile.DoesNotExist:
            return None

    def _is_self_assigned_asset(self, asset: Asset, profile: EmployeeProfile):
        return AssetAssignment.objects.filter(asset=asset, employee=profile, is_active=True).exists()

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        serializer = self.get_serializer(page if page is not None else queryset, many=True)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return success({"items": serializer.data, "count": queryset.count()})

    def retrieve(self, request, *args, **kwargs):
        return success(self.get_serializer(self.get_object()).data)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        instance = serializer.save()
        audit(
            request,
            "asset_created",
            entity="Asset",
            entity_id=instance.id,
            metadata={"before": None, "after": self._asset_snapshot(instance)},
        )
        return success(self.get_serializer(instance).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        before = self._asset_snapshot(instance)
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        updated_instance = serializer.save()
        after = self._asset_snapshot(updated_instance)
        action_name = "asset_status_changed" if before["status"] != after["status"] else "asset_updated"
        audit(
            request,
            action_name,
            entity="Asset",
            entity_id=updated_instance.id,
            metadata={"before": before, "after": after},
        )
        return success(self.get_serializer(updated_instance).data)

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.assignments.filter(is_active=True).exists():
            return error(
                "Validation error",
                errors=["Asset cannot be deleted while it has an active assignment."],
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        instance_id = instance.id
        snapshot = self._asset_snapshot(instance)
        instance.delete()
        audit(
            request,
            "asset_deleted",
            entity="Asset",
            entity_id=instance_id,
            metadata={"before": snapshot, "after": None},
        )
        return success({"id": instance_id})

    @action(detail=True, methods=["post"], url_path="assign")
    def assign(self, request, pk=None):
        serializer = AssetAssignmentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        employee = serializer.validated_data["employee"]

        with transaction.atomic():
            asset = Asset.objects.select_for_update().filter(pk=pk).first()
            if not asset:
                return error("Not found", status=status.HTTP_404_NOT_FOUND)
            if AssetAssignment.objects.select_for_update().filter(asset=asset, is_active=True).exists():
                return error(
                    "Validation error",
                    errors=["Asset is already assigned."],
                    status=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )

            assignment = AssetAssignment.objects.create(
                asset=asset,
                employee=employee,
                assigned_by=request.user,
                is_active=True,
            )
            old_status = asset.status
            asset.status = Asset.AssetStatus.ASSIGNED
            asset.save(update_fields=["status", "updated_at"])

        audit(
            request,
            "asset_assigned",
            entity="AssetAssignment",
            entity_id=assignment.id,
            metadata={
                "asset_id": asset.id,
                "employee_id": employee.id,
                "status_before": old_status,
                "status_after": asset.status,
            },
        )
        return success(self.get_serializer(asset).data)

    @action(detail=True, methods=["post"], url_path="return")
    def return_asset(self, request, pk=None):
        serializer = AssetReturnSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            asset = Asset.objects.select_for_update().filter(pk=pk).first()
            if not asset:
                return error("Not found", status=status.HTTP_404_NOT_FOUND)
            assignment = (
                AssetAssignment.objects.select_for_update()
                .filter(asset=asset, is_active=True)
                .select_related("employee")
                .first()
            )
            if not assignment:
                return error(
                    "Validation error",
                    errors=["No active assignment found for this asset."],
                    status=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )

            assignment.returned_at = serializer.validated_data["returned_at"]
            assignment.return_note = serializer.validated_data.get("return_note", "")
            assignment.condition_on_return = serializer.validated_data.get("condition_on_return", "")
            assignment.is_active = False
            assignment.save(update_fields=["returned_at", "return_note", "condition_on_return", "is_active", "updated_at"])

            old_status = asset.status
            asset.status = Asset.AssetStatus.AVAILABLE
            asset.save(update_fields=["status", "updated_at"])

            pending_requests = AssetReturnRequest.objects.select_for_update().filter(
                asset=asset,
                employee=assignment.employee,
                status=AssetReturnRequest.RequestStatus.PENDING,
            )
            for request_obj in pending_requests:
                request_obj.status = AssetReturnRequest.RequestStatus.PROCESSED
                request_obj.processed_by = request.user
                request_obj.processed_at = timezone.now()
                request_obj.save(update_fields=["status", "processed_by", "processed_at"])

        audit(
            request,
            "asset_returned",
            entity="AssetAssignment",
            entity_id=assignment.id,
            metadata={
                "asset_id": asset.id,
                "employee_id": assignment.employee.id,
                "status_before": old_status,
                "status_after": asset.status,
            },
        )
        return success(self.get_serializer(asset).data)

    @action(detail=False, methods=["get"], url_path="dashboard-summary")
    def dashboard_summary(self, request):
        today = timezone.localdate()
        expiry_cutoff = today + timedelta(days=30)
        qs = Asset.objects.all()

        summary = qs.aggregate(
            total=Count("id"),
            assigned=Count("id", filter=Q(status=Asset.AssetStatus.ASSIGNED)),
            available=Count("id", filter=Q(status=Asset.AssetStatus.AVAILABLE)),
            damaged=Count("id", filter=Q(status=Asset.AssetStatus.DAMAGED)),
            lost=Count("id", filter=Q(status=Asset.AssetStatus.LOST)),
            warranty_expiring_soon=Count(
                "id",
                filter=Q(warranty_expiry__isnull=False, warranty_expiry__gte=today, warranty_expiry__lte=expiry_cutoff),
            ),
        )
        return success(summary)

    @action(detail=False, methods=["get"], url_path="my-assets")
    def my_assets(self, request):
        role = get_role(request.user)
        if role not in ["Employee", "Manager"]:
            return error("Forbidden", status=status.HTTP_403_FORBIDDEN)

        profile = self._get_request_profile()
        if not profile:
            return error("Employee profile not found.", status=status.HTTP_404_NOT_FOUND)

        asset_ids = AssetAssignment.objects.filter(employee=profile, is_active=True).values_list("asset_id", flat=True)
        queryset = self.filter_queryset(self.get_queryset().filter(id__in=asset_ids))
        page = self.paginate_queryset(queryset)
        serializer = self.get_serializer(page if page is not None else queryset, many=True)

        if page is not None:
            return self.get_paginated_response(serializer.data)
        return success({"items": serializer.data, "count": queryset.count()})

    @action(detail=True, methods=["post"], url_path="damage-report")
    def damage_report(self, request, pk=None):
        if get_role(request.user) != "Employee":
            return error("Forbidden", status=status.HTTP_403_FORBIDDEN)

        profile = self._get_request_profile()
        if not profile:
            return error("Employee profile not found.", status=status.HTTP_404_NOT_FOUND)

        asset = self.get_object()
        if not self._is_self_assigned_asset(asset, profile):
            return error("Forbidden", status=status.HTTP_403_FORBIDDEN)

        serializer = AssetDamageReportCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        report = AssetDamageReport.objects.create(
            asset=asset,
            employee=profile,
            description=serializer.validated_data["description"],
        )

        audit(
            request,
            "asset_damage_reported",
            entity="AssetDamageReport",
            entity_id=report.id,
            metadata={"asset_id": asset.id, "employee_id": profile.id},
        )
        return success({"id": report.id, "reported_at": report.reported_at}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="return-request")
    def return_request(self, request, pk=None):
        if get_role(request.user) != "Employee":
            return error("Forbidden", status=status.HTTP_403_FORBIDDEN)

        profile = self._get_request_profile()
        if not profile:
            return error("Employee profile not found.", status=status.HTTP_404_NOT_FOUND)

        asset = self.get_object()
        if not self._is_self_assigned_asset(asset, profile):
            return error("Forbidden", status=status.HTTP_403_FORBIDDEN)

        serializer = AssetReturnRequestCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        return_request = AssetReturnRequest.objects.create(
            asset=asset,
            employee=profile,
            note=serializer.validated_data["note"],
            status=AssetReturnRequest.RequestStatus.PENDING,
        )

        audit(
            request,
            "asset_return_requested",
            entity="AssetReturnRequest",
            entity_id=return_request.id,
            metadata={"asset_id": asset.id, "employee_id": profile.id},
        )
        return success(
            {
                "id": return_request.id,
                "status": return_request.status,
                "requested_at": return_request.requested_at,
            },
            status=status.HTTP_201_CREATED,
        )
