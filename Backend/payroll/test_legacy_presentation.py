import json
from decimal import Decimal
from pathlib import Path

import pytest
from django.contrib.auth import get_user_model

from . import dto
from .models import PayrollRun, PayrollRunItem, Payslip
from .test_phase2 import create
from .test_phase2 import ctx as ctx

pytestmark = pytest.mark.django_db


@pytest.fixture
def legacy_run(ctx):
    run = PayrollRun.objects.create(
        company=ctx.company,
        year=2026,
        month=8,
        status="COMPLETED",
        legacy_calculation=True,
        total_net="57239.00",
        total_employees=52,
        total_gross="0.00",
    )
    items = PayrollRunItem.objects.bulk_create(
        [
            PayrollRunItem(
                payroll_run=run,
                company=ctx.company,
                employee_id=f"LEGACY-{index:03d}",
                employee_name=f"Legacy employee {index}",
                basic_salary="1000.25",
                total_allowances="200.50",
                total_deductions="100.00",
                net_salary="1100.75",
            )
            for index in range(52)
        ]
    )
    users = get_user_model().objects.bulk_create(
        [get_user_model()(email=f"legacy-{index}@test.com") for index in range(33)]
    )
    Payslip.objects.bulk_create(
        [
            Payslip(
                payroll_run=run,
                payroll_run_item=item,
                company=ctx.company,
                employee=user,
                year=run.year,
                month=run.month,
                status=run.status,
                basic_salary="1000.25",
                accommodation_allowance="200.50",
                total_salary="1200.75",
                total_deductions="100.00",
                net_salary="1100.75",
            )
            for item, user in zip(items, users, strict=False)
        ]
    )
    run.refresh_from_db()
    return run


@pytest.mark.parametrize("status", ["COMPLETED", "PAID"])
def test_production_shaped_legacy_dtos_derive_unknown_totals_without_writes(ctx, legacy_run, status):
    run = legacy_run
    run.status = status
    run.save(update_fields=["status"])
    run.payslips.update(status=status)
    stored_run = PayrollRun.objects.filter(pk=run.pk).values().get()
    stored_items = list(run.items.values())
    stored_slips = list(run.payslips.values())

    def get(suffix=""):
        response = ctx.client.get(f"/payroll-runs/{run.pk}/{suffix}", **ctx.headers)
        assert response.status_code == 200, response.data
        return response.data["data"]

    detail, summary, validation = get(), get("summary/"), get("validation-report/")
    examples = json.loads(Path(__file__).with_name("contract_examples.json").read_text(encoding="utf-8"))
    for name, actual in (("run", detail), ("summary", summary), ("validation", validation)):
        assert set(actual) == set(examples["legacy_presentation"][name])
    listing = ctx.client.get("/payroll-runs/", **ctx.headers).data["data"]["items"]
    listed = next(row for row in listing if row["id"] == run.pk)
    for result in (detail, listed, summary):
        assert result["total_gross_salary" if result is summary else "total_gross"] == "62439.00"
        assert result["total_additions"] is None
        assert result["total_provisions"] is None
        assert result["total_company_cost"] is None
        assert result["cost_incomplete"] is True
    assert detail["total_net"] == summary["total_net_salary"] == "57239.00"
    assert summary["total_basic_salary"] == "52013.00"
    assert summary["total_allowances"] == "10426.00"
    assert validation["reconciliation"] == {
        "total_net": "57239.00",
        "items_net": "57239.00",
        "payslips_net": "36324.75",
        "item_count": 52,
        "payslip_count": 33,
        "matches": True,
    }
    assert summary["reconciliation"]["matches"] is True
    assert validation["finalize_state"] == "finalized"
    assert validation["can_finalize"] is True
    assert validation["errors"] == validation["infos"] == []
    assert "payroll_reconciliation_failed" not in {issue["code"] for issue in validation["warnings"]}
    assert PayrollRun.objects.filter(pk=run.pk).values().get() == stored_run
    assert list(run.items.values()) == stored_items
    assert list(run.payslips.values()) == stored_slips


