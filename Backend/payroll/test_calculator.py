from dataclasses import replace
from datetime import date
from decimal import Decimal
from fractions import Fraction

import pytest

from .calculator import (
    CarryInput,
    EmployeeInput,
    PayrollInputError,
    PenaltyInput,
    RentAssignmentInput,
    allocate_rent,
    calculate_employee,
    calculate_run,
    date_set,
    default_settings,
    exact_share,
    fifth_anniversary,
    money,
    period_dates,
    round_share,
)

D = Decimal
SALARY = {
    "basic_salary": D(6000),
    "accommodation_allowance": D(3000),
    "transportation_allowance": D(1500),
    "other_allowance": D(500),
}


def employee(**changes):
    year, month = changes.get("year", 2026), changes.get("month", 6)
    first, last = period_dates(year, month)
    return replace(
        EmployeeInput(
            101,
            year,
            month,
            SALARY,
            hire_date=date(2024, 1, 1),
            due_work_dates=date_set(first, last),
            attendance_source_available=True,
            accommodation_status="none",
            allowed_overtime=20,
        ),
        **changes,
    )


def calculate(e=None, **settings):
    return calculate_employee(e or employee(), {**default_settings(), "no_medical_insurance": True, **settings})


def amount(result, kind):
    return sum((entry["amount"] or D(0) for entry in result["lines"] if entry["type"] == kind), D(0))


def codes(result, severity=None):
    return {i["code"] for i in result["issues"] if severity is None or i["severity"] == severity}


def test_golden_a():
    r = calculate(
        employee(absent_dates=frozenset({date(2026, 6, 2), date(2026, 6, 3)}), accommodation_status="unknown")
    )
    assert set(r["assumptions"]) == {
        "payroll.assumption.overtime_basic",
        "payroll.assumption.overtime_calendar_month",
    }
    assert (r["gross_salary"], amount(r, "ABSENCE"), r["net_salary"], r["total_company_cost"]) == (
        11000,
        733,
        10267,
        12035,
    )
    assert [amount(r, k) for k in ("LEAVE_PROVISION", "EOS_PROVISION", "AIR_TICKET", "ID_COST", "GOSI_COMPANY")] == [
        350,
        250,
        125,
        863,
        180,
    ]
    assert r["cost_incomplete"]


@pytest.mark.parametrize("year,month,days", [(2026, 7, 31), (2026, 2, 28), (2024, 2, 29)])
def test_full_month_absence_and_cap(year, month, days):
    dates = date_set(*period_dates(year, month))
    r = calculate(employee(year=year, month=month, absent_dates=dates, zero_salary_reason="full_absence"))
    assert r["employed_calendar_days"] == days
    assert amount(r, "ABSENCE") == 11000 and r["net_salary"] == 0
    assert r["absence"]["full_month_absence"]


def test_february_27_of_28():
    r = calculate(employee(year=2026, month=2, absent_dates=date_set(date(2026, 2, 1), date(2026, 2, 27))))
    assert amount(r, "ABSENCE") == 9900 and not r["absence"]["full_month_absence"]


@pytest.mark.parametrize(
    "hired,archive,month,days,gross",
    [
        (date(2026, 6, 16), None, 6, 15, 5500),
        (date(2026, 7, 1), None, 7, 30, 11000),
        (date(2024, 1, 1), date(2026, 6, 15), 6, 15, 5500),
    ],
)
def test_join_and_archive_proration(hired, archive, month, days, gross):
    r = calculate(employee(month=month, hire_date=hired, archive_date=archive, is_archived=bool(archive)))
    assert r["salary_days"] == days and r["gross_salary"] == gross


def test_mid_month_absence_base_and_cap():
    e = employee(
        hire_date=date(2026, 6, 16), absent_dates=frozenset({date(2026, 6, 16), date(2026, 6, 17), date(2026, 6, 1)})
    )
    r = calculate(e)
    assert (amount(r, "ABSENCE"), r["net_salary"]) == (733, 4767)
    r = calculate(
        replace(
            e, absence_days_override=D(30), absence_override_reason="HR confirmed", zero_salary_reason="full_absence"
        )
    )
    assert amount(r, "ABSENCE") == 5500 and r["net_salary"] == 0


