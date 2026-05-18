from datetime import date as date_type
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.throttling import UserRateThrottle

from audit.utils import audit
from core.delegation import get_delegated_manager_user_ids
from core.permissions import IsManager, get_role, is_hr_workflow_approver_user
from core.responses import error, success
from core.services import (
    get_ceo_approver_users,
    get_direct_manager_user,
    get_hr_approver_users,
    notify_users_for_pending_status,
    sync_workflow,
)
from employees.models import EmployeeProfile

from .models import AttendanceCorrectionRequest, AttendanceRecord
from .permissions import IsAttendanceSelfServiceRole, IsDepartmentCEOApprover, IsHRManagerOrAdmin
from .serializers import (
    AttendanceCorrectionRequestSerializer,
    AttendanceOverrideSerializer,
    AttendanceRecordSerializer,
    CheckInResponseSerializer,
    CheckOutResponseSerializer,
)

User = get_user_model()

ATTENDANCE_MAINTENANCE_MESSAGE = "Attendance is temporarily unavailable while we fix this part."


def _is_hr_manager_user(user):
    return bool(user and user.is_authenticated and user.groups.filter(name="HRManager").exists())


def _is_hr_manager_origin_record(instance: AttendanceRecord):
    employee_user = getattr(getattr(instance, "employee_profile", None), "user", None)
    return bool(employee_user and employee_user.groups.filter(name="HRManager").exists())


def _manager_scope_filter(user):
    manager_profile = getattr(user, "employee_profile", None)
    manager_match = Q(employee_profile__manager=user)
    if manager_profile:
        manager_match |= Q(employee_profile__manager_profile=manager_profile)

    delegated_manager_ids = get_delegated_manager_user_ids(user)
    if delegated_manager_ids:
        manager_match |= Q(employee_profile__manager_id__in=delegated_manager_ids) | Q(
            employee_profile__manager_profile__user_id__in=delegated_manager_ids
        )
    return manager_match


def _can_manager_act_on_correction(user, correction: AttendanceCorrectionRequest):
    return AttendanceCorrectionRequest.objects.filter(pk=correction.pk).filter(_manager_scope_filter(user)).exists()


class AttendanceThrottle(UserRateThrottle):
    rate = "10/min"


