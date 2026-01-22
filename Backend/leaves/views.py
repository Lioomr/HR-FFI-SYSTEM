from django.utils import timezone
from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend

from core.permissions import get_role
from audit.utils import audit
from core.responses import success, error

from .models import LeaveType, LeaveRequest
from .serializers import (
    LeaveTypeSerializer, 
    LeaveRequestSerializer, 
    LeaveRequestCreateSerializer,
    LeaveRequestActionSerializer,
    LeaveBalanceSerializer
)
from .permissions import IsHRManagerOrAdmin, IsLeaveRequestOwner, IsActiveEmployee, IsOwnerOrHR, IsManagerOfEmployee
from .utils import calculate_leave_balance
from django.contrib.auth import get_user_model

User = get_user_model()

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
        return success(serializer.data)

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
        if role in ["SystemAdmin", "HRManager"]:
            return LeaveRequest.objects.all().select_related("employee", "leave_type", "decided_by", "manager_decision_by")
        return LeaveRequest.objects.filter(employee=user).select_related("employee", "leave_type", "decided_by", "manager_decision_by")

    def get_serializer_class(self):
        if self.action == "create":
            return LeaveRequestCreateSerializer
        return LeaveRequestSerializer

    def get_permissions(self):
        if self.action == "create":
            # Employee creates own; HR/Admin can also create (technically allowed)
             return [IsAuthenticated()]

        if self.action in ["list", "retrieve"]:
             # HR/Admin OR Owner
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
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        
        # Return read-serializer
        instance = serializer.instance
        read_serializer = LeaveRequestSerializer(instance)
        return success(read_serializer.data, status=status.HTTP_201_CREATED)

    def perform_create(self, serializer):
        # Determine initial status
        user = self.request.user
        initial_status = LeaveRequest.RequestStatus.PENDING_HR
        
        if hasattr(user, 'employee_profile') and user.employee_profile.manager:
            initial_status = LeaveRequest.RequestStatus.PENDING_MANAGER
            
        instance = serializer.save(employee=self.request.user, status=initial_status)
        
        # Audit
        audit(self.request, "leave_request_created", entity="leave_request", entity_id=instance.id, metadata={
            "type": instance.leave_type.code,
            "start": str(instance.start_date),
            "end": str(instance.end_date),
            "initial_status": initial_status
        })

    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        response = super().retrieve(request, *args, **kwargs)
        return success(response.data)

    def destroy(self, request, *args, **kwargs):
        return error("Hard delete is not allowed.", status=status.HTTP_405_METHOD_NOT_ALLOWED)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsHRManagerOrAdmin])
    def approve(self, request, pk=None):
        instance = self.get_object()
        
        # HR can only approve PENDING_HR
        if instance.status != LeaveRequest.RequestStatus.PENDING_HR:
             return error("HR can only approve requests that are Pending HR Approval.", status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        
        s = LeaveRequestActionSerializer(data=request.data)
        s.is_valid(raise_exception=True)

        instance.status = LeaveRequest.RequestStatus.APPROVED
        instance.decided_by = request.user
        instance.decided_at = timezone.now()
        # Explicit new field + legacy field for compatibility
        note = s.validated_data.get("decision_reason", "")
        instance.hr_decision_note = note 
        instance.decision_reason = note
        instance.save()

        audit(request, "leave_request_approved_hr", entity="leave_request", entity_id=instance.id)
        return success(LeaveRequestSerializer(instance).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsHRManagerOrAdmin])
    def reject(self, request, pk=None):
        instance = self.get_object()
        
        # HR can only reject PENDING_HR (or maybe PENDING_MANAGER if they want to override? Spec says HR approve/reject from PENDING_HR)
        if instance.status != LeaveRequest.RequestStatus.PENDING_HR:
             return error("HR can only reject requests that are Pending HR Approval.", status=status.HTTP_422_UNPROCESSABLE_ENTITY)

        s = LeaveRequestActionSerializer(data=request.data)
        s.is_valid(raise_exception=True)

        instance.status = LeaveRequest.RequestStatus.REJECTED
        instance.decided_by = request.user
        instance.decided_at = timezone.now()
        note = s.validated_data.get("decision_reason", "")
        instance.hr_decision_note = note
        instance.decision_reason = note 
        instance.save()
        
        audit(request, "leave_request_rejected_hr", entity="leave_request", entity_id=instance.id)
        return success(LeaveRequestSerializer(instance).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsLeaveRequestOwner])
    def cancel(self, request, pk=None):
        instance = self.get_object()
        # Allow cancel if PENDING_MANAGER or PENDING_HR
        if instance.status not in [LeaveRequest.RequestStatus.PENDING_MANAGER, LeaveRequest.RequestStatus.PENDING_HR]:
            return error("Only pending requests can be cancelled by the employee.", status=status.HTTP_422_UNPROCESSABLE_ENTITY)

        instance.status = LeaveRequest.RequestStatus.CANCELLED
        instance.save()
        
        audit(request, "leave_request_cancelled", entity="leave_request", entity_id=instance.id)
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
            employee__employee_profile__manager=self.request.user
        ).select_related("employee", "leave_type")

    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        # Implicitly checks queryset filter
        return super().retrieve(request, *args, **kwargs)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsManagerOfEmployee])
    def approve(self, request, pk=None):
        instance = self.get_object()
        
        if instance.status != LeaveRequest.RequestStatus.PENDING_MANAGER:
            return error("Manager can only approve requests that are Pending Manager Approval.", status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        
        s = LeaveRequestActionSerializer(data=request.data)
        s.is_valid(raise_exception=True)

        # Transition to PENDING_HR
        instance.status = LeaveRequest.RequestStatus.PENDING_HR
        instance.manager_decision_by = request.user
        instance.manager_decision_at = timezone.now()
        instance.manager_decision_note = s.validated_data.get("decision_reason", "")
        instance.save()

        audit(request, "leave_request_approved_manager", entity="leave_request", entity_id=instance.id)
        return success(LeaveRequestSerializer(instance).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsManagerOfEmployee])
    def reject(self, request, pk=None):
        instance = self.get_object()

        if instance.status != LeaveRequest.RequestStatus.PENDING_MANAGER:
            return error("Manager can only reject requests that are Pending Manager Approval.", status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        
        s = LeaveRequestActionSerializer(data=request.data)
        s.is_valid(raise_exception=True)

        # Transition to REJECTED (Final)
        instance.status = LeaveRequest.RequestStatus.REJECTED
        instance.manager_decision_by = request.user
        instance.manager_decision_at = timezone.now()
        instance.manager_decision_note = s.validated_data.get("decision_reason", "")
        instance.save()

        audit(request, "leave_request_rejected_manager", entity="leave_request", entity_id=instance.id)
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
            return error("employee_id is required.", status=status.HTTP_400_BAD_REQUEST)
        if not year:
             return error("year is required.", status=status.HTTP_400_BAD_REQUEST)
        
        try:
             year = int(year)
        except ValueError:
             return error("year must be a valid integer.", status=status.HTTP_400_BAD_REQUEST)

        # Get Employee User
        from employees.models import EmployeeProfile
        try:
            profile = EmployeeProfile.objects.get(id=employee_id)
            user = profile.user
        except (EmployeeProfile.DoesNotExist, ValueError):
             return error("Employee not found.", status=status.HTTP_404_NOT_FOUND)

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
    permission_classes = [IsAuthenticated]

    def get(self, request):
        year = request.query_params.get("year")
        
        if not year:
             return error("year is required.", status=status.HTTP_400_BAD_REQUEST)
        
        try:
             year = int(year)
        except ValueError:
             return error("year must be a valid integer.", status=status.HTTP_400_BAD_REQUEST)

        balances = calculate_leave_balance(request.user, year)
        
        # Audit
        audit(request, "leave_balance.viewed", entity="user", entity_id=request.user.id, metadata={"year": year})

        serializer = LeaveBalanceSerializer(balances, many=True)
        return success(serializer.data)