def test_golden_overtime():
    r = calculate(employee(overtime_normal_hours=D(4), weekly_rest_work_days=D(1), official_holiday_work_days=D(1)))
    assert [amount(r, k) for k in ("OVERTIME_NORMAL", "WEEKLY_REST_WORK", "OFFICIAL_HOLIDAY_WORK")] == [150, 300, 400]
    assert r["total_additions"] == 850


@pytest.mark.parametrize(
    "limit,hours,paid,warning",
    [
        (20, 24, 750, "overtime_over_allowed"),
        (0, 4, 0, "overtime_over_allowed"),
        (None, 4, 150, "overtime_limit_not_set"),
    ],
)
def test_normal_overtime_limits(limit, hours, paid, warning):
    r = calculate(employee(allowed_overtime=limit, overtime_normal_hours=D(hours)))
    assert amount(r, "OVERTIME_NORMAL") == paid and warning in codes(r, "warning")
    assert r["overtime"]["normal_hours"] == hours
    if limit is not None:
        assert r["overtime"]["unpaid_normal_hours"] == max(0, hours - limit)


def test_overtime_override_requires_explicit_flag_and_reason():
    e = employee(allowed_overtime=0, overtime_normal_hours=D(4), overtime_override_reason="Exceptional work")
    assert amount(calculate(e), "OVERTIME_NORMAL") == 0
    assert amount(calculate(replace(e, override_overtime_eligibility=True)), "OVERTIME_NORMAL") == 150
    r = calculate(replace(e, override_overtime_eligibility=True, overtime_override_reason=""))
    assert amount(r, "OVERTIME_NORMAL") == 0 and "reason_required" in codes(r, "error")


@pytest.mark.parametrize("limit", [0, None])
def test_day_work_is_not_capped(limit):
    r = calculate(employee(allowed_overtime=limit, weekly_rest_work_days=D(1), official_holiday_work_days=D(1)))
    assert r["total_additions"] == 700
    assert not codes(r) & {"overtime_over_allowed", "overtime_limit_not_set"}


@pytest.mark.parametrize(
    "is_saudi,employee_bears,expected", [(False, False, 180), (False, True, 180), (True, False, 878), (True, True, 878)]
)
def test_gosi_one_party(is_saudi, employee_bears, expected):
    r = calculate(employee(is_saudi=is_saudi, deduct_gosi_from_employee=employee_bears))
    assert amount(r, "GOSI_EMPLOYEE") == (expected if employee_bears else 0)
    assert amount(r, "GOSI_COMPANY") == (0 if employee_bears else expected)


@pytest.mark.parametrize("value,expected", [("433.33", 433), ("433.49", 433), ("433.50", 434)])
def test_half_up(value, expected):
    assert money(D(value)) == expected


def test_lines_are_rounded_before_totals():
    r = calculate(employee(salary={"basic_salary": D("433.50"), "other_allowance": D("433.50")}))
    assert r["gross_salary"] == 868


@pytest.mark.parametrize(
    "hired,month,leave,eos",
    [
        (date(2020, 2, 29), 2, 350, 250),
        (date(2020, 2, 29), 3, 500, 500),
        (date(2020, 2, 28), 2, 350, 250),
        (date(2020, 2, 28), 3, 500, 500),
        (date(2020, 3, 1), 3, 350, 250),
        (date(2020, 3, 1), 4, 500, 500),
    ],
)
def test_five_year_tier(hired, month, leave, eos):
    r = calculate(employee(year=2025, month=month, hire_date=hired))
    assert (amount(r, "LEAVE_PROVISION"), amount(r, "EOS_PROVISION")) == (leave, eos)
    if hired.day == 29:
        assert fifth_anniversary(hired) == date(2025, 2, 28)


@pytest.mark.parametrize(
    "mode,expected", [("FULL_MONTH", [350, 250, 125, 863, 180, 100]), ("PRORATED_BY_DAYS", [175, 125, 63, 431, 90, 50])]
)
@pytest.mark.parametrize("leaver", [False, True])
def test_both_provision_modes(mode, expected, leaver):
    e = employee(
        included_employee_count=10,
        hire_date=date(2026, 6, 16) if not leaver else date(2024, 1, 1),
        archive_date=date(2026, 6, 15) if leaver else None,
        is_archived=leaver,
    )
    r = calculate(e, provision_proration=mode, no_medical_insurance=False, annual_medical_invoice="12000.00")
    assert [
        amount(r, k) for k in ("LEAVE_PROVISION", "EOS_PROVISION", "AIR_TICKET", "ID_COST", "GOSI_COMPANY", "MEDICAL")
    ] == expected


