from django.utils import timezone
from datetime import date
from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend

from core.permissions import get_role
from audit.utils import audit
from core.responses import success, error
from core.pagination import StandardPagination

from .models import LeaveType, LeaveRequest
from .serializers import (
    LeaveTypeSerializer, 
    LeaveRequestSerializer, 
    LeaveRequestCreateSerializer,
    LeaveRequestActionSerializer,
    LeaveBalanceSerializer
)
from .permissions import (
    IsHRManagerOrAdmin,
    IsLeaveRequestOwner,
    IsActiveEmployee,
    IsOwnerOrHR,
    IsManagerOfEmployee,
    IsEmployeeOnly,
)
from .utils import calculate_leave_balance
from django.contrib.auth import get_user_model

User = get_user_model()

def _flatten_errors(error_dict):
    errors = []
    for field, messages in error_dict.items():
        if isinstance(messages, (list, tuple)):
            for msg in messages:
                errors.append(f"{field}: {msg}")
        else:
            errors.append(f"{field}: {messages}")
    return errors

class LeaveTypeViewSet(viewsets.ModelViewSet):
    queryset = LeaveType.objects.all()
    serializer_class = LeaveTypeSerializer
    permission_classes = [IsAuthenticated] # Overridden by get_permissions

    def get_permissions(self):
        # List/Retrieve: Anyone authenticated can try, but logic filters content
        if self.action in ["list", "retrieve"]:
            return [IsAuthenticated()]
        
        # Write actions: HR/Admin only
        return [IsAuthenticated(), IsHRManagerOrAdmin()]

    def list(self, request, *args, **kwargs):
        # Employees only see active leave types; HR/Admin see all
        role = get_role(request.user)
        qs = self.get_queryset()
        
        if role == "Employee":
            qs = qs.filter(is_active=True)
             
        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)

    def perform_create(self, serializer):
        instance = serializer.save()
        audit(self.request, "leave_type_created", entity="leave_type", entity_id=instance.id, metadata=serializer.data)

    def perform_update(self, serializer):
        instance = serializer.save()
        audit(self.request, "leave_type_updated", entity="leave_type", entity_id=instance.id, metadata=serializer.data)
    
    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        self.perform_destroy(instance)
        return success({"id": instance.id, "is_active": instance.is_active})

    def perform_destroy(self, instance):
        # Soft-delete implementation
        instance.is_active = False
        instance.save()
        audit(self.request, "leave_type_deactivated", entity="leave_type", entity_id=instance.id, metadata={"name": instance.name})

    # Wrap responses
    def retrieve(self, request, *args, **kwargs):
        response = super().retrieve(request, *args, **kwargs)
        return success(response.data)

    def create(self, request, *args, **kwargs):
        response = super().create(request, *args, **kwargs)
        return success(response.data, status=response.status_code)
    
    def update(self, request, *args, **kwargs):
        response = super().update(request, *args, **kwargs)
        return success(response.data)


