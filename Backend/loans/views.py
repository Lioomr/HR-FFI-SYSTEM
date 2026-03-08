from django.db.models import Q
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from audit.utils import audit
from core.pagination import StandardPagination
from core.permissions import get_role
from core.responses import error, success
from core.services import (
    get_ceo_approver_users,
    get_cfo_approver_users,
    get_direct_manager_user,
    get_disbursement_approver_users,
    get_hr_approver_users,
    notify_users_for_pending_status,
    send_request_submission_email,
)

from .models import LoanRequest
from .permissions import (
    IsCEOApproverOrAdmin,
    IsCFOApproverOrAdmin,
    IsEmployeeOnly,
    IsFinanceApproverOrAdmin,
    IsHRApproverOrAdmin,
    IsManagerOrAdmin,
    get_active_workflow_config,
    is_accountant_user,
    is_ceo_approver_user,
    is_cfo_approver_user,
    is_hr_approver_user,
)
from .serializers import LoanRequestActionSerializer, LoanRequestCreateSerializer, LoanRequestReadSerializer

LEGACY_PENDING_HR_STATUSES = [
    LoanRequest.RequestStatus.PENDING_HR,
    LoanRequest.RequestStatus.PENDING_FINANCE,
]


def _flatten_errors(error_dict):
    errors = []
    for field, messages in error_dict.items():
        if isinstance(messages, (list, tuple)):
            for msg in messages:
                errors.append(f"{field}: {msg}")
        else:
            errors.append(f"{field}: {messages}")
    return errors


def _scope_hr_queryset_for_user(user, qs):
    if not is_hr_approver_user(user):
        return qs.none()
    return qs


def _scope_disbursement_queryset_for_user(user, qs):
    if not is_accountant_user(user):
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


def _reject_self_approval(request, instance):
    is_hr_manager_origin = bool(instance.employee and instance.employee.groups.filter(name="HRManager").exists())
    if is_hr_manager_origin and instance.employee_id == request.user.id:
        return error("Validation error", errors=["Self approval is not allowed."], status=422)
    return None


def _next_year_month(year, month):
    if month == 12:
        return year + 1, 1
    return year, month + 1


def _is_hr_manager_user(user):
    return bool(user and user.is_authenticated and user.groups.filter(name="HRManager").exists())