def test_provision_factor_does_not_double_prorate_rent():
    r = calculate(
        employee(hire_date=date(2026, 6, 16), accommodation_status="assigned", accommodation_raw=Fraction(500)),
        provision_proration="PRORATED_BY_DAYS",
    )
    assert amount(r, "ACCOMMODATION_COST") == 500


def test_unpaid_leave_paid_leave_and_distinct_dates():
    days = frozenset({date(2026, 6, 2), date(2026, 6, 3)})
    r = calculate(employee(absent_dates=days, unpaid_leave_dates=days))
    assert amount(r, "ABSENCE") == 733
    assert amount(calculate(employee(absent_dates=days, paid_leave_dates=days)), "ABSENCE") == 0


def test_full_absence_paid_leave_and_prior_withholding():
    days = date_set(*period_dates(2026, 2))
    e = employee(year=2026, month=2, absent_dates=days)
    assert amount(calculate(replace(e, paid_leave_dates=frozenset({date(2026, 2, 1)}))), "ABSENCE") == 9900
    assert (
        amount(
            calculate(replace(e, prior_wage_dates=frozenset({date(2026, 2, 1)}), prior_wage_amount=D(300))), "ABSENCE"
        )
        == 10700
    )


def test_pending_penalty_overlap_only_offsets_if_collected():
    day = frozenset({date(2026, 6, 2)})
    claim = PenaltyInput("penalty:1", wage=D(300), wage_dates=day)
    r = calculate(employee(absent_dates=day, penalties=(claim,)))
    assert amount(r, "ABSENCE") == 0 and amount(r, "PENALTY_WAGE_WITHHOLDING") == 300
    r = calculate(
        employee(salary={"basic_salary": D(1000)}, absent_dates=day, penalties=(replace(claim, wage=D(10000)),))
    )
    assert amount(r, "ABSENCE") == 33 and amount(r, "PENALTY_WAGE_WITHHOLDING") == 0
    assert "claim_unaffordable" in codes(r)


def test_manual_absence_total_preserves_prior_wage_exclusion():
    day = frozenset({date(2026, 6, 2)})
    result = calculate(
        employee(
            attendance_source_available=False,
            absence_days_override=D(3),
            absence_override_reason="HR confirmed total",
            prior_wage_dates=day,
            prior_wage_amount=D(300),
        )
    )
    assert amount(result, "ABSENCE") == 733 and result["absence"]["effective_days"] == 2
    assert "penalty_absence_overlap" in codes(result)


def test_manual_absence_total_replaces_observed_full_month():
    result = calculate(
        employee(
            absent_dates=date_set(*period_dates(2026, 6)),
            absence_days_override=D(3),
            absence_override_reason="HR corrected total",
        )
    )
    assert amount(result, "ABSENCE") == 1100 and not result["absence"]["full_month_absence"]


def test_selected_full_month_wage_claim_and_absence_are_coupled():
    days = date_set(*period_dates(2026, 6))
    r = calculate(
        employee(
            absent_dates=days,
            penalties=(PenaltyInput("penalty:1", wage=D(300), wage_dates=frozenset({date(2026, 6, 2)})),),
            zero_salary_reason="full_absence",
        )
    )
    assert amount(r, "ABSENCE") == 10700 and amount(r, "PENALTY_WAGE_WITHHOLDING") == 300 and r["net_salary"] == 0


@pytest.mark.parametrize("fine,collectible", [("166.50", True), ("166.67", False)])
def test_exact_article70_boundary(fine, collectible):
    r = calculate(employee(salary={"basic_salary": D(1000)}, penalties=(PenaltyInput("p:1", fine=D(fine)),)))
    assert amount(r, "PENALTY_FINE") == (167 if collectible else 0)
    if collectible:
        line = next(entry for entry in r["lines"] if entry["type"] == "PENALTY_FINE")
        assert line["exact_fine_amount"] == fine and line["rounded_amount"] == "167"
    else:
        assert "penalty_pending_fine_cap" in codes(r)


