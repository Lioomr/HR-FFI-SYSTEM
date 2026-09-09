import logging
from datetime import date as date_type
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db.models import Count, Q
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated

from audit.utils import audit
from core.pagination import StandardPagination
from core.permissions import (
    IsDepartmentCEOApprover,
    IsHRManagerOrAdmin,
    IsManager,
    IsSystemAdmin,
    get_role,
    is_hr_workflow_approver_user,
)
from core.responses import error, success
from employees.models import EmployeeProfile
from employees.services.manager_relationships import manager_scope_q
from organization.services import (
    ensure_company_write_allowed,
    filter_queryset_by_company_scope,
    get_active_company_for_request,
)

from .biotime_policy import (
    attendance_unavailable_unmapped,
    has_active_biotime_mapping,
    limit_to_mapped_employees,
    manual_attendance_gone,
)
from .models import AttendanceCorrectionRequest, AttendanceRecord, WorkLocation
from .permissions import IsAttendanceSelfServiceRole
from .serializers import (
    AttendanceCorrectionRequestSerializer,
    AttendanceRecordSerializer,
    WorkLocationSerializer,
)

logger = logging.getLogger(__name__)


def _log_notification_failure(event_name, *, entity_id, notification_type, actor_id=None, channel=None):
    extra = {"entity_id": entity_id, "notification_type": notification_type}
    if actor_id is not None:
        extra["actor_id"] = actor_id
    if channel is not None:
        extra["channel"] = channel
    logger.exception(event_name, extra=extra)

User = get_user_model()


def _apply_employee_search(queryset, search_param):
    if not search_param:
        return queryset
    return queryset.filter(
        Q(employee_profile__full_name_en__icontains=search_param)
        | Q(employee_profile__full_name_ar__icontains=search_param)
        | Q(employee_profile__full_name__icontains=search_param)
        | Q(employee_profile__user__email__icontains=search_param)
    )


def _manager_scope_filter(user):
    return manager_scope_q(
        user, employee_prefix="employee_profile__", cross_company_capability="attendance.approve"
    )


def _scope_attendance_queryset(queryset, request):
    """Company-scope an attendance queryset and drop BioTime-ineligible employees.

    Attendance eligibility is the active BioTime mapping, so every attendance
    read path (employee, HR, manager, CEO) funnels through this helper.
    """
    queryset = filter_queryset_by_company_scope(queryset, request, field_name="employee_profile__company_id")
    queryset = queryset.filter(employee_profile__company_id__isnull=False)
    return limit_to_mapped_employees(queryset)


