import csv
import importlib
from datetime import date
from decimal import Decimal
from gettext import GNUTranslations
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.db import IntegrityError, connection, transaction
from django.http import Http404
from django.test import RequestFactory
from rest_framework.exceptions import PermissionDenied

from attendance.models import BioTimeEmployeeMap
from attendance.schedule import get_work_schedule, is_rest_day_for_everyone, is_working_day
from audit.models import AuditLog
from employees.models import EmployeeProfile
from organization.models import OrganizationNode, UserOrganizationAccess
from rents.models import Rent, RentType

from .accommodation import end_assignments_for_archive, save_assignment
from .calculator import EmployeeInput, calculate_employee, date_set, default_settings, period_dates
from .configuration import PayrollDomainError, snapshot_run_settings, update_company_settings, update_employee_gosi
from .i18n import AR, EN, enum_directory
from .models import (
    AccommodationAssignment,
    PayrollAdjustment,
    PayrollCarryForward,
    PayrollLine,
    PayrollRun,
    PayrollRunItem,
    PayrollSettings,
    Payslip,
)
from .permissions import PAYROLL_MANAGER_ROLES, IsPayrollManager
from .serializers import PayslipDetailSerializer
from .settings_serializers import PayrollSettingsSerializer, SettingsUpdateSerializer


@pytest.fixture
def context(db):
    company = OrganizationNode.objects.create(code="PHASE1_A", name="Phase1 A", node_type="company")
    other = OrganizationNode.objects.create(code="PHASE1_B", name="Phase1 B", node_type="company")
    user = get_user_model().objects.create_user(email="phase1-hr@test.com", password="password")
    user.groups.add(Group.objects.get_or_create(name="HRManager")[0])
    UserOrganizationAccess.objects.create(user=user, organization=company)
    request = RequestFactory().patch("/payroll-settings/", HTTP_X_ACTIVE_COMPANY_ID=str(company.pk))
    request.user = user
    profile = EmployeeProfile.objects.create(company=company, employee_id="PHASE1_001", hire_date=date(2024, 1, 1))
    return SimpleNamespace(company=company, other=other, user=user, request=request, profile=profile)


def update(ctx, **changes):
    return update_company_settings(ctx.request, {"expected_revision": 0, "reason": "Policy selected", **changes})


def test_settings_defaults_configuration_and_audit(context):
    setting = update(context, provision_proration="PRORATED_BY_DAYS", require_manual_absence_confirmation=True)
    assert setting.revision == 1 and setting.provision_proration == "PRORATED_BY_DAYS"
    event = AuditLog.objects.get(action="payroll_settings_updated")
    assert event.actor == context.user and event.metadata["original_value"] is None
    assert event.metadata["new_value"]["require_manual_absence_confirmation"] is True
    history = PayrollAdjustment.objects.get(audit_log=event)
    assert history.type == "SETTINGS_CHANGE" and history.reason == "Policy selected"
    rendered = PayrollSettingsSerializer(setting).data
    assert rendered["foreign_gosi_rate"] == "0.020000" and rendered["monthly_foreign_id_cost"] == "862.50"
    assert rendered["normal_overtime_limit_period"] == "PAYROLL_WINDOW"
    assert {row["key"] for row in rendered["assumptions"]} == {
        "payroll.assumption.overtime_basic",
        "payroll.assumption.overtime_calendar_month",
    }


def test_default_full_month_is_configurable_and_frozen(context):
    settings = update(context)
    assert settings.provision_proration == "FULL_MONTH" and not settings.require_manual_absence_confirmation
    run = PayrollRun.objects.create(company=context.company, year=2026, month=6)
    original = snapshot_run_settings(context.request, run.pk, reason="Draft created")
    update_company_settings(
        context.request,
        {"expected_revision": 1, "reason": "Proration selected", "provision_proration": "PRORATED_BY_DAYS"},
    )
    assert snapshot_run_settings(context.request, run.pk) == original
    original["provision_proration"] = "corrupted local dict"
    run.refresh_from_db()
    assert run.settings_snapshot["provision_proration"] == "FULL_MONTH"
    refreshed = snapshot_run_settings(context.request, run.pk, refresh=True, reason="HR requested refresh")
    assert refreshed["provision_proration"] == "PRORATED_BY_DAYS"
    run.status = "COMPLETED"
    run.save(update_fields=["status"])
    with pytest.raises(PayrollDomainError) as exc:
        snapshot_run_settings(context.request, run.pk, refresh=True, reason="Not allowed")
    assert exc.value.status_code == 422


