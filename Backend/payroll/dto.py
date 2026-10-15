"""Explicit HR and employee response whitelists; no model-wide serialization."""

from decimal import Decimal
from fractions import Fraction

from django.db.models import Sum

from .calculator import SALARY_COMPONENTS, period_dates
from .i18n import ENUMS, translated
from .models import PayrollLine, Payslip

ZERO = Decimal(0)
LINE_KEYS = {e["value"]: e["label_key"] for e in ENUMS["line_type"]}
SCALARS = {
    "absence_deduction": "ABSENCE",
    "gosi_employee_deduction": "GOSI_EMPLOYEE",
    "loan_deduction": "LOAN",
    "other_deduction": "OTHER_DEDUCTION",
    "overtime_normal": "OVERTIME_NORMAL",
    "weekly_rest_work": "WEEKLY_REST_WORK",
    "official_holiday_work": "OFFICIAL_HOLIDAY_WORK",
    "bonus": "BONUS",
    "incentive": "INCENTIVE",
    "other_addition": "OTHER_ADDITION",
    "medical_provision": "MEDICAL",
    "id_cost_provision": "ID_COST",
    "air_ticket_provision": "AIR_TICKET",
    "leave_provision": "LEAVE_PROVISION",
    "eos_provision": "EOS_PROVISION",
    "accommodation_cost": "ACCOMMODATION_COST",
    "gosi_company_provision": "GOSI_COMPANY",
}


def amount(value):
    return None if value is None else f"{Decimal(value):.2f}"


def actor(user):
    return {"id": user.pk, "name": user.full_name or user.email} if user else None


def labelled(kind, value):
    key = LINE_KEYS[kind]
    return {"type": kind, "label": translated(key), "label_key": key, "amount": amount(value)}


def issue_dto(issue, run):
    data = {k: v for k, v in issue.items() if k not in ("employee_profile_id", "params")}
    params = issue.get("params", {})
    data["message"] = translated(data["message_key"]).format_map(DefaultParams(params))
    data["params"] = params
    if "field" in params:
        data["field"] = params["field"]
    pk = issue.get("employee_profile_id")
    data["employee"] = None
    if pk:
        from employees.models import EmployeeProfile

        item = run.items.filter(employee_profile_id=pk).first()
        profile = EmployeeProfile.objects.filter(pk=pk, company_id=run.company_id).first()
        data["employee"] = {
            "employee_profile_id": pk,
            "employee_id": item.employee_id if item else profile.employee_id if profile else "",
            "employee_name": item.employee_name if item else profile.full_name if profile else "",
            "item_id": item.pk if item else None,
        }
    return data


class DefaultParams(dict):
    def __missing__(self, key):
        return "{" + key + "}"


def carry_dto(collection):
    by_type = {}
    for row in collection:
        requested, collected, uncollected = (Decimal(row[k]) for k in ("requested", "collected", "uncollected"))
        if requested == 0:
            continue
        totals = by_type.setdefault(
            row["type"],
            {
                "type": row["type"],
                "carried_in": ZERO,
                "requested": ZERO,
                "collected": ZERO,
                "uncollected": ZERO,
                "manual_reentry_required": False,
            },
        )
        totals["carried_in"] += requested if row.get("carried_in") else ZERO
        for key, value in (("requested", requested), ("collected", collected), ("uncollected", uncollected)):
            totals[key] += value
        totals["manual_reentry_required"] |= row.get("manual_reentry_required", False)
    output = {
        k: amount(sum((r[k] for r in by_type.values()), ZERO))
        for k in ("carried_in", "requested", "collected", "uncollected")
    }
    output["by_category"] = [
        {k: amount(v) if isinstance(v, Decimal) else v for k, v in row.items()} for row in by_type.values()
    ]
    return output


def line_dto(line, *, employee=False, compact=False):
    data = labelled(line.type, line.amount)
    if compact:
        return data
    data.update(
        quantity=amount(line.quantity),
        source_period={"year": line.source_year, "month": line.source_month} if line.source_year else None,
    )
    if not employee:
        data.update(
            id=line.pk,
            source_kind=line.source_kind,
            source_id=line.source_id,
            requested_amount=amount(line.requested_amount),
            collected_amount=amount(line.collected_amount),
            uncollected_amount=amount(line.uncollected_amount),
            carried_in=line.carried_in,
        )
    return data