def test_shared_fine_cap_across_sources():
    claims = (PenaltyInput("a:1", fine=D(100), source_kind="attendance_penalty"), PenaltyInput("p:1", fine=D(100)))
    r = calculate(employee(salary={"basic_salary": D(1000)}, penalties=claims))
    assert amount(r, "ATTENDANCE_PENALTY") == 100 and amount(r, "PENALTY_FINE") == 0


@pytest.mark.parametrize("limit", [None, 0, 2])
def test_executive_attendance_overtime_and_missing_accommodation_exemption(limit):
    e = employee(
        executive_exempt=True,
        attendance_source_available=False,
        absent_dates=date_set(date(2026, 6, 1), date(2026, 6, 30)),
        accommodation_status="unknown",
        allowed_overtime=limit,
        overtime_normal_hours=D(4),
    )
    result = calculate(e, require_manual_absence_confirmation=True)
    assert not result["issues"]
    assert amount(result, "ABSENCE") == 0 and not result["absence"]["full_month_absence"]
    assert amount(result, "OVERTIME_NORMAL") == 150
    assert result["overtime"]["payable_normal_hours"] == 4 and result["overtime"]["over_allowed_hours"] == 0
    assert amount(result, "ACCOMMODATION_COST") == 0
    assert result["accommodation_status"] == "none" and not result["cost_incomplete"]
    if limit is None:
        ordinary = calculate(
            replace(e, executive_exempt=False, absent_dates=frozenset()), require_manual_absence_confirmation=True
        )
        assert result["net_salary"] == ordinary["net_salary"]
        assert result["total_company_cost"] == ordinary["total_company_cost"]
        assert {"attendance_source_unavailable", "overtime_limit_not_set", "accommodation_unknown"} <= codes(ordinary)


@pytest.mark.parametrize("manual,expected", [(None, 733), (D(3), 1100)])
def test_executive_unpaid_leave_and_audited_absence_override_still_deduct(manual, expected):
    result = calculate(
        employee(
            executive_exempt=True,
            attendance_source_available=False,
            absent_dates=date_set(date(2026, 6, 1), date(2026, 6, 30)),
            unpaid_leave_dates=frozenset({date(2026, 6, 1), date(2026, 6, 2)}),
            absence_days_override=manual,
            absence_override_reason="HR approved absence total" if manual is not None else "",
        ),
        require_manual_absence_confirmation=True,
    )
    assert amount(result, "ABSENCE") == expected
    assert not result["absence"]["full_month_absence"] and not result["issues"]


@pytest.mark.parametrize("present,expected", [(False, "none"), (True, "unknown")])
def test_executive_unknown_existing_assignment_is_not_silently_exempted(present, expected):
    result = calculate(
        employee(executive_exempt=True, accommodation_status="unknown", accommodation_assignment_present=present)
    )
    assert result["accommodation_status"] == expected
    assert result["cost_incomplete"] is present
    assert ("accommodation_unknown" in codes(result)) is present


@pytest.mark.parametrize("mode", ["FULL_MONTH", "PRORATED_BY_DAYS"])
def test_executive_assigned_rent_and_other_financial_rules_are_unchanged(mode):
    e = employee(
        hire_date=date(2026, 6, 16),
        accommodation_status="assigned",
        accommodation_assignment_present=True,
        accommodation_raw=Fraction(1000, 3),
        deduct_gosi_from_employee=True,
        loan_amount=D(100),
        loan_id=1,
        weekly_rest_work_days=D(1),
        official_holiday_work_days=D(1),
    )
    ordinary, executive = (
        calculate(e, provision_proration=mode),
        calculate(replace(e, executive_exempt=True), provision_proration=mode),
    )
    assert ordinary["lines"] == executive["lines"]
    assert ordinary["net_salary"] == executive["net_salary"]
    assert ordinary["total_company_cost"] == executive["total_company_cost"]
    assert amount(executive, "ACCOMMODATION_COST") == 333