def test_legacy_payslip_money_is_informational_but_nonlegacy_reconciliation_stays_strict(legacy_run):
    legacy_run.payslips.update(net_salary="1.00")
    assert dto.reconciliation(legacy_run)["matches"] is True
    assert dto.reconciliation(legacy_run)["payslips_net"] == "33.00"
    legacy_run.legacy_calculation = False
    assert dto.reconciliation(legacy_run)["matches"] is False


@pytest.mark.parametrize("field,value", [("total_net", Decimal("57238.00")), ("total_employees", 51)])
def test_legacy_reconciliation_still_checks_active_net_and_item_count(legacy_run, field, value):
    setattr(legacy_run, field, value)
    report = dto.validation(legacy_run)
    assert report["reconciliation"]["matches"] is False
    assert report["errors"] == [] and report["counts"]["errors"] == 0
    assert [issue["code"] for issue in report["infos"]] == ["payroll_reconciliation_failed"]
    assert report["infos"][0]["severity"] == "info"
    assert report["can_finalize"] is True and report["finalize_state"] == "finalized"


def test_legacy_read_derivations_exclude_inactive_items_and_slips(legacy_run):
    PayrollRunItem.objects.create(
        payroll_run=legacy_run,
        employee_id="INACTIVE",
        employee_name="Inactive employee",
        basic_salary="9000.00",
        total_allowances="500.00",
        net_salary="9500.00",
        is_active=False,
    )
    Payslip.objects.create(
        payroll_run=legacy_run,
        year=legacy_run.year,
        month=legacy_run.month,
        net_salary="9500.00",
        is_active=False,
    )
    assert dto.run_dto(legacy_run)["total_gross"] == dto.summary(legacy_run)["total_gross_salary"] == "62439.00"
    assert dto.reconciliation(legacy_run)["matches"] is True
    assert dto.reconciliation(legacy_run)["item_count"] == 52
    assert dto.reconciliation(legacy_run)["payslip_count"] == 33


@pytest.mark.parametrize("status", ["DRAFT", "COMPLETED", "PAID"])
def test_validation_finalized_blockers_are_visible_as_info_and_draft_blockers_stay_errors(ctx, status):
    run = create(ctx)
    run.status = status
    run.validation_snapshot = {
        "issues": [
            {
                "code": code,
                "severity": severity,
                "message_key": f"payroll.validation.{code}",
                "employee_profile_id": ctx.profile.pk,
                "params": {},
            }
            for code, severity in (("missing_hire_date", "error"), ("overtime_limit_not_set", "warning"))
        ]
    }
    run.save(update_fields=["status", "validation_snapshot"])
    before = run.validation_snapshot.copy()
    report = dto.validation(run)
    finalized = status != "DRAFT"
    assert report["can_finalize"] is finalized
    assert report["finalize_state"] == ("finalized" if finalized else "not_finalized")
    assert report["counts"] == {"errors": 0 if finalized else 1, "warnings": 1}
    issues = report["infos"] if finalized else report["errors"]
    assert [issue["code"] for issue in issues] == ["missing_hire_date"]
    assert issues[0]["severity"] == ("info" if finalized else "error")
    assert [issue["code"] for issue in report["warnings"]] == ["overtime_limit_not_set"]
    path = f"/payroll-runs/{run.pk}/validation-report/"
    response = ctx.client.get(path, {"severity": "info", "code": "missing_hire_date"}, **ctx.headers)
    assert response.status_code == 200, response.data
    filtered = response.data["data"]
    assert filtered["infos"] == (issues if finalized else [])
    assert filtered["warnings"] == filtered["errors"] == []
    assert filtered["counts"] == report["counts"]
    assert filtered["can_finalize"] is finalized
    response = ctx.client.get(path, {"severity": "info", "employee_profile_id": ctx.profile.pk + 1}, **ctx.headers)
    assert response.data["data"]["infos"] == []
    response = ctx.client.get(path, {"severity": "warning"}, **ctx.headers)
    assert response.data["data"]["infos"] == []
    assert response.data["data"]["warnings"] == report["warnings"]
    run.refresh_from_db()
    assert run.validation_snapshot == before