def reconciliation(run):
    items = run.items.filter(is_active=True)
    slips = (
        run.payslips.filter(payroll_run_item__is_active=True)
        if run.status == "CANCELLED"
        else run.payslips.filter(is_active=True)
    )
    item_net = items.aggregate(value=Sum("net_salary"))["value"] or ZERO
    slip_net = slips.aggregate(value=Sum("net_salary"))["value"] or ZERO
    matches = item_net == slip_net == run.total_net and items.count() == slips.count() == run.total_employees
    if not run.legacy_calculation:
        for run_field, item_field in (
            ("total_gross", "gross_salary"),
            ("total_additions", "total_additions"),
            ("total_deductions", "total_deductions"),
            ("total_provisions", "total_provisions"),
            ("total_company_cost", "total_company_cost"),
        ):
            matches &= getattr(run, run_field) == sum((getattr(i, item_field) for i in items), ZERO)
    # Each pair must agree too: equal aggregates cannot hide opposite individual errors.
    for item in items:
        slip = slips.filter(payroll_run_item=item).first()
        if run.legacy_calculation:
            continue
        matches &= bool(
            slip
            and slip.net_salary == item.net_salary
            and slip.total_salary == item.gross_salary
            and slip.total_deductions == item.total_deductions
            and slip.total_additions == item.total_additions
        )
        lines = item.lines.all()
        matches &= item.net_salary == item.gross_salary + item.total_additions - item.total_deductions
        matches &= item.total_company_cost == item.net_salary + item.total_provisions
        for category, expected in (
            ("SALARY", item.gross_salary),
            ("ADDITION", item.total_additions),
            ("DEDUCTION", item.total_deductions),
            ("PROVISION", item.total_provisions),
        ):
            matches &= sum((line.amount or ZERO for line in lines if line.category == category), ZERO) == expected
    if not run.legacy_calculation:
        matches &= all(rent_reconciles(a) for a in run.rent_allocations.all())
    return {
        "total_net": amount(run.total_net),
        "items_net": amount(item_net),
        "payslips_net": amount(slip_net),
        "item_count": items.count(),
        "payslip_count": slips.count(),
        "matches": bool(matches),
    }


def validation(run):
    issues = [issue_dto(i, run) for i in run.validation_snapshot.get("issues", [])]
    check = reconciliation(run)
    if not check["matches"]:
        issues.append(
            issue_dto(
                {
                    "code": "payroll_reconciliation_failed",
                    "severity": "error",
                    "message_key": "payroll.validation.payroll_reconciliation_failed",
                    "params": {},
                },
                run,
            )
        )
    errors, warnings = ([i for i in issues if i["severity"] == level] for level in ("error", "warning"))
    return {
        "run_id": run.pk,
        "revision": run.revision,
        "can_finalize": not errors,
        "errors": errors,
        "warnings": warnings,
        "counts": {"errors": len(errors), "warnings": len(warnings)},
        "employees_checked": run.validation_snapshot.get("employees_checked", run.total_employees),
        "excluded_employees_checked": len(run.validation_snapshot.get("excluded", [])),
        "reconciliation": check,
    }


def run_dto(run):
    first, last = period_dates(run.year, run.month)
    data = {
        k: getattr(run, k)
        for k in (
            "id",
            "year",
            "month",
            "status",
            "total_employees",
            "revision",
            "cost_incomplete",
            "calculator_version",
            "legacy_calculation",
        )
    }
    data.update(
        {
            k: amount(getattr(run, k))
            for k in (
                "total_net",
                "total_gross",
                "total_additions",
                "total_deductions",
                "total_provisions",
                "total_company_cost",
            )
        }
    )
    data.update(
        company_id=run.company_id,
        company_name=run.company.name if run.company_id else None,
        period_start=first.isoformat(),
        period_end=last.isoformat(),
        settings_revision=run.settings_snapshot.get("settings_revision", 0),
        settings_snapshot=run.settings_snapshot,
        cancelled_by=run.cancelled_by_id,
        cancel_reason=run.cancel_reason or None,
        validation_counts=validation(run)["counts"],
    )
    data.update(
        {
            k: getattr(run, k).isoformat() if getattr(run, k) else None
            for k in ("calculated_at", "finalized_at", "paid_at", "cancelled_at")
        }
    )
    return data


