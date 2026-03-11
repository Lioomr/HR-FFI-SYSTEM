from datetime import date as date_type
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db.models import Q
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.throttling import UserRateThrottle

from audit.utils import audit
from core.permissions import IsManager, get_role
from core.responses import error, success
from core.services import (
    get_ceo_approver_users,
    get_direct_manager_user,
    get_hr_approver_users,
    notify_users_for_pending_status,
)
from employees.models import EmployeeProfile

from .models import AttendanceRecord
from .permissions import IsAttendanceSelfServiceRole, IsDepartmentCEOApprover, IsHRManagerOrAdmin
from .serializers import (
    AttendanceOverrideSerializer,
    AttendanceRecordSerializer,
    CheckInResponseSerializer,
    CheckOutResponseSerializer,
)

User = get_user_model()


def _is_hr_manager_user(user):
    return bool(user and user.is_authenticated and user.groups.filter(name="HRManager").exists())


def _is_hr_manager_origin_record(instance: AttendanceRecord):
    employee_user = getattr(getattr(instance, "employee_profile", None), "user", None)
    return bool(employee_user and employee_user.groups.filter(name="HRManager").exists())


class AttendanceThrottle(UserRateThrottle):
    rate = "10/min"


class AttendanceRecordViewSet(viewsets.ModelViewSet):
    serializer_class = AttendanceRecordSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status"]
    ordering_fields = ["date", "created_at"]
    ordering = ["-date"]

    def _apply_status_filter(self, queryset):
        """
        Support legacy UI filter `status=PENDING` by mapping to current workflow states.
        """
        status_param = self.request.query_params.get("status")
        if not status_param:
            return queryset

        if status_param == AttendanceRecord.Status.PENDING:
            return queryset.filter(
                status__in=[
                    AttendanceRecord.Status.PENDING,
                    AttendanceRecord.Status.PENDING_HR,
                    AttendanceRecord.Status.PENDING_MANAGER,
                ]
            )

        return queryset.filter(status=status_param)

    def get_queryset(self):
        user = self.request.user
        role = get_role(user)

        # Date Filter Logic (Default: Last 30 days)
        queryset = AttendanceRecord.objects.all().select_related("employee_profile__user")
        date_from_str = self.request.query_params.get("date_from")
        date_to_str = self.request.query_params.get("date_to")

        # Validate and parse dates
        if date_from_str and date_to_str:
            try:
                date_from = date_type.fromisoformat(date_from_str)
                date_to = date_type.fromisoformat(date_to_str)
                if date_from > date_to:
                    # This will be caught in list() to return proper error envelope
                    raise ValueError("date_from must not be after date_to")
                queryset = queryset.filter(date__range=[date_from, date_to])
            except (ValueError, TypeError) as e:
                # Store error for list() to handle
                self._date_filter_error = str(e)
                return queryset.none()
        elif not date_from_str and not date_to_str:
            # Default to last 30 days if no explicit filter
            today = timezone.localdate()
            thirty_days_ago = today - timedelta(days=30)
            queryset = queryset.filter(date__range=[thirty_days_ago, today])

        if role in ["SystemAdmin", "HRManager"]:
            employee_id = self.request.query_params.get("employee_id")
            if employee_id:
                queryset = queryset.filter(employee_profile_id=employee_id)
            return queryset

        # Employee Scope (for me_list action)
        return queryset.filter(employee_profile__user=user)

    def get_permissions(self):
        # Strict separation: global list/retrieve ONLY for HR/Admin
        if self.action in ["list", "retrieve"]:
            return [IsAuthenticated(), IsHRManagerOrAdmin()]

        # Employee-only actions
        if self.action in ["me_list", "me_check_in", "me_check_out"]:
            return [IsAuthenticated(), IsAttendanceSelfServiceRole()]

        # HR/Admin write actions
        if self.action in ["create", "update", "partial_update", "destroy"]:
            return [IsAuthenticated(), IsHRManagerOrAdmin()]

        return [IsAuthenticated()]

    def filter_queryset(self, queryset):
        # Apply custom status mapping first.
        queryset = self._apply_status_filter(queryset)

        # Skip DjangoFilterBackend because we've already handled status.
        # Keep ordering behavior from OrderingFilter.
        for backend in list(self.filter_backends):
            if backend is DjangoFilterBackend:
                continue
            queryset = backend().filter_queryset(self.request, queryset, self)
        return queryset

    def list(self, request, *args, **kwargs):
        # Check for date filter error
        if hasattr(self, "_date_filter_error"):
            return error(f"Invalid date filter: {self._date_filter_error}", status=status.HTTP_400_BAD_REQUEST)

        response = super().list(request, *args, **kwargs)

        # Avoid double wrapping if pagination already added the envelope
        if isinstance(response.data, dict) and response.data.get("status") == "success":
            return response

        return success(response.data)

    def retrieve(self, request, *args, **kwargs):
        response = super().retrieve(request, *args, **kwargs)
        return success(response.data)

    def destroy(self, request, *args, **kwargs):
        return error("Attendance records cannot be deleted.", status=status.HTTP_405_METHOD_NOT_ALLOWED)

    def partial_update(self, request, *args, **kwargs):
        # HR Override logic (PATCH routes here)
        instance = self.get_object()
        if _is_hr_manager_origin_record(instance) and instance.status == AttendanceRecord.Status.PENDING_CEO:
            return error(
                "Validation error",
                errors=["HR manager attendance requests must be approved by CEO."],
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        s = AttendanceOverrideSerializer(instance, data=request.data, partial=True)
        s.is_valid(raise_exception=True)

        # Set override metadata
        instance.is_overridden = True
        instance.source = AttendanceRecord.Source.HR
        instance.updated_by = request.user

        # Apply validated changes
        for attr, value in s.validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        # Serialize metadata to ensure datetimes are strings
        import json

        from django.core.serializers.json import DjangoJSONEncoder

        serialized_metadata = json.loads(json.dumps(s.validated_data, cls=DjangoJSONEncoder))

        audit(
            request,
            "attendance.override",
            entity="attendance_record",
            entity_id=instance.id,
            metadata=serialized_metadata,
        )

        return success(AttendanceRecordSerializer(instance).data)

    def update(self, request, *args, **kwargs):
        # Route PUT to same override logic as PATCH
        return self.partial_update(request, *args, **kwargs)

    @action(detail=False, methods=["post"], url_path="me/check-in", throttle_classes=[AttendanceThrottle])
    def me_check_in(self, request):
        user = request.user
        today = timezone.localdate()

        try:
            profile = EmployeeProfile.objects.get(user=user)
        except EmployeeProfile.DoesNotExist:
            return error("Employee profile not found.", status=status.HTTP_404_NOT_FOUND)

        if AttendanceRecord.objects.filter(employee_profile=profile, date=today).exists():
            return error("Check-in already exists for today.", status=status.HTTP_400_BAD_REQUEST)

        # Check if user has a manager
        has_manager = False
        if profile.manager or profile.manager_profile:
            has_manager = True

        if _is_hr_manager_user(user):
            status_value = AttendanceRecord.Status.PENDING_CEO
        else:
            status_value = AttendanceRecord.Status.PENDING_MANAGER if has_manager else AttendanceRecord.Status.PENDING_HR
        # Fallback/Legacy note: PENDING_HR maps to old 'PENDING' concept effectively

        record = AttendanceRecord.objects.create(
            employee_profile=profile,
            date=today,
            check_in_at=timezone.now(),
            status=status_value,
            source=AttendanceRecord.Source.EMPLOYEE,
            created_by=user,
            updated_by=user,
        )

        audit(request, "attendance.check_in", entity="attendance_record", entity_id=record.id)
        try:
            requester_name = profile.full_name or user.email
            if record.status == AttendanceRecord.Status.PENDING_MANAGER:
                manager = get_direct_manager_user(user)
                if manager:
                    notify_users_for_pending_status(
                        users=[manager],
                        request_type="Attendance Request",
                        request_id=record.id,
                        requester_name=requester_name,
                        status_label=record.status,
                        details=[f"Date: {record.date}", "Action: Check-in"],
                        action_path="/manager/attendance",
                    )
            elif record.status == AttendanceRecord.Status.PENDING_HR:
                notify_users_for_pending_status(
                    users=get_hr_approver_users(),
                    request_type="Attendance Request",
                    request_id=record.id,
                    requester_name=requester_name,
                    status_label=record.status,
                    details=[f"Date: {record.date}", "Action: Check-in"],
                    action_path="/hr/attendance",
                )
            elif record.status == AttendanceRecord.Status.PENDING_CEO:
                notify_users_for_pending_status(
                    users=get_ceo_approver_users(),
                    request_type="Attendance Request",
                    request_id=record.id,
                    requester_name=requester_name,
                    status_label=record.status,
                    details=[f"Date: {record.date}", "Action: Check-in"],
                    action_path="/ceo/attendance",
                )
        except Exception:
            pass
        return success(CheckInResponseSerializer(record).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"], url_path="me/check-out", throttle_classes=[AttendanceThrottle])
    def me_check_out(self, request):
        user = request.user
        today = timezone.localdate()

        try:
            profile = EmployeeProfile.objects.get(user=user)
        except EmployeeProfile.DoesNotExist:
            return error("Employee profile not found.", status=status.HTTP_404_NOT_FOUND)

        try:
            record = AttendanceRecord.objects.get(employee_profile=profile, date=today)
        except AttendanceRecord.DoesNotExist:
            return error("No check-in record found for today.", status=status.HTTP_400_BAD_REQUEST)

        if record.check_out_at:
            return error("Check-out already exists for today.", status=status.HTTP_400_BAD_REQUEST)

        record.check_out_at = timezone.now()
        record.updated_by = user
        record.save()

        audit(request, "attendance.check_out", entity="attendance_record", entity_id=record.id)
        return success(CheckOutResponseSerializer(record).data)

    @action(detail=False, methods=["get"], url_path="me")
    def me_list(self, request):
        # Employee-scoped list (get_queryset already filters to own records)
        queryset = self.filter_queryset(self.get_queryset())

        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            # Return proper paginated response directly (already enveloped)
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(queryset, many=True)
        return success(serializer.data)


class ManagerAttendanceViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Endpoints for managers to view and act on their direct reports' attendance.
    """

    serializer_class = AttendanceRecordSerializer
    permission_classes = [IsAuthenticated, IsManager]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status"]
    ordering_fields = ["date", "created_at"]
    ordering = ["-date"]

    def filter_queryset(self, queryset):
        status_param = self.request.query_params.get("status")
        if status_param == AttendanceRecord.Status.PENDING:
            queryset = queryset.filter(
                status__in=[
                    AttendanceRecord.Status.PENDING,
                    AttendanceRecord.Status.PENDING_MANAGER,
                ]
            )
        elif status_param:
            queryset = queryset.filter(status=status_param)

        # Keep ordering behavior from OrderingFilter.
        for backend in list(self.filter_backends):
            if backend is DjangoFilterBackend:
                continue
            queryset = backend().filter_queryset(self.request, queryset, self)
        return queryset

    def get_queryset(self):
        role = get_role(self.request.user)
        base_qs = AttendanceRecord.objects.select_related("employee_profile__user", "employee_profile__manager_profile")
        if role == "SystemAdmin":
            return base_qs

        # Only records where the employee's manager maps to current user
        manager_profile = getattr(self.request.user, "employee_profile", None)
        profile_match = Q()
        if manager_profile:
            profile_match = Q(employee_profile__manager_profile=manager_profile)

        return base_qs.filter(
            Q(employee_profile__manager_profile__user=self.request.user)
            | Q(employee_profile__manager=self.request.user)
            | profile_match
        )

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        try:
            instance = self.get_queryset().get(pk=pk)
        except AttendanceRecord.DoesNotExist:
            return error("Not found", errors=["Not found."], status=404)

        if instance.status != AttendanceRecord.Status.PENDING_MANAGER:
            return error(
                "Validation error", errors=["Request is not in a state to be approved by manager."], status=422
            )

        instance.status = AttendanceRecord.Status.PENDING_HR
        instance.manager_decision_by = request.user
        instance.manager_decision_at = timezone.now()
        instance.manager_decision_note = request.data.get("notes", "")  # Simple note
        instance.save()

        audit(request, "approve", entity="AttendanceRecord", entity_id=instance.id)
        try:
            notify_users_for_pending_status(
                users=get_hr_approver_users(),
                request_type="Attendance Request",
                request_id=instance.id,
                requester_name=instance.employee_profile.full_name or instance.employee_profile.user.email,
                status_label=instance.status,
                details=[f"Date: {instance.date}", "Manager forwarded for HR approval"],
                action_path="/hr/attendance",
            )
        except Exception:
            pass
        return success(AttendanceRecordSerializer(instance).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        try:
            instance = self.get_queryset().get(pk=pk)
        except AttendanceRecord.DoesNotExist:
            return error("Not found", errors=["Not found."], status=404)

        if instance.status != AttendanceRecord.Status.PENDING_MANAGER:
            return error(
                "Validation error", errors=["Request is not in a state to be rejected by manager."], status=422
            )

        note = request.data.get("notes", "")
        if not note:
            return error("Validation error", errors=["notes/comment is required for rejection."], status=422)

        instance.status = AttendanceRecord.Status.REJECTED
        instance.manager_decision_by = request.user
        instance.manager_decision_at = timezone.now()
        instance.manager_decision_note = note
        instance.save()

        audit(request, "reject", entity="AttendanceRecord", entity_id=instance.id)
        return success(AttendanceRecordSerializer(instance).data)


class CEOAttendanceViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = AttendanceRecordSerializer
    permission_classes = [IsAuthenticated, IsDepartmentCEOApprover]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status"]
    ordering_fields = ["date", "created_at"]
    ordering = ["-date"]

    def get_queryset(self):
        qs = AttendanceRecord.objects.select_related("employee_profile__user")
        status_param = self.request.query_params.get("status")
        if status_param:
            return qs.filter(status=status_param)
        return qs.filter(status=AttendanceRecord.Status.PENDING_CEO)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        instance = self.get_object()
        if instance.status != AttendanceRecord.Status.PENDING_CEO:
            return error("Validation error", errors=["Request is not pending CEO approval."], status=422)
        if _is_hr_manager_origin_record(instance) and instance.employee_profile.user_id == request.user.id:
            return error("Validation error", errors=["Self approval is not allowed."], status=422)

        instance.status = AttendanceRecord.Status.PRESENT
        instance.ceo_decision_by = request.user
        instance.ceo_decision_at = timezone.now()
        instance.ceo_decision_note = request.data.get("notes", "")
        instance.save(
            update_fields=[
                "status",
                "ceo_decision_by",
                "ceo_decision_at",
                "ceo_decision_note",
                "updated_at",
            ]
        )
        audit(request, "approve_ceo", entity="AttendanceRecord", entity_id=instance.id)
        return success(AttendanceRecordSerializer(instance).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        instance = self.get_object()
        if instance.status != AttendanceRecord.Status.PENDING_CEO:
            return error("Validation error", errors=["Request is not pending CEO approval."], status=422)
        if _is_hr_manager_origin_record(instance) and instance.employee_profile.user_id == request.user.id:
            return error("Validation error", errors=["Self approval is not allowed."], status=422)

        note = (request.data.get("notes") or "").strip()
        if not note:
            return error("Validation error", errors=["notes/comment is required for rejection."], status=422)

        instance.status = AttendanceRecord.Status.REJECTED
        instance.ceo_decision_by = request.user
        instance.ceo_decision_at = timezone.now()
        instance.ceo_decision_note = note
        instance.save(
            update_fields=[
                "status",
                "ceo_decision_by",
                "ceo_decision_at",
                "ceo_decision_note",
                "updated_at",
            ]
        )
        audit(request, "reject_ceo", entity="AttendanceRecord", entity_id=instance.id)
        return success(AttendanceRecordSerializer(instance).data)
