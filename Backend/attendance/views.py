from datetime import date as date_type
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import Count, Q
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.throttling import UserRateThrottle

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
from core.services import (
    get_ceo_approver_users,
    get_direct_manager_user,
    get_hr_approver_users,
    notify_profile_request_status_whatsapp,
    notify_users_for_pending_status,
    sync_workflow,
)
from employees.models import EmployeeProfile
from employees.services.manager_relationships import (
    get_valid_manager_user,
    manager_approval_actor_source,
    manager_scope_q,
)
from organization.services import (
    ensure_company_write_allowed,
    filter_queryset_by_company_scope,
    get_active_company_for_request,
)

from .geofence import GeofencePayloadError, validate_mobile_geofence
from .models import AttendanceCorrectionRequest, AttendanceRecord, WorkLocation
from .permissions import IsAttendanceSelfServiceRole
from .serializers import (
    AttendanceCorrectionRequestSerializer,
    AttendanceOverrideSerializer,
    AttendanceRecordSerializer,
    CheckInResponseSerializer,
    CheckOutResponseSerializer,
    WorkLocationSerializer,
)

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


def _is_hr_manager_user(user):
    return bool(user and user.is_authenticated and user.groups.filter(name="HRManager").exists())


def _is_hr_manager_origin_record(instance: AttendanceRecord):
    employee_user = getattr(getattr(instance, "employee_profile", None), "user", None)
    return bool(employee_user and employee_user.groups.filter(name="HRManager").exists())


def _manager_scope_filter(user):
    return manager_scope_q(
        user, employee_prefix="employee_profile__", cross_company_capability="attendance.approve"
    )


def _can_manager_act_on_correction(user, correction: AttendanceCorrectionRequest):
    return bool(
        manager_approval_actor_source(
            user,
            correction.employee_profile,
            capability="attendance.approve",
            allow_admin=True,
        )
    )


def _scope_attendance_queryset(queryset, request):
    queryset = filter_queryset_by_company_scope(queryset, request, field_name="employee_profile__company_id")
    return queryset.filter(employee_profile__company_id__isnull=False)


def _profile_matches_active_company(request, profile):
    if profile.company_id is None:
        return False
    active_company = get_active_company_for_request(request)
    return bool(active_company and active_company.id == profile.company_id)