class WorkLocationViewSet(viewsets.ModelViewSet):
    """SystemAdmin-managed, active-company-scoped attendance sites."""

    permission_classes = [IsAuthenticated, IsSystemAdmin]
    serializer_class = WorkLocationSerializer
    pagination_class = StandardPagination

    def get_queryset(self):
        return filter_queryset_by_company_scope(
            WorkLocation.objects.select_related("company").filter(is_active=True), self.request
        )

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        if isinstance(response.data, dict) and response.data.get("status") == "success":
            return response
        return success(response.data)

    def retrieve(self, request, *args, **kwargs):
        return success(self.get_serializer(self.get_object()).data)

    def create(self, request, *args, **kwargs):
        ensure_company_write_allowed(request)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        location = serializer.save(company=get_active_company_for_request(request))
        audit(
            request,
            "attendance.work_location_created",
            entity="work_location",
            entity_id=location.id,
            metadata={"company_id": location.company_id, "name": location.name},
        )
        return success(self.get_serializer(location).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        ensure_company_write_allowed(request)
        location = self.get_object()
        serializer = self.get_serializer(location, data=request.data, partial=kwargs.pop("partial", False))
        serializer.is_valid(raise_exception=True)
        updated = serializer.save()
        audit(
            request,
            "attendance.work_location_updated",
            entity="work_location",
            entity_id=updated.id,
            metadata={"company_id": updated.company_id, "name": updated.name},
        )
        return success(self.get_serializer(updated).data)

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        location = self.get_object()
        location.is_active = False
        location.save(update_fields=["is_active", "updated_at"])
        audit(
            request,
            "attendance.work_location_deleted",
            entity="work_location",
            entity_id=location.id,
            metadata={"company_id": location.company_id, "name": location.name, "soft_deleted": True},
        )
        return success({})


class AttendanceRecordViewSet(viewsets.ModelViewSet):
    serializer_class = AttendanceRecordSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status"]
    ordering_fields = ["date", "check_in_at", "check_out_at", "created_at"]
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

    def _apply_source_filter(self, queryset):
        source_param = self.request.query_params.get("source")
        if not source_param:
            return queryset
        if source_param not in AttendanceRecord.Source.values:
            self._source_filter_error = "source must be SYSTEM, EMPLOYEE, or HR"
            return queryset.none()
        return queryset.filter(source=source_param)

    def get_queryset(self):
        user = self.request.user
        role = get_role(user)

        # Date Filter Logic (Default: Last 30 days)
        queryset = AttendanceRecord.objects.all().select_related("employee_profile__user")
        queryset = _scope_attendance_queryset(queryset, self.request)
        date_str = self.request.query_params.get("date")
        date_from_str = self.request.query_params.get("date_from")
        date_to_str = self.request.query_params.get("date_to")

        if date_str:
            try:
                queryset = queryset.filter(date=date_type.fromisoformat(date_str))
            except (ValueError, TypeError) as exc:
                self._date_filter_error = str(exc)
                return queryset.none()
        elif date_from_str or date_to_str:
            try:
                date_from = date_type.fromisoformat(date_from_str) if date_from_str else None
                date_to = date_type.fromisoformat(date_to_str) if date_to_str else None
                if date_from:
                    queryset = queryset.filter(date__gte=date_from)
                if date_to:
                    queryset = queryset.filter(date__lte=date_to)
                if date_from and date_to and date_from > date_to:
                    raise ValueError("date_from must not be after date_to")
            except (ValueError, TypeError) as e:
                self._date_filter_error = str(e)
                return queryset.none()
        else:
            today = timezone.localdate()
            thirty_days_ago = today - timedelta(days=30)
            queryset = queryset.filter(date__range=[thirty_days_ago, today])

        queryset = _apply_employee_search(queryset, self.request.query_params.get("search"))

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

        # Read-only employee self-service.
        if self.action == "me_list":
            return [IsAuthenticated(), IsAttendanceSelfServiceRole()]

        # Retired manual-attendance mutations answer 410 for any authenticated
        # caller; gating them by role would mask the retirement behind a 403.
        return [IsAuthenticated()]

    def filter_queryset(self, queryset):
        # Apply custom status mapping first.
        queryset = self._apply_status_filter(queryset)
        queryset = self._apply_source_filter(queryset)

        # Skip DjangoFilterBackend because we've already handled status.
        # Keep ordering behavior from OrderingFilter.
        for backend in list(self.filter_backends):
            if backend is DjangoFilterBackend:
                continue
            queryset = backend().filter_queryset(self.request, queryset, self)
        return queryset

    def list(self, request, *args, **kwargs):
        queryset = self.get_queryset()
        filtered_queryset = self.filter_queryset(queryset)
        filter_error = getattr(self, "_date_filter_error", None) or getattr(self, "_source_filter_error", None)
        if filter_error:
            return error(f"Invalid attendance filter: {filter_error}", status=status.HTTP_400_BAD_REQUEST)

        summary = {row["status"]: row["n"] for row in filtered_queryset.values("status").annotate(n=Count("id"))}

        response = super().list(request, *args, **kwargs)

        # Avoid double wrapping if pagination already added the envelope
        if isinstance(response.data, dict) and response.data.get("status") == "success":
            if isinstance(response.data.get("data"), dict):
                response.data["data"]["summary"] = summary
            return response

        return success(response.data)

    def retrieve(self, request, *args, **kwargs):
        response = super().retrieve(request, *args, **kwargs)
        return success(response.data)

    def destroy(self, request, *args, **kwargs):
        return manual_attendance_gone()

    def create(self, request, *args, **kwargs):
        return manual_attendance_gone()

    def partial_update(self, request, *args, **kwargs):
        # Retired HR override (PATCH routes here).
        return manual_attendance_gone()

    def update(self, request, *args, **kwargs):
        # Retired HR override (PUT routes here).
        return manual_attendance_gone()

    @action(detail=False, methods=["post"], url_path="me/check-in")
    def me_check_in(self, request):
        """Retired: BioTime agent ingestion is the only writer of punch records."""
        return manual_attendance_gone()

    @action(detail=False, methods=["post"], url_path="me/check-out")
    def me_check_out(self, request):
        """Retired: BioTime agent ingestion is the only writer of punch records."""
        return manual_attendance_gone()

    @action(detail=False, methods=["get"], url_path="me")
    def me_list(self, request):
        """Read-only own attendance history, for BioTime-mapped employees only."""
        profile = getattr(request.user, "employee_profile", None)
        if profile is None:
            profile = EmployeeProfile.objects.filter(user=request.user).first()
        if profile is None:
            return error("Employee profile not found.", status=status.HTTP_404_NOT_FOUND)
        if not has_active_biotime_mapping(profile):
            return attendance_unavailable_unmapped()

        queryset = self.filter_queryset(self.get_queryset())

        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            # Return proper paginated response directly (already enveloped)
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(queryset, many=True)
        return success(serializer.data)


class AttendanceCorrectionRequestViewSet(viewsets.ModelViewSet):
    serializer_class = AttendanceCorrectionRequestSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status", "date", "employee_profile"]
    ordering_fields = ["date", "created_at", "updated_at"]
    ordering = ["-created_at", "-id"]

    def get_queryset(self):
        user = self.request.user
        role = get_role(user)
        qs = AttendanceCorrectionRequest.objects.select_related(
            "employee_profile__user",
            "employee_profile__manager",
            "employee_profile__manager_profile__user",
            "attendance_record",
        )
        qs = _scope_attendance_queryset(qs, self.request)

        if role in ["SystemAdmin", "HRManager"] or is_hr_workflow_approver_user(user):
            return qs

        employee_profile = getattr(user, "employee_profile", None)
        owner_match = Q(employee_profile__user=user)
        manager_match = _manager_scope_filter(user)
        if employee_profile:
            owner_match |= Q(employee_profile=employee_profile)
        return qs.filter(owner_match | manager_match)

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        if isinstance(response.data, dict) and response.data.get("status") == "success":
            return response
        return success(response.data)

    def retrieve(self, request, *args, **kwargs):
        response = super().retrieve(request, *args, **kwargs)
        return success(response.data)

    def create(self, request, *args, **kwargs):
        return manual_attendance_gone()

    def update(self, request, *args, **kwargs):
        return manual_attendance_gone()

    def partial_update(self, request, *args, **kwargs):
        return manual_attendance_gone()

    def destroy(self, request, *args, **kwargs):
        return manual_attendance_gone()

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        return manual_attendance_gone()

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return manual_attendance_gone()

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return manual_attendance_gone()

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        return manual_attendance_gone()


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
        qs = AttendanceRecord.objects.select_related("employee_profile__user", "employee_profile__manager_profile")
        base_qs = qs
        base_qs = _scope_attendance_queryset(base_qs, self.request)
        if role == "SystemAdmin":
            return base_qs
        return limit_to_mapped_employees(qs.filter(_manager_scope_filter(self.request.user))).distinct()

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return manual_attendance_gone()

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return manual_attendance_gone()


class CEOAttendanceViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = AttendanceRecordSerializer
    permission_classes = [IsAuthenticated, IsDepartmentCEOApprover]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status"]
    ordering_fields = ["date", "created_at"]
    ordering = ["-date"]

    def get_queryset(self):
        qs = AttendanceRecord.objects.select_related("employee_profile__user")
        qs = _scope_attendance_queryset(qs, self.request)
        date_from_str = self.request.query_params.get("date_from")
        date_to_str = self.request.query_params.get("date_to")
        if date_from_str and date_to_str:
            try:
                date_from = date_type.fromisoformat(date_from_str)
                date_to = date_type.fromisoformat(date_to_str)
                qs = qs.filter(date__range=[date_from, date_to])
            except (ValueError, TypeError):
                return qs.none()

        status_param = self.request.query_params.get("status")
        if status_param:
            qs = qs.filter(status=status_param)

        qs = _apply_employee_search(qs, self.request.query_params.get("search"))

        return qs

    def list(self, request, *args, **kwargs):
        summary = {
            row["status"]: row["n"]
            for row in self.filter_queryset(self.get_queryset()).values("status").annotate(n=Count("id"))
        }

        response = super().list(request, *args, **kwargs)

        if isinstance(response.data, dict) and response.data.get("status") == "success":
            if isinstance(response.data.get("data"), dict):
                response.data["data"]["summary"] = summary

        return response

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        return manual_attendance_gone()

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return manual_attendance_gone()