def item_dto(item):
    run = item.payroll_run
    snapshot = item.input_snapshot
    result, source, overrides = (snapshot.get(k, {}) for k in ("result", "source", "overrides"))
    monthly_salary = source.get("salary", {})
    lines = list(item.lines.order_by("id"))
    sums = {kind: sum((line.amount or ZERO for line in lines if line.type == kind), ZERO) for kind in LINE_KEYS}
    data = {
        k: getattr(item, k)
        for k in (
            "id",
            "employee_id",
            "employee_name",
            "department",
            "position",
            "cost_incomplete",
            "accommodation_status",
            "zero_salary_reason",
            "zero_salary_reason_detail",
            "suspended_pay_decision",
        )
    }
    slip = Payslip.objects.filter(payroll_run_item=item, is_active=True).first()
    data.update(
        payroll_run_id=run.pk,
        run_revision=run.revision,
        employee_profile_id=item.employee_profile_id,
        has_user_account=bool(source.get("has_user_account", slip.employee_id if slip else False)),
        payslip_id=slip.pk if slip else None,
        hire_date=source.get("hire_date"),
        archive_date=source.get("archive_date"),
        salary_days=amount(result.get("salary_days", 30)),
        employed_calendar_days=result.get("employed_calendar_days", 0),
        full_monthly_gross=amount(result.get("full_monthly_gross", item.basic_salary + item.total_allowances)),
        monthly_salary_components=(
            {name: amount(monthly_salary[name]) for name in SALARY_COMPONENTS}
            if all(name in monthly_salary for name in SALARY_COMPONENTS)
            else None
        ),
        salary_adjusted=bool(overrides.get("salary_components")),
        executive_exempt=source.get("executive_exempt", False),
        manual_inputs={
            "absence_days_override": amount(overrides.get("absence_days_override")),
            **{
                key: amount(overrides.get(key, ZERO))
                for key in (
                    "overtime_normal_hours",
                    "weekly_rest_work_days",
                    "official_holiday_work_days",
                    "bonus",
                    "incentive",
                    "other_addition",
                    "other_deduction",
                )
            },
            "override_overtime_eligibility": overrides.get("override_overtime_eligibility", False),
        },
        deduct_gosi_from_employee=source.get("deduct_gosi_from_employee", False),
    )
    data.update(
        {
            k: amount(getattr(item, k))
            for k in (
                "basic_salary",
                "total_allowances",
                "gross_salary",
                "total_additions",
                "total_deductions",
                "net_salary",
                "total_provisions",
                "total_company_cost",
            )
        }
    )
    for name, kind in SALARY_COMPONENTS.items():
        if name != "basic_salary":
            data[name] = amount(sums[kind])
    for name, kind in SCALARS.items():
        unknown = any(line.type == kind and line.amount is None for line in lines)
        data[name] = None if unknown else amount(sums[kind])
    data["penalty_deduction"] = amount(
        sum((sums[k] for k in ("ATTENDANCE_PENALTY", "PENALTY_FINE", "PENALTY_WAGE_WITHHOLDING")), ZERO)
    )
    for name, category in (
        ("salary_components", "SALARY"),
        ("additions", "ADDITION"),
        ("deductions", "DEDUCTION"),
        ("provisions", "PROVISION"),
    ):
        data[name] = [
            line_dto(line, compact=category in ("SALARY", "PROVISION"))
            for line in lines
            if line.category == category and (category in ("SALARY", "PROVISION") or line.amount)
        ]
    absence = result.get("absence", {})
    collected_wage_ids = {
        row.get("source_id")
        for row in result.get("collection", [])
        if row["type"] == "PENALTY_WAGE_WITHHOLDING" and Decimal(row["collected"]) > 0
    }
    withheld = set(source.get("prior_wage_dates", [])) | {
        d
        for c in source.get("penalties", [])
        if c.get("source_id") in collected_wage_ids
        for d in c.get("wage_dates", [])
    }
    data["absence"] = {
        "attendance_days": amount(0 if source.get("executive_exempt") else len(source.get("absent_dates", []))),
        "unpaid_leave_days": amount(len(source.get("unpaid_leave_dates", []))),
        "paid_leave_days": amount(len(source.get("paid_leave_dates", []))),
        "penalty_withheld_days": amount(len(withheld)),
        "override_days": amount(overrides.get("absence_days_override")),
        "effective_days": amount(absence.get("effective_days", 0)),
        "full_month_absence": absence.get("full_month_absence", False),
        "base_type": run.settings_snapshot.get("absence_base", {}).get("type", "GROSS"),
        "monthly_base": amount(
            _base(source.get("salary", {}), run.settings_snapshot.get("absence_base", {"type": "GROSS"}))
        ),
        "authorized_amount": amount(
            next((line.requested_amount for line in lines if line.source_key == "absence"), ZERO)
        ),
        "capped_amount": amount(
            next(
                (
                    i.get("params", {}).get("amount", 0)
                    for i in result.get("issues", [])
                    if i["code"] == "absence_capped"
                ),
                0,
            )
        ),
        "source_available": absence.get("source_available", False),
        "mapping_start_date": source.get("mapping_start_date"),
        "uncovered_dates": source.get("uncovered_dates", []),
        "manual_confirmed": absence.get("manual_confirmed", False),
        "manual_confirmation_required": bool(
            not source.get("executive_exempt")
            and run.settings_snapshot.get("require_manual_absence_confirmation")
            and not absence.get("source_available")
        ),
    }
    ot = result.get("overtime", {})
    data["overtime"] = {
        k: amount(ot.get(k, 0))
        for k in ("normal_hours", "payable_normal_hours", "over_allowed_hours", "unpaid_normal_hours")
    }
    data["overtime"].update(
        weekly_rest_days=amount(source.get("weekly_rest_work_days", 0)),
        official_holiday_days=amount(source.get("official_holiday_work_days", 0)),
        allowed_overtime=source.get("allowed_overtime"),
        override_overtime_eligibility=overrides.get("override_overtime_eligibility", False),
        limit_period="CALENDAR_MONTH",
    )
    data["carry_forward"] = carry_dto(result.get("collection", []))
    data["warnings"] = [
        issue_dto(i, run)
        for i in result.get("issues", [])
        if i["severity"] == "warning" and i.get("params", {}).get("scope") != "run"
    ]
    data["assumptions"] = [
        {"key": key, "message": translated(key)}
        for key in result.get("assumptions", [])
        if key != "payroll.assumption.provision_proration_pending"
    ]
    return data


