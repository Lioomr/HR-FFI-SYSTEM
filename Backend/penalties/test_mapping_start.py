"""Attendance penalties apply only to BioTime-mapped employees, from the mapping start date."""

from datetime import date, datetime, time, timedelta
from decimal import Decimal
from io import StringIO

import pytest
from admin_portal.models import SystemSettings
from attendance.absence import mark_absentees_for_date
from attendance.models import AttendanceCorrectionRequest, AttendanceDailyResult, AttendanceRecord, BioTimeEmployeeMap
from attendance.schedule import is_working_day
from attendance.serializers import BioTimeEmployeeMapSerializer
from core.models import WorkflowInstance
from core.services.workflow_engine import sync_workflow
from django.core.management import call_command
from django.utils import timezone
from employees.models import EmployeeProfile
from organization.models import OrganizationNode

from penalties.catalog import CATALOG
from penalties.models import PenaltyCatalog, PenaltyRecord
from penalties.services import invalidate_unmapped_candidates, sync_absence_candidates, sync_attendance_candidates

START = date(2026, 10, 5)


@pytest.fixture
def profile():
    for row in CATALOG:
        PenaltyCatalog.objects.update_or_create(code=row["code"], defaults=row)
    company = OrganizationNode.objects.create(code="MAP-START", name="Map start", node_type="company")
    return EmployeeProfile.objects.create(
        company=company,
        employee_id="MAP-START-1",
        full_name="Mapped later",
        hire_date=date(2025, 1, 1),
        total_salary=Decimal("3000.00"),
        basic_salary=Decimal("3000.00"),
        employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
    )


def _working_days(profile, start, end):
    days, current = [], start
    while current <= end:
        if is_working_day(profile, current):
            days.append(current)
        current += timedelta(days=1)
    return days


def _absences(profile, days):
    return [
        AttendanceRecord.objects.create(
            employee_profile=profile,
            date=day,
            source=AttendanceRecord.Source.SYSTEM,
            status=AttendanceRecord.Status.ABSENT,
        )
        for day in days
    ]


@pytest.mark.django_db
def test_absence_detection_starts_on_mapping_start_date(profile):
    settings = SystemSettings.get_solo()
    settings.absence_detection_enabled = False  # Backfill bypasses only this flag.
    settings.save()
    BioTimeEmployeeMap.objects.create(employee_profile=profile, biotime_emp_code="MAP-1", attendance_start_date=START)
    call_command(
        "backfill_absences", date_from=(START - timedelta(days=7)).isoformat(), date_to="2026-10-08", stdout=StringIO()
    )
    marked = set(AttendanceRecord.objects.filter(employee_profile=profile).values_list("date", flat=True))
    assert marked == set(_working_days(profile, START, date(2026, 10, 8)))


@pytest.mark.django_db
def test_unmapped_employee_is_never_marked_absent(profile):
    day = _working_days(profile, START, START + timedelta(days=3))[0]
    mark_absentees_for_date(day, force=True)
    assert not AttendanceRecord.objects.filter(employee_profile=profile).exists()


@pytest.mark.django_db
def test_absences_before_mapping_start_never_count_toward_penalty_bands(profile):
    BioTimeEmployeeMap.objects.create(employee_profile=profile, biotime_emp_code="MAP-2", attendance_start_date=START)
    rows = _absences(profile, _working_days(profile, date(2026, 9, 29), date(2026, 10, 6)))
    sync_absence_candidates(rows)
    candidate = PenaltyRecord.objects.get(employee_profile=profile, source_kind="absence")
    counted = [row.date for row in rows if row.date >= START]
    assert candidate.evidence["absence_days"] == len(counted)
    assert candidate.evidence["spell_start_on"] == counted[0].isoformat()


@pytest.mark.django_db
def test_absences_for_unmapped_employee_raise_no_candidate(profile):
    rows = _absences(profile, _working_days(profile, START, START + timedelta(days=3)))
    sync_absence_candidates(rows)
    assert not PenaltyRecord.objects.filter(employee_profile=profile).exists()


