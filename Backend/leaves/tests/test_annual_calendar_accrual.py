"""
Regression tests for calendar-month annual leave accrual (84ebef2 fix).

Covers:
- February normal/leap handling
- 28th/29th/30th/31st contract starts
- Original-day anniversary chain (31 Jan -> 28 Feb -> 31 Mar)
- Day-before vs anniversary accrual
- 6-month unlock and 12-month 21-day cap with inclusive cycle-end fix
- Future request rejected based on today's accrued balance
- Balance / eligibility / snapshot consistency
- Pending/approved reservation and no DB writes on GET
"""

from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from employees.models import EmployeeProfile
from leaves.models import LeaveRequest, LeaveType
from leaves.serializers import LeaveRequestSerializer
from leaves.utils import (
    calculate_leave_balance,
    get_annual_accrual_details,
    get_completed_calendar_months,
    get_contract_year_cycle,
)
from organization.models import OrganizationNode, UserOrganizationAccess

User = get_user_model()


class CalendarMonthHelperTests(TestCase):
    """Pure helper tests — no company/DB needed beyond the helper."""

    def _details(self, contract_start, as_of):
        class P:
            contract_date = contract_start
            hire_date = contract_start

        cycle_start, cycle_end = get_contract_year_cycle(P(), as_of)
        completed = get_completed_calendar_months(
            cycle_start, as_of, contract_start=contract_start, cycle_end=cycle_end
        )
        return cycle_start, cycle_end, completed

    def test_feb_normal_vs_leap(self):
        # 30 Jan in normal year: Feb 28 is anniversary
        _, _, c = self._details(date(2023, 1, 30), date(2023, 2, 28))
        self.assertEqual(c, 1)
        _, _, c = self._details(date(2023, 1, 30), date(2023, 2, 27))
        self.assertEqual(c, 0)
        # 30 Jan in leap year: Feb 29 is anniversary
        _, _, c = self._details(date(2024, 1, 30), date(2024, 2, 29))
        self.assertEqual(c, 1)
        _, _, c = self._details(date(2024, 1, 30), date(2024, 2, 28))
        self.assertEqual(c, 0)

    def test_31_jan_chain(self):
        # 31 Jan -> 28 Feb -> 31 Mar (original day, not chained)
        _, _, c = self._details(date(2023, 1, 31), date(2023, 2, 28))
        self.assertEqual(c, 1)
        _, _, c = self._details(date(2023, 1, 31), date(2023, 3, 31))
        self.assertEqual(c, 2)
        _, _, c = self._details(date(2023, 1, 31), date(2023, 3, 30))
        self.assertEqual(c, 1)
        # Leap year
        _, _, c = self._details(date(2024, 1, 31), date(2024, 2, 29))
        self.assertEqual(c, 1)
        _, _, c = self._details(date(2024, 1, 31), date(2024, 2, 28))
        self.assertEqual(c, 0)

    def test_28_29_30_31_starts(self):
        # 28th
        _, _, c = self._details(date(2023, 1, 28), date(2023, 2, 28))
        self.assertEqual(c, 1)
        _, _, c = self._details(date(2023, 1, 28), date(2023, 2, 27))
        self.assertEqual(c, 0)
        # 29 Feb contract
        _, _, c = self._details(date(2020, 2, 29), date(2020, 3, 29))
        self.assertEqual(c, 1)
        _, _, c = self._details(date(2020, 2, 29), date(2020, 3, 28))
        self.assertEqual(c, 0)
        # Non-leap year anniversary for 29 Feb is 28 Feb
        cycle_start, cycle_end, _ = self._details(date(2020, 2, 29), date(2021, 2, 28))
        # 2021-02-28 is start of new cycle, not end of previous
        self.assertEqual(cycle_start, date(2021, 2, 28))
        # Previous cycle end should still be 12
        class P:
            contract_date = date(2020, 2, 29)
            hire_date = date(2020, 2, 29)

        cycle_start_prev, cycle_end_prev = get_contract_year_cycle(P(), date(2021, 2, 27))
        self.assertEqual(cycle_end_prev, date(2021, 2, 27))
        c = get_completed_calendar_months(
            cycle_start_prev, cycle_end_prev, contract_start=date(2020, 2, 29), cycle_end=cycle_end_prev
        )
        self.assertEqual(c, 12)

    def test_one_day_before_vs_anniversary(self):
        # 1 Feb -> 1 Mar
        _, _, c = self._details(date(2023, 2, 1), date(2023, 2, 28))
        self.assertEqual(c, 0)
        _, _, c = self._details(date(2023, 2, 1), date(2023, 3, 1))
        self.assertEqual(c, 1)
        # 20 Mar -> 20 Apr
        _, _, c = self._details(date(2023, 3, 20), date(2023, 4, 19))
        self.assertEqual(c, 0)
        _, _, c = self._details(date(2023, 3, 20), date(2023, 4, 20))
        self.assertEqual(c, 1)

    def test_cycle_end_returns_12(self):
        # Defect table — every cycle end must be 12 (21 days)
        cases = [
            (date(2023, 1, 1), date(2023, 12, 31)),
            (date(2023, 1, 31), date(2024, 1, 30)),
            (date(2023, 3, 20), date(2024, 3, 19)),
            (date(2020, 2, 29), date(2021, 2, 27)),
        ]
        for contract_start, cycle_end in cases:
            with self.subTest(contract_start=contract_start):
                class P:
                    contract_date = contract_start
                    hire_date = contract_start

                cycle_start, derived_end = get_contract_year_cycle(P(), cycle_end)
                self.assertEqual(derived_end, cycle_end)
                c = get_completed_calendar_months(
                    cycle_start, cycle_end, contract_start=contract_start, cycle_end=cycle_end
                )
                self.assertEqual(c, 12)
                # One day before end is 11
                c_before = get_completed_calendar_months(
                    cycle_start, cycle_end - timedelta(days=1), contract_start=contract_start, cycle_end=cycle_end
                )
                # For 12-month cycle, day before end still 11 unless that day itself is an anniversary
                # (e.g., Feb case). We assert it is not 12.
                self.assertEqual(c_before, 11)

    def test_six_and_twelve_month_rules(self):
        c = self._details(date(2023, 1, 1), date(2023, 6, 30))[2]
        self.assertEqual(c, 5)
        c = self._details(date(2023, 1, 1), date(2023, 7, 1))[2]
        self.assertEqual(c, 6)
        # Accrual via helper
        class P:
            contract_date = date(2023, 1, 1)
            hire_date = date(2023, 1, 1)

        d = get_annual_accrual_details(P(), date(2023, 7, 1))
        self.assertEqual(d["completed_periods"], 6)
        self.assertEqual(d["accrued_days"], Decimal("10.50"))
        # Cap at 12
        d = get_annual_accrual_details(P(), date(2023, 12, 31))
        self.assertEqual(d["completed_periods"], 12)
        self.assertEqual(d["accrued_days"], Decimal("21.00"))
        # Day after cap still 12 (next cycle start resets, but effective_date capped to cycle_end)
        d = get_annual_accrual_details(P(), date(2024, 1, 1))
        # New cycle start, 0 in new cycle
        self.assertEqual(d["cycle_start"], date(2024, 1, 1))
        self.assertEqual(d["completed_periods"], 0)


class AnnualAccrualIntegrationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        head = OrganizationNode.objects.create(
            code="HEAD_CAL", name="Head Cal", node_type=OrganizationNode.NodeType.HEAD_OFFICE
        )
        self.company = OrganizationNode.objects.create(
            code="COMP_CAL", name="Comp Cal", node_type=OrganizationNode.NodeType.COMPANY, parent=head
        )
        self.emp = User.objects.create_user(email="cal.emp@test.com", password="password")
        self.hr = User.objects.create_user(email="cal.hr@test.com", password="password")
        for u, r in ((self.emp, "Employee"), (self.hr, "HRManager")):
            g, _ = Group.objects.get_or_create(name=r)
            u.groups.add(g)
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.company)
        self.profile = EmployeeProfile.objects.create(
            user=self.emp,
            company=self.company,
            employee_id="EMP-CAL-1",
            full_name="Cal Emp",
            contract_date=date(2023, 1, 1),
            hire_date=date(2023, 1, 1),
            total_salary=Decimal("3000.00"),
        )
        EmployeeProfile.objects.create(user=self.hr, company=self.company, employee_id="EMP-CAL-HR", full_name="HR")
        self.annual = LeaveType.objects.create(company=self.company, name="Annual Leave", code="ANNUAL", is_active=True)
        LeaveType.objects.create(company=self.company, name="Unpaid Leave", code="UNPAID", is_active=True)
        self.client.defaults["HTTP_X_ACTIVE_COMPANY_ID"] = str(self.company.id)

    def test_future_request_rejected_based_on_today_accrual(self):
        # Contract 1 Jan, today is 1 Jul (6 months -> 10.5 days). Request for 12 days in future should fail
        # even though by leave start date (Sep) more would accrue.
        self.profile.contract_date = date(2023, 1, 1)
        self.profile.hire_date = date(2023, 1, 1)
        self.profile.save(update_fields=["contract_date", "hire_date"])
        today = date(2023, 7, 1)
        # Mock timezone.localdate to control today
        with patch("leaves.utils.timezone.localdate", return_value=today):
            with patch("leaves.serializers.timezone.localdate", return_value=today):
                self.client.force_authenticate(self.emp)
                # Request 12 days (needs 12, only 10.5 accrued today)
                resp = self.client.post(
                    "/api/leaves/leave-requests/",
                    {
                        "leave_type": self.annual.id,
                        "start_date": str(date(2023, 9, 10)),
                        "end_date": str(date(2023, 9, 21)),  # 12 days
                    },
                )
                self.assertEqual(resp.status_code, 400)
                self.assertIn("Annual leave exceeds available balance", str(resp.data))

    def test_balance_eligibility_snapshot_consistency(self):
        # Ensure balance, eligibility, and snapshot share same accrual value
        self.profile.contract_date = date(2023, 1, 31)
        self.profile.hire_date = date(2023, 1, 31)
        self.profile.save(update_fields=["contract_date", "hire_date"])
        as_of = date(2024, 1, 30)  # cycle end, should be 12
        from leaves.utils import build_annual_leave_eligibility, build_annual_leave_payment_snapshot

        details = get_annual_accrual_details(self.profile, as_of)
        self.assertEqual(details["accrued_days"], Decimal("21.00"))
        balances = calculate_leave_balance(self.emp, 2024, as_of=as_of)
        annual_bal = next(b for b in balances if b["leave_code"] == "ANNUAL")
        self.assertEqual(float(annual_bal["available_annual_year_days"]), 21.0)
        snap = build_annual_leave_payment_snapshot(self.profile, as_of=as_of)
        self.assertEqual(snap["accrued_days"], Decimal("21.00"))
        # Eligibility in final-five-days window should show 21
        eligibility = build_annual_leave_eligibility(self.profile, active_company=self.company, as_of=as_of)
        self.assertEqual(eligibility["cycle_end"], date(2024, 1, 30))
        self.assertTrue(eligibility["window_open"])

    def test_existing_requests_reduce_balance(self):
        self.profile.contract_date = date(2023, 1, 1)
        self.profile.hire_date = date(2023, 1, 1)
        self.profile.save(update_fields=["contract_date", "hire_date"])
        as_of = date(2023, 12, 31)
        # Approved request reduces remaining
        LeaveRequest.objects.create(
            employee=self.emp,
            employee_profile=self.profile,
            company=self.company,
            leave_type=self.annual,
            start_date=date(2023, 6, 1),
            end_date=date(2023, 6, 2),
            status=LeaveRequest.RequestStatus.APPROVED,
        )
        balances = calculate_leave_balance(self.emp, 2023, as_of=as_of)
        annual = next(b for b in balances if b["leave_code"] == "ANNUAL")
        self.assertEqual(float(annual["used_days"]), 2.0)
        self.assertEqual(float(annual["remaining_days"]), 19.0)
        # Pending reserves requestable but not remaining
        LeaveRequest.objects.create(
            employee=self.emp,
            employee_profile=self.profile,
            company=self.company,
            leave_type=self.annual,
            start_date=date(2023, 7, 1),
            end_date=date(2023, 7, 5),
            status=LeaveRequest.RequestStatus.PENDING_HR,
        )
        balances = calculate_leave_balance(self.emp, 2023, as_of=as_of)
        annual = next(b for b in balances if b["leave_code"] == "ANNUAL")
        self.assertEqual(float(annual["pending_days"]), 5.0)
        self.assertEqual(float(annual["requestable_days"]), 14.0)  # floor(19) -5

    def test_no_db_writes_on_get_balance_and_list(self):
        self.client.force_authenticate(self.emp)
        # Balance GET
        with CaptureQueriesContext(connection) as ctx:
            resp = self.client.get("/api/leaves/employee/leave-balance/?year=2023")
            self.assertEqual(resp.status_code, 200)
        # Ensure no INSERT/UPDATE/DELETE in captured queries
        writes = [q["sql"] for q in ctx.captured_queries if q["sql"].strip().upper().startswith(("INSERT", "UPDATE", "DELETE"))]
        self.assertEqual(writes, [])
        # Create a request for list serialization
        lr = LeaveRequest.objects.create(
            employee=self.emp,
            employee_profile=self.profile,
            company=self.company,
            leave_type=self.annual,
            start_date=date(2023, 8, 1),
            end_date=date(2023, 8, 1),
            status=LeaveRequest.RequestStatus.APPROVED,
        )
        with CaptureQueriesContext(connection) as ctx2:
            serializer = LeaveRequestSerializer(LeaveRequest.objects.filter(pk=lr.pk), many=True, context={"request": None})
            _ = serializer.data
        writes2 = [q["sql"] for q in ctx2.captured_queries if q["sql"].strip().upper().startswith(("INSERT", "UPDATE", "DELETE"))]
        self.assertEqual(writes2, [])

    def test_six_month_unlock(self):
        self.profile.contract_date = date(2023, 3, 20)
        self.profile.hire_date = date(2023, 3, 20)
        self.profile.save(update_fields=["contract_date", "hire_date"])
        # 5 months not enough
        with patch("leaves.utils.timezone.localdate", return_value=date(2023, 8, 19)):
            from leaves.utils import validate_leave_request_policy

            err = validate_leave_request_policy(self.emp, self.annual, date(2023, 8, 20), date(2023, 8, 21))
            self.assertIn("completing 6 months", err)
        # 6 months exact: 20 Sep is 6th anniversary
        with patch("leaves.utils.timezone.localdate", return_value=date(2023, 9, 20)):
            err = validate_leave_request_policy(self.emp, self.annual, date(2023, 9, 21), date(2023, 9, 21))
            # Should not be the 6-month error (may still be balance, but not service)
            self.assertTrue(err is None or "completing 6 months" not in err)

    def test_hire_date_fallback(self):
        # Legacy profile without contract_date uses hire_date
        self.profile.contract_date = None
        self.profile.hire_date = date(2023, 1, 31)
        self.profile.save(update_fields=["contract_date", "hire_date"])
        d = get_annual_accrual_details(self.profile, date(2023, 2, 28))
        self.assertEqual(d["accrued_days"], Decimal("1.75"))
