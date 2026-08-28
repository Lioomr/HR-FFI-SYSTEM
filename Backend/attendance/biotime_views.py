import logging
import secrets

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework import status, views, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated

from audit.utils import audit
from core.pagination import StandardPagination
from core.permissions import IsHRManagerOrAdmin
from core.responses import error, success
from organization.services import (
    filter_queryset_by_company_scope,
    is_head_office_context,
    user_has_all_company_access,
)

from .biotime_client import BioTimeClient
from .models import BioTimeConfig, BioTimeDeviceEmployee, BioTimeEmployeeMap
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


class BioTimeAgentIngestView(views.APIView):
    """Receive BioTime transactions from an agent inside the office LAN."""

    authentication_classes = []
    permission_classes = []

    def post(self, request):
        configured_token = getattr(settings, "BIOTIME_AGENT_TOKEN", "")
        supplied_token = request.headers.get("X-BioTime-Agent-Token", "")
        if not configured_token or not secrets.compare_digest(supplied_token, configured_token):
            return error("Unauthorized", status=status.HTTP_401_UNAUTHORIZED)
        transactions = request.data.get("transactions") if isinstance(request.data, dict) else None
        if not isinstance(transactions, list) or len(transactions) > 5000:
            return error("transactions must be a list of at most 5000 items.", status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            result = SyncBioTimeService.ingest_transactions(transactions)
            config = BioTimeConfig.get_solo()
            config.last_sync_time = timezone.now()
            config.save(update_fields=["last_sync_time", "updated_at"])
        return success(result, message="BioTime transactions ingested.")


class BioTimeAgentEmployeesView(views.APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        configured_token = getattr(settings, "BIOTIME_AGENT_TOKEN", "")
        supplied_token = request.headers.get("X-BioTime-Agent-Token", "")
        if not configured_token or not secrets.compare_digest(supplied_token, configured_token):
            return error("Unauthorized", status=status.HTTP_401_UNAUTHORIZED)
        employees = request.data.get("employees") if isinstance(request.data, dict) else None
        if not isinstance(employees, list) or len(employees) > 5000:
            return error("employees must be a list of at most 5000 items.", status=status.HTTP_400_BAD_REQUEST)
        for employee in employees:
            emp_code = str(employee.get("emp_code") or "").strip()
            if emp_code:
                BioTimeDeviceEmployee.objects.update_or_create(
                    emp_code=emp_code,
                    defaults={
                        "first_name": str(employee.get("first_name") or "").strip(),
                        "last_name": str(employee.get("last_name") or "").strip(),
                        "department": str(employee.get("department") or "").strip(),
                    },
                )
        return success({"received": len(employees)}, message="BioTime employees updated.")


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
        # Device roster rows do not carry a company key, so they cannot be
        # safely tenant-filtered. Expose them only as an explicit all-company
        # head-office workflow; ordinary company contexts must fail closed.
        if not is_head_office_context(request) or not user_has_all_company_access(request.user):
            raise PermissionDenied("Unmapped BioTime employees require all-company head-office access.")
        try:
            mapped_codes = set(BioTimeEmployeeMap.objects.values_list("biotime_emp_code", flat=True))
            employees = [
                {
                    "emp_code": employee.emp_code,
                    "first_name": employee.first_name,
                    "last_name": employee.last_name,
                    "department": employee.department,
                }
                for employee in BioTimeDeviceEmployee.objects.all()
                if employee.emp_code not in mapped_codes
            ]
        except Exception:
            logger.exception("Unexpected error while loading unmapped BioTime employees.")
            return error("Unable to load BioTime employees.", status=status.HTTP_502_BAD_GATEWAY)

        page = self.paginate_queryset(employees)
        if page is not None:
            return self.get_paginated_response(page)
        return success({"items": employees, "count": len(employees)})
