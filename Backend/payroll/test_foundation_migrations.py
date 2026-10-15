from datetime import date
from decimal import Decimal

import pytest
from audit.models import AuditLog
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from employees.models import EmployeeProfile
from organization.models import OrganizationNode


@pytest.mark.django_db(transaction=True)
def test_legacy_backfill_keeps_historical_halala_and_money():
    executor = MigrationExecutor(connection)
    leaves = executor.loader.graph.leaf_nodes()
    # Other migration probes may leave a non-payroll app rolled back. Normalize
    # before the backwards-only payroll plan; never mix directions in one call.
    executor.migrate(leaves)
    executor = MigrationExecutor(connection)
    before = [n for n in leaves if n[0] != "payroll"] + [("payroll", "0006_attendancepayrolldeduction_claim_state")]
    executor.migrate(before)
    try:
        apps = executor.loader.project_state(before).apps
        Run, Item, Slip = [apps.get_model("payroll", name) for name in ("PayrollRun", "PayrollRunItem", "Payslip")]
        from django.contrib.auth import get_user_model

        company = OrganizationNode.objects.create(code="BACKFILL_A", name="Backfill A", node_type="company")
        user = get_user_model().objects.create_user(email="backfill@test.com", password="password")
        profile = EmployeeProfile.objects.create(
            company=company, user=user, employee_id="BACKFILL_1", hire_date=date(2020, 1, 1)
        )
        run = Run.objects.create(company_id=company.pk, year=2026, month=6, status="COMPLETED")
        item = Item.objects.create(
            payroll_run_id=run.pk,
            employee_id=profile.employee_id,
            employee_name="Historic",
            basic_salary=1000,
            total_allowances=0,
            total_deductions=Decimal("433.50"),
            net_salary=Decimal("566.50"),
        )
        slip = Slip.objects.create(
            payroll_run_id=run.pk,
            employee_id=user.pk,
            year=2026,
            month=6,
            basic_salary=1000,
            total_salary=1000,
            total_deductions=Decimal("433.50"),
            net_salary=Decimal("566.50"),
            status="PAID",
        )
        unknown = Item.objects.create(
            payroll_run_id=run.pk,
            employee_id="NO_SUCH_PROFILE",
            employee_name="Unresolved",
            basic_salary=500,
            net_salary=500,
        )
        cancelled = Run.objects.create(company_id=company.pk, year=2026, month=7, status="CANCELLED")
        zero_item = Item.objects.create(
            payroll_run_id=cancelled.pk, employee_id=profile.employee_id, basic_salary=1000, net_salary=1000
        )
        zero_slip = Slip.objects.create(
            payroll_run_id=cancelled.pk,
            employee_id=user.pk,
            year=2026,
            month=7,
            basic_salary=1000,
            total_salary=1000,
            total_deductions=0,
            net_salary=1000,
        )
        ambiguous = Run.objects.create(company_id=company.pk, year=2026, month=8)
        duplicate_items = [
            Item.objects.create(payroll_run_id=ambiguous.pk, employee_id=profile.employee_id) for _ in range(2)
        ]
        ambiguous_slip = Slip.objects.create(
            payroll_run_id=ambiguous.pk,
            employee_id=user.pk,
            year=2026,
            month=8,
        )
        executor = MigrationExecutor(connection)
        executor.migrate(leaves)
        state = executor.loader.project_state(leaves).apps
        Slip, Item, Run, Line = [
            state.get_model("payroll", name) for name in ("Payslip", "PayrollRunItem", "PayrollRun", "PayrollLine")
        ]
        current = Slip.objects.get(pk=slip.pk)
        assert current.total_deductions == Decimal("433.50") and current.net_salary == Decimal("566.50")
        assert (
            current.status == "COMPLETED"
            and current.payroll_run_item_id == item.pk
            and current.employee_profile_id == profile.pk
        )
        legacy = Line.objects.get(item_id=item.pk, type="PREVIOUS_TOTAL_DEDUCTIONS")
        assert legacy.amount == Decimal("433.50")
        assert Item.objects.get(pk=unknown.pk).employee_profile_id is None
        migrated = Run.objects.get(pk=run.pk)
        assert migrated.settings_snapshot == {"schema_version": 0, "legacy_unknown": True}
        assert migrated.validation_snapshot["legacy_link_issues"]
        assert AuditLog.objects.filter(
            action="payroll_legacy_backfilled", entity="Payslip", entity_id=str(slip.pk)
        ).exists()
        assert Line.objects.get(item_id=zero_item.pk, type="PREVIOUS_TOTAL_DEDUCTIONS").amount == Decimal("0.00")
        zero_current = Slip.objects.get(pk=zero_slip.pk)
        assert zero_current.status == "CANCELLED" and not zero_current.is_active and zero_current.net_salary == 1000
        assert all(Item.objects.get(pk=entry.pk).employee_profile_id is None for entry in duplicate_items)
        assert Slip.objects.get(pk=ambiguous_slip.pk).payroll_run_item_id is None
        assert Run.objects.get(pk=ambiguous.pk).validation_snapshot["legacy_link_issues"]
    finally:
        MigrationExecutor(connection).migrate(leaves)