def test_revision_noop_and_audit_failure_rollback(context):
    setting = update(context)
    count = AuditLog.objects.count()
    update_company_settings(
        context.request, {"expected_revision": 1, "reason": "No change", "provision_proration": "FULL_MONTH"}
    )
    assert AuditLog.objects.count() == count
    with pytest.raises(PayrollDomainError) as exc:
        update_company_settings(
            context.request, {"expected_revision": 0, "reason": "Stale", "no_medical_insurance": True}
        )
    assert exc.value.status_code == 409
    assert exc.value.payload["errors"][0]["params"] == {"expected_revision": 0, "current_revision": 1}
    with patch("payroll.configuration.audit", side_effect=RuntimeError("Audit failed")):
        with pytest.raises(RuntimeError):
            update_company_settings(
                context.request, {"expected_revision": 1, "reason": "Must roll back", "no_medical_insurance": True}
            )
    setting.refresh_from_db()
    assert not setting.no_medical_insurance and setting.revision == 1


def test_adjustment_history_is_immutable(context):
    update(context)
    history = PayrollAdjustment.objects.get()
    history.reason = "Rewrite"
    with pytest.raises(ValidationError):
        history.save()
    with pytest.raises(ValidationError):
        history.delete()


@pytest.mark.parametrize(
    "changes",
    [
        {"foreign_gosi_rate": 2},
        {"foreign_gosi_rate": "2.0"},
        {"annual_air_ticket": 1500.0},
        {"annual_air_ticket": "NaN"},
        {"annual_air_ticket": "1e3"},
        {"day_basis": 31},
        {"provision_proration": "DAYS"},
        {"require_manual_absence_confirmation": "yes"},
        {"absence_base": {"type": "FIXED_AMOUNT", "fixed_amount": None}},
        {"absence_base": {"type": "BASIC", "fixed_amount": "10.00"}},
    ],
)
def test_settings_reject_invalid_inputs(changes):
    serializer = SettingsUpdateSerializer(data={"expected_revision": 1, "reason": "Test", **changes})
    assert not serializer.is_valid()


def test_settings_company_scoping_and_employee_gosi_audit(context):
    other_profile = EmployeeProfile.objects.create(company=context.other, employee_id="PHASE1_FOREIGN")
    with pytest.raises(Http404):
        update_employee_gosi(
            context.request,
            other_profile.pk,
            {"expected_revision": 0, "reason": "Forbidden", "deduct_gosi_from_employee": True},
        )
    profile = update_employee_gosi(
        context.request,
        context.profile.pk,
        {"expected_revision": 0, "reason": "Bearing arrangement", "deduct_gosi_from_employee": True},
    )
    assert profile.deduct_gosi_from_employee and profile.payroll_config_revision == 1
    event = AuditLog.objects.get(action="payroll_employee_gosi_updated")
    assert event.metadata["original_value"] == {"deduct_gosi_from_employee": False}
    assert event.metadata["new_value"] == {"deduct_gosi_from_employee": True}
    assert PayrollAdjustment.objects.get(audit_log=event).type == "EMPLOYEE_GOSI_CHANGE"
    request = RequestFactory().patch("/payroll-settings/", HTTP_X_ACTIVE_COMPANY_ID=str(context.other.pk))
    request.user = context.user
    with pytest.raises(PermissionDenied):
        update_company_settings(request, {"expected_revision": 0, "reason": "Spoofed company"})


@pytest.mark.parametrize(
    "role,allowed",
    [
        ("HRManager", True),
        ("SystemAdmin", True),
        ("CFO", True),
        ("CEO", False),
        ("Manager", False),
        ("Employee", False),
    ],
)
def test_payroll_role_gate_isolated_in_one_place(context, role, allowed):
    context.user.groups.clear()
    context.user.groups.add(Group.objects.get_or_create(name=role)[0])
    assert IsPayrollManager().has_permission(context.request, None) == allowed
    assert PAYROLL_MANAGER_ROLES == frozenset({"SystemAdmin", "HRManager", "CFO"})


def test_employee_role_cannot_change_settings(context):
    context.user.groups.clear()
    with pytest.raises(PermissionDenied):
        update(context)
    assert not PayrollSettings.objects.exists()


def assignment(context, start=date(2026, 6, 1), end=date(2026, 6, 15), **kwargs):
    return save_assignment(
        context.request,
        employee_profile_id=context.profile.pk,
        status="none",
        start_date=start,
        end_date=end,
        reason="Housing decision",
        **kwargs,
    )


