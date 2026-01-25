import random
import string

from django.db import IntegrityError, transaction
from django.db.models import Q

from rest_framework import viewsets, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.decorators import action

from core.permissions import get_role
from core.responses import success, error
from core.pagination import EmployeePagination
from audit.utils import audit

from .models import EmployeeProfile
from .serializers import EmployeeProfileReadSerializer, EmployeeProfileWriteSerializer
from .permissions import IsHRManagerOrAdmin, IsEmployeeOwner


def generate_employee_id():
    suffix = "".join(random.choices(string.digits, k=6))
    return f"EMP-{suffix}"


def _audit_snapshot(instance: EmployeeProfile) -> dict:
    return {
        "id": instance.id,
        "employee_id": instance.employee_id,
        "full_name": instance.full_name,
        "user_id": instance.user.id if instance.user else None,
        "email": instance.user.email if instance.user else "",
        "department_id": instance.department_ref.id if instance.department_ref else None,
        "position_id": instance.position_ref.id if instance.position_ref else None,
        "task_group_id": instance.task_group_ref.id if instance.task_group_ref else None,
        "sponsor_id": instance.sponsor_ref.id if instance.sponsor_ref else None,
        "employment_status": instance.employment_status,
    }


def _sync_legacy_fields(instance: EmployeeProfile) -> None:
    updates = []
    if instance.department_ref and instance.department != instance.department_ref.name:
        instance.department = instance.department_ref.name
        updates.append("department")
    if instance.position_ref and instance.job_title != instance.position_ref.name:
        instance.job_title = instance.position_ref.name
        updates.append("job_title")
    if updates:
        instance.save(update_fields=updates)


class EmployeeProfileViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    pagination_class = EmployeePagination

    def get_permissions(self):
        if self.action in ["retrieve", "me"]:
            permission_classes = [IsAuthenticated, IsHRManagerOrAdmin | IsEmployeeOwner]
        else:
            permission_classes = [IsAuthenticated, IsHRManagerOrAdmin]
        return [permission() for permission in permission_classes]

    def get_queryset(self):
        user = self.request.user
        role = get_role(user)

        base_qs = EmployeeProfile.objects.select_related(
            "user",
            "manager",
            "department_ref",
            "position_ref",
            "task_group_ref",
            "sponsor_ref",
        )

        if role in ["SystemAdmin", "HRManager"]:
            return base_qs.all()

        return base_qs.filter(user=user)

    def get_serializer_class(self):
        if self.action in ["list", "retrieve", "me"]:
            return EmployeeProfileReadSerializer
        return EmployeeProfileWriteSerializer

    def _apply_filters(self, qs):
        params = self.request.query_params
        search = params.get("search")
        if search:
            qs = qs.filter(
                Q(full_name__icontains=search)
                | Q(employee_id__icontains=search)
                | Q(employee_number__icontains=search)
                | Q(mobile__icontains=search)
                | Q(passport_no__icontains=search)
                | Q(national_id__icontains=search)
            )

        department = params.get("department")
        if department:
            qs = qs.filter(
                Q(department_ref__code__iexact=department)
                | Q(department__iexact=department)
            )

        position = params.get("position")
        if position:
            qs = qs.filter(position_ref__code__iexact=position)

        task_group = params.get("task_group")
        if task_group:
            qs = qs.filter(task_group_ref__code__iexact=task_group)

        sponsor = params.get("sponsor")
        if sponsor:
            qs = qs.filter(sponsor_ref__code__iexact=sponsor)

        status_value = params.get("status")
        if status_value:
            qs = qs.filter(employment_status=status_value)

        return qs

    def list(self, request, *args, **kwargs):
        qs = self._apply_filters(self.get_queryset())
        page = self.paginate_queryset(qs)
        serializer = self.get_serializer(page if page is not None else qs, many=True)

        if page is not None:
            return self.get_paginated_response(serializer.data)

        return success({"results": serializer.data, "count": qs.count()})

    def retrieve(self, request, *args, **kwargs):
        response = super().retrieve(request, *args, **kwargs)
        return success(response.data)

    @action(detail=False, methods=["get"], url_path="me")
    def me(self, request):
        try:
            profile = EmployeeProfile.objects.get(user=request.user)
        except EmployeeProfile.DoesNotExist:
            return error("Profile not found.", status=status.HTTP_404_NOT_FOUND)

        serializer = self.get_serializer(profile)
        return success(serializer.data)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        read_serializer = EmployeeProfileReadSerializer(serializer.instance)
        return success(read_serializer.data, status=status.HTTP_201_CREATED)

    def perform_create(self, serializer):
        max_retries = 5
        for _ in range(max_retries):
            eid = generate_employee_id()
            try:
                with transaction.atomic():
                    instance = serializer.save(employee_id=eid)
                    _sync_legacy_fields(instance)
                    audit(
                        self.request,
                        "employee_profile_created",
                        entity="employee_profile",
                        entity_id=instance.id,
                        metadata={"before": None, "after": _audit_snapshot(instance)},
                    )
                    return
            except IntegrityError:
                continue

        raise IntegrityError("Failed to generate unique Employee ID after multiple attempts.")

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        read_serializer = EmployeeProfileReadSerializer(serializer.instance)
        return success(read_serializer.data)

    def perform_update(self, serializer):
        before = _audit_snapshot(serializer.instance)
        instance = serializer.save()
        _sync_legacy_fields(instance)
        audit(
            self.request,
            "employee_profile_updated",
            entity="employee_profile",
            entity_id=instance.id,
            metadata={"before": before, "after": _audit_snapshot(instance)},
        )

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        read_serializer = EmployeeProfileReadSerializer(serializer.instance)
        return success(read_serializer.data)

    def destroy(self, request, *args, **kwargs):
        return error(
            "Hard delete is not allowed. Please update status to TERMINATED.",
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )
