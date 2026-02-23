from django.db.models import Q
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend

from audit.utils import audit
from core.pagination import StandardPagination
from core.permissions import get_role
from core.responses import error, success
from employees.models import EmployeeProfile

from .models import LoanRequest
from .permissions import (
    IsCEOApproverOrAdmin,
    IsCFOApproverOrAdmin,
    IsEmployeeOnly,
    IsFinanceApproverOrAdmin,
    IsManagerOrAdmin,
    get_active_workflow_config,
    is_ceo_approver_user,
    is_cfo_approver_user,
    is_cfo_requester,
    is_cfo_requester_profile,
    is_finance_approver_user,
)
from .serializers import LoanRequestActionSerializer, LoanRequestCreateSerializer, LoanRequestReadSerializer


def _flatten_errors(error_dict):
    errors = []
    for field, messages in error_dict.items():
        if isinstance(messages, (list, tuple)):
            for msg in messages:
                errors.append(f"{field}: {msg}")
        else:
            errors.append(f"{field}: {messages}")
    return errors


def _scope_finance_queryset_for_user(user, qs):
    if not is_finance_approver_user(user):
        return qs.none()

    return qs


def _scope_cfo_queryset_for_user(user, qs):
    if not is_cfo_approver_user(user):
        return qs.none()
    return qs


def _scope_ceo_queryset_for_user(user, qs):
    if not is_ceo_approver_user(user):
        return qs.none()
    return qs


def _has_available_ceo_approver(exclude_user_id):
    config = get_active_workflow_config()
    user_model = get_user_model()
    base_qs = user_model.objects.filter(is_active=True)
    if base_qs.filter(groups__name__in=["CEO", "SystemAdmin"]).exclude(id=exclude_user_id).exists():
        return True

    return (
        EmployeeProfile.objects.filter(
            user__isnull=False,
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            position_ref_id=config.ceo_position_id,
            user__is_active=True,
        )
        .exclude(user_id=exclude_user_id)
        .exists()
    )


def _reject_self_approval(request, instance):
    if instance.employee_id == request.user.id:
        return error("Validation error", errors=["Self approval is not allowed."], status=422)
    return None