def test_assignment_overlap_through_service_path(context):
    first = assignment(context)
    with pytest.raises(PayrollDomainError) as exc:
        assignment(context, start=date(2026, 6, 15), end=date(2026, 6, 30))
    assert exc.value.status_code == 409 and exc.value.get_codes()["errors"][0]["code"] == "assignment_overlap"
    second = assignment(context, start=date(2026, 6, 16), end=date(2026, 6, 30))
    with pytest.raises(PayrollDomainError):
        assignment(context, start=date(2026, 6, 10), end=date(2026, 6, 30), assignment_id=second.pk)
    assert AccommodationAssignment.objects.count() == 2
    assert AuditLog.objects.filter(action="payroll_accommodation_assignment_created").count() == 2
    assert first.company_id == context.company.pk


def test_assignment_tenant_date_status_and_archive(context):
    typ = RentType.objects.create(company=context.other, code="HOUSE", name_en="Housing")
    rent = Rent.objects.create(
        company=context.other,
        rent_type=typ,
        property_name_en="Other residence",
        recurrence="ONE_TIME",
        one_time_due_date=date(2026, 6, 1),
    )
    with pytest.raises(Http404):
        assignment(context, rent_id=rent.pk)
    with pytest.raises(PayrollDomainError):
        assignment(context, start=date(2026, 6, 20), end=date(2026, 6, 10))
    obj = assignment(context, end=date(2026, 6, 30))
    with pytest.raises(PayrollDomainError):
        end_assignments_for_archive(context.request, context.profile.pk, date(2026, 6, 10), reason=" ")
    end_assignments_for_archive(context.request, context.profile.pk, date(2026, 6, 10), reason="Archive date confirmed")
    obj.refresh_from_db()
    assert obj.end_date == date(2026, 6, 10)
    assert AuditLog.objects.filter(action="payroll_accommodation_assignment_ended").exists()


def test_replacement_constraint_and_draft_payslip_default(context):
    old = PayrollRun.objects.create(company=context.company, year=2026, month=6, status="CANCELLED")
    new = PayrollRun.objects.create(company=context.company, year=2026, month=6)
    with transaction.atomic():
        with pytest.raises(IntegrityError):
            PayrollRun.objects.create(company=context.company, year=2026, month=6)
        transaction.set_rollback(True)
    slip = Payslip.objects.create(
        payroll_run=new, year=2026, month=6, employee=None, employee_profile=context.profile, company=context.company
    )
    assert slip.status == "DRAFT" and old.pk != new.pk


def test_model_relationship_validation_and_no_duplicate_carry(context):
    run = PayrollRun.objects.create(company=context.company, year=2026, month=6)
    item = PayrollRunItem.objects.create(
        payroll_run=run,
        company=context.company,
        employee_profile=context.profile,
        employee_id=context.profile.employee_id,
        employee_name="Employee",
    )
    carry = PayrollCarryForward(
        company=context.other,
        employee_profile=context.profile,
        origin_run=run,
        source_key="absence:1",
        type="ABSENCE",
        original_authorized_amount=100,
        remaining_amount=100,
        source_year=2026,
        source_month=6,
    )
    with pytest.raises(ValidationError):
        carry.full_clean()
    carry.company = context.company
    carry.full_clean()
    carry.save()
    with transaction.atomic():
        with pytest.raises(IntegrityError):
            PayrollCarryForward.objects.bulk_create(
                [
                    PayrollCarryForward(
                        company=context.company,
                        employee_profile=context.profile,
                        origin_run=run,
                        source_key="absence:1",
                        type="ABSENCE",
                        original_authorized_amount=100,
                        remaining_amount=100,
                        source_year=2026,
                        source_month=6,
                    )
                ]
            )
        transaction.set_rollback(True)
    line = PayrollLine(
        company=context.other,
        item=item,
        category="PROVISION",
        type="MEDICAL",
        source_key="medical",
        source_kind="company_settings",
        amount=None,
    )
    with pytest.raises(ValidationError):
        line.full_clean()


def test_employee_serializer_has_no_company_cost_provision_keys(context):
    run = PayrollRun.objects.create(company=context.company, year=2026, month=6)
    slip = Payslip.objects.create(
        payroll_run=run, company=context.company, employee_profile=context.profile, year=2026, month=6, net_salary=1000
    )
    data = PayslipDetailSerializer(slip).data
    assert not set(data) & {
        "company_id",
        "settings_snapshot",
        "total_provisions",
        "total_company_cost",
        "cost_incomplete",
        "gosi_company_provision",
    }