def _base(salary, selector):
    names = {
        "BASIC": ["basic_salary"],
        "BASIC_HOUSING": ["basic_salary", "accommodation_allowance"],
        "BASIC_HOUSING_TRANSPORT": ["basic_salary", "accommodation_allowance", "transportation_allowance"],
        "GROSS": SALARY_COMPONENTS,
    }
    return (
        Decimal(selector.get("fixed_amount") or 0)
        if selector["type"] == "FIXED_AMOUNT"
        else sum((Decimal(salary.get(k) or 0) for k in names[selector["type"]]), ZERO)
    )


def employee_dto(slip):
    data = {k: getattr(slip, k) for k in ("id", "year", "month", "payment_mode", "status")}
    data.update(
        {
            k: amount(getattr(slip, k))
            for k in (*SALARY_COMPONENTS, "total_salary", "total_deductions", "net_salary", "total_additions")
        }
    )
    data["gross_salary"] = amount(slip.total_salary)
    data["salary_components"] = [labelled(kind, getattr(slip, key)) for key, kind in SALARY_COMPONENTS.items()]
    lines = list(PayrollLine.objects.filter(item_id=slip.payroll_run_item_id)) if slip.payroll_run_item_id else []
    data["additions"] = [line_dto(line, employee=True) for line in lines if line.category == "ADDITION" and line.amount]
    allowed = {
        "ABSENCE",
        "GOSI_EMPLOYEE",
        "LOAN",
        "ATTENDANCE_PENALTY",
        "PENALTY_FINE",
        "PENALTY_WAGE_WITHHOLDING",
        "OTHER_DEDUCTION",
        "PREVIOUS_TOTAL_DEDUCTIONS",
    }
    data["deductions"] = [
        line_dto(line, employee=True)
        for line in lines
        if line.category == "DEDUCTION" and line.type in allowed and line.amount
    ]
    if not lines and slip.total_deductions:
        data["deductions"] = [
            {
                **labelled("PREVIOUS_TOTAL_DEDUCTIONS", slip.total_deductions),
                "quantity": None,
                "source_period": {"year": slip.year, "month": slip.month},
            }
        ]
    data["legacy_calculation"] = slip.calculation_version == "legacy"
    return data


