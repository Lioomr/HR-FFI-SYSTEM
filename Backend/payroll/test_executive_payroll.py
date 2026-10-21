from datetime import date, datetime
from decimal import Decimal

import pytest
from django.contrib.auth.models import Group
from django.utils import timezone

from attendance.models import AttendanceDailyResult, AttendanceLateViolation, AttendanceRecord
from audit.models import AuditLog
from employees.models import EmployeeProfile
from leaves.models import LeaveRequest, LeaveType
from rents.models import Rent, RentType

from . import dto, engine
from .models import AccommodationAssignment, AttendancePayrollDeduction, PayrollAdjustment
from .test_phase2 import create, edit, finalize, penalty
from .test_phase2 import ctx as ctx

pytestmark = pytest.mark.django_db


def mark_executive(ctx, title="General Manager"):
    if title == "CEO_GROUP":
        ctx.employee.groups.add(Group.objects.get_or_create(name="CEO")[0])
    else:
        ctx.profile.job_title = title
        ctx.profile.save(update_fields=["job_title"])


@pytest.mark.parametrize(
    "title,exempt",
    [
        ("CEO_GROUP", True),
        ("General Manager", True),
        ("Chief Executive Officer", True),
        ("المدير العام", True),
        ("Assistant General Manager", False),
    ],
)
def test_executive_classifier_counts_money_and_frozen_hr_only_flag(ctx, title, exempt):
    ctx.profile.biotime_mapping.all().delete()
    ctx.profile.payroll_accommodation_assignments.all().delete()
    ctx.profile.allowed_overtime = None
    ctx.profile.save(update_fields=["allowed_overtime"])
    ctx.settings.require_manual_absence_confirmation = True
    ctx.settings.save()
    run = create(ctx)
    ordinary = edit(ctx, run, {"overtime_normal_hours": "4.00"})
    run.refresh_from_db()
    assert dto.validation(run)["counts"] == {"errors": 1, "warnings": 3}
    mark_executive(ctx, title)
    engine.recalculate(run, request=ctx.request, reason="Refresh employment classification", advance_revision=True)
    run.refresh_from_db()
    item = run.items.get()
    value = dto.item_dto(item)
    assert value["executive_exempt"] is exempt and item.input_snapshot["source"]["executive_exempt"] is exempt
    assert (value["net_salary"], value["total_company_cost"]) == (
        ordinary["net_salary"],
        ordinary["total_company_cost"],
    )
    assert value["absence"]["manual_confirmation_required"] is (not exempt)
    assert not value["absence"]["source_available"]
    report = dto.validation(run)
    expected = {"errors": 0, "warnings": 0} if exempt else {"errors": 1, "warnings": 3}
    assert report["counts"] == expected and report["can_finalize"] is exempt
    assert dto.run_dto(run)["validation_counts"] == expected
    assert dto.summary(run)["validation_counts"] == expected
    assert (not any(row["severity"] == "error" for row in run.validation_snapshot["issues"])) is exempt
    assert dto.reconciliation(run)["matches"]
    if not exempt:
        assert "attendance_source_unavailable" in {row["code"] for row in report["errors"]}
        return
    assert value["warnings"] == [] and value["accommodation_status"] == "none"
    assert value["accommodation_cost"] == "0.00" and not value["cost_incomplete"]
    assert value["overtime"]["payable_normal_hours"] == "4.00"
    assert PayrollAdjustment.objects.filter(run=run, type="EMPLOYMENT_INPUT_CHANGE").exists()
    finalize(ctx, run)
    ctx.profile.job_title = "Engineer"
    ctx.profile.job_title_en = "Engineer"
    ctx.profile.save(update_fields=["job_title", "job_title_en"])
    ctx.employee.groups.remove(Group.objects.get_or_create(name="CEO")[0])
    item.refresh_from_db()
    assert dto.item_dto(item)["executive_exempt"] is True
    ctx.client.force_authenticate(ctx.employee)
    response = ctx.client.get(f"/employee/payslips/{run.payslips.get().pk}/", **ctx.headers)
    assert response.status_code == 200 and "executive_exempt" not in response.data["data"]