class AttendanceMaintenanceMixin:
    def dispatch(self, request, *args, **kwargs):
        request = self.initialize_request(request, *args, **kwargs)
        self.request = request
        self.args = args
        self.kwargs = kwargs
        self.headers = self.default_response_headers
        response = error(ATTENDANCE_MAINTENANCE_MESSAGE, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return self.finalize_response(request, response, *args, **kwargs)


class AttendanceRecordViewSet(AttendanceMaintenanceMixin, viewsets.ModelViewSet):
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
        sync_workflow(instance, actor=request.user)

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
        sync_workflow(record, actor=user)

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
        sync_workflow(record, actor=user)

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

        if role in ["SystemAdmin", "HRManager"] or is_hr_workflow_approver_user(user):
            return qs

        employee_profile = getattr(user, "employee_profile", None)
        owner_match = Q(employee_profile__user=user)
        manager_match = _manager_scope_filter(user)
        if employee_profile:
            owner_match |= Q(employee_profile=employee_profile)
        return qs.filter(owner_match | manager_match)

    def perform_create(self, serializer):
        user = self.request.user
        role = get_role(user)
        profile = serializer.validated_data.get("employee_profile")

        if role not in ["SystemAdmin", "HRManager"]:
            profile = getattr(user, "employee_profile", None)
            if not profile:
                raise PermissionDenied("Employee profile not found.")
        elif not profile:
            raise ValidationError({"employee_profile": "This field is required."})

        record = serializer.validated_data.get("attendance_record")
        if record and record.employee_profile_id != profile.id:
            raise ValidationError({"attendance_record": "Attendance record does not belong to this employee."})
        if not record and profile and serializer.validated_data.get("date"):
            record = AttendanceRecord.objects.filter(
                employee_profile=profile,
                date=serializer.validated_data["date"],
            ).first()

        serializer.save(
            employee_profile=profile,
            attendance_record=record,
            created_by=user,
            updated_by=user,
        )

    def perform_update(self, serializer):
        user = self.request.user
        role = get_role(user)
        if role in ["SystemAdmin", "HRManager"]:
            serializer.save(updated_by=user)
            return

        serializer.save(
            employee_profile=serializer.instance.employee_profile,
            updated_by=user,
        )

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        if isinstance(response.data, dict) and response.data.get("status") == "success":
            return response
        return success(response.data)

    def retrieve(self, request, *args, **kwargs):
        response = super().retrieve(request, *args, **kwargs)
        return success(response.data)

    def create(self, request, *args, **kwargs):
        response = super().create(request, *args, **kwargs)
        return success(response.data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.status != AttendanceCorrectionRequest.Status.DRAFT:
            return error("Only draft correction requests can be edited.", status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        if instance.created_by_id != request.user.id and get_role(request.user) not in ["SystemAdmin", "HRManager"]:
            return error("You cannot edit this correction request.", status=status.HTTP_403_FORBIDDEN)
        response = super().update(request, *args, **kwargs)
        return success(response.data)

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        return error("Attendance correction requests cannot be deleted.", status=status.HTTP_405_METHOD_NOT_ALLOWED)

    def _serialize(self, instance):
        return AttendanceCorrectionRequestSerializer(instance, context={"request": self.request}).data

    def _notify_next_approver(self, instance):
        requester_name = instance.employee_profile.full_name or getattr(instance.employee_profile.user, "email", "")
        details = [f"Date: {instance.date}", "Request: Attendance correction"]
        try:
            if instance.status == AttendanceCorrectionRequest.Status.PENDING_MANAGER:
                manager = get_direct_manager_user(instance.employee_profile.user)
                if manager:
                    notify_users_for_pending_status(
                        users=[manager],
                        request_type="Attendance Correction",
                        request_id=instance.id,
                        requester_name=requester_name,
                        status_label=instance.status,
                        details=details,
                        action_path="/manager/team-requests?tab=attendance-corrections",
                    )
            elif instance.status == AttendanceCorrectionRequest.Status.PENDING_HR:
                notify_users_for_pending_status(
                    users=get_hr_approver_users(),
                    request_type="Attendance Correction",
                    request_id=instance.id,
                    requester_name=requester_name,
                    status_label=instance.status,
                    details=details,
                    action_path="/hr/attendance-correction-requests",
                )
        except Exception:
            pass

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        instance = self.get_object()
        if instance.status != AttendanceCorrectionRequest.Status.DRAFT:
            return error("Only draft correction requests can be submitted.", status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        if instance.created_by_id != request.user.id and get_role(request.user) not in ["SystemAdmin", "HRManager"]:
            return error("You cannot submit this correction request.", status=status.HTTP_403_FORBIDDEN)

        has_manager = bool(instance.employee_profile.manager_id or instance.employee_profile.manager_profile_id)
        instance.status = (
            AttendanceCorrectionRequest.Status.PENDING_MANAGER
            if has_manager
            else AttendanceCorrectionRequest.Status.PENDING_HR
        )
        instance.submitted_at = timezone.now()
        instance.updated_by = request.user
        instance.save(update_fields=["status", "submitted_at", "updated_by", "updated_at"])
        sync_workflow(instance, actor=request.user)
        audit(request, "attendance_correction.submitted", entity="AttendanceCorrectionRequest", entity_id=instance.id)
        self._notify_next_approver(instance)
        return success(self._serialize(instance))

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        instance = self.get_object()
        note = (request.data.get("notes") or request.data.get("comment") or "").strip()

        if instance.status == AttendanceCorrectionRequest.Status.PENDING_MANAGER:
            if not _can_manager_act_on_correction(request.user, instance):
                return error("You cannot approve this correction request.", status=status.HTTP_403_FORBIDDEN)
            instance.status = AttendanceCorrectionRequest.Status.PENDING_HR
            instance.manager_decision_by = request.user
            instance.manager_decision_at = timezone.now()
            instance.manager_decision_note = note
            instance.updated_by = request.user
            instance.save(
                update_fields=[
                    "status",
                    "manager_decision_by",
                    "manager_decision_at",
                    "manager_decision_note",
                    "updated_by",
                    "updated_at",
                ]
            )
            sync_workflow(instance, actor=request.user)
            audit(request, "attendance_correction.manager_approved", entity="AttendanceCorrectionRequest", entity_id=instance.id)
            self._notify_next_approver(instance)
            return success(self._serialize(instance))

        if instance.status == AttendanceCorrectionRequest.Status.PENDING_HR:
            if not is_hr_workflow_approver_user(request.user):
                return error("You cannot approve this correction request.", status=status.HTTP_403_FORBIDDEN)
            with transaction.atomic():
                self._apply_correction(instance, request.user, note)
                sync_workflow(instance, actor=request.user)
            audit(request, "attendance_correction.hr_approved", entity="AttendanceCorrectionRequest", entity_id=instance.id)
            return success(self._serialize(instance))

        return error("Request is not in an approvable state.", status=status.HTTP_422_UNPROCESSABLE_ENTITY)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        instance = self.get_object()
        note = (request.data.get("notes") or request.data.get("comment") or "").strip()
        if not note:
            return error("notes/comment is required for rejection.", status=status.HTTP_422_UNPROCESSABLE_ENTITY)

        if instance.status == AttendanceCorrectionRequest.Status.PENDING_MANAGER:
            if not _can_manager_act_on_correction(request.user, instance):
                return error("You cannot reject this correction request.", status=status.HTTP_403_FORBIDDEN)
            instance.manager_decision_by = request.user
            instance.manager_decision_at = timezone.now()
            instance.manager_decision_note = note
        elif instance.status == AttendanceCorrectionRequest.Status.PENDING_HR:
            if not is_hr_workflow_approver_user(request.user):
                return error("You cannot reject this correction request.", status=status.HTTP_403_FORBIDDEN)
            instance.hr_decision_by = request.user
            instance.hr_decision_at = timezone.now()
            instance.hr_decision_note = note
        else:
            return error("Request is not in a rejectable state.", status=status.HTTP_422_UNPROCESSABLE_ENTITY)

        instance.status = AttendanceCorrectionRequest.Status.REJECTED
        instance.decided_at = timezone.now()
        instance.updated_by = request.user
        instance.save()
        sync_workflow(instance, actor=request.user)
        audit(request, "attendance_correction.rejected", entity="AttendanceCorrectionRequest", entity_id=instance.id)
        return success(self._serialize(instance))

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        instance = self.get_object()
        if instance.status in {
            AttendanceCorrectionRequest.Status.APPROVED,
            AttendanceCorrectionRequest.Status.REJECTED,
            AttendanceCorrectionRequest.Status.CANCELLED,
        }:
            return error("Request is already finalized.", status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        if instance.created_by_id != request.user.id and get_role(request.user) not in ["SystemAdmin", "HRManager"]:
            return error("You cannot cancel this correction request.", status=status.HTTP_403_FORBIDDEN)

        instance.status = AttendanceCorrectionRequest.Status.CANCELLED
        instance.cancelled_at = timezone.now()
        instance.updated_by = request.user
        instance.save(update_fields=["status", "cancelled_at", "updated_by", "updated_at"])
        sync_workflow(instance, actor=request.user)
        audit(request, "attendance_correction.cancelled", entity="AttendanceCorrectionRequest", entity_id=instance.id)
        return success(self._serialize(instance))

    def _apply_correction(self, instance, actor, note):
        record = instance.attendance_record
        if record is None:
            record, _ = AttendanceRecord.objects.get_or_create(
                employee_profile=instance.employee_profile,
                date=instance.date,
                defaults={
                    "status": instance.requested_status or AttendanceRecord.Status.PRESENT,
                    "source": AttendanceRecord.Source.HR,
                    "created_by": actor,
                    "updated_by": actor,
                },
            )

        if instance.requested_check_in_at is not None:
            record.check_in_at = instance.requested_check_in_at
        if instance.requested_check_out_at is not None:
            record.check_out_at = instance.requested_check_out_at
        if instance.requested_status:
            record.status = instance.requested_status
        elif record.status in {
            AttendanceRecord.Status.PENDING,
            AttendanceRecord.Status.PENDING_MANAGER,
            AttendanceRecord.Status.PENDING_HR,
            AttendanceRecord.Status.PENDING_CEO,
        }:
            record.status = AttendanceRecord.Status.PRESENT

        record.source = AttendanceRecord.Source.HR
        record.is_overridden = True
        record.override_reason = f"Attendance correction request #{instance.id}: {instance.reason}"
        record.updated_by = actor
        record.save()

        instance.attendance_record = record
        instance.status = AttendanceCorrectionRequest.Status.APPROVED
        instance.hr_decision_by = actor
        instance.hr_decision_at = timezone.now()
        instance.hr_decision_note = note
        instance.decided_at = instance.hr_decision_at
        instance.updated_by = actor
        instance.save()


class ManagerAttendanceViewSet(AttendanceMaintenanceMixin, viewsets.ReadOnlyModelViewSet):
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
        delegated_manager_ids = get_delegated_manager_user_ids(self.request.user)
        delegated_match = Q()
        if delegated_manager_ids:
            delegated_match = Q(employee_profile__manager_id__in=delegated_manager_ids) | Q(
                employee_profile__manager_profile__user_id__in=delegated_manager_ids
            )

        return base_qs.filter(
            Q(employee_profile__manager_profile__user=self.request.user)
            | Q(employee_profile__manager=self.request.user)
            | profile_match
            | delegated_match
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
        sync_workflow(instance, actor=request.user)

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
        sync_workflow(instance, actor=request.user)

        audit(request, "reject", entity="AttendanceRecord", entity_id=instance.id)
        return success(AttendanceRecordSerializer(instance).data)


class CEOAttendanceViewSet(AttendanceMaintenanceMixin, viewsets.ReadOnlyModelViewSet):
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
        sync_workflow(instance, actor=request.user)
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
        sync_workflow(instance, actor=request.user)
        audit(request, "reject_ceo", entity="AttendanceRecord", entity_id=instance.id)
        return success(AttendanceRecordSerializer(instance).data)