def _resolve_open_loan_target_period():
    """
    Open-loan policy:
    - Deduct in current payroll month by default.
    - If current month payroll is already finalized/paid, move target to next month.
    """
    from payroll.models import PayrollRun

    now = timezone.localtime()
    year, month = now.year, now.month
    current_run = PayrollRun.objects.filter(year=year, month=month).order_by("-id").first()
    if current_run and current_run.status in [PayrollRun.Status.COMPLETED, PayrollRun.Status.PAID]:
        return _next_year_month(year, month)
    return year, month


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
        if self.action in ["list", "retrieve", "approve", "reject"]:
            return [IsAuthenticated(), IsHRApproverOrAdmin()]
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
        if _is_hr_manager_user(request.user):
            initial_status = LoanRequest.RequestStatus.PENDING_CEO
        elif manager_user and config.require_manager_stage:
            initial_status = LoanRequest.RequestStatus.PENDING_MANAGER
        else:
            initial_status = LoanRequest.RequestStatus.PENDING_HR

        instance = LoanRequest.objects.create(
            employee=request.user,
            employee_profile=profile,
            requested_amount=serializer.validated_data["amount"],
            loan_type=serializer.validated_data.get("loan_type", LoanRequest.LoanType.OPEN),
            installment_months=serializer.validated_data.get("installment_months"),
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
        try:
            send_request_submission_email(
                to_email=getattr(request.user, "email", None),
                employee_name=request.user.full_name or request.user.email,
                request_type="Loan Request",
                request_id=instance.id,
                status_label=instance.status,
                details=[
                    f"Loan Type: {instance.loan_type}",
                    f"Requested Amount: {instance.requested_amount}",
                ],
                action_path=f"/employee/loans/{instance.id}",
            )
        except Exception:
            pass
        try:
            requester_name = request.user.full_name or request.user.email
            details = [f"Loan Type: {instance.loan_type}", f"Requested Amount: {instance.requested_amount}"]
            if instance.status == LoanRequest.RequestStatus.PENDING_MANAGER:
                manager = get_direct_manager_user(request.user)
                if manager:
                    notify_users_for_pending_status(
                        users=[manager],
                        request_type="Loan Request",
                        request_id=instance.id,
                        requester_name=requester_name,
                        status_label=instance.status,
                        details=details,
                        action_path=f"/manager/loan-requests/{instance.id}",
                    )
            elif instance.status in LEGACY_PENDING_HR_STATUSES:
                notify_users_for_pending_status(
                    users=get_hr_approver_users(),
                    request_type="Loan Request",
                    request_id=instance.id,
                    requester_name=requester_name,
                    status_label=instance.status,
                    details=details,
                    action_path=f"/finance/loan-requests/{instance.id}",
                )
            elif instance.status == LoanRequest.RequestStatus.PENDING_CEO:
                notify_users_for_pending_status(
                    users=get_ceo_approver_users(),
                    request_type="Loan Request",
                    request_id=instance.id,
                    requester_name=requester_name,
                    status_label=instance.status,
                    details=details,
                    action_path=f"/ceo/loan-requests/{instance.id}",
                )
        except Exception:
            pass
        return success(LoanRequestReadSerializer(instance).data, status=status.HTTP_201_CREATED)

    def list(self, request, *args, **kwargs):
        qs = _scope_hr_queryset_for_user(request.user, self.get_queryset())
        status_param = request.query_params.get("status")
        if status_param:
            if status_param == LoanRequest.RequestStatus.PENDING_HR:
                qs = qs.filter(status__in=LEGACY_PENDING_HR_STATUSES)
            else:
                qs = qs.filter(status=status_param)
        else:
            qs = qs.filter(status__in=LEGACY_PENDING_HR_STATUSES)

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
        instance = _scope_hr_queryset_for_user(request.user, self.get_queryset()).filter(pk=kwargs.get("pk")).first()
        if not instance:
            return error("Not found", errors=["Not found."], status=404)
        return success(LoanRequestReadSerializer(instance).data)

    def destroy(self, request, *args, **kwargs):
        return error("Hard delete is not allowed.", errors=["Hard delete is not allowed."], status=405)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsHRApproverOrAdmin])
    def approve(self, request, pk=None):
        instance = _scope_hr_queryset_for_user(request.user, self.get_queryset()).filter(pk=pk).first()
        if not instance:
            return error("Not found", errors=["Not found."], status=404)
        self_approval_error = _reject_self_approval(request, instance)
        if self_approval_error:
            return self_approval_error
        if instance.status not in LEGACY_PENDING_HR_STATUSES:
            return error("Validation error", errors=["Request is not pending HR approval."], status=422)

        serializer = LoanRequestActionSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)

        instance.status = LoanRequest.RequestStatus.PENDING_CFO
        instance.finance_decision_by = request.user
        instance.finance_decision_at = timezone.now()
        instance.finance_decision_note = serializer.validated_data.get("comment", "")
        instance.hr_recommendation = LoanRequest.Recommendation.APPROVE
        instance.save(
            update_fields=[
                "status",
                "finance_decision_by",
                "finance_decision_at",
                "finance_decision_note",
                "hr_recommendation",
                "updated_at",
            ]
        )
        audit(request, "loan_request_recommended_hr_approve", entity="LoanRequest", entity_id=instance.id)
        try:
            notify_users_for_pending_status(
                users=get_cfo_approver_users(),
                request_type="Loan Request",
                request_id=instance.id,
                requester_name=instance.employee.full_name or instance.employee.email,
                status_label=instance.status,
                details=[f"Requested Amount: {instance.requested_amount}", "HR recommendation: approve"],
                action_path=f"/cfo/loan-requests/{instance.id}",
            )
        except Exception:
            pass
        return success(LoanRequestReadSerializer(instance).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsHRApproverOrAdmin])
    def reject(self, request, pk=None):
        instance = _scope_hr_queryset_for_user(request.user, self.get_queryset()).filter(pk=pk).first()
        if not instance:
            return error("Not found", errors=["Not found."], status=404)
        self_approval_error = _reject_self_approval(request, instance)
        if self_approval_error:
            return self_approval_error
        if instance.status not in LEGACY_PENDING_HR_STATUSES:
            return error("Validation error", errors=["Request is not pending HR approval."], status=422)

        serializer = LoanRequestActionSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)

        instance.status = LoanRequest.RequestStatus.PENDING_CFO
        instance.finance_decision_by = request.user
        instance.finance_decision_at = timezone.now()
        instance.finance_decision_note = serializer.validated_data.get("comment", "")
        instance.hr_recommendation = LoanRequest.Recommendation.REJECT
        instance.save(
            update_fields=[
                "status",
                "finance_decision_by",
                "finance_decision_at",
                "finance_decision_note",
                "hr_recommendation",
                "updated_at",
            ]
        )
        audit(request, "loan_request_recommended_hr_reject", entity="LoanRequest", entity_id=instance.id)
        try:
            notify_users_for_pending_status(
                users=get_cfo_approver_users(),
                request_type="Loan Request",
                request_id=instance.id,
                requester_name=instance.employee.full_name or instance.employee.email,
                status_label=instance.status,
                details=[f"Requested Amount: {instance.requested_amount}", "HR recommendation: reject"],
                action_path=f"/cfo/loan-requests/{instance.id}",
            )
        except Exception:
            pass
        return success(LoanRequestReadSerializer(instance).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsEmployeeOnly])
    def cancel(self, request, pk=None):
        instance = self.get_object()
        if instance.employee_id != request.user.id:
            return error("Forbidden", errors=["Forbidden."], status=status.HTTP_403_FORBIDDEN)

        allowed_statuses = [
            LoanRequest.RequestStatus.SUBMITTED,
            LoanRequest.RequestStatus.PENDING_MANAGER,
            LoanRequest.RequestStatus.PENDING_HR,
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
        return LoanRequest.objects.filter(employee=self.request.user, is_active=True).select_related(
            "employee", "employee_profile"
        )

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

        instance.status = LoanRequest.RequestStatus.PENDING_HR
        instance.manager_decision_by = request.user
        instance.manager_decision_at = timezone.now()
        instance.manager_decision_note = serializer.validated_data.get("comment", "")
        instance.manager_recommendation = LoanRequest.Recommendation.APPROVE
        instance.save(
            update_fields=[
                "status",
                "manager_decision_by",
                "manager_decision_at",
                "manager_decision_note",
                "manager_recommendation",
                "updated_at",
            ]
        )
        audit(request, "loan_request_recommended_manager_approve", entity="LoanRequest", entity_id=instance.id)
        try:
            notify_users_for_pending_status(
                users=get_hr_approver_users(),
                request_type="Loan Request",
                request_id=instance.id,
                requester_name=instance.employee.full_name or instance.employee.email,
                status_label=instance.status,
                details=[f"Requested Amount: {instance.requested_amount}", "Manager recommendation: approve"],
                action_path=f"/finance/loan-requests/{instance.id}",
            )
        except Exception:
            pass
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

        instance.status = LoanRequest.RequestStatus.PENDING_HR
        instance.manager_decision_by = request.user
        instance.manager_decision_at = timezone.now()
        instance.manager_decision_note = serializer.validated_data.get("comment", "")
        instance.manager_recommendation = LoanRequest.Recommendation.REJECT
        instance.save(
            update_fields=[
                "status",
                "manager_decision_by",
                "manager_decision_at",
                "manager_decision_note",
                "manager_recommendation",
                "updated_at",
            ]
        )
        audit(request, "loan_request_recommended_manager_reject", entity="LoanRequest", entity_id=instance.id)
        try:
            notify_users_for_pending_status(
                users=get_hr_approver_users(),
                request_type="Loan Request",
                request_id=instance.id,
                requester_name=instance.employee.full_name or instance.employee.email,
                status_label=instance.status,
                details=[f"Requested Amount: {instance.requested_amount}", "Manager recommendation: reject"],
                action_path=f"/finance/loan-requests/{instance.id}",
            )
        except Exception:
            pass
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

        approved_year, approved_month = timezone.localtime().year, timezone.localtime().month
        target_year = None
        target_month = None
        if instance.loan_type == LoanRequest.LoanType.OPEN:
            target_year, target_month = _resolve_open_loan_target_period()
        instance.status = LoanRequest.RequestStatus.PENDING_DISBURSEMENT
        instance.approved_amount = instance.requested_amount
        instance.approved_year = approved_year
        instance.approved_month = approved_month
        instance.target_deduction_year = target_year
        instance.target_deduction_month = target_month
        instance.cfo_decision_by = request.user
        instance.cfo_decision_at = timezone.now()
        instance.cfo_decision_note = serializer.validated_data.get("comment", "")
        instance.save(
            update_fields=[
                "status",
                "approved_amount",
                "approved_year",
                "approved_month",
                "target_deduction_year",
                "target_deduction_month",
                "cfo_decision_by",
                "cfo_decision_at",
                "cfo_decision_note",
                "updated_at",
            ]
        )
        audit(request, "loan_request_approved_cfo", entity="LoanRequest", entity_id=instance.id)
        try:
            notify_users_for_pending_status(
                users=get_disbursement_approver_users(),
                request_type="Loan Disbursement",
                request_id=instance.id,
                requester_name=instance.employee.full_name or instance.employee.email,
                status_label=instance.status,
                details=[f"Approved Amount: {instance.approved_amount or instance.requested_amount}"],
                action_path=f"/finance/loan-requests/{instance.id}",
            )
        except Exception:
            pass
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

    @action(detail=True, methods=["post"], url_path="refer-to-ceo", permission_classes=[IsAuthenticated, IsCFOApproverOrAdmin])
    def refer_to_ceo(self, request, pk=None):
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

        instance.status = LoanRequest.RequestStatus.PENDING_CEO
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
        audit(request, "loan_request_referred_to_ceo", entity="LoanRequest", entity_id=instance.id)
        try:
            notify_users_for_pending_status(
                users=get_ceo_approver_users(),
                request_type="Loan Request",
                request_id=instance.id,
                requester_name=instance.employee.full_name or instance.employee.email,
                status_label=instance.status,
                details=[f"Requested Amount: {instance.requested_amount}", "Referred by CFO"],
                action_path=f"/ceo/loan-requests/{instance.id}",
            )
        except Exception:
            pass
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

        approved_year, approved_month = timezone.localtime().year, timezone.localtime().month
        target_year = None
        target_month = None
        if instance.loan_type == LoanRequest.LoanType.OPEN:
            target_year, target_month = _resolve_open_loan_target_period()
        instance.status = LoanRequest.RequestStatus.PENDING_DISBURSEMENT
        instance.approved_amount = instance.requested_amount
        instance.approved_year = approved_year
        instance.approved_month = approved_month
        instance.target_deduction_year = target_year
        instance.target_deduction_month = target_month
        instance.ceo_decision_by = request.user
        instance.ceo_decision_at = timezone.now()
        instance.ceo_decision_note = serializer.validated_data.get("comment", "")
        instance.save(
            update_fields=[
                "status",
                "approved_amount",
                "approved_year",
                "approved_month",
                "target_deduction_year",
                "target_deduction_month",
                "ceo_decision_by",
                "ceo_decision_at",
                "ceo_decision_note",
                "updated_at",
            ]
        )
        audit(request, "loan_request_approved_ceo", entity="LoanRequest", entity_id=instance.id)
        try:
            notify_users_for_pending_status(
                users=get_disbursement_approver_users(),
                request_type="Loan Disbursement",
                request_id=instance.id,
                requester_name=instance.employee.full_name or instance.employee.email,
                status_label=instance.status,
                details=[f"Approved Amount: {instance.approved_amount or instance.requested_amount}"],
                action_path=f"/finance/loan-requests/{instance.id}",
            )
        except Exception:
            pass
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


class DisbursementLoanRequestViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = LoanRequestReadSerializer
    permission_classes = [IsAuthenticated, IsFinanceApproverOrAdmin]
    pagination_class = StandardPagination
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status"]
    ordering_fields = ["created_at", "requested_amount"]
    ordering = ["-created_at"]

    def get_queryset(self):
        qs = LoanRequest.objects.filter(is_active=True).select_related("employee", "employee_profile")
        qs = _scope_disbursement_queryset_for_user(self.request.user, qs)
        status_param = self.request.query_params.get("status")
        if status_param:
            return qs.filter(status=status_param)
        return qs.filter(status=LoanRequest.RequestStatus.PENDING_DISBURSEMENT)

    @action(detail=True, methods=["post"], url_path="mark-disbursed", permission_classes=[IsAuthenticated, IsFinanceApproverOrAdmin])
    def mark_disbursed(self, request, pk=None):
        instance = self.get_object()
        if instance.status != LoanRequest.RequestStatus.PENDING_DISBURSEMENT:
            return error("Validation error", errors=["Request is not pending disbursement."], status=422)

        serializer = LoanRequestActionSerializer(data=request.data)
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)

        instance.status = LoanRequest.RequestStatus.APPROVED
        instance.disbursed_by = request.user
        instance.disbursed_at = timezone.now()
        instance.disbursement_note = serializer.validated_data.get("comment", "")
        instance.save(
            update_fields=[
                "status",
                "disbursed_by",
                "disbursed_at",
                "disbursement_note",
                "updated_at",
            ]
        )
        audit(request, "loan_request_disbursed", entity="LoanRequest", entity_id=instance.id)
        return success(LoanRequestReadSerializer(instance).data)
