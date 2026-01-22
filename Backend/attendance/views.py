from django.utils import timezone
from django.shortcuts import get_object_or_404
from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.throttling import UserRateThrottle
from django_filters.rest_framework import DjangoFilterBackend
from datetime import timedelta, date as date_type

from .models import AttendanceRecord
from .serializers import (
    AttendanceRecordSerializer, 
    AttendanceOverrideSerializer,
    CheckInResponseSerializer,
    CheckOutResponseSerializer
)
from .permissions import IsAttendanceOwner, IsHRManagerOrAdmin
from core.permissions import get_role
from core.responses import success, error
from audit.utils import audit
from employees.models import EmployeeProfile

class AttendanceThrottle(UserRateThrottle):
    rate = '10/min'

class AttendanceRecordViewSet(viewsets.ModelViewSet):
    serializer_class = AttendanceRecordSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["status"]
    ordering_fields = ["date", "created_at"]
    ordering = ["-date"]

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
            return [IsAuthenticated()]
        
        # HR/Admin write actions
        if self.action in ["create", "update", "partial_update", "destroy"]:
            return [IsAuthenticated(), IsHRManagerOrAdmin()]
        
        return [IsAuthenticated()]

    def list(self, request, *args, **kwargs):
        # Check for date filter error
        if hasattr(self, '_date_filter_error'):
            return error(f"Invalid date filter: {self._date_filter_error}", status=status.HTTP_400_BAD_REQUEST)
        
        response = super().list(request, *args, **kwargs)
        return success(response.data)

    def retrieve(self, request, *args, **kwargs):
        response = super().retrieve(request, *args, **kwargs)
        return success(response.data)

    def destroy(self, request, *args, **kwargs):
        return error("Attendance records cannot be deleted.", status=status.HTTP_405_METHOD_NOT_ALLOWED)
    
    def partial_update(self, request, *args, **kwargs):
        # HR Override logic (PATCH routes here)
        instance = self.get_object()
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
        
        audit(request, "attendance.override", entity="attendance_record", entity_id=instance.id, metadata=s.validated_data)
        
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

        record = AttendanceRecord.objects.create(
            employee_profile=profile,
            date=today,
            check_in_at=timezone.now(),
            status=AttendanceRecord.Status.PRESENT,
            source=AttendanceRecord.Source.EMPLOYEE,
            created_by=user,
            updated_by=user
        )
        
        audit(request, "attendance.check_in", entity="attendance_record", entity_id=record.id)
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
            paginated_response = self.get_paginated_response(serializer.data)
            # Wrap the paginated response
            return success(paginated_response.data)

        serializer = self.get_serializer(queryset, many=True)
        return success(serializer.data)