@pytest.mark.django_db
def test_removing_or_moving_mapping_withdraws_pending_candidates(profile, django_capture_on_commit_callbacks):
    mapping = BioTimeEmployeeMap.objects.create(employee_profile=profile, biotime_emp_code="MAP-3")
    rows = _absences(profile, _working_days(profile, START, START + timedelta(days=1)))
    sync_absence_candidates(rows)
    candidate = PenaltyRecord.objects.get(employee_profile=profile, source_kind="absence")
    assert candidate.status == PenaltyRecord.Status.PENDING_HR_MARK

    mapping.attendance_start_date = rows[-1].date + timedelta(days=1)
    with django_capture_on_commit_callbacks(execute=True):
        mapping.save()
    candidate.refresh_from_db()
    assert candidate.status == PenaltyRecord.Status.WAIVED

    mapping.attendance_start_date = None
    mapping.save()
    sync_absence_candidates(rows)
    reopened = PenaltyRecord.objects.filter(employee_profile=profile, status=PenaltyRecord.Status.PENDING_HR_MARK)
    assert reopened.exists()
    with django_capture_on_commit_callbacks(execute=True):
        mapping.delete()
    assert not PenaltyRecord.objects.filter(
        employee_profile=profile, status=PenaltyRecord.Status.PENDING_HR_MARK
    ).exists()
    assert invalidate_unmapped_candidates() == 0


@pytest.mark.django_db
def test_purge_command_removes_only_premapping_absences(profile):
    BioTimeEmployeeMap.objects.create(employee_profile=profile, biotime_emp_code="MAP-4", attendance_start_date=START)
    before, after = _absences(profile, [START - timedelta(days=1), START])
    call_command("purge_premapping_absences", stdout=StringIO())
    assert AttendanceRecord.objects.filter(pk=before.pk).exists()  # dry run by default
    call_command("purge_premapping_absences", "--apply", stdout=StringIO())
    assert not AttendanceRecord.objects.filter(pk=before.pk).exists()
    assert AttendanceRecord.objects.filter(pk=after.pk).exists()


@pytest.mark.django_db
def test_new_mapping_defaults_start_date_to_today(profile):
    serializer = BioTimeEmployeeMapSerializer(data={"employee_profile": profile.pk, "biotime_emp_code": "MAP-5"})
    assert serializer.is_valid(), serializer.errors
    assert serializer.save().attendance_start_date == timezone.localdate()


def _late_result(profile, day):
    start = timezone.make_aware(datetime.combine(day, time(9, 0)))
    return AttendanceDailyResult.objects.create(
        employee_profile=profile,
        company=profile.company,
        date=day,
        shift_start_at=start,
        shift_end_at=start.replace(hour=18),
        scheduled_minutes=540,
        first_check_in_at=start + timedelta(minutes=20),
        final_check_out_at=start.replace(hour=18),
    )


@pytest.mark.django_db
def test_unmapped_employee_gets_no_late_or_early_penalty(profile):
    sync_attendance_candidates(_late_result(profile, date(2026, 10, 6)))
    assert not PenaltyRecord.objects.filter(employee_profile=profile).exists()


@pytest.mark.django_db
def test_late_penalty_only_from_mapping_start_date(profile):
    BioTimeEmployeeMap.objects.create(employee_profile=profile, biotime_emp_code="MAP-6", attendance_start_date=START)
    sync_attendance_candidates(_late_result(profile, START - timedelta(days=5)))
    assert not PenaltyRecord.objects.filter(employee_profile=profile).exists()
    sync_attendance_candidates(_late_result(profile, START + timedelta(days=1)))
    assert list(PenaltyRecord.objects.filter(employee_profile=profile).values_list("occurred_on", flat=True)) == [
        START + timedelta(days=1)
    ]


@pytest.mark.django_db
def test_api_update_cannot_clear_mapping_start_date(profile):
    mapping = BioTimeEmployeeMap.objects.create(
        employee_profile=profile, biotime_emp_code="MAP-7", attendance_start_date=START
    )
    cleared = BioTimeEmployeeMapSerializer(mapping, data={"attendance_start_date": None}, partial=True)
    assert not cleared.is_valid()
    assert "attendance_start_date" in cleared.errors
    renamed = BioTimeEmployeeMapSerializer(mapping, data={"biotime_emp_code": "MAP-7B"}, partial=True)
    assert renamed.is_valid(), renamed.errors
    assert renamed.save().attendance_start_date == START


@pytest.mark.django_db
def test_purge_removes_workflow_wrapper_and_keeps_referenced_rows(profile):
    BioTimeEmployeeMap.objects.create(employee_profile=profile, biotime_emp_code="MAP-8", attendance_start_date=START)
    removable, corrected = _absences(profile, [START - timedelta(days=2), START - timedelta(days=1)])
    workflow = sync_workflow(removable)
    AttendanceCorrectionRequest.objects.create(
        employee_profile=profile, attendance_record=corrected, date=corrected.date, reason="Was on site"
    )
    call_command("purge_premapping_absences", "--apply", stdout=StringIO())
    assert not AttendanceRecord.objects.filter(pk=removable.pk).exists()
    assert not WorkflowInstance.objects.filter(pk=workflow.pk).exists()
    assert AttendanceRecord.objects.filter(pk=corrected.pk).exists()
