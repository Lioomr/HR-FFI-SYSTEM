import logging

from rest_framework import status, views, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated

from audit.utils import audit
from core.pagination import StandardPagination
from core.permissions import IsHRManagerOrAdmin
from core.responses import error, success
from organization.services import filter_queryset_by_company_scope

from .biotime_client import BioTimeClient
from .models import BioTimeConfig, BioTimeEmployeeMap
from .serializers import BioTimeConfigSerializer, BioTimeEmployeeMapSerializer
from .services import SyncBioTimeService

logger = logging.getLogger(__name__)


class BioTimeConfigViewSet(views.APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def get(self, request):
        return success(BioTimeConfigSerializer(BioTimeConfig.get_solo()).data)

    def put(self, request):
        config = BioTimeConfig.get_solo()
        payload = request.data.copy()
        if "password" in payload and not payload["password"]:
            payload.pop("password")

        serializer = BioTimeConfigSerializer(config, data=payload, partial=True)
        if serializer.is_valid():
            serializer.save()
            return success(serializer.data)
        return error("Validation error", errors=serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class BioTimeActionsViewSet(views.APIView):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def post(self, request, action):
        if action == "test-connection":
            config = BioTimeConfig.get_solo()
            client = BioTimeClient(
                request.data.get("server_ip", config.server_ip),
                request.data.get("server_port", config.server_port),
                request.data.get("username", config.username),
                request.data.get("password", config.password),
            )
            if client.test_connection():
                return success({"connected": True}, message="Connection successful")
            logger.warning("BioTime test connection failed: %s", client.last_error)
            return error("Connection failed", status=status.HTTP_400_BAD_REQUEST)

        if action == "sync-now":
            try:
                days_back = max(int(request.data.get("days_back", 7)), 1)
            except (TypeError, ValueError):
                return error("days_back must be a positive integer.", status=status.HTTP_400_BAD_REQUEST)

            is_successful, result = SyncBioTimeService.execute(days_back=days_back)
            message = result.pop("message", "BioTime sync completed.")
            if is_successful:
                return success(result, message=message)
            return error(message, errors=result, status=status.HTTP_400_BAD_REQUEST)

        return error("Invalid action", status=status.HTTP_400_BAD_REQUEST)


class BioTimeEmployeeMapViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]
    serializer_class = BioTimeEmployeeMapSerializer
    pagination_class = StandardPagination

    def get_queryset(self):
        queryset = BioTimeEmployeeMap.objects.select_related("employee_profile", "employee_profile__user")
        queryset = filter_queryset_by_company_scope(queryset, self.request, field_name="employee_profile__company_id")
        return queryset.filter(employee_profile__company_id__isnull=False).order_by("-created_at", "-id")

    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        return success(self.get_serializer(self.get_object()).data)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        mapping = serializer.save()
        audit(
            request,
            "biotime.mapping_created",
            entity="biotime_employee_map",
            entity_id=mapping.id,
            metadata={"employee_profile_id": mapping.employee_profile_id, "biotime_emp_code": mapping.biotime_emp_code},
        )
        return success(self.get_serializer(mapping).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        mapping = self.get_object()
        serializer = self.get_serializer(mapping, data=request.data, partial=kwargs.pop("partial", False))
        serializer.is_valid(raise_exception=True)
        mapping = serializer.save()
        audit(
            request,
            "biotime.mapping_updated",
            entity="biotime_employee_map",
            entity_id=mapping.id,
            metadata={"employee_profile_id": mapping.employee_profile_id, "biotime_emp_code": mapping.biotime_emp_code},
        )
        return success(self.get_serializer(mapping).data)

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        mapping = self.get_object()
        audit(
            request,
            "biotime.mapping_deleted",
            entity="biotime_employee_map",
            entity_id=mapping.id,
            metadata={"employee_profile_id": mapping.employee_profile_id, "biotime_emp_code": mapping.biotime_emp_code},
        )
        mapping.delete()
        return success({})

    @action(detail=False, methods=["get"])
    def unmapped(self, request):
        try:
            employees = SyncBioTimeService.get_unmapped_users()
        except Exception:
            logger.exception("Unexpected error while loading unmapped BioTime employees.")
            return error("Unable to load BioTime employees.", status=status.HTTP_502_BAD_GATEWAY)

        page = self.paginate_queryset(employees)
        if page is not None:
            return self.get_paginated_response(page)
        return success({"items": employees, "count": len(employees)})