@pytest.mark.parametrize(
    "changes,code",
    [
        ({"hire_date": None}, "missing_hire_date"),
        ({"employment_status": "SUSPENDED"}, "suspended_pay_decision_required"),
        ({"salary": {"basic_salary": D(0)}}, "zero_salary_reason_required"),
        ({"salary": {"basic_salary": D(0)}, "zero_salary_reason": "other"}, "zero_salary_detail_required"),
        ({"due_work_dates": None}, "attendance_calendar_missing"),
        ({"override_overtime_eligibility": True}, "reason_required"),
    ],
)
def test_executive_blocking_errors_are_preserved(changes, code):
    ordinary = calculate(employee(**changes))
    executive = calculate(employee(executive_exempt=True, **changes))
    assert codes(executive, "error") == codes(ordinary, "error")
    assert code in codes(executive, "error")


@pytest.mark.parametrize(
    "fine,manual,warning",
    [(D(25), None, None), (D(2000), None, "penalty_pending_fine_cap"), (D(25), D(30), "claim_unaffordable")],
)
def test_executive_skips_only_attendance_fines_preserving_disciplinary_warnings(fine, manual, warning):
    result = calculate(
        employee(
            executive_exempt=True,
            absence_days_override=manual,
            absence_override_reason="HR confirmed full absence" if manual is not None else "",
            zero_salary_reason="full_absence" if manual is not None else None,
            penalties=(
                PenaltyInput("attendance:1", fine=D(10000), source_kind="attendance_penalty", source_id=41),
                PenaltyInput("disciplinary:1", fine=fine, source_kind="penalty", source_id=42),
            ),
        )
    )
    assert amount(result, "ATTENDANCE_PENALTY") == 0
    assert not any(row["source_kind"] == "attendance_penalty" for row in result["collection"])
    assert amount(result, "PENALTY_FINE") == (25 if warning is None else 0)
    if warning:
        assert any(issue["code"] == warning and issue["params"]["source_id"] == 42 for issue in result["issues"])
    assert not any(issue["params"].get("source_id") == 41 for issue in result["issues"])


def test_priority_whole_loan_and_manual_other_reentry():
    r = calculate(
        employee(
            salary={"basic_salary": D(1000)},
            absent_dates=frozenset({date(2026, 6, 1), date(2026, 6, 2)}),
            deduct_gosi_from_employee=True,
            penalties=(PenaltyInput("p:1", fine=D(100)),),
            loan_amount=D(900),
            loan_id=12,
            other_deduction=D(1000),
            zero_salary_reason="other",
            zero_salary_reason_detail="Deductions consume pay",
        )
    )
    assert [amount(r, k) for k in ("ABSENCE", "GOSI_EMPLOYEE", "PENALTY_FINE", "LOAN", "OTHER_DEDUCTION")] == [
        67,
        20,
        100,
        0,
        813,
    ]
    assert r["net_salary"] == 0
    assert next(c for c in r["collection"] if c["type"] == "LOAN")["uncollected"] == 900
    other = next(c for c in r["collection"] if c["type"] == "OTHER_DEDUCTION")
    assert other["uncollected"] == 187 and other["manual_reentry_required"]


def test_carry_forward_preserves_priority_and_balance():
    r = calculate(
        employee(
            salary={"basic_salary": D(1000)},
            carries=(CarryInput("carry:1", "GOSI_EMPLOYEE", D(1500)),),
            zero_salary_reason="other",
            zero_salary_reason_detail="Prior debt",
        )
    )
    c = next(c for c in r["collection"] if c["source_key"] == "carry:1")
    assert c["collected"] == 1000 and c["uncollected"] == 500 and c["carried_in"]
    with pytest.raises(PayrollInputError):
        calculate(employee(carries=(CarryInput("loan:1", "LOAN", D(1)),)))


def test_attendance_unavailable_and_manual_confirmation():
    e = employee(attendance_source_available=False)
    r = calculate(e)
    assert amount(r, "ABSENCE") == 0 and "attendance_source_unavailable" in codes(r, "warning")
    assert "attendance_source_unavailable" not in codes(r, "error")
    assert "attendance_source_unavailable" in codes(calculate(e, require_manual_absence_confirmation=True), "error")
    for days in (D(0), D(3)):
        r = calculate(
            replace(e, absence_days_override=days, absence_override_reason="Site attendance confirmed"),
            require_manual_absence_confirmation=True,
        )
        assert amount(r, "ABSENCE") == money(D(11000) / 30 * days)
        assert "attendance_source_unavailable" in codes(r, "warning") and "attendance_source_unavailable" not in codes(
            r, "error"
        )