def assignment_dto(obj):
    return {
        "id": obj.pk,
        "company_id": obj.company_id,
        "employee_profile_id": obj.employee_profile_id,
        "employee_id": obj.employee_profile.employee_id,
        "employee_name": obj.employee_profile.full_name,
        "status": obj.status,
        "rent_id": obj.rent_id,
        "rent_name": obj.rent.property_name_en or obj.rent.property_name_ar if obj.rent else None,
        "start_date": obj.start_date.isoformat(),
        "end_date": obj.end_date.isoformat(),
        "is_active": obj.is_active,
        "created_by": actor(obj.created_by),
        "updated_by": actor(obj.updated_by),
        "created_at": obj.created_at.isoformat(),
        "updated_at": obj.updated_at.isoformat(),
    }


def adjustment_dto(obj):
    data = {
        "id": obj.pk,
        "audit_log_id": obj.audit_log_id,
        "type": obj.type,
        "changed_fields": obj.changed_fields,
        "original_value": obj.original_value,
        "new_value": obj.new_value,
        "reason": obj.reason,
        "actor": actor(obj.actor),
        "created_at": obj.created_at.isoformat(),
        "run_revision": obj.input_revision,
    }
    if obj.type in ("SETTINGS_CHANGE", "EMPLOYEE_GOSI_CHANGE"):
        data["settings_revision"] = data.pop("run_revision")
    return data


def audit_dto(log):
    return {
        "audit_log_id": log.pk,
        "action": log.action,
        "original_value": log.metadata.get("original_value"),
        "new_value": log.metadata.get("new_value"),
        "reason": log.metadata.get("reason", ""),
        "actor": actor(log.actor),
        "created_at": log.created_at.isoformat(),
    }


def exact_share_dto(value):
    return {**value, "numerator": amount(value["numerator"])}


def rent_dto(allocation):
    residents = []
    for row in allocation.resident_allocations:
        residents.append(
            {
                "employee": {
                    "employee_profile_id": row["employee_profile_id"],
                    "employee_id": row.get("employee_id", ""),
                    "employee_name": row.get("employee_name", ""),
                },
                "raw_share": exact_share_dto(row["raw_share"]),
                "rounded_share": amount(row["rounded_share"]),
                "in_payroll": row["in_payroll"],
                "payroll_status_label": None
                if row["in_payroll"]
                else {"key": "payroll.rent.not_in_payroll", "message": translated("payroll.rent.not_in_payroll")},
            }
        )
    return {
        "rent_id": allocation.rent_id,
        "rent_name": allocation.slot_inputs[0].get("rent_name", "") if allocation.slot_inputs else "",
        "year": allocation.run.year,
        "month": allocation.run.month,
        "residents": residents,
        "monthly_rent": exact_share_dto(allocation.monthly_rent),
        "vacant_unallocated_raw": exact_share_dto(allocation.vacant_unallocated_raw),
        "not_in_payroll_raw": exact_share_dto(allocation.not_in_payroll_raw),
        "rounding_difference": exact_share_dto(allocation.rounding_difference),
        "slots": [
            {
                k: (exact_share_dto(slot[k]) if slot["resident_profile_ids"] else None)
                if k == "raw_daily_share"
                else slot[k]
                for k in ("slot", "calendar_date", "resident_profile_ids", "raw_daily_share")
            }
            for slot in allocation.slot_inputs
        ],
        "rounding_difference_label": {
            "key": "payroll.rent.rounding_difference",
            "message": translated("payroll.rent.rounding_difference"),
        },
        "in_payroll_rounded": amount(
            sum((Decimal(r["rounded_share"]) for r in allocation.resident_allocations if r["in_payroll"]), ZERO)
        ),
        "raw_reconciliation": {"matches": rent_reconciles(allocation)},
    }