class LoanRequestViewSet(viewsets.ModelViewSet):
    serializer_class = LoanRequestReadSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPagination
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status", "employee"]
    ordering_fields = ["created_at", "requested_amount"]
    ordering = ["-created_at"]

    def get_permissions(self):
        if self.action == "create":
            return [IsAuthenticated(), IsEmployeeOnly()]
        if self.action in ["list", "approve", "reject"]:
            return [IsAuthenticated(), IsFinanceApproverOrAdmin()]
        if self.action == "cancel":
            return [IsAuthenticated(), IsEmployeeOnly()]
        return [IsAuthenticated()]

    def get_queryset(self):
        return LoanRequest.objects.filter(is_active=True).select_related("employee", "employee_profile")

    def get_serializer_class(self):
        if self.action == "create":
            return LoanRequestCreateSerializer
        return LoanRequestReadSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data, context={"request": request})
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)

        profile = serializer.validated_data["employee_profile"]
        manager_user = None
        if profile.manager_profile and profile.manager_profile.user_id:
            manager_user = profile.manager_profile.user
        elif profile.manager_id:
            manager_user = profile.manager

        config = get_active_workflow_config()
        requester_is_cfo = is_cfo_requester(request.user, profile)

        if requester_is_cfo:
            # CFO requests always route through finance then CEO.
            initial_status = LoanRequest.RequestStatus.PENDING_FINANCE
        elif manager_user and is_cfo_approver_user(manager_user):
            # If direct manager is CFO approver, route directly to CFO.
            initial_status = LoanRequest.RequestStatus.PENDING_CFO
        elif manager_user and config.require_manager_stage:
            initial_status = LoanRequest.RequestStatus.PENDING_MANAGER
        else:
            initial_status = LoanRequest.RequestStatus.PENDING_FINANCE

        instance = LoanRequest.objects.create(
            employee=request.user,
            employee_profile=profile,
            requested_amount=serializer.validated_data["amount"],
            reason=serializer.validated_data.get("reason", ""),
            status=initial_status,
        )

        audit(
            request,
            "loan_request_submitted",
            entity="LoanRequest",
            entity_id=instance.id,
            metadata={"amount": str(instance.requested_amount), "status": instance.status},
        )
        return success(LoanRequestReadSerializer(instance).data, status=status.HTTP_201_CREATED)

    def list(self, request, *args, **kwargs):
        qs = _scope_finance_queryset_for_user(request.user, self.get_queryset())
        status_param = request.query_params.get("status")
        if status_param:
            qs = qs.filter(status=status_param)
        else:
            qs = qs.filter(status=LoanRequest.RequestStatus.PENDING_FINANCE)

        employee_id = request.query_params.get("employee_id")
        if employee_id:
            qs = qs.filter(employee_id=employee_id)

        date_from = request.query_params.get("date_from")
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)

        date_to = request.query_params.get("date_to")
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)

        page = self.paginate_queryset(qs)
        serializer = LoanRequestReadSerializer(page if page is not None else qs, many=True)
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
        instance = _scope_finance_queryset_for_user(request.user, self.get_queryset()).filter(pk=kwargs.get("pk")).first()
        if not instance:
            return error("Not found", errors=["Not found."], status=404)
        return success(LoanRequestReadSerializer(instance).data)

    def destroy(self, request, *args, **kwargs):
        return error("Hard delete is not allowed.", errors=["Hard delete is not allowed."], status=405)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsFinanceApproverOrAdmin])
    def approve(self, request, pk=None):
        instance = _scope_finance_queryset_for_user(request.user, self.get_queryset()).filter(pk=pk).first()
        if not instance:
            return error("Not found", errors=["Not found."], status=404)
        self_approval_error = _reject_self_approval(request, instance)
        if self_approval_error:
            return self_approval_error
        if instance.status != LoanRequest.RequestStatus.PENDING_FINANCE:
            return error("Validation error", errors=["Request is not pending finance approval."], status=422)

        serializer = LoanRequestActionSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)

        if is_cfo_requester(instance.employee, instance.employee_profile):
            if not _has_available_ceo_approver(exclude_user_id=instance.employee_id):
                return error(
                    "Validation error",
                    errors=["No eligible CEO approver found for this request."],
                    status=422,
                )
            next_status = LoanRequest.RequestStatus.PENDING_CEO
        else:
            next_status = LoanRequest.RequestStatus.PENDING_CFO

        instance.status = next_status
        instance.finance_decision_by = request.user
        instance.finance_decision_at = timezone.now()
        instance.finance_decision_note = serializer.validated_data.get("comment", "")
        instance.save(
            update_fields=[
                "status",
                "finance_decision_by",
                "finance_decision_at",
                "finance_decision_note",
                "updated_at",
            ]
        )
        audit(request, "loan_request_approved_finance", entity="LoanRequest", entity_id=instance.id)
        return success(LoanRequestReadSerializer(instance).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsFinanceApproverOrAdmin])
    def reject(self, request, pk=None):
        instance = _scope_finance_queryset_for_user(request.user, self.get_queryset()).filter(pk=pk).first()
        if not instance:
            return error("Not found", errors=["Not found."], status=404)
        self_approval_error = _reject_self_approval(request, instance)
        if self_approval_error:
            return self_approval_error
        if instance.status != LoanRequest.RequestStatus.PENDING_FINANCE:
            return error("Validation error", errors=["Request is not pending finance approval."], status=422)

        serializer = LoanRequestActionSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)
        comment = serializer.validated_data.get("comment", "").strip()
        if not comment:
            return error("Validation error", errors=["comment is required."], status=422)

        instance.status = LoanRequest.RequestStatus.REJECTED
        instance.finance_decision_by = request.user
        instance.finance_decision_at = timezone.now()
        instance.finance_decision_note = comment
        instance.save(
            update_fields=[
                "status",
                "finance_decision_by",
                "finance_decision_at",
                "finance_decision_note",
                "updated_at",
            ]
        )
        audit(request, "loan_request_rejected_finance", entity="LoanRequest", entity_id=instance.id)
        return success(LoanRequestReadSerializer(instance).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsEmployeeOnly])
    def cancel(self, request, pk=None):
        instance = self.get_object()
        if instance.employee_id != request.user.id:
            return error("Forbidden", errors=["Forbidden."], status=status.HTTP_403_FORBIDDEN)

        allowed_statuses = [
            LoanRequest.RequestStatus.SUBMITTED,
            LoanRequest.RequestStatus.PENDING_MANAGER,
            LoanRequest.RequestStatus.PENDING_FINANCE,
            LoanRequest.RequestStatus.PENDING_CFO,
            LoanRequest.RequestStatus.PENDING_CEO,
        ]
        if instance.status not in allowed_statuses:
            return error("Validation error", errors=["Only pending requests can be cancelled."], status=422)

        instance.status = LoanRequest.RequestStatus.CANCELLED
        instance.save(update_fields=["status", "updated_at"])
        audit(request, "loan_request_cancelled", entity="LoanRequest", entity_id=instance.id)
        return success(LoanRequestReadSerializer(instance).data)


class EmployeeLoanRequestViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = LoanRequestReadSerializer
    permission_classes = [IsAuthenticated, IsEmployeeOnly]
    pagination_class = StandardPagination

    def get_queryset(self):
        return LoanRequest.objects.filter(employee=self.request.user, is_active=True).select_related("employee", "employee_profile")

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        status_param = request.query_params.get("status")
        if status_param:
            qs = qs.filter(status=status_param)
        page = self.paginate_queryset(qs)
        serializer = self.get_serializer(page if page is not None else qs, many=True)
        if page is not None:
            return self.get_paginated_response(serializer.data)
        return success({"items": serializer.data, "count": len(serializer.data)})

    def retrieve(self, request, *args, **kwargs):
        return success(super().retrieve(request, *args, **kwargs).data)


class ManagerLoanRequestViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = LoanRequestReadSerializer
    permission_classes = [IsAuthenticated, IsManagerOrAdmin]
    pagination_class = StandardPagination
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status"]
    ordering_fields = ["created_at", "requested_amount"]
    ordering = ["-created_at"]

    def get_queryset(self):
        role = get_role(self.request.user)
        base_qs = LoanRequest.objects.filter(is_active=True).select_related("employee", "employee_profile")
        if role == "SystemAdmin":
            return base_qs

        manager_profile = getattr(self.request.user, "employee_profile", None)
        manager_match = Q(employee_profile__manager=self.request.user)
        if manager_profile:
            manager_match = manager_match | Q(employee_profile__manager_profile=manager_profile)

        # History visibility: include requests the manager already decided on,
        # even if the employee mapping changes later.
        return base_qs.filter(manager_match | Q(manager_decision_by=self.request.user)).distinct()

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        return success(LoanRequestReadSerializer(instance).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsManagerOrAdmin])
    def approve(self, request, pk=None):
        instance = self.get_object()
        self_approval_error = _reject_self_approval(request, instance)
        if self_approval_error:
            return self_approval_error
        if instance.status != LoanRequest.RequestStatus.PENDING_MANAGER:
            return error("Validation error", errors=["Request is not pending manager approval."], status=422)

        serializer = LoanRequestActionSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)

        instance.status = LoanRequest.RequestStatus.PENDING_FINANCE
        instance.manager_decision_by = request.user
        instance.manager_decision_at = timezone.now()
        instance.manager_decision_note = serializer.validated_data.get("comment", "")
        instance.save(
            update_fields=[
                "status",
                "manager_decision_by",
                "manager_decision_at",
                "manager_decision_note",
                "updated_at",
            ]
        )
        audit(request, "loan_request_approved_manager", entity="LoanRequest", entity_id=instance.id)
        return success(LoanRequestReadSerializer(instance).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsManagerOrAdmin])
    def reject(self, request, pk=None):
        instance = self.get_object()
        self_approval_error = _reject_self_approval(request, instance)
        if self_approval_error:
            return self_approval_error
        if instance.status != LoanRequest.RequestStatus.PENDING_MANAGER:
            return error("Validation error", errors=["Request is not pending manager approval."], status=422)

        serializer = LoanRequestActionSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)
        comment = serializer.validated_data.get("comment", "").strip()
        if not comment:
            return error("Validation error", errors=["comment is required."], status=422)

        instance.status = LoanRequest.RequestStatus.REJECTED
        instance.manager_decision_by = request.user
        instance.manager_decision_at = timezone.now()
        instance.manager_decision_note = comment
        instance.save(
            update_fields=[
                "status",
                "manager_decision_by",
                "manager_decision_at",
                "manager_decision_note",
                "updated_at",
            ]
        )
        audit(request, "loan_request_rejected_manager", entity="LoanRequest", entity_id=instance.id)
        return success(LoanRequestReadSerializer(instance).data)


class CFOLoanRequestViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = LoanRequestReadSerializer
    permission_classes = [IsAuthenticated, IsCFOApproverOrAdmin]
    pagination_class = StandardPagination
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status"]
    ordering_fields = ["created_at", "requested_amount"]
    ordering = ["-created_at"]

    def get_queryset(self):
        qs = LoanRequest.objects.filter(is_active=True).select_related("employee", "employee_profile")
        qs = _scope_cfo_queryset_for_user(self.request.user, qs)
        status_param = self.request.query_params.get("status")
        if status_param:
            return qs.filter(status=status_param)
        return qs.filter(status=LoanRequest.RequestStatus.PENDING_CFO)

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        return success(LoanRequestReadSerializer(instance).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsCFOApproverOrAdmin])
    def approve(self, request, pk=None):
        instance = self.get_object()
        self_approval_error = _reject_self_approval(request, instance)
        if self_approval_error:
            return self_approval_error
        if instance.status != LoanRequest.RequestStatus.PENDING_CFO:
            return error("Validation error", errors=["Request is not pending CFO approval."], status=422)

        serializer = LoanRequestActionSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)

        instance.status = LoanRequest.RequestStatus.APPROVED
        instance.approved_amount = instance.requested_amount
        instance.cfo_decision_by = request.user
        instance.cfo_decision_at = timezone.now()
        instance.cfo_decision_note = serializer.validated_data.get("comment", "")
        instance.save(
            update_fields=[
                "status",
                "approved_amount",
                "cfo_decision_by",
                "cfo_decision_at",
                "cfo_decision_note",
                "updated_at",
            ]
        )
        audit(request, "loan_request_approved_cfo", entity="LoanRequest", entity_id=instance.id)
        return success(LoanRequestReadSerializer(instance).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsCFOApproverOrAdmin])
    def reject(self, request, pk=None):
        instance = self.get_object()
        self_approval_error = _reject_self_approval(request, instance)
        if self_approval_error:
            return self_approval_error
        if instance.status != LoanRequest.RequestStatus.PENDING_CFO:
            return error("Validation error", errors=["Request is not pending CFO approval."], status=422)

        serializer = LoanRequestActionSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)
        comment = serializer.validated_data.get("comment", "").strip()
        if not comment:
            return error("Validation error", errors=["comment is required."], status=422)

        instance.status = LoanRequest.RequestStatus.REJECTED
        instance.cfo_decision_by = request.user
        instance.cfo_decision_at = timezone.now()
        instance.cfo_decision_note = comment
        instance.save(
            update_fields=[
                "status",
                "cfo_decision_by",
                "cfo_decision_at",
                "cfo_decision_note",
                "updated_at",
            ]
        )
        audit(request, "loan_request_rejected_cfo", entity="LoanRequest", entity_id=instance.id)
        return success(LoanRequestReadSerializer(instance).data)


class CEOLoanRequestViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = LoanRequestReadSerializer
    permission_classes = [IsAuthenticated, IsCEOApproverOrAdmin]
    pagination_class = StandardPagination
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status"]
    ordering_fields = ["created_at", "requested_amount"]
    ordering = ["-created_at"]

    def get_queryset(self):
        qs = LoanRequest.objects.filter(is_active=True).select_related("employee", "employee_profile")
        qs = _scope_ceo_queryset_for_user(self.request.user, qs)
        status_param = self.request.query_params.get("status")
        if status_param:
            return qs.filter(status=status_param)
        return qs.filter(status=LoanRequest.RequestStatus.PENDING_CEO)

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        return success(LoanRequestReadSerializer(instance).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsCEOApproverOrAdmin])
    def approve(self, request, pk=None):
        instance = self.get_object()
        self_approval_error = _reject_self_approval(request, instance)
        if self_approval_error:
            return self_approval_error
        if instance.status != LoanRequest.RequestStatus.PENDING_CEO:
            return error("Validation error", errors=["Request is not pending CEO approval."], status=422)

        serializer = LoanRequestActionSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)

        instance.status = LoanRequest.RequestStatus.APPROVED
        instance.approved_amount = instance.requested_amount
        instance.ceo_decision_by = request.user
        instance.ceo_decision_at = timezone.now()
        instance.ceo_decision_note = serializer.validated_data.get("comment", "")
        instance.save(
            update_fields=[
                "status",
                "approved_amount",
                "ceo_decision_by",
                "ceo_decision_at",
                "ceo_decision_note",
                "updated_at",
            ]
        )
        audit(request, "loan_request_approved_ceo", entity="LoanRequest", entity_id=instance.id)
        return success(LoanRequestReadSerializer(instance).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsCEOApproverOrAdmin])
    def reject(self, request, pk=None):
        instance = self.get_object()
        self_approval_error = _reject_self_approval(request, instance)
        if self_approval_error:
            return self_approval_error
        if instance.status != LoanRequest.RequestStatus.PENDING_CEO:
            return error("Validation error", errors=["Request is not pending CEO approval."], status=422)

        serializer = LoanRequestActionSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)
        comment = serializer.validated_data.get("comment", "").strip()
        if not comment:
            return error("Validation error", errors=["comment is required."], status=422)

        instance.status = LoanRequest.RequestStatus.REJECTED
        instance.ceo_decision_by = request.user
        instance.ceo_decision_at = timezone.now()
        instance.ceo_decision_note = comment
        instance.save(
            update_fields=[
                "status",
                "ceo_decision_by",
                "ceo_decision_at",
                "ceo_decision_note",
                "updated_at",
            ]
        )
        audit(request, "loan_request_rejected_ceo", entity="LoanRequest", entity_id=instance.id)
        return success(LoanRequestReadSerializer(instance).data)
