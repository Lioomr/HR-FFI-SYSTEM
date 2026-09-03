from datetime import date, timedelta
from io import StringIO
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command

from admin_portal.models import SystemSettings
from attendance.absence import mark_absentees_for_date
from attendance.models import AttendanceRecord
from attendance.tasks import mark_daily_absentees
from employees.models import EmployeeProfile
from leaves.models import LeaveRequest, LeaveType
from organization.models import OrganizationNode


@pytest.mark.django_db
@pytest.mark.parametrize("entrypoint", ["service", "backfill", "scheduled"])
def test_hire_status_archive_company_and_leave_rules_apply_to_every_entrypoint(entrypoint):
    workday = date(2026, 1, 5)
    settings = SystemSettings.get_solo()
    settings.work_week_days = [0, 1, 2, 3, 4]
    settings.absence_detection_enabled = True
    settings.save()
    company = OrganizationNode.objects.create(code="ABS-ELIGIBLE", name="Eligible", node_type="company")
    inactive_company = OrganizationNode.objects.create(
        code="ABS-INACTIVE",
        name="Inactive",
        node_type="company",
        is_active=False,
    )
    disabled = get_user_model().objects.create_user(email="absence-disabled@example.com", is_active=False)
    leave_user = get_user_model().objects.create_user(email="absence-leave@example.com")
    profiles = {}
    for name, overrides in {
        "before_hire": {"hire_date": workday + timedelta(days=1)},
        "on_hire": {"hire_date": workday},
        "after_hire": {"hire_date": workday - timedelta(days=1)},
        "unknown_hire": {},
        "archived": {"is_archived": True},
        "terminated": {"employment_status": "TERMINATED"},
        "suspended": {"employment_status": "SUSPENDED"},
        "prehire": {"employment_status": "PREHIRE"},
        "inactive_company": {"company": inactive_company, "is_archived": True},
        "disabled": {"user": disabled},
        "approved_leave": {},
        "legacy_leave": {"user": leave_user},
        "pending_leave": {},
    }.items():
        profiles[name] = EmployeeProfile.objects.create(
            **{"company": company, "employee_id": f"ABS-{name}", "full_name": name, **overrides},
        )
    leave_type = LeaveType.objects.create(company=company, code="ABS-LEAVE", name="Annual")
    for name, leave_status in [
        ("approved_leave", LeaveRequest.RequestStatus.APPROVED),
        ("legacy_leave", LeaveRequest.RequestStatus.APPROVED),
        ("pending_leave", LeaveRequest.RequestStatus.PENDING_HR),
    ]:
        LeaveRequest.objects.create(
            employee_profile=None if name == "legacy_leave" else profiles[name],
            employee=leave_user if name == "legacy_leave" else None,
            company=company,
            leave_type=leave_type,
            start_date=workday,
            end_date=workday,
            status=leave_status,
        )
    if entrypoint == "backfill":
        call_command("backfill_absences", date_from=workday.isoformat(), date_to=workday.isoformat(), stdout=StringIO())
    elif entrypoint == "scheduled":
        with patch("attendance.tasks.timezone.localdate", return_value=workday + timedelta(days=1)):
            mark_daily_absentees()
    else:
        mark_absentees_for_date(workday)
    marked = set(AttendanceRecord.objects.filter(date=workday).values_list("employee_profile_id", flat=True))
    assert marked == {profiles[name].id for name in ["on_hire", "after_hire", "unknown_hire", "pending_leave"]}


@pytest.mark.django_db
def test_backfill_crossing_hire_date_starts_on_hire_date_and_is_idempotent():
    company = OrganizationNode.objects.create(code="ABS-RANGE", name="Range", node_type="company")
    hire_date = date(2026, 1, 6)
    profile = EmployeeProfile.objects.create(
        company=company, full_name="Range", employee_id="ABS-RANGE", hire_date=hire_date
    )
    settings = SystemSettings.get_solo()
    settings.work_week_days = [0, 1, 2, 3, 4]
    settings.absence_detection_enabled = False  # Backfill bypasses only this flag.
    settings.save()
    for _ in range(2):
        call_command("backfill_absences", date_from="2026-01-05", date_to="2026-01-10", stdout=StringIO())
    assert list(
        AttendanceRecord.objects.filter(employee_profile=profile).order_by("date").values_list("date", flat=True)
    ) == [date(2026, 1, day) for day in range(6, 10)]