def test_unmapped_count_or_rows_cannot_prove_full_month():
    r = calculate(
        employee(year=2026, month=2, absent_dates=date_set(*period_dates(2026, 2)), attendance_source_available=False)
    )
    assert not r["absence"]["full_month_absence"] and amount(r, "ABSENCE") == 10267


def test_missing_hire_date_and_schedule_are_blocking_but_draft_calculates():
    r = calculate(employee(hire_date=None, due_work_dates=None))
    assert r["gross_salary"] == 11000 and {"missing_hire_date", "attendance_calendar_missing"} <= codes(r, "error")
    assert amount(r, "LEAVE_PROVISION") == 350


@pytest.mark.parametrize(
    "changes,code",
    [
        ({"is_archived": True}, "archived_without_date"),
        ({"employment_status": "TERMINATED"}, "terminated_without_end_date"),
        ({"employment_status": "PREHIRE"}, "prehire_status_conflict"),
    ],
)
def test_excluded_conflicts_are_reported(changes, code):
    r = calculate(employee(**changes))
    assert not r["included"] and code in codes(r, "error")


def test_future_hire_excluded_without_warning():
    r = calculate(employee(hire_date=date(2026, 7, 1)))
    assert not r["included"] and not r["issues"]


def test_suspended_decisions_and_zero_reason():
    e = employee(employment_status="SUSPENDED")
    assert "suspended_pay_decision_required" in codes(calculate(e), "error")
    assert calculate(replace(e, suspended_pay_decision="FULL_PAY"))["gross_salary"] == 11000
    r = calculate(replace(e, suspended_pay_decision="ZERO_PAY", zero_salary_reason="suspended"))
    assert r["gross_salary"] == 0 and "zero_salary_reason_required" not in codes(r, "error")


def test_medical_unknown_none_and_run_level_warning():
    employees = [employee(employee_profile_id=i) for i in range(10)]
    r = calculate_run(employees, default_settings())
    assert sum(i["code"] == "medical_invoice_missing" for i in r["issues"]) == 1
    assert all(item["cost_incomplete"] for item in r["items"])
    settings = {**default_settings(), "annual_medical_invoice": "12000.00"}
    r = calculate_run(employees, settings)
    assert all(amount(item, "MEDICAL") == 100 for item in r["items"])
    assert r["totals"]["total_provisions"] == sum(item["total_provisions"] for item in r["items"])
    assert not calculate_run([], settings)["items"]
    assert amount(calculate(no_medical_insurance=True, annual_medical_invoice=None), "MEDICAL") == 0


def test_missing_rent_is_null_known_subtotal_incomplete():
    r = calculate(employee(accommodation_status="unknown"))
    assert next(entry for entry in r["lines"] if entry["type"] == "ACCOMMODATION_COST")["amount"] is None
    assert r["cost_incomplete"] and r["total_company_cost"] == r["net_salary"] + r["total_provisions"]


@pytest.mark.parametrize(
    "base,expected",
    [("BASIC", 400), ("BASIC_HOUSING", 600), ("BASIC_HOUSING_TRANSPORT", 700), ("GROSS", 733), ("FIXED_AMOUNT", 100)],
)
def test_fixed_salary_base_selectors(base, expected):
    r = calculate(
        employee(absent_dates=frozenset({date(2026, 6, 2), date(2026, 6, 3)})),
        absence_base={"type": base, "fixed_amount": "1500.00" if base == "FIXED_AMOUNT" else None},
    )
    assert amount(r, "ABSENCE") == expected


@pytest.mark.parametrize("value", [1.1, True, "NaN", "Infinity", "-1", "1e2", "=1+1"])
def test_invalid_money_is_rejected(value):
    with pytest.raises(PayrollInputError):
        calculate(employee(bonus=value))


def test_salary_mismatch_and_overflow():
    assert "salary_total_mismatch" in codes(calculate(employee(profile_total_salary=D(1))))
    with pytest.raises(PayrollInputError, match="amount_out_of_range"):
        calculate(employee(salary={"basic_salary": D("999999999999.00")}))