def test_executive_absent_records_are_ignored_unpaid_leave_and_manual_override_remain(ctx):
    AttendanceRecord.objects.bulk_create(
        [
            AttendanceRecord(employee_profile=ctx.profile, date=date(2026, 9, day), status="ABSENT")
            for day in range(1, 31)
        ]
    )
    unpaid = LeaveType.objects.create(company=ctx.company, name="Unpaid", code="EXEC_UP", is_paid=False)
    LeaveRequest.objects.create(
        company=ctx.company,
        employee_profile=ctx.profile,
        leave_type=unpaid,
        start_date=date(2026, 9, 2),
        end_date=date(2026, 9, 3),
        status="approved",
    )
    mark_executive(ctx)
    ctx.profile.biotime_mapping.all().delete()
    ctx.settings.require_manual_absence_confirmation = True
    ctx.settings.save()
    run = create(ctx)
    value = dto.item_dto(run.items.get())
    assert value["absence"]["attendance_days"] == "0.00" and value["absence"]["unpaid_leave_days"] == "2.00"
    assert value["absence_deduction"] == "733.00" and value["net_salary"] == "10267.00"
    assert not value["absence"]["full_month_absence"] and value["warnings"] == []
    assert len(run.items.get().input_snapshot["source"]["absent_dates"]) == 30
    value = edit(ctx, run, {"absence_days_override": "3.00"})
    assert value["absence_deduction"] == "1100.00" and value["absence"]["manual_confirmed"]
    assert not value["absence"]["manual_confirmation_required"]
    assert PayrollAdjustment.objects.filter(run=run, type="ABSENCE_OVERRIDE").exists()
    run.refresh_from_db()
    assert dto.validation(run)["can_finalize"]


def test_accountless_general_manager_is_exempt_without_mapping_or_assignment(ctx):
    profile = EmployeeProfile.objects.create(
        company=ctx.company,
        employee_id="EXEC_ACCOUNTLESS",
        job_title="General Manager",
        hire_date=date(2024, 1, 1),
        basic_salary="6000.00",
        accommodation_allowance="3000.00",
        transportation_allowance="1500.00",
        telephone_allowance="500.00",
        total_salary="11000.00",
    )
    ctx.settings.require_manual_absence_confirmation = True
    ctx.settings.save()
    run = create(ctx)
    item = run.items.get(employee_profile=profile)
    value = dto.item_dto(item)
    assert value["executive_exempt"] is True and value["has_user_account"] is False
    assert value["warnings"] == [] and value["accommodation_status"] == "none"
    assert value["absence"]["manual_confirmation_required"] is False
    assert run.payslips.get(employee_profile=profile).employee_id is None
    assert dto.validation(run)["counts"] == {"errors": 0, "warnings": 0} and dto.validation(run)["can_finalize"]


@pytest.mark.parametrize("status", ["assigned", "unknown"])
def test_executive_existing_accommodation_assignment_follows_normal_rules(ctx, status):
    ctx.profile.payroll_accommodation_assignments.all().delete()
    rent = None
    if status == "assigned":
        rent_type = RentType.objects.create(company=ctx.company, code="EXEC_HOME", name_en="Housing")
        rent = Rent.objects.create(
            company=ctx.company,
            rent_type=rent_type,
            property_name_en="Executive residence",
            annual_rent_value="12000.00",
            recurrence="MONTHLY",
            amount="1000.00",
            start_date=date(2026, 1, 1),
            due_day=1,
        )
    AccommodationAssignment.objects.create(
        company=ctx.company,
        employee_profile=ctx.profile,
        status=status,
        rent=rent,
        start_date=date(2026, 9, 1),
        end_date=date(2026, 9, 30),
    )
    mark_executive(ctx)
    run = create(ctx)
    value = dto.item_dto(run.items.get())
    assert value["accommodation_status"] == status
    assert run.items.get().input_snapshot["source"]["accommodation_assignment_present"] is True
    if status == "assigned":
        assert value["accommodation_cost"] == "1000.00" and not value["cost_incomplete"]
        assert value["warnings"] == [] and dto.reconciliation(run)["matches"]
    else:
        assert value["accommodation_cost"] is None and value["cost_incomplete"]
        assert "accommodation_unknown" in {row["code"] for row in value["warnings"]}