class LeaveRequestViewSet(viewsets.ModelViewSet):
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status", "leave_type", "employee"]
    ordering_fields = ["created_at", "start_date"]
    ordering = ["-created_at"]

    def get_queryset(self):
        user = self.request.user
        role = get_role(user)
        base_qs = LeaveRequest.objects.filter(is_active=True).select_related(
            "employee", "leave_type", "decided_by", "manager_decision_by"
        )
        if role in ["SystemAdmin", "HRManager"]:
            return base_qs
        return base_qs.filter(employee=user)

    def get_serializer_class(self):
        if self.action == "create":
            return LeaveRequestCreateSerializer
        return LeaveRequestSerializer

    def get_permissions(self):
        if self.action == "create":
            return [IsAuthenticated(), IsEmployeeOnly()]

        if self.action in ["list", "retrieve"]:
             # HR/Admin OR Owner (retrieve), HR-only for list enforced in list()
            return [IsAuthenticated(), IsOwnerOrHR()]

        if self.action in ["approve", "reject"]:
             # HR/Admin only
            return [IsAuthenticated(), IsHRManagerOrAdmin()]

        if self.action == "cancel":
             # Owner only
            return [IsAuthenticated(), IsLeaveRequestOwner()]

        # For update/partial_update/destroy (standard CRUD)
        # Default restricted to HR/Admin
        return [IsAuthenticated(), IsHRManagerOrAdmin()]

    def create(self, request, *args, **kwargs):
        if "employee_id" in request.data:
            return error("Validation error", errors=["employee_id is not allowed."], status=422)
        serializer = self.get_serializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)
        self.perform_create(serializer)
        
        # Return read-serializer
        instance = serializer.instance
        read_serializer = LeaveRequestSerializer(instance)
        return success(read_serializer.data, status=status.HTTP_201_CREATED)

    def perform_create(self, serializer):
        # Determine initial status
        initial_status = LeaveRequest.RequestStatus.SUBMITTED
        instance = serializer.save(employee=self.request.user, status=initial_status)
        
        # Audit
        audit(
            self.request,
            "submit",
            entity="LeaveRequest",
            entity_id=instance.id,
            metadata={
                "leave_type": instance.leave_type.name,
                "start_date": str(instance.start_date),
                "end_date": str(instance.end_date),
            },
        )

    def list(self, request, *args, **kwargs):
        role = get_role(request.user)
        if role not in ["SystemAdmin", "HRManager"]:
            return error("Forbidden", errors=["Forbidden."], status=status.HTTP_403_FORBIDDEN)
        qs = self.get_queryset()
        params = request.query_params
        status_param = params.get("status")
        if status_param:
            allowed = {
                LeaveRequest.RequestStatus.SUBMITTED,
                LeaveRequest.RequestStatus.APPROVED,
                LeaveRequest.RequestStatus.REJECTED,
                LeaveRequest.RequestStatus.CANCELLED,
            }
            if status_param not in allowed:
                return error("Validation error", errors=["Invalid status."], status=422)
            qs = qs.filter(status=status_param)
        employee_id = params.get("employee_id")
        if employee_id:
            qs = qs.filter(employee_id=employee_id)
        date_from = params.get("date_from")
        if date_from:
            qs = qs.filter(start_date__gte=date_from)
        date_to = params.get("date_to")
        if date_to:
            qs = qs.filter(end_date__lte=date_to)
        page = self.paginate_queryset(qs)
        serializer = self.get_serializer(page if page is not None else qs, many=True)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return Response(
            {
                "status": "success",
                "data": {
                    "items": serializer.data,
                    "page": 1,
                    "page_size": len(serializer.data),
                    "count": len(serializer.data),
                    "total_pages": 1,
                },
            }
        )

    def retrieve(self, request, *args, **kwargs):
        role = get_role(request.user)
        qs = self.get_queryset()
        if role not in ["SystemAdmin", "HRManager"]:
            qs = qs.filter(employee=request.user)
        try:
            instance = qs.get(pk=kwargs.get("pk"))
        except LeaveRequest.DoesNotExist:
            return error("Not found", errors=["Not found."], status=404)
        return success(LeaveRequestSerializer(instance).data)

    def destroy(self, request, *args, **kwargs):
        return error(
            "Hard delete is not allowed.",
            errors=["Hard delete is not allowed."],
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsHRManagerOrAdmin])
    def approve(self, request, pk=None):
        try:
            instance = self.get_queryset().get(pk=pk)
        except LeaveRequest.DoesNotExist:
            return error("Not found", errors=["Not found."], status=404)
        
        if instance.status != LeaveRequest.RequestStatus.SUBMITTED:
             return error("Validation error", errors=["Only submitted requests can be approved."], status=422)
        
        s = LeaveRequestActionSerializer(data=request.data)
        if not s.is_valid():
            return error("Validation error", errors=_flatten_errors(s.errors), status=422)

        instance.status = LeaveRequest.RequestStatus.APPROVED
        instance.decided_by = request.user
        instance.decided_at = timezone.now()
        note = s.validated_data.get("comment", "")
        instance.hr_decision_note = note
        instance.save()

        audit(request, "approve", entity="LeaveRequest", entity_id=instance.id)
        return success(LeaveRequestSerializer(instance).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsHRManagerOrAdmin])
    def reject(self, request, pk=None):
        try:
            instance = self.get_queryset().get(pk=pk)
        except LeaveRequest.DoesNotExist:
            return error("Not found", errors=["Not found."], status=404)
        
        if instance.status != LeaveRequest.RequestStatus.SUBMITTED:
             return error("Validation error", errors=["Only submitted requests can be rejected."], status=422)

        s = LeaveRequestActionSerializer(data=request.data)
        if not s.is_valid():
            return error("Validation error", errors=_flatten_errors(s.errors), status=422)
        comment = (s.validated_data.get("comment") or "").strip()
        if not comment:
            return error("Validation error", errors=["comment is required."], status=422)

        instance.status = LeaveRequest.RequestStatus.REJECTED
        instance.decided_by = request.user
        instance.decided_at = timezone.now()
        instance.hr_decision_note = comment
        instance.save()
        
        audit(request, "reject", entity="LeaveRequest", entity_id=instance.id)
        return success(LeaveRequestSerializer(instance).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsLeaveRequestOwner])
    def cancel(self, request, pk=None):
        try:
            instance = LeaveRequest.objects.get(pk=pk, employee=request.user, is_active=True)
        except LeaveRequest.DoesNotExist:
            return error("Not found", errors=["Not found."], status=404)
        if instance.status != LeaveRequest.RequestStatus.SUBMITTED:
            return error("Validation error", errors=["Only submitted requests can be cancelled."], status=422)

        instance.status = LeaveRequest.RequestStatus.CANCELLED
        instance.save()
        
        audit(request, "cancel", entity="LeaveRequest", entity_id=instance.id)
        return success(LeaveRequestSerializer(instance).data)


class ManagerLeaveRequestViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Endpoints for managers to view and act on their direct reports' leave requests.
    """
    serializer_class = LeaveRequestSerializer
    permission_classes = [IsAuthenticated] # Filtering logic handles scope
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status", "leave_type"]
    ordering_fields = ["created_at", "start_date"]
    ordering = ["-created_at"]

    def get_queryset(self):
        # Only requests where the employee's manager is the current user
        return LeaveRequest.objects.filter(
            employee__employee_profile__manager=self.request.user,
            is_active=True,
        ).select_related("employee", "leave_type")

    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        # Implicitly checks queryset filter
        return super().retrieve(request, *args, **kwargs)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsManagerOfEmployee])
    def approve(self, request, pk=None):
        instance = self.get_object()
        
        if instance.status != LeaveRequest.RequestStatus.SUBMITTED:
            return error("Validation error", errors=["Only submitted requests can be approved."], status=422)
        
        s = LeaveRequestActionSerializer(data=request.data)
        if not s.is_valid():
            return error("Validation error", errors=_flatten_errors(s.errors), status=422)

        instance.status = LeaveRequest.RequestStatus.APPROVED
        instance.manager_decision_by = request.user
        instance.manager_decision_at = timezone.now()
        instance.manager_decision_note = s.validated_data.get("comment", "")
        instance.save()

        audit(request, "approve", entity="LeaveRequest", entity_id=instance.id)
        return success(LeaveRequestSerializer(instance).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsManagerOfEmployee])
    def reject(self, request, pk=None):
        instance = self.get_object()

        if instance.status != LeaveRequest.RequestStatus.SUBMITTED:
            return error("Validation error", errors=["Only submitted requests can be rejected."], status=422)
        
        s = LeaveRequestActionSerializer(data=request.data)
        if not s.is_valid():
            return error("Validation error", errors=_flatten_errors(s.errors), status=422)
        comment = (s.validated_data.get("comment") or "").strip()
        if not comment:
            return error("Validation error", errors=["comment is required."], status=422)

        instance.status = LeaveRequest.RequestStatus.REJECTED
        instance.manager_decision_by = request.user
        instance.manager_decision_at = timezone.now()
        instance.manager_decision_note = comment
        instance.save()

        audit(request, "reject", entity="LeaveRequest", entity_id=instance.id)
        return success(LeaveRequestSerializer(instance).data)


class LeaveBalanceViewSet(viewsets.ViewSet):
    """
    HR/Admin endpoint for viewing any employee's leave balance.
    GET /leave-balances/?employee_id=...&year=...
    """
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]

    def list(self, request):
        employee_id = request.query_params.get("employee_id")
        year = request.query_params.get("year")

        if not employee_id:
            return error("Validation error", errors=["employee_id is required."], status=422)
        if not year:
            return error("Validation error", errors=["year is required."], status=422)
        
        try:
            year = int(year)
        except ValueError:
            return error("Validation error", errors=["year must be a valid integer."], status=422)

        # Get Employee User
        from employees.models import EmployeeProfile
        try:
            profile = EmployeeProfile.objects.get(id=employee_id)
            user = profile.user
        except (EmployeeProfile.DoesNotExist, ValueError):
            return error("Not found", errors=["Not found."], status=404)

        balances = calculate_leave_balance(user, year)
        
        # Audit
        audit(request, "leave_balance.viewed_hr", entity="employee_profile", entity_id=profile.id, metadata={"year": year})

        serializer = LeaveBalanceSerializer(balances, many=True)
        return success(serializer.data)

from rest_framework.views import APIView

class EmployeeLeaveBalanceView(APIView):
    """
    Employee endpoint for viewing their own leave balance.
    GET /employee/leave-balance/?year=...
    """
    permission_classes = [IsAuthenticated, IsEmployeeOnly]

    def get(self, request):
        year = request.query_params.get("year")

        if not year:
            year = date.today().year
        else:
            try:
                year = int(year)
            except ValueError:
                return error("Validation error", errors=["year must be a valid integer."], status=422)

        balances = calculate_leave_balance(request.user, year)
        
        # Audit
        audit(request, "leave_balance.viewed", entity="user", entity_id=request.user.id, metadata={"year": year})

        serializer = LeaveBalanceSerializer(balances, many=True)
        return success(serializer.data)


class EmployeeLeaveRequestViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = LeaveRequestSerializer
    permission_classes = [IsAuthenticated, IsEmployeeOnly]
    pagination_class = None

    def get_queryset(self):
        return LeaveRequest.objects.filter(
            employee=self.request.user,
            is_active=True,
        ).select_related("employee", "leave_type", "decided_by")

    def list(self, request, *args, **kwargs):
        if "employee_id" in request.query_params:
            return error("Validation error", errors=["employee_id is not allowed."], status=422)
        qs = self.get_queryset()
        paginator = StandardPagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        serializer = self.get_serializer(page if page is not None else qs, many=True)
        if page is not None:
            return paginator.get_paginated_response(serializer.data)
        return Response(
            {
                "status": "success",
                "data": {
                    "items": serializer.data,
                    "page": 1,
                    "page_size": len(serializer.data),
                    "count": len(serializer.data),
                    "total_pages": 1,
                },
            }
        )
