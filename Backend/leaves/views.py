import mimetypes
from datetime import date

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db.models import Q
from django.http import FileResponse
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.utils import audit
from core.pagination import StandardPagination
from core.permissions import IsDepartmentCEOApprover, get_role
from core.responses import error, success
from core.services import (
    get_ceo_approver_users,
    get_direct_manager_user,
    get_hr_approver_users,
    notify_users_for_pending_status,
    send_leave_rejected_email,
    send_request_submission_email,
)
from employees.models import EmployeeProfile
from employees.permissions import IsHRManagerOrAdmin

from .models import LeaveBalanceAdjustment, LeaveRequest, LeaveType
from .notifications import (
    send_leave_request_approved_whatsapp,
    send_leave_request_rejected_whatsapp,
    send_leave_request_submitted_whatsapp,
)
from .permissions import (
    IsEmployeeOnly,
    IsLeaveRequestOwner,
    IsManagerOfEmployee,
    IsOwnerOrHR,
)
from .serializers import (
    HRManualLeaveRequestSerializer,
    LeaveBalanceAdjustmentSerializer,
    LeaveBalanceSerializer,
    LeaveRequestActionSerializer,
    LeaveRequestCreateSerializer,
    LeaveRequestSerializer,
    LeaveTypeSerializer,
)
from .utils import calculate_leave_balance, get_leave_days, get_payment_breakdown, get_used_days_for_type

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


def _to_bool(value):
    return str(value).strip().lower() in {"1", "true", "yes", "y"}


def _is_hr_manager_user(user):
    return bool(user and user.is_authenticated and user.groups.filter(name="HRManager").exists())


def _is_hr_manager_origin_request(instance: LeaveRequest):
    employee = getattr(instance, "employee", None)
    return bool(employee and employee.groups.filter(name="HRManager").exists())


def _serve_leave_document(instance, request):
    if not instance.document:
        return error("Not found", errors=["No document attached to this leave request."], status=404)

    try:
        as_attachment = _to_bool(request.query_params.get("download", "0"))
        filename = instance.document.name.split("/")[-1] or f"leave_document_{instance.id}"
        
        # Guess the content type so the browser can preview PDFs/images inline
        content_type, _ = mimetypes.guess_type(filename)
        if not content_type:
            content_type = "application/octet-stream"
            
        return FileResponse(
            instance.document.open("rb"),
            as_attachment=as_attachment,
            filename=filename,
            content_type=content_type,
        )
    except FileNotFoundError:
        return error("Not found", errors=["Document file is missing from storage."], status=404)