def test_new_company_cost_lines_use_18_digits_without_widening_legacy_salary():
    r = calculate(no_medical_insurance=False, annual_medical_invoice="120000000000.00")
    assert amount(r, "MEDICAL") == 10000000000
    assert r["total_company_cost"] > D("9999999999.99")
    assert r["gross_salary"] == 11000


def test_prior_wages_for_other_dates_do_not_reduce_full_absence():
    r = calculate(
        employee(
            absent_dates=date_set(*period_dates(2026, 6)),
            prior_wage_dates=frozenset({date(2026, 5, 1)}),
            prior_wage_amount=D(300),
        )
    )
    assert amount(r, "ABSENCE") == 11000


def raw(obj):
    return Fraction(D(obj["numerator"])) / obj["denominator"]


@pytest.mark.parametrize("year", [2026, 2024])
def test_rent_february_full_month_and_exact_reconciliation(year):
    first, last = period_dates(year, 2)
    r = allocate_rent(year, 2, D(12000), [RentAssignmentInput(1, first, last)], {1})
    assert r["residents"][0]["rounded_share"] == 1000
    assert raw(r["residents"][0]["raw_share"]) + raw(r["vacant_unallocated_raw"]) == raw(r["monthly_rent"])
    assert len(r["slots"]) == 30 and r["slots"][-1]["calendar_date"] == last.isoformat()


def test_rent_leave_and_move_in_february():
    r = allocate_rent(
        2026,
        2,
        D(12000),
        [
            RentAssignmentInput(1, date(2026, 2, 1), date(2026, 2, 10)),
            RentAssignmentInput(2, date(2026, 2, 20), date(2026, 2, 28)),
        ],
        {1, 2},
    )
    shares = {x["employee_profile_id"]: raw(x["raw_share"]) for x in r["residents"]}
    assert shares == {1: Fraction(1000, 3), 2: Fraction(1100, 3)}
    assert sum(shares.values()) + raw(r["vacant_unallocated_raw"]) == 1000


def test_rent_three_residents_rounding_outside_payroll():
    assignments = [RentAssignmentInput(i, date(2026, 6, 1), date(2026, 6, 30)) for i in (1, 2, 3)]
    r = allocate_rent(2026, 6, D(12000), assignments, {1, 2})
    assert [x["rounded_share"] for x in r["residents"]] == [333] * 3
    assert raw(r["rounding_difference"]) == 1 and raw(r["not_in_payroll_raw"]) == Fraction(1000, 3)
    assert sum(raw(x["raw_share"]) for x in r["residents"]) + raw(r["vacant_unallocated_raw"]) == 1000


def test_exact_share_numerator_has_two_decimals_without_changing_exact_value():
    for value, numerator in (
        (Fraction(0), "0.00"),
        (Fraction(1), "1.00"),
        (Fraction(-1), "-1.00"),
        (Fraction(1000, 3), "1000.00"),
    ):
        share = exact_share(value)
        assert share["numerator"] == numerator
        assert raw(share) == value and share["denominator"] == value.denominator


def test_rent_move_and_day31_ignored():
    a = allocate_rent(2026, 7, D(12000), [RentAssignmentInput(1, date(2026, 7, 1), date(2026, 7, 15))], {1})
    b = allocate_rent(2026, 7, D(12000), [RentAssignmentInput(1, date(2026, 7, 16), date(2026, 7, 31))], {1})
    assert raw(a["residents"][0]["raw_share"]) == raw(b["residents"][0]["raw_share"]) == 500
    assert all(s["calendar_date"] != "2026-07-31" for s in b["slots"])


def test_rent_negative_rounding_difference_and_half_boundary():
    r = allocate_rent(
        2026, 6, D(12012), [RentAssignmentInput(i, date(2026, 6, 1), date(2026, 6, 30)) for i in (1, 2)], {1, 2}
    )
    assert raw(r["rounding_difference"]) == -1
    assert round_share(Fraction(999, 2)) == 500
    assert round_share(Fraction(1, 2) - Fraction(1, 10**80)) == 0


def test_calculator_inputs_not_mutated_and_no_database_access():
    settings = default_settings()
    original = repr(settings)
    e = employee()
    assert calculate_employee(e, settings) == calculate_employee(e, settings)
    assert repr(settings) == original
    # This unmarked pytest test cannot access Django's database.