def _validate_attendance_geofence(request, profile):
    """Return a matching site when the global rollout toggle is enabled."""
    from admin_portal.models import SystemSettings

    if not SystemSettings.get_solo().geofence_attendance_enabled:
        return None, None

    try:
        location = validate_mobile_geofence(payload=request.data, company=profile.company)
    except GeofencePayloadError as exc:
        if exc.kind == "poor_accuracy":
            return None, error(
                "GPS accuracy must be 100 metres or better.",
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        return None, error("Invalid GPS coordinates.", status=status.HTTP_422_UNPROCESSABLE_ENTITY)

    if location is None:
        return None, error(
            "You are not within an approved work location.", status=status.HTTP_403_FORBIDDEN
        )
    return location, None


class AttendanceThrottle(UserRateThrottle):
    rate = "10/min"


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
        return error("Attendance records cannot be deleted.", status=status.HTTP_405_METHOD_NOT_ALLOWED)

    def create(self, request, *args, **kwargs):
        return error("Attendance records cannot be created directly.", status=status.HTTP_405_METHOD_NOT_ALLOWED)

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

        if profile.is_archived:
            return error("Archived employees cannot check in.", status=status.HTTP_403_FORBIDDEN)

        if not _profile_matches_active_company(request, profile):
            return error("Employee profile is not available in the active company.", status=status.HTTP_403_FORBIDDEN)

        matched_location, geofence_error = _validate_attendance_geofence(request, profile)
        if geofence_error:
            return geofence_error

        has_manager = bool(get_valid_manager_user(profile, cross_company_capability="attendance.approve"))

        if _is_hr_manager_user(user):
            status_value = AttendanceRecord.Status.PENDING_CEO
        else:
            status_value = (
                AttendanceRecord.Status.PENDING_MANAGER if has_manager else AttendanceRecord.Status.PENDING_HR
            )
        # Fallback/Legacy note: PENDING_HR maps to old 'PENDING' concept effectively

        try:
            with transaction.atomic():
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
                audit(
                    request,
                    "attendance.check_in",
                    entity="attendance_record",
                    entity_id=record.id,
                    metadata={
                        "date": str(record.date),
                        "company_id": profile.company_id,
                        **(
                            {"work_location_id": matched_location.id, "work_location_name": matched_location.name}
                            if matched_location
                            else {}
                        ),
                    },
                )
        except IntegrityError:
            return error("Check-in already exists for today.", status=status.HTTP_400_BAD_REQUEST)
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

        if profile.is_archived:
            return error("Archived employees cannot check out.", status=status.HTTP_403_FORBIDDEN)

        if not _profile_matches_active_company(request, profile):
            return error("Employee profile is not available in the active company.", status=status.HTTP_403_FORBIDDEN)

        matched_location, geofence_error = _validate_attendance_geofence(request, profile)
        if geofence_error:
            return geofence_error

        with transaction.atomic():
            try:
                record = AttendanceRecord.objects.select_for_update().get(employee_profile=profile, date=today)
            except AttendanceRecord.DoesNotExist:
                return error("No check-in record found for today.", status=status.HTTP_400_BAD_REQUEST)

            if record.check_out_at:
                return error("Check-out already exists for today.", status=status.HTTP_400_BAD_REQUEST)

            record.check_out_at = timezone.now()
            record.updated_by = user
            record.save(update_fields=["check_out_at", "updated_by", "updated_at"])
            sync_workflow(record, actor=user)
            audit(
                request,
                "attendance.check_out",
                entity="attendance_record",
                entity_id=record.id,
                metadata={
                    "date": str(record.date),
                    "company_id": profile.company_id,
                    **(
                        {"work_location_id": matched_location.id, "work_location_name": matched_location.name}
                        if matched_location
                        else {}
                    ),
                },
            )
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
        qs = _scope_attendance_queryset(qs, self.request)

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

        if not _profile_matches_active_company(self.request, profile):
            raise PermissionDenied("Employee profile is not available in the active company.")

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
            return error(
                "Only draft correction requests can be submitted.", status=status.HTTP_422_UNPROCESSABLE_ENTITY
            )
        if instance.created_by_id != request.user.id and get_role(request.user) not in ["SystemAdmin", "HRManager"]:
            return error("You cannot submit this correction request.", status=status.HTTP_403_FORBIDDEN)

        has_manager = bool(
            get_valid_manager_user(instance.employee_profile, cross_company_capability="attendance.approve")
        )
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
            actor_source = manager_approval_actor_source(
                request.user,
                instance.employee_profile,
                capability="attendance.approve",
                allow_admin=True,
            )
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
            audit(
                request,
                "attendance_correction.manager_approved",
                entity="AttendanceCorrectionRequest",
                entity_id=instance.id,
                metadata={"actor_source": actor_source},
            )
            self._notify_next_approver(instance)
            return success(self._serialize(instance))

        if instance.status == AttendanceCorrectionRequest.Status.PENDING_HR:
            if not is_hr_workflow_approver_user(request.user):
                return error("You cannot approve this correction request.", status=status.HTTP_403_FORBIDDEN)
            with transaction.atomic():
                self._apply_correction(instance, request.user, note)
                sync_workflow(instance, actor=request.user)
            audit(
                request,
                "attendance_correction.hr_approved",
                entity="AttendanceCorrectionRequest",
                entity_id=instance.id,
            )
            try:
                notify_profile_request_status_whatsapp(
                    profile=instance.employee_profile,
                    request_type="Attendance Correction",
                    request_id=instance.id,
                    status_label="Approved",
                    details=[f"Date: {instance.date}"],
                    action_path="/employee/attendance",
                )
            except Exception:
                pass
            return success(self._serialize(instance))

        return error("Request is not in an approvable state.", status=status.HTTP_422_UNPROCESSABLE_ENTITY)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        instance = self.get_object()
        note = (request.data.get("notes") or request.data.get("comment") or "").strip()
        approval_actor_source = "admin"
        if not note:
            return error("notes/comment is required for rejection.", status=status.HTTP_422_UNPROCESSABLE_ENTITY)

        if instance.status == AttendanceCorrectionRequest.Status.PENDING_MANAGER:
            if not _can_manager_act_on_correction(request.user, instance):
                return error("You cannot reject this correction request.", status=status.HTTP_403_FORBIDDEN)
            actor_source = manager_approval_actor_source(
                request.user,
                instance.employee_profile,
                capability="attendance.approve",
                allow_admin=True,
            )
            approval_actor_source = actor_source
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
        audit(
            request,
            "attendance_correction.rejected",
            entity="AttendanceCorrectionRequest",
            entity_id=instance.id,
            metadata={"actor_source": approval_actor_source},
        )
        try:
            notify_profile_request_status_whatsapp(
                profile=instance.employee_profile,
                request_type="Attendance Correction",
                request_id=instance.id,
                status_label="Rejected",
                reason=note,
                details=[f"Date: {instance.date}"],
                action_path="/employee/attendance",
            )
        except Exception:
            pass
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
        return qs.filter(_manager_scope_filter(self.request.user)).distinct()

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        try:
            instance = self.get_queryset().get(pk=pk)
        except AttendanceRecord.DoesNotExist:
            return error("Not found", errors=["Not found."], status=404)

        actor_source = manager_approval_actor_source(
            request.user,
            instance.employee_profile,
            capability="attendance.approve",
            allow_admin=True,
        )
        if not actor_source:
            return error("Forbidden", errors=["You cannot approve this attendance request."], status=403)

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

        audit(
            request,
            "approve",
            entity="AttendanceRecord",
            entity_id=instance.id,
            metadata={"actor_source": actor_source},
        )
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

        actor_source = manager_approval_actor_source(
            request.user,
            instance.employee_profile,
            capability="attendance.approve",
            allow_admin=True,
        )
        if not actor_source:
            return error("Forbidden", errors=["You cannot reject this attendance request."], status=403)

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

        audit(
            request,
            "reject",
            entity="AttendanceRecord",
            entity_id=instance.id,
            metadata={"actor_source": actor_source},
        )
        try:
            notify_profile_request_status_whatsapp(
                profile=instance.employee_profile,
                request_type="Attendance Request",
                request_id=instance.id,
                status_label="Rejected",
                reason=note,
                details=[f"Date: {instance.date}", "Rejected by manager"],
                action_path="/employee/attendance",
            )
        except Exception:
            pass
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
        try:
            notify_profile_request_status_whatsapp(
                profile=instance.employee_profile,
                request_type="Attendance Request",
                request_id=instance.id,
                status_label="Approved",
                details=[f"Date: {instance.date}", "Approved by CEO"],
                action_path="/employee/attendance",
            )
        except Exception:
            pass
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
        try:
            notify_profile_request_status_whatsapp(
                profile=instance.employee_profile,
                request_type="Attendance Request",
                request_id=instance.id,
                status_label="Rejected",
                reason=note,
                details=[f"Date: {instance.date}", "Rejected by CEO"],
                action_path="/employee/attendance",
            )
        except Exception:
            pass
        return success(AttendanceRecordSerializer(instance).data)