class LeaveTypeViewSet(viewsets.ModelViewSet):
    queryset = LeaveType.objects.all()
    serializer_class = LeaveTypeSerializer
    permission_classes = [IsAuthenticated]  # Overridden by get_permissions

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
        audit(
            self.request,
            "leave_type_deactivated",
            entity="leave_type",
            entity_id=instance.id,
            metadata={"name": instance.name},
        )

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
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status", "leave_type", "employee"]
    ordering_fields = ["created_at", "start_date"]
    ordering = ["-created_at"]

    def get_queryset(self):
        user = self.request.user
        role = get_role(user)
        base_qs = LeaveRequest.objects.filter(is_active=True).select_related(
            "employee", "employee__employee_profile", "leave_type", "decided_by", "manager_decision_by"
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
        user = self.request.user
        has_manager = False
        # Check both new manager_profile and legacy manager for compatibility
        if hasattr(user, "employee_profile"):
            profile = user.employee_profile
            manager_user_id = profile.manager_id
            if not manager_user_id and profile.manager_profile:
                manager_user_id = profile.manager_profile.user_id
            has_manager = bool(manager_user_id)

        if _is_hr_manager_user(user):
            initial_status = LeaveRequest.RequestStatus.PENDING_CEO
        elif has_manager:
            initial_status = LeaveRequest.RequestStatus.PENDING_MANAGER
        else:
            initial_status = LeaveRequest.RequestStatus.PENDING_HR

        instance = serializer.save(employee=self.request.user, status=initial_status)
        requested_days = get_leave_days(instance.start_date, instance.end_date)
        used_before = get_used_days_for_type(self.request.user, instance.leave_type, instance.start_date.year)
        payment_breakdown = get_payment_breakdown(instance.leave_type, used_before, requested_days)

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
                "duration_days": requested_days,
                "payment_breakdown": payment_breakdown,
                "approval_status": instance.status,
            },
        )
        # Fire-and-log pattern: leave workflow should not fail on notification issues.
        try:
            send_leave_request_submitted_whatsapp(instance)
        except Exception:
            pass
        try:
            send_request_submission_email(
                to_email=getattr(instance.employee, "email", None),
                employee_name=instance.employee.full_name or instance.employee.email,
                request_type="Leave Request",
                request_id=instance.id,
                status_label=instance.status,
                details=[
                    f"Leave Type: {instance.leave_type.name}",
                    f"From: {instance.start_date}",
                    f"To: {instance.end_date}",
                ],
                action_path="/employee/leave/requests",
            )
        except Exception:
            pass
        try:
            requester_name = instance.employee.full_name or instance.employee.email
            details = [
                f"Leave Type: {instance.leave_type.name}",
                f"From: {instance.start_date}",
                f"To: {instance.end_date}",
            ]
            if instance.status == LeaveRequest.RequestStatus.PENDING_MANAGER:
                manager = get_direct_manager_user(instance.employee)
                if manager:
                    notify_users_for_pending_status(
                        users=[manager],
                        request_type="Leave Request",
                        request_id=instance.id,
                        requester_name=requester_name,
                        status_label=instance.status,
                        details=details,
                        action_path=f"/manager/leave/requests/{instance.id}",
                    )
            elif instance.status == LeaveRequest.RequestStatus.PENDING_HR:
                notify_users_for_pending_status(
                    users=get_hr_approver_users(),
                    request_type="Leave Request",
                    request_id=instance.id,
                    requester_name=requester_name,
                    status_label=instance.status,
                    details=details,
                    action_path=f"/hr/leave/requests/{instance.id}",
                )
            elif instance.status == LeaveRequest.RequestStatus.PENDING_CEO:
                notify_users_for_pending_status(
                    users=get_ceo_approver_users(),
                    request_type="Leave Request",
                    request_id=instance.id,
                    requester_name=requester_name,
                    status_label=instance.status,
                    details=details,
                    action_path=f"/ceo/leave/requests/{instance.id}",
                )
        except Exception:
            pass

    def list(self, request, *args, **kwargs):
        role = get_role(request.user)
        if role not in ["SystemAdmin", "HRManager"]:
            return error("Forbidden", errors=["Forbidden."], status=status.HTTP_403_FORBIDDEN)
        qs = self.get_queryset()
        params = request.query_params
        status_param = params.get("status")
        if status_param:
            # allowed = {
            #     LeaveRequest.RequestStatus.SUBMITTED,
            #     LeaveRequest.RequestStatus.APPROVED,
            #     LeaveRequest.RequestStatus.REJECTED,
            #     LeaveRequest.RequestStatus.CANCELLED,
            # }
            # Relax validation or allow all for list
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
        if _is_hr_manager_origin_request(instance):
            return error(
                "Validation error",
                errors=["HR manager requests must be approved by CEO."],
                status=422,
            )

        allowed_statuses = [LeaveRequest.RequestStatus.SUBMITTED, LeaveRequest.RequestStatus.PENDING_HR]

        if instance.status not in allowed_statuses:
            return error("Validation error", errors=["Request is not in a state to be approved by HR."], status=422)

        s = LeaveRequestActionSerializer(data=request.data)
        if not s.is_valid():
            return error("Validation error", errors=_flatten_errors(s.errors), status=422)

        instance.decided_by = request.user
        instance.decided_at = timezone.now()
        note = s.validated_data.get("comment", "")
        instance.hr_decision_note = note

        # Check if CEO approval is required
        if instance.leave_type.requires_ceo_approval:
            instance.status = LeaveRequest.RequestStatus.PENDING_CEO
        else:
            instance.status = LeaveRequest.RequestStatus.APPROVED

        instance.save()

        requested_days = get_leave_days(instance.start_date, instance.end_date)
        used_before = max(
            0.0,
            get_used_days_for_type(instance.employee, instance.leave_type, instance.start_date.year) - requested_days,
        )
        payment_breakdown = get_payment_breakdown(instance.leave_type, used_before, requested_days)

        audit(
            request,
            "approve",
            entity="LeaveRequest",
            entity_id=instance.id,
            metadata={
                "duration_days": requested_days,
                "payment_breakdown": payment_breakdown,
                "approval_status": instance.status,
            },
        )
        try:
            send_leave_request_approved_whatsapp(instance)
        except Exception:
            pass
        if instance.status == LeaveRequest.RequestStatus.PENDING_CEO:
            try:
                notify_users_for_pending_status(
                    users=get_ceo_approver_users(),
                    request_type="Leave Request",
                    request_id=instance.id,
                    requester_name=instance.employee.full_name or instance.employee.email,
                    status_label=instance.status,
                    details=[f"Leave Type: {instance.leave_type.name}", f"Employee: {instance.employee.email}"],
                    action_path="/ceo/leave/requests",
                )
            except Exception:
                pass
        return success(LeaveRequestSerializer(instance).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsHRManagerOrAdmin])
    def reject(self, request, pk=None):
        try:
            instance = self.get_queryset().get(pk=pk)
        except LeaveRequest.DoesNotExist:
            return error("Not found", errors=["Not found."], status=404)
        if _is_hr_manager_origin_request(instance):
            return error(
                "Validation error",
                errors=["HR manager requests must be approved by CEO."],
                status=422,
            )

        # HR can reject at any pending stage? Or only pending HR?
        # Let's allow rejecting from PENDING_HR or SUBMITTED
        allowed_statuses = [
            LeaveRequest.RequestStatus.SUBMITTED,
            LeaveRequest.RequestStatus.PENDING_HR,
            LeaveRequest.RequestStatus.PENDING_MANAGER,
        ]

        if instance.status not in allowed_statuses:
            return error("Validation error", errors=["Request cannot be rejected."], status=422)

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
        try:
            send_leave_request_rejected_whatsapp(instance, comment)
        except Exception:
            pass
        try:
            send_leave_rejected_email(
                to_email=instance.employee.email,
                employee_name=instance.employee.full_name or instance.employee.email,
                leave_type=instance.leave_type.name,
                start_date=str(instance.start_date),
                end_date=str(instance.end_date),
                rejection_reason=comment,
                action_url=f"{settings.FRONTEND_URL.rstrip('/')}/employee/leave/requests",
            )
        except Exception:
            pass
        return success(LeaveRequestSerializer(instance).data)

    @action(
        detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsHRManagerOrAdmin], url_path="send-to-ceo"
    )
    def send_to_ceo(self, request, pk=None):
        try:
            instance = self.get_queryset().get(pk=pk)
        except LeaveRequest.DoesNotExist:
            return error("Not found", errors=["Not found."], status=404)
        if _is_hr_manager_origin_request(instance):
            return error(
                "Validation error",
                errors=["Request is already under CEO workflow."],
                status=422,
            )

        allowed_statuses = [
            LeaveRequest.RequestStatus.SUBMITTED,
            LeaveRequest.RequestStatus.PENDING_HR,
            LeaveRequest.RequestStatus.PENDING_MANAGER,
            LeaveRequest.RequestStatus.PENDING_CEO,
        ]
        if instance.status not in allowed_statuses:
            return error("Validation error", errors=["Request cannot be sent to CEO in current state."], status=422)

        s = LeaveRequestActionSerializer(data=request.data)
        if not s.is_valid():
            return error("Validation error", errors=_flatten_errors(s.errors), status=422)

        note = (s.validated_data.get("comment") or "").strip()
        if note:
            instance.hr_decision_note = note
        instance.status = LeaveRequest.RequestStatus.PENDING_CEO
        instance.decided_by = request.user
        instance.decided_at = timezone.now()
        instance.save()

        audit(
            request,
            "send_to_ceo",
            entity="LeaveRequest",
            entity_id=instance.id,
            metadata={"status": instance.status, "note": note},
        )
        try:
            notify_users_for_pending_status(
                users=get_ceo_approver_users(),
                request_type="Leave Request",
                request_id=instance.id,
                requester_name=instance.employee.full_name or instance.employee.email,
                status_label=instance.status,
                details=[f"Leave Type: {instance.leave_type.name}", f"Employee: {instance.employee.email}"],
                action_path="/ceo/leave/requests",
            )
        except Exception:
            pass
        return success(LeaveRequestSerializer(instance).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsLeaveRequestOwner])
    def cancel(self, request, pk=None):
        try:
            instance = LeaveRequest.objects.get(pk=pk, employee=request.user, is_active=True)
        except LeaveRequest.DoesNotExist:
            return error("Not found", errors=["Not found."], status=404)

        allowed_statuses = [
            LeaveRequest.RequestStatus.SUBMITTED,
            LeaveRequest.RequestStatus.PENDING_HR,
            LeaveRequest.RequestStatus.PENDING_MANAGER,
        ]

        if instance.status not in allowed_statuses:
            return error("Validation error", errors=["Only pending requests can be cancelled."], status=422)

        instance.status = LeaveRequest.RequestStatus.CANCELLED
        instance.save()

        audit(request, "cancel", entity="LeaveRequest", entity_id=instance.id)
        return success(LeaveRequestSerializer(instance).data)

    @action(detail=True, methods=["get"], permission_classes=[IsAuthenticated, IsOwnerOrHR])
    def document(self, request, pk=None):
        try:
            instance = self.get_object()
        except LeaveRequest.DoesNotExist:
            return error("Not found", errors=["Not found."], status=404)
        return _serve_leave_document(instance, request)