def test_executive_missing_hire_date_remains_blocking_and_flag_is_readonly(ctx):
    mark_executive(ctx)
    ctx.profile.hire_date = None
    ctx.profile.save(update_fields=["hire_date"])
    ctx.profile.biotime_mapping.all().delete()
    ctx.settings.require_manual_absence_confirmation = True
    ctx.settings.save()
    run = create(ctx)
    report = dto.validation(run)
    assert report["counts"] == {"errors": 1, "warnings": 0} and not report["can_finalize"]
    assert report["errors"][0]["code"] == "missing_hire_date"
    finalize(ctx, run, 422)
    run.refresh_from_db()
    response = ctx.client.patch(
        f"/payroll-runs/{run.pk}/items/{run.items.get().pk}/",
        {
            "expected_revision": run.revision,
            "changes": {"executive_exempt": False},
            "reason": "Client cannot set classification",
        },
        format="json",
        **ctx.headers,
    )
    assert response.status_code == 422 and dto.item_dto(run.items.get())["executive_exempt"] is True


@pytest.mark.parametrize("late_amount", [Decimal("25.00"), Decimal("10000.00")])
def test_executive_draft_attendance_fine_released_or_skipped_disciplinary_collects(ctx, late_amount):
    day = date(2026, 9, 1)
    result = AttendanceDailyResult.objects.create(
        employee_profile=ctx.profile,
        company=ctx.company,
        date=day,
        shift_start_at=timezone.make_aware(datetime(2026, 9, 1, 9)),
        shift_end_at=timezone.make_aware(datetime(2026, 9, 1, 18)),
        scheduled_minutes=540,
    )
    violation = AttendanceLateViolation.objects.create(
        employee_profile=ctx.profile,
        company=ctx.company,
        date=day,
        result=result,
        occurrence_number=2,
        daily_rate=Decimal(300),
        penalty_percent=Decimal("0.05"),
        penalty_amount=late_amount,
    )
    late, _ = AttendancePayrollDeduction.objects.update_or_create(
        violation=violation,
        defaults={
            "employee_profile": ctx.profile,
            "company": ctx.company,
            "intended_year": 2026,
            "intended_month": 9,
            "amount": late_amount,
            "status": "pending",
        },
    )
    disciplinary = penalty(ctx, fine="25.00")
    run = create(ctx)
    mark_executive(ctx)
    engine.recalculate(run, request=ctx.request, reason="Executive classification refreshed", advance_revision=True)
    run.refresh_from_db()
    late.refresh_from_db()
    disciplinary.refresh_from_db()
    assert late.status == "pending" and late.payroll_run_id is None and late.claimed_amount == 0
    assert disciplinary.status == "claimed" and disciplinary.claimed_amount == 25
    assert dto.item_dto(run.items.get())["penalty_deduction"] == "25.00"
    assert dto.validation(run)["counts"] == {"errors": 0, "warnings": 0}
    if late_amount == 25:
        assert AuditLog.objects.filter(
            entity="AttendancePayrollDeduction", entity_id=str(late.pk), action__contains="released"
        ).exists()
    finalize(ctx, run)
    disciplinary.refresh_from_db()
    late.refresh_from_db()
    assert disciplinary.status == "applied" and late.status == "pending"


def test_executive_missing_medical_cost_is_not_suppressed(ctx):
    mark_executive(ctx)
    ctx.profile.payroll_accommodation_assignments.all().delete()
    ctx.settings.no_medical_insurance = False
    ctx.settings.save()
    run = create(ctx)
    value = dto.item_dto(run.items.get())
    assert value["accommodation_cost"] == "0.00" and value["medical_provision"] is None and value["cost_incomplete"]
    report = dto.validation(run)
    assert report["counts"] == {"errors": 0, "warnings": 1} and report["can_finalize"]
    assert report["warnings"][0]["code"] == "medical_invoice_missing"
