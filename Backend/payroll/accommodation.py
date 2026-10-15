"""Portable assignment writes shared by the later payroll endpoints."""

from time import sleep

from audit.utils import audit
from django.core.exceptions import ValidationError
from django.db import IntegrityError, OperationalError, connection, transaction
from django.shortcuts import get_object_or_404
from employees.models import EmployeeProfile
from organization.services import filter_queryset_by_company_scope
from rents.models import Rent

from .configuration import PayrollDomainError, payroll_company
from .models import AccommodationAssignment


def _values(assignment):
    return {
        "employee_profile_id": assignment.employee_profile_id,
        "rent_id": assignment.rent_id,
        "status": assignment.status,
        "start_date": assignment.start_date.isoformat(),
        "end_date": assignment.end_date.isoformat(),
        "is_active": assignment.is_active,
    }


def save_assignment(
    request, *, employee_profile_id, status, start_date, end_date, reason, rent_id=None, assignment_id=None
):
    if not reason.strip():
        raise PayrollDomainError("reason_required")
    for attempt in range(3):
        try:
            with transaction.atomic():
                company = payroll_company(request)
                profile = get_object_or_404(
                    filter_queryset_by_company_scope(EmployeeProfile.objects.select_for_update(), request),
                    pk=employee_profile_id,
                )
                if connection.vendor == "sqlite":
                    # Acquire the SQLite writer reservation before the overlap read.
                    EmployeeProfile.objects.filter(pk=profile.pk).update(
                        payroll_config_revision=profile.payroll_config_revision
                    )
                rent = None
                if rent_id is not None:
                    rent = get_object_or_404(filter_queryset_by_company_scope(Rent.objects.all(), request), pk=rent_id)
                old = None
                obj = AccommodationAssignment(company=company, employee_profile=profile, created_by=request.user)
                if assignment_id is not None:
                    obj = get_object_or_404(
                        filter_queryset_by_company_scope(AccommodationAssignment.objects.select_for_update(), request),
                        pk=assignment_id,
                    )
                    if obj.employee_profile_id != profile.pk:
                        raise PayrollDomainError("field_not_editable", field="employee_profile_id")
                    old = _values(obj)
                obj.status, obj.rent, obj.start_date, obj.end_date = status, rent, start_date, end_date
                obj.updated_by = request.user
                if end_date < start_date:
                    raise PayrollDomainError("invalid_date_range")
                if (status == "assigned") != bool(rent):
                    raise PayrollDomainError("invalid_choice", field="rent_id")
                overlaps = filter_queryset_by_company_scope(AccommodationAssignment.objects.all(), request).filter(
                    employee_profile=profile, is_active=True, start_date__lte=end_date, end_date__gte=start_date
                )
                if obj.pk:
                    overlaps = overlaps.exclude(pk=obj.pk)
                if obj.is_active and overlaps.exists():
                    raise PayrollDomainError("assignment_overlap", status_code=409)
                obj.full_clean()
                if old == _values(obj):
                    return obj
                obj.save()
                audit(
                    request,
                    "payroll_accommodation_assignment_updated" if old else "payroll_accommodation_assignment_created",
                    entity="AccommodationAssignment",
                    entity_id=obj.pk,
                    metadata={
                        "company_id": company.pk,
                        "original_value": old,
                        "new_value": _values(obj),
                        "reason": reason,
                    },
                )
                return obj
        except OperationalError as exc:
            if connection.vendor != "sqlite" or "locked" not in str(exc).lower() or attempt == 2:
                raise
            sleep(0.02 * (attempt + 1))
        except IntegrityError as exc:
            if "payroll_assignment_no_overlap" in str(exc):
                raise PayrollDomainError("assignment_overlap", status_code=409) from exc
            raise
        except ValidationError as exc:
            raise PayrollDomainError("invalid_choice", field="assignment") from exc


@transaction.atomic
def end_assignments_for_archive(request, profile_id, archive_date, *, reason):
    if not reason.strip():
        raise PayrollDomainError("reason_required")
    payroll_company(request)
    profile = get_object_or_404(
        filter_queryset_by_company_scope(EmployeeProfile.objects.select_for_update(), request), pk=profile_id
    )
    end_profile_assignments(profile, archive_date, actor=request.user, reason=reason, request=request)


def end_profile_assignments(profile, archive_date, *, actor, reason, request=None):
    assignments = AccommodationAssignment.objects.select_for_update().filter(
        company_id=profile.company_id, employee_profile=profile, is_active=True, end_date__gt=archive_date
    )
    for obj in assignments:
        old = _values(obj)
        if obj.start_date > archive_date:
            obj.is_active = False
        else:
            obj.end_date = archive_date
        obj.updated_by = actor
        obj.full_clean()
        obj.save()
        audit(
            request,
            "payroll_accommodation_assignment_ended",
            actor=actor,
            entity="AccommodationAssignment",
            entity_id=obj.pk,
            metadata={"company_id": obj.company_id, "original_value": old, "new_value": _values(obj), "reason": reason},
        )