class HRManualLeaveRequestViewSet(viewsets.ModelViewSet):
    """
    HR-only endpoints for creating/updating/deleting manual leave records.
    Manual records are always auto-approved and flagged as HR manual source.
    """

    parser_classes = [MultiPartParser, FormParser, JSONParser]
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]
    queryset = LeaveRequest.objects.filter(
        is_active=True,
        source=LeaveRequest.RequestSource.HR_MANUAL,
    ).select_related("employee", "leave_type", "employee__employee_profile")
    serializer_class = HRManualLeaveRequestSerializer
    http_method_names = ["post", "patch", "delete", "get", "head", "options"]

    def _notify_manager(self, instance: LeaveRequest, action_label: str):
        try:
            manager = get_direct_manager_user(instance.employee)
            if not manager:
                return
            notify_users_for_pending_status(
                users=[manager],
                request_type="Manual Leave Record",
                request_id=instance.id,
                requester_name=instance.employee.full_name or instance.employee.email,
                status_label=action_label,
                details=[
                    f"Leave Type: {instance.leave_type.name}",
                    f"From: {instance.start_date}",
                    f"To: {instance.end_date}",
                ],
                action_path=f"/hr/leave/requests/{instance.id}",
            )
        except Exception:
            pass

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data, context={"request": request})
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)

        instance = serializer.save()
        warnings = serializer.policy_warnings

        audit(
            request,
            "manual_leave_record_created",
            entity="LeaveRequest",
            entity_id=instance.id,
            metadata={
                "employee_id": instance.employee_id,
                "source": instance.source,
                "manual_entry_reason": instance.manual_entry_reason,
                "source_document_ref": instance.source_document_ref,
                "warning_messages": warnings,
            },
        )
        self._notify_manager(instance, "manual_record_created")

        data = LeaveRequestSerializer(instance).data
        data["warning_messages"] = warnings
        return success(data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True, context={"request": request})
        if not serializer.is_valid():
            return error("Validation error", errors=_flatten_errors(serializer.errors), status=422)

        updated = serializer.save()
        warnings = serializer.policy_warnings

        audit(
            request,
            "manual_leave_record_updated",
            entity="LeaveRequest",
            entity_id=updated.id,
            metadata={
                "employee_id": updated.employee_id,
                "source": updated.source,
                "manual_entry_reason": updated.manual_entry_reason,
                "source_document_ref": updated.source_document_ref,
                "warning_messages": warnings,
            },
        )
        self._notify_manager(updated, "manual_record_updated")

        data = LeaveRequestSerializer(updated).data
        data["warning_messages"] = warnings
        return success(data)

    def update(self, request, *args, **kwargs):
        return self.partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        instance.is_active = False
        instance.deleted_by = request.user
        instance.deleted_at = timezone.now()
        instance.save(update_fields=["is_active", "deleted_by", "deleted_at", "updated_at"])

        audit(
            request,
            "manual_leave_record_deleted",
            entity="LeaveRequest",
            entity_id=instance.id,
            metadata={
                "employee_id": instance.employee_id,
                "source": instance.source,
                "manual_entry_reason": instance.manual_entry_reason,
                "source_document_ref": instance.source_document_ref,
            },
        )
        self._notify_manager(instance, "manual_record_deleted")
        return success({})


class ManagerLeaveRequestViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Endpoints for managers to view and act on their direct reports' leave requests.
    """

    serializer_class = LeaveRequestSerializer
    permission_classes = [IsAuthenticated]  # Filtering logic handles scope
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status", "leave_type"]
    ordering_fields = ["created_at", "start_date"]
    ordering = ["-created_at"]

    def get_queryset(self):
        role = get_role(self.request.user)
        if role == "CEO":
            ceo_profile = getattr(self.request.user, "employee_profile", None)
            direct_reports_q = Q(manager=self.request.user)
            if ceo_profile:
                direct_reports_q = direct_reports_q | Q(manager_profile=ceo_profile)

            leadership_user_ids = User.objects.filter(groups__name__in=["Manager", "HRManager"]).values_list(
                "id", flat=True
            )
            direct_report_user_ids = (
                EmployeeProfile.objects.filter(direct_reports_q)
                .exclude(user__isnull=True)
                .values_list("user_id", flat=True)
            )
            scope_user_ids = set(leadership_user_ids).union(set(direct_report_user_ids))

            return LeaveRequest.objects.filter(
                employee_id__in=scope_user_ids,
                is_active=True,
            ).select_related(
                "employee", "leave_type", "employee__employee_profile", "employee__employee_profile__manager_profile"
            )

        # Only requests where the employee's manager maps to the current user.
        manager_profile_match = Q()
        if hasattr(self.request.user, "employee_profile"):
            manager_profile_match = Q(employee__employee_profile__manager_profile=self.request.user.employee_profile)

        return LeaveRequest.objects.filter(
            (
                Q(employee__employee_profile__manager_profile__user=self.request.user)
                | Q(employee__employee_profile__manager=self.request.user)
                | manager_profile_match
            ),
            is_active=True,
        ).select_related(
            "employee", "leave_type", "employee__employee_profile", "employee__employee_profile__manager_profile"
        )

    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        # Implicitly checks queryset filter
        return super().retrieve(request, *args, **kwargs)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsManagerOfEmployee])
    def approve(self, request, pk=None):
        instance = self.get_object()

        allowed_statuses = [LeaveRequest.RequestStatus.SUBMITTED, LeaveRequest.RequestStatus.PENDING_MANAGER]

        if instance.status not in allowed_statuses:
            return error(
                "Validation error", errors=["Request is not in a state to be approved by manager."], status=422
            )

        s = LeaveRequestActionSerializer(data=request.data)
        if not s.is_valid():
            return error("Validation error", errors=_flatten_errors(s.errors), status=422)

        instance.status = LeaveRequest.RequestStatus.PENDING_HR
        instance.manager_decision_by = request.user
        instance.manager_decision_at = timezone.now()
        instance.manager_decision_note = s.validated_data.get("comment", "")
        instance.save()

        audit(request, "approve", entity="LeaveRequest", entity_id=instance.id)
        try:
            notify_users_for_pending_status(
                users=get_hr_approver_users(),
                request_type="Leave Request",
                request_id=instance.id,
                requester_name=instance.employee.full_name or instance.employee.email,
                status_label=instance.status,
                details=[f"Leave Type: {instance.leave_type.name}", f"Employee: {instance.employee.email}"],
                action_path=f"/hr/leave/requests/{instance.id}",
            )
        except Exception:
            pass
        return success(LeaveRequestSerializer(instance).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsManagerOfEmployee])
    def reject(self, request, pk=None):
        instance = self.get_object()

        allowed_statuses = [LeaveRequest.RequestStatus.SUBMITTED, LeaveRequest.RequestStatus.PENDING_MANAGER]

        if instance.status not in allowed_statuses:
            return error(
                "Validation error", errors=["Request is not in a state to be rejected by manager."], status=422
            )

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
        try:
            send_leave_request_rejected_whatsapp(instance, comment)
        except Exception:
            pass
        try:
            send_leave_rejected_email(
                to_email=instance.employee.email,
                employee_name=instance.employee.full_name or instance.employee.email,
                leave_type=instance.leave_type.name,
                start_date=str(instance.start_date),
                end_date=str(instance.end_date),
                rejection_reason=comment,
                action_url=f"{settings.FRONTEND_URL.rstrip('/')}/employee/leave/requests",
            )
        except Exception:
            pass
        return success(LeaveRequestSerializer(instance).data)

    @action(detail=True, methods=["get"], permission_classes=[IsAuthenticated, IsManagerOfEmployee])
    def document(self, request, pk=None):
        instance = self.get_object()
        return _serve_leave_document(instance, request)


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

        balances = calculate_leave_balance(user, year, profile=profile)

        # Audit
        audit(
            request, "leave_balance.viewed_hr", entity="employee_profile", entity_id=profile.id, metadata={"year": year}
        )

        serializer = LeaveBalanceSerializer(balances, many=True)
        return success(serializer.data)


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


class LeaveBalanceAdjustmentViewSet(viewsets.ModelViewSet):
    """
    CRUD for manual leave balance adjustments.
    """

    queryset = LeaveBalanceAdjustment.objects.all().order_by("-created_at")
    serializer_class = LeaveBalanceAdjustmentSerializer
    permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["employee", "leave_type"]

    def perform_create(self, serializer):
        instance = serializer.save(created_by=self.request.user)
        audit(
            self.request,
            "create_adjustment",
            entity="leave_balance_adjustment",
            entity_id=instance.id,
            metadata={"employee_id": instance.employee.id, "days": float(instance.adjustment_days)},
        )


class CEOLeaveRequestViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Endpoints for CEO to view and act on pending leave requests.
    """

    serializer_class = LeaveRequestSerializer
    permission_classes = [IsAuthenticated, IsDepartmentCEOApprover]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status", "leave_type"]
    ordering_fields = ["created_at", "start_date"]
    ordering = ["-created_at"]

    def get_queryset(self):
        # CEO sees all requests pending CEO approval
        return LeaveRequest.objects.filter(
            status=LeaveRequest.RequestStatus.PENDING_CEO,
            is_active=True,
        ).select_related("employee", "leave_type", "employee__employee_profile")

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        instance = self.get_object()

        if instance.status != LeaveRequest.RequestStatus.PENDING_CEO:
            return error("Validation error", errors=["Request is not in a state to be approved by CEO."], status=422)
        if _is_hr_manager_origin_request(instance) and instance.employee_id == request.user.id:
            return error("Validation error", errors=["Self approval is not allowed."], status=422)

        s = LeaveRequestActionSerializer(data=request.data)
        if not s.is_valid():
            return error("Validation error", errors=_flatten_errors(s.errors), status=422)

        instance.status = LeaveRequest.RequestStatus.APPROVED
        instance.ceo_decision_by = request.user
        instance.ceo_decision_at = timezone.now()
        instance.ceo_decision_note = s.validated_data.get("comment", "")
        instance.save()

        audit(request, "approve_ceo", entity="LeaveRequest", entity_id=instance.id)
        try:
            send_leave_request_approved_whatsapp(instance)
        except Exception:
            pass
        return success(LeaveRequestSerializer(instance).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        instance = self.get_object()

        if instance.status != LeaveRequest.RequestStatus.PENDING_CEO:
            return error("Validation error", errors=["Request is not in a state to be rejected by CEO."], status=422)
        if _is_hr_manager_origin_request(instance) and instance.employee_id == request.user.id:
            return error("Validation error", errors=["Self approval is not allowed."], status=422)

        s = LeaveRequestActionSerializer(data=request.data)
        if not s.is_valid():
            return error("Validation error", errors=_flatten_errors(s.errors), status=422)
        comment = (s.validated_data.get("comment") or "").strip()
        if not comment:
            return error("Validation error", errors=["comment is required."], status=422)

        instance.status = LeaveRequest.RequestStatus.REJECTED
        instance.ceo_decision_by = request.user
        instance.ceo_decision_at = timezone.now()
        instance.ceo_decision_note = comment
        instance.save()

        audit(request, "reject_ceo", entity="LeaveRequest", entity_id=instance.id)
        try:
            send_leave_request_rejected_whatsapp(instance, comment)
        except Exception:
            pass
        try:
            send_leave_rejected_email(
                to_email=instance.employee.email,
                employee_name=instance.employee.full_name or instance.employee.email,
                leave_type=instance.leave_type.name,
                start_date=str(instance.start_date),
                end_date=str(instance.end_date),
                rejection_reason=comment,
                action_url=f"{settings.FRONTEND_URL.rstrip('/')}/employee/leave/requests",
            )
        except Exception:
            pass
        return success(LeaveRequestSerializer(instance).data)

    @action(detail=True, methods=["get"])
    def document(self, request, pk=None):
        instance = self.get_object()
        return _serve_leave_document(instance, request)
