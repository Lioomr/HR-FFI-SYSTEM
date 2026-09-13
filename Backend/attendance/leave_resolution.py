"""Resolve approved leave against attendance without changing device evidence."""

from django.db.models import Case, CharField, F, OuterRef, Q, Subquery, Value, When

from leaves.models import LeaveRequest

from .models import AttendanceRecord


def with_leave_resolution(queryset):
    # Prefer the immutable profile link; user-only matching is for legacy rows.
    matching_leave = LeaveRequest.objects.filter(
        Q(employee_profile_id=OuterRef("employee_profile_id"))
        | Q(employee_profile__isnull=True, employee_id=OuterRef("employee_profile__user_id")),
        company_id=OuterRef("employee_profile__company_id"),
        is_active=True,
        status=LeaveRequest.RequestStatus.APPROVED,
        start_date__lte=OuterRef("date"),
        end_date__gte=OuterRef("date"),
    ).order_by("pk")
    return queryset.annotate(
        covering_leave_id=Subquery(matching_leave.values("pk")[:1]),
    ).annotate(
        effective_status=Case(
            When(
                status=AttendanceRecord.Status.ABSENT,
                source=AttendanceRecord.Source.SYSTEM,
                is_overridden=False,
                check_in_at__isnull=True,
                check_out_at__isnull=True,
                covering_leave_id__isnull=False,
                then=Value("EXCUSED"),
            ),
            default=F("status"),
            output_field=CharField(),
        ),
    )


def filter_effective_status(queryset, value):
    if value == AttendanceRecord.Status.PENDING:
        return queryset.filter(effective_status__in=["PENDING", "PENDING_MGR", "PENDING_HR", "PENDING_CEO"])
    return queryset.filter(effective_status=value) if value else queryset