def rent_reconciles(allocation):
    def raw(value):
        return Fraction(value["numerator"]) / int(value["denominator"])

    return sum((raw(r["raw_share"]) for r in allocation.resident_allocations), Fraction(0)) + raw(
        allocation.vacant_unallocated_raw
    ) == raw(allocation.monthly_rent)


def summary(run):
    items = list(run.items.filter(is_active=True))
    lines = list(PayrollLine.objects.filter(item__in=items))
    sums = {kind: sum((line.amount or ZERO for line in lines if line.type == kind), ZERO) for kind in LINE_KEYS}

    def values(mapping):
        return {name: amount(sums[kind]) for name, kind in mapping.items()}

    data = {
        "run_id": run.pk,
        "year": run.year,
        "month": run.month,
        "total_employees": run.total_employees,
        "employees_with_deductions": sum(item.total_deductions > 0 for item in items),
        "total_basic_salary": amount(sum((i.basic_salary for i in items), ZERO)),
        "total_allowances": amount(sum((i.total_allowances for i in items), ZERO)),
        "total_gross_salary": amount(run.total_gross),
        "total_net_salary": amount(run.total_net),
        "average_net_salary": amount(run.total_net / len(items) if items else ZERO),
        "cost_incomplete": run.cost_incomplete,
        "reconciliation": reconciliation(run),
    }
    data.update(
        {
            k: amount(getattr(run, k))
            for k in ("total_additions", "total_deductions", "total_provisions", "total_company_cost")
        }
    )
    data["salary_components"] = values(SALARY_COMPONENTS)
    data["additions"] = values(
        {
            k: SCALARS[k]
            for k in (
                "overtime_normal",
                "weekly_rest_work",
                "official_holiday_work",
                "bonus",
                "incentive",
                "other_addition",
            )
        }
    )
    data["deductions"] = values(
        {
            k.lower(): k
            for k in (
                "ABSENCE",
                "GOSI_EMPLOYEE",
                "ATTENDANCE_PENALTY",
                "PENALTY_FINE",
                "PENALTY_WAGE_WITHHOLDING",
                "LOAN",
                "OTHER_DEDUCTION",
                "PREVIOUS_TOTAL_DEDUCTIONS",
            )
        }
    )
    data["provisions"] = values(
        {
            "medical": "MEDICAL",
            "id_cost": "ID_COST",
            "air_ticket": "AIR_TICKET",
            "leave": "LEAVE_PROVISION",
            "eos": "EOS_PROVISION",
            "accommodation_cost": "ACCOMMODATION_COST",
            "gosi_company": "GOSI_COMPANY",
        }
    )
    data["carry_forward"] = carry_dto(
        [c for i in items for c in i.input_snapshot.get("result", {}).get("collection", [])]
    )
    difference = sum(
        (
            Fraction(a.rounding_difference["numerator"]) / a.rounding_difference["denominator"]
            for a in run.rent_allocations.all()
        ),
        Fraction(0),
    )
    data["rent_rounding_difference"] = {
        "numerator": amount(difference.numerator),
        "denominator": difference.denominator,
        "decimal": str(Decimal(difference.numerator) / difference.denominator),
    }
    data["validation_counts"] = validation(run)["counts"]
    data["unknown_provision_counts"] = {
        kind: sum(line.type == kind and line.amount is None for line in lines)
        for kind in (
            "MEDICAL",
            "ID_COST",
            "AIR_TICKET",
            "LEAVE_PROVISION",
            "EOS_PROVISION",
            "ACCOMMODATION_COST",
            "GOSI_COMPANY",
        )
    }
    data["reconciliation"].pop("total_net")
    return data