def test_catalog_parity_and_all_45_validation_keys():
    assert set(EN) == set(AR) and len(EN) == 251
    removed = "payroll.assumption.provision_proration_pending"
    assert removed not in EN
    for language, messages in (("en", EN), ("ar", AR)):
        folder = Path(__file__).with_name("locale") / language / "LC_MESSAGES"
        assert removed not in folder.joinpath("django.po").read_text(encoding="utf-8")
        with folder.joinpath("django.mo").open("rb") as stream:
            catalog = GNUTranslations(stream)
        assert {key: value for key, value in catalog._catalog.items() if key} == messages
    directory = enum_directory("ar")
    assert len(directory["validation_codes"]) == 45
    assert all(c["label"] == AR[c["label_key"]] for entries in directory.values() for c in entries)
    assert "payroll.validation.overtime_eligibility_unknown" not in EN


def test_vendor_guard_forward_reverse_without_postgres():
    migration = importlib.import_module("payroll.migrations.0009_accommodation_exclusion")
    editor = Mock(connection=SimpleNamespace(vendor="sqlite"))
    migration.add_exclusion(None, editor)
    migration.remove_exclusion(None, editor)
    editor.execute.assert_not_called()
    editor.connection.vendor = "postgresql"
    migration.add_exclusion(None, editor)
    migration.remove_exclusion(None, editor)
    assert editor.execute.call_count == 3


@pytest.mark.django_db
def test_real_postgres_exclusion_rejects_direct_overlap(context):
    if connection.vendor != "postgresql":
        pytest.skip("PostgreSQL exclusion DDL only; SQLite overlap is tested through service")
    assignment(context)
    with transaction.atomic():
        with pytest.raises(IntegrityError):
            AccommodationAssignment.objects.create(
                company=context.company,
                employee_profile=context.profile,
                status="unknown",
                start_date=date(2026, 6, 10),
                end_date=date(2026, 6, 30),
                created_by=context.user,
                updated_by=context.user,
            )
        transaction.set_rollback(True)


def test_global_schedule_helpers_supply_authoritative_evidence(context):
    schedule = get_work_schedule()
    assert schedule.start_time is not None
    days = date_set(*period_dates(2026, 6))
    due = frozenset(d for d in days if not is_rest_day_for_everyone(d) and is_working_day(context.profile, d))
    assert all(d.weekday() != 4 for d in due)
    result = calculate_employee(
        EmployeeInput(
            context.profile.pk,
            2026,
            6,
            {"basic_salary": Decimal(1000)},
            hire_date=date(2024, 1, 1),
            absent_dates=due,
            due_work_dates=due,
            attendance_source_available=True,
        ),
        default_settings(),
    )
    assert result["absence"]["full_month_absence"]


def test_pre_go_live_report_dates_overtime_and_mapping(context, tmp_path):
    context.profile.allowed_overtime = 1
    context.profile.save(update_fields=["allowed_overtime"])
    partial = EmployeeProfile.objects.create(
        company=context.company, employee_id="PHASE1_PARTIAL", hire_date=date(2024, 1, 1)
    )
    mapped = EmployeeProfile.objects.create(
        company=context.company, employee_id="PHASE1_MAPPED", hire_date=date(2024, 1, 1)
    )
    BioTimeEmployeeMap.objects.create(
        employee_profile=partial, biotime_emp_code="P1PART", attendance_start_date=date(2026, 6, 16)
    )
    BioTimeEmployeeMap.objects.create(
        employee_profile=mapped, biotime_emp_code="P1FULL", attendance_start_date=date(2026, 6, 1)
    )
    EmployeeProfile.objects.create(company=context.company, employee_id="PHASE1_ARCHIVE", is_archived=True)
    EmployeeProfile.objects.create(company=context.company, employee_id="PHASE1_TERM", employment_status="TERMINATED")
    output = tmp_path / "private-payroll-audit.csv"
    stdout = StringIO()
    call_command("report_archived_payroll_dates", output=str(output), year=2026, month=6, stdout=stdout)
    rows = list(csv.DictReader(output.open(encoding="utf-8-sig")))
    issues = {row["issue_code"] for row in rows}
    assert {
        "archived_without_date",
        "terminated_without_end_date",
        "allowed_overtime_import_review",
        "attendance_source_unavailable",
    } <= issues
    assert "unmapped=1 partial=1" in stdout.getvalue() and "PHASE1" not in stdout.getvalue()
