"""Annual Leave carried forward is leave only: never payable, in any later cycle.

HR resolves a settlement one of two ways: pay, or carry forward. Carried days become leave-only
days: they are recorded in ``locked_unused_days`` of every later cycle, are excluded from
``eligible_unused_days`` and ``payment_amount``, and keep rolling forward as leave-only through
every later cycle until they are taken as leave.
"""

from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APITestCase

from employees.models import ContractDecision, EmployeeProfile
from leaves.annual_payment_services import (
    apply_annual_payment_ceo_approval,
    apply_annual_payment_ceo_rejection,
    apply_annual_payment_hr_review,
)
from leaves.models import AnnualLeavePaymentRequest, LeaveRequest, LeaveType
from leaves.utils import (
    _batch_prior_annual_carry_forward,
    _renewal_decisions,
    annual_leave_payment_amount,
    build_annual_leave_payment_snapshot,
    get_prior_annual_carry_forward_days,
    get_prior_annual_carry_forward_split,
    get_unsettled_renewed_annual_term,
)
from organization.models import OrganizationNode, UserOrganizationAccess

User = get_user_model()

Status = AnnualLeavePaymentRequest.Status
Resolution = AnnualLeavePaymentRequest.Resolution

CYCLE_2023 = (date(2023, 1, 1), date(2023, 12, 31))
CYCLE_2024 = (date(2024, 1, 1), date(2024, 12, 31))
CYCLE_2025 = (date(2025, 1, 1), date(2025, 12, 31))
CYCLE_2026 = (date(2026, 1, 1), date(2026, 12, 31))

NOTIFY = "leaves.annual_payment_services.notify_users_for_pending_status"


def _days(value):
    return Decimal(value)


class LockedCarryForwardBalanceTests(TestCase):
    """Balance math: the locked bucket is tracked apart from the cash-eligible one."""

    def setUp(self):
        head_office = OrganizationNode.objects.create(
            code="HEAD_OFFICE_LOCKED_CARRY",
            name="Locked Carry Head Office",
            node_type=OrganizationNode.NodeType.HEAD_OFFICE,
        )
        self.company = OrganizationNode.objects.create(
            code="LOCKED_CARRY_COMPANY",
            name="Locked Carry Company",
            node_type=OrganizationNode.NodeType.COMPANY,
            parent=head_office,
        )
        self.employee = User.objects.create_user(email="locked.carry@test.com", password="password")
        self.hr_user = User.objects.create_user(email="locked.carry.hr@test.com", password="password")
        self.ceo_user = User.objects.create_user(email="locked.carry.ceo@test.com", password="password")
        # No contract expiry: yearly anniversary cycles 2023, 2024, 2025, 2026.
        self.profile = EmployeeProfile.objects.create(
            user=self.employee,
            company=self.company,
            employee_id="EMP-LOCKED-CARRY",
            full_name="Locked Carry Employee",
            contract_date=CYCLE_2023[0],
            hire_date=CYCLE_2023[0],
            total_salary=Decimal("3000.00"),
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        self.annual = LeaveType.objects.create(company=self.company, name="Annual Leave", code="ANNUAL", is_active=True)

    # --- helpers -------------------------------------------------------------------------

    def _approved_leave(self, start, end):
        return LeaveRequest.objects.create(
            employee=self.employee,
            employee_profile=self.profile,
            company=self.company,
            leave_type=self.annual,
            start_date=start,
            end_date=end,
            status=LeaveRequest.RequestStatus.APPROVED,
        )

    def _recorded(self, cycle, status, *, resolution=Resolution.PAY, eligible="0.00", carry="0.00", locked="0.00"):
        return AnnualLeavePaymentRequest.objects.create(
            employee=self.employee,
            employee_profile=self.profile,
            company=self.company,
            cycle_start=cycle[0],
            cycle_end=cycle[1],
            eligible_unused_days=Decimal(eligible),
            carry_forward_days=Decimal(carry),
            locked_unused_days=Decimal(locked),
            resolution=resolution,
            status=status,
        )

    def _submit_from_snapshot(self, cycle):
        """Record a settlement for ``cycle`` exactly as the create serializer snapshots it."""
        snapshot = build_annual_leave_payment_snapshot(self.profile, as_of=cycle[1])
        self.assertEqual((snapshot["cycle_start"], snapshot["cycle_end"]), cycle)
        return AnnualLeavePaymentRequest.objects.create(
            employee=self.employee,
            employee_profile=self.profile,
            company=self.company,
            cycle_start=snapshot["cycle_start"],
            cycle_end=snapshot["cycle_end"],
            accrued_days=snapshot["accrued_days"],
            used_days=snapshot["used_days"],
            eligible_unused_days=snapshot["eligible_unused_days"],
            locked_unused_days=snapshot["locked_unused_days"],
            salary_at_year_end=snapshot["salary_at_year_end"],
            payment_amount=snapshot["payment_amount"],
            submitted_by=self.employee,
            status=Status.PENDING_HR,
        )

    def _settle(self, cycle, decision):
        """Submit, HR-review with ``decision`` and CEO-approve the settlement for ``cycle``."""
        payment = self._submit_from_snapshot(cycle)
        payment = apply_annual_payment_hr_review(payment, actor=self.hr_user, decision=decision)
        payment = apply_annual_payment_ceo_approval(payment, actor=self.ceo_user)
        payment.refresh_from_db()
        return payment

    def _set_salary(self, amount):
        self.profile.total_salary = Decimal(amount)
        self.profile.save(update_fields=["total_salary"])

    # --- recorded settlement -> next cycle's opening -----------------------------------

    def test_locked_carry_forward_hands_leave_only_days_to_next_cycle(self):
        self._recorded(CYCLE_2023, Status.CARRIED_FORWARD, resolution=Resolution.CARRY_FORWARD, carry="10.00")

        self.assertEqual(get_prior_annual_carry_forward_split(self.profile, CYCLE_2024[0]), (_days("0"), _days("10")))
        # Leave balances count leave-only days in full: they are real, takeable leave.
        self.assertEqual(get_prior_annual_carry_forward_days(self.profile, CYCLE_2024[0]), _days("10"))

    def test_carried_days_are_not_priced_in_the_next_cycle(self):
        self._recorded(CYCLE_2023, Status.CARRIED_FORWARD, resolution=Resolution.CARRY_FORWARD, carry="10.00")

        snapshot = build_annual_leave_payment_snapshot(self.profile, as_of=CYCLE_2024[1])
        self.assertEqual(snapshot["accrued_days"], _days("31"))  # 10 carried + 21 accrued: all takeable leave
        self.assertEqual(snapshot["eligible_unused_days"], _days("21"))  # only the 2024 accrual is payable
        self.assertEqual(snapshot["locked_unused_days"], _days("10"))
        self.assertEqual(snapshot["payment_amount"], Decimal("2100.00"))  # not 31 x 3000 / 30

    def test_every_outcome_keeps_already_locked_days_locked(self):
        for status_value, resolution, expected in (
            (Status.APPROVED, Resolution.PAY, ("0", "4")),
            (Status.CARRIED_FORWARD, Resolution.CARRY_FORWARD, ("0", "10")),
            (Status.REJECTED, Resolution.CARRY_FORWARD, ("6", "4")),
            (Status.PENDING_HR, Resolution.PAY, ("6", "4")),
            (Status.PENDING_CEO, Resolution.CARRY_FORWARD, ("6", "4")),
        ):
            with self.subTest(status=status_value, resolution=resolution):
                AnnualLeavePaymentRequest.objects.all().delete()
                self._recorded(
                    CYCLE_2023, status_value, resolution=resolution, eligible="6.00", carry="6.00", locked="4.00"
                )

                self.assertEqual(
                    get_prior_annual_carry_forward_split(self.profile, CYCLE_2024[0]),
                    (_days(expected[0]), _days(expected[1])),
                )

    # --- services: the new HR decision --------------------------------------------------

    def test_hr_carry_forward_settles_as_leave_only_with_no_payout(self):
        payment = self._submit_from_snapshot(CYCLE_2023)
        self.assertEqual((payment.eligible_unused_days, payment.payment_amount), (_days("21"), Decimal("2100.00")))

        payment = apply_annual_payment_hr_review(payment, actor=self.hr_user, decision="carry_forward")
        self.assertEqual(payment.resolution, Resolution.CARRY_FORWARD)
        self.assertEqual((payment.payment_amount, payment.carry_forward_days), (Decimal("0"), _days("21")))
        # A raise before the CEO approves must not price a carry-forward.
        self._set_salary("6000.00")
        payment = apply_annual_payment_ceo_approval(payment, actor=self.ceo_user)
        payment.refresh_from_db()

        self.assertEqual(payment.status, Status.CARRIED_FORWARD)
        self.assertEqual(payment.payment_amount, Decimal("0.00"))
        self.assertIsNotNone(payment.settled_at)
        self.assertEqual(get_prior_annual_carry_forward_split(self.profile, CYCLE_2024[0]), (_days("0"), _days("21")))

    def test_ceo_rejecting_a_carry_forward_does_not_lock_the_days(self):
        payment = self._submit_from_snapshot(CYCLE_2023)
        payment = apply_annual_payment_hr_review(payment, actor=self.hr_user, decision="carry_forward")
        apply_annual_payment_ceo_rejection(payment, actor=self.ceo_user, comment="Pay it instead next time")

        self.assertEqual(get_prior_annual_carry_forward_split(self.profile, CYCLE_2024[0]), (_days("21"), _days("0")))

    def test_later_pay_excludes_locked_days_and_carries_them_forward_untouched(self):
        self._recorded(CYCLE_2023, Status.CARRIED_FORWARD, resolution=Resolution.CARRY_FORWARD, carry="10.00")
        self._approved_leave(date(2024, 4, 7), date(2024, 4, 9))  # 3 days, drawn from the locked days first

        payment = self._submit_from_snapshot(CYCLE_2024)
        self.assertEqual(payment.used_days, _days("3"))
        self.assertEqual(payment.accrued_days, _days("31"))  # 10 locked opening + 21 accrued in 2024
        self.assertEqual(payment.eligible_unused_days, _days("21"))  # only the new 2024 accrual is payable
        self.assertEqual(payment.locked_unused_days, _days("7"))  # 10 locked - 3 taken as leave
        self.assertEqual(payment.payment_amount, Decimal("2100.00"))  # 21 x 3000 / 30, not 28 days

        payment = apply_annual_payment_hr_review(payment, actor=self.hr_user, decision="forward")
        # The CEO re-prices at a raised salary: still only the cash-eligible days.
        self._set_salary("3600.00")
        payment = apply_annual_payment_ceo_approval(payment, actor=self.ceo_user)
        payment.refresh_from_db()
        self.assertEqual(payment.status, Status.APPROVED)
        self.assertEqual(payment.payment_amount, annual_leave_payment_amount(_days("21"), Decimal("3600.00")))
        self.assertEqual(payment.payment_amount, Decimal("2520.00"))

        # Paying 2024 paid out the cash days only: the 7 locked days open 2025, still locked.
        self.assertEqual(get_prior_annual_carry_forward_split(self.profile, CYCLE_2025[0]), (_days("0"), _days("7")))
        snapshot_2025 = build_annual_leave_payment_snapshot(self.profile, as_of=CYCLE_2025[1])
        self.assertEqual(snapshot_2025["eligible_unused_days"], _days("21"))
        self.assertEqual(snapshot_2025["locked_unused_days"], _days("7"))
        self.assertEqual(snapshot_2025["payment_amount"], Decimal("2520.00"))

    def test_locked_days_survive_several_cycles_without_becoming_payable(self):
        cycle_2027 = (date(2027, 1, 1), date(2027, 12, 31))

        # 2023: HR carries the whole 21-day balance forward: it becomes leave only.
        settled_2023 = self._settle(CYCLE_2023, "carry_forward")
        self.assertEqual(
            (settled_2023.eligible_unused_days, settled_2023.carry_forward_days), (_days("21"), _days("21"))
        )
        self.assertEqual(settled_2023.payment_amount, Decimal("0.00"))
        self.assertEqual(get_prior_annual_carry_forward_split(self.profile, CYCLE_2024[0]), (_days("0"), _days("21")))

        # 2024: 3 days of leave come out of the locked days; HR carries the new accrual forward too.
        self._approved_leave(date(2024, 4, 7), date(2024, 4, 9))
        settled_2024 = self._settle(CYCLE_2024, "carry_forward")
        self.assertEqual(
            (settled_2024.eligible_unused_days, settled_2024.locked_unused_days), (_days("21"), _days("18"))
        )
        self.assertEqual(settled_2024.payment_amount, Decimal("0.00"))
        self.assertEqual(get_prior_annual_carry_forward_split(self.profile, CYCLE_2025[0]), (_days("0"), _days("39")))

        # 2025: HR pays. Only the 2025 accrual is paid; the 39 locked days stay locked.
        settled_2025 = self._settle(CYCLE_2025, "forward")
        self.assertEqual(settled_2025.status, Status.APPROVED)
        self.assertEqual(
            (settled_2025.eligible_unused_days, settled_2025.locked_unused_days), (_days("21"), _days("39"))
        )
        self.assertEqual(settled_2025.payment_amount, Decimal("2100.00"))
        self.assertEqual(get_prior_annual_carry_forward_split(self.profile, CYCLE_2026[0]), (_days("0"), _days("39")))

        # 2026: HR carries forward again; the locked bucket grows and nothing merges back.
        settled_2026 = self._settle(CYCLE_2026, "carry_forward")
        self.assertEqual(
            (settled_2026.eligible_unused_days, settled_2026.locked_unused_days), (_days("21"), _days("39"))
        )
        self.assertEqual(get_prior_annual_carry_forward_split(self.profile, cycle_2027[0]), (_days("0"), _days("60")))

        # 2027: HR pays. Still only that year's accrual.
        settled_2027 = self._settle(cycle_2027, "forward")
        self.assertEqual(
            (settled_2027.eligible_unused_days, settled_2027.locked_unused_days), (_days("21"), _days("60"))
        )
        self.assertEqual(settled_2027.payment_amount, Decimal("2100.00"))
        self.assertEqual(
            get_prior_annual_carry_forward_split(self.profile, cycle_2027[1] + timedelta(days=1)),
            (_days("0"), _days("60")),
        )

        # Across five cycles only the two paid years' own accruals were ever priced.
        total_paid = sum(
            AnnualLeavePaymentRequest.objects.filter(status=Status.APPROVED).values_list("payment_amount", flat=True),
            Decimal("0"),
        )
        self.assertEqual(total_paid, Decimal("4200.00"))

    def test_fractional_cash_accrual_never_rounds_locked_days_into_payable_days(self):
        self._recorded(CYCLE_2023, Status.CARRIED_FORWARD, resolution=Resolution.CARRY_FORWARD, carry="10.00")

        # Six months into 2024: 10.50 accrued + 10 locked = 20.50 -> 20 whole days.
        snapshot = build_annual_leave_payment_snapshot(self.profile, as_of=date(2024, 7, 15))

        self.assertEqual(snapshot["eligible_unused_days"], _days("10"))
        self.assertEqual(snapshot["locked_unused_days"], _days("10"))
        self.assertEqual(snapshot["fractional_days"], Decimal("0.50"))
        self.assertEqual(snapshot["payment_amount"], Decimal("1000.00"))

    def test_leave_beyond_the_locked_days_draws_down_the_payable_days(self):
        self._recorded(CYCLE_2023, Status.CARRIED_FORWARD, resolution=Resolution.CARRY_FORWARD, carry="2.00")
        self._approved_leave(date(2024, 4, 7), date(2024, 4, 11))  # 5 days: 2 locked + 3 payable

        snapshot = build_annual_leave_payment_snapshot(self.profile, as_of=CYCLE_2024[1])

        self.assertEqual(snapshot["used_days"], _days("5"))
        self.assertEqual(snapshot["locked_unused_days"], _days("0"))
        self.assertEqual(snapshot["eligible_unused_days"], _days("18"))  # 21 accrued - 3
        self.assertEqual(snapshot["payment_amount"], Decimal("1800.00"))


class LockedCarryForwardRenewalTests(TestCase):
    """A locked balance next to a renewal-closed, unsettled term (the carry-forward fix)."""

    def setUp(self):
        head_office = OrganizationNode.objects.create(
            code="HEAD_OFFICE_LOCKED_RENEWAL",
            name="Locked Renewal Head Office",
            node_type=OrganizationNode.NodeType.HEAD_OFFICE,
        )
        self.company = OrganizationNode.objects.create(
            code="LOCKED_RENEWAL_COMPANY",
            name="Locked Renewal Company",
            node_type=OrganizationNode.NodeType.COMPANY,
            parent=head_office,
        )
        self.employee = User.objects.create_user(email="locked.renewal@test.com", password="password")
        self.profile = EmployeeProfile.objects.create(
            user=self.employee,
            company=self.company,
            employee_id="EMP-LOCKED-RENEWAL",
            full_name="Locked Renewal Employee",
            contract_date=CYCLE_2023[0],
            contract_expiry=CYCLE_2023[1],
            hire_date=CYCLE_2023[0],
            total_salary=Decimal("3000.00"),
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        self.annual = LeaveType.objects.create(company=self.company, name="Annual Leave", code="ANNUAL", is_active=True)

    def _renew(self, old, new):
        self.profile.contract_date, self.profile.contract_expiry = new
        self.profile.save(update_fields=["contract_date", "contract_expiry", "updated_at"])
        return ContractDecision.objects.create(
            company=self.company,
            employee_profile=self.profile,
            status=ContractDecision.Status.AUTO_RENEWED,
            original_contract_date=old[0],
            original_contract_expiry=old[1],
            proposed_contract_date=new[0],
            proposed_contract_expiry=new[1],
        )

    def test_unsettled_renewed_term_keeps_its_own_days_payable_and_inherited_locked_days_locked(self):
        self._renew(CYCLE_2023, CYCLE_2024)
        AnnualLeavePaymentRequest.objects.create(
            employee=self.employee,
            employee_profile=self.profile,
            company=self.company,
            cycle_start=CYCLE_2023[0],
            cycle_end=CYCLE_2023[1],
            eligible_unused_days=Decimal("10.00"),
            carry_forward_days=Decimal("10.00"),
            resolution=Resolution.CARRY_FORWARD,
            status=Status.CARRIED_FORWARD,
        )
        # 2024 is closed by a renewal with no settlement: no HR decision was made for it.
        self._renew(CYCLE_2024, CYCLE_2025)
        LeaveRequest.objects.create(
            employee=self.employee,
            employee_profile=self.profile,
            company=self.company,
            leave_type=self.annual,
            start_date=date(2024, 4, 7),
            end_date=date(2024, 4, 9),  # 3 days, from the locked days first
            status=LeaveRequest.RequestStatus.APPROVED,
        )

        # 2024's own 21-day accrual is live-computed and stays payable; the inherited 10
        # locked days less the 3 taken stay locked. The two are never merged.
        self.assertEqual(get_prior_annual_carry_forward_split(self.profile, CYCLE_2025[0]), (_days("21"), _days("7")))
        self.assertEqual(get_prior_annual_carry_forward_days(self.profile, CYCLE_2025[0]), _days("28"))
        # The renewal notice to HR reports the term's whole unused balance, as before.
        self.assertEqual(get_unsettled_renewed_annual_term(self.profile, CYCLE_2025[0]), (*CYCLE_2024, _days("28")))

        snapshot = build_annual_leave_payment_snapshot(self.profile, as_of=CYCLE_2025[1])
        self.assertEqual(snapshot["eligible_unused_days"], _days("42"))  # 21 (2024, unsettled) + 21 (2025)
        self.assertEqual(snapshot["locked_unused_days"], _days("7"))
        self.assertEqual(snapshot["payment_amount"], Decimal("4200.00"))

        # The batched leave-balance path agrees on the total.
        batch = {
            "rows_by_profile": {
                self.profile.id: list(
                    LeaveRequest.objects.filter(employee_profile=self.profile).values(
                        "id",
                        "employee_id",
                        "employee_profile_id",
                        "leave_type_id",
                        "start_date",
                        "end_date",
                        "status",
                        "is_active",
                    )
                )
            },
            "leave_types_by_company": {self.company.id: [self.annual]},
            "adjustments": {},
            "payment_rows": list(
                AnnualLeavePaymentRequest.objects.values(
                    "id",
                    "employee_profile_id",
                    "cycle_end",
                    "status",
                    "carry_forward_days",
                    "eligible_unused_days",
                    "locked_unused_days",
                )
            ),
            "renewal_decisions_by_profile": {self.profile.id: list(_renewal_decisions([self.profile.id]))},
        }
        for cycle_start in (CYCLE_2024[0], CYCLE_2025[0]):
            with self.subTest(cycle_start=cycle_start):
                self.assertEqual(
                    _batch_prior_annual_carry_forward(batch, self.profile, cycle_start),
                    get_prior_annual_carry_forward_days(self.profile, cycle_start),
                )


class LockedCarryForwardApiTests(APITestCase):
    def setUp(self):
        head_office = OrganizationNode.objects.create(
            code="HEAD_OFFICE_LOCKED_API",
            name="Locked API Head Office",
            node_type=OrganizationNode.NodeType.HEAD_OFFICE,
        )
        self.company = OrganizationNode.objects.create(
            code="LOCKED_API_COMPANY",
            name="Locked API Company",
            node_type=OrganizationNode.NodeType.COMPANY,
            parent=head_office,
        )
        self.employee = User.objects.create_user(email="locked.api.employee@test.com", password="password")
        self.hr = User.objects.create_user(email="locked.api.hr@test.com", password="password")
        self.ceo = User.objects.create_user(email="locked.api.ceo@test.com", password="password")
        for user, role in ((self.employee, "Employee"), (self.hr, "HRManager"), (self.ceo, "CEO")):
            group, _ = Group.objects.get_or_create(name=role)
            user.groups.add(group)
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.company)
        # A 360-day-old contract: the final-five-days settlement window is open today.
        self.profile = EmployeeProfile.objects.create(
            user=self.employee,
            company=self.company,
            employee_id="EMP-LOCKED-API",
            full_name="Locked API Employee",
            contract_date=date.today() - timedelta(days=360),
            hire_date=date.today() - timedelta(days=360),
            total_salary=Decimal("3000.00"),
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        for user, employee_id in ((self.hr, "EMP-LOCKED-API-HR"), (self.ceo, "EMP-LOCKED-API-CEO")):
            EmployeeProfile.objects.create(user=user, company=self.company, employee_id=employee_id)
        LeaveType.objects.create(company=self.company, name="Annual Leave", code="ANNUAL", is_active=True)
        self.client.defaults["HTTP_X_ACTIVE_COMPANY_ID"] = str(self.company.id)

    @patch(NOTIFY)
    def test_hr_review_carry_forward_is_leave_only(self, notify):
        self.client.force_authenticate(self.employee)
        created = self.client.post("/api/leaves/annual-leave-payments/", {"employee_preference": "carry_forward"})
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        payment_id = created.data["data"]["id"]
        self.assertEqual(Decimal(str(created.data["data"]["locked_unused_days"])), Decimal("0.00"))

        self.client.force_authenticate(self.hr)
        review = self.client.post(
            f"/api/leaves/annual-leave-payments/{payment_id}/review/",
            {"decision": "carry_forward", "comment": "Leave only"},
        )
        self.assertEqual(review.status_code, status.HTTP_200_OK)
        self.assertEqual(review.data["data"]["resolution"], Resolution.CARRY_FORWARD)
        self.assertEqual(Decimal(str(review.data["data"]["payment_amount"])), Decimal("0.00"))

        self.client.force_authenticate(self.ceo)
        approved = self.client.post(f"/api/leaves/annual-leave-payments/{payment_id}/approve/", {})
        self.assertEqual(approved.status_code, status.HTTP_200_OK)
        self.assertEqual(approved.data["data"]["status"], Status.CARRIED_FORWARD)
        self.assertEqual(approved.data["data"]["resolution"], Resolution.CARRY_FORWARD)
        payment = AnnualLeavePaymentRequest.objects.get(pk=payment_id)
        self.assertEqual(payment.carry_forward_days, payment.eligible_unused_days)
        self.assertEqual(payment.payment_amount, Decimal("0.00"))

    @patch(NOTIFY)
    def test_hr_submitted_carry_forward_is_created_unpriced(self, notify):
        self.client.force_authenticate(self.hr)
        response = self.client.post(
            "/api/leaves/annual-leave-payments/",
            {"employee_id": self.profile.id, "decision": "carry_forward"},
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        data = response.data["data"]
        self.assertEqual((data["status"], data["resolution"]), (Status.PENDING_CEO, Resolution.CARRY_FORWARD))
        self.assertEqual(Decimal(str(data["payment_amount"])), Decimal("0.00"))
        self.assertEqual(Decimal(str(data["carry_forward_days"])), Decimal(str(data["eligible_unused_days"])))

    def test_employee_cannot_carry_forward_their_own_days(self):
        self.client.force_authenticate(self.employee)
        response = self.client.post("/api/leaves/annual-leave-payments/", {"decision": "carry_forward"})

        self.assertEqual(response.status_code, 422)
        self.assertFalse(AnnualLeavePaymentRequest.objects.exists())

    def test_eligibility_reports_leave_only_days_apart(self):
        AnnualLeavePaymentRequest.objects.create(
            employee=self.employee,
            employee_profile=self.profile,
            company=self.company,
            cycle_start=self.profile.contract_date - timedelta(days=365),
            cycle_end=self.profile.contract_date - timedelta(days=1),
            eligible_unused_days=Decimal("5.00"),
            carry_forward_days=Decimal("5.00"),
            resolution=Resolution.CARRY_FORWARD,
            status=Status.CARRIED_FORWARD,
        )
        self.client.force_authenticate(self.employee)
        response = self.client.get("/api/leaves/annual-leave-payments/eligibility/")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.data["data"]
        self.assertEqual(Decimal(str(data["locked_unused_days"])), Decimal("5.00"))
        # The estimate prices only the payable days.
        self.assertEqual(
            Decimal(str(data["estimated_payment_amount"])),
            annual_leave_payment_amount(Decimal(str(data["eligible_unused_days"])), Decimal("3000.00")),
        )


class TerminationLockedDaysPayoutTests(APITestCase):
    """HR's per-termination choice to pay leave-only days out in the final settlement."""

    TERMINATION_DATE = date(2025, 7, 15)

    def setUp(self):
        head_office = OrganizationNode.objects.create(
            code="HEAD_OFFICE_LOCKED_TERM",
            name="Locked Termination Head Office",
            node_type=OrganizationNode.NodeType.HEAD_OFFICE,
        )
        self.company = OrganizationNode.objects.create(
            code="LOCKED_TERM_COMPANY",
            name="Locked Termination Company",
            node_type=OrganizationNode.NodeType.COMPANY,
            parent=head_office,
        )
        self.hr = User.objects.create_user(email="locked.term.hr@test.com", password="password")
        self.ceo = User.objects.create_user(email="locked.term.ceo@test.com", password="password")
        for user, role in ((self.hr, "HRManager"), (self.ceo, "CEO")):
            group, _ = Group.objects.get_or_create(name=role)
            user.groups.add(group)
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.company)
        for user, employee_id in ((self.hr, "EMP-LOCKED-TERM-HR"), (self.ceo, "EMP-LOCKED-TERM-CEO")):
            EmployeeProfile.objects.create(user=user, company=self.company, employee_id=employee_id)
        LeaveType.objects.create(company=self.company, name="Annual Leave", code="ANNUAL", is_active=True)
        self.client.defaults["HTTP_X_ACTIVE_COMPANY_ID"] = str(self.company.id)

        self.leaver = self._employee("locked.term.leaver", EmployeeProfile.EmploymentStatus.TERMINATED)
        # 2024 was carried forward: 10 leave-only days open 2025.
        self._carried_forward(self.leaver, "10.00")

    def _employee(self, handle, employment_status):
        user = User.objects.create_user(email=f"{handle}@test.com", password="password")
        group, _ = Group.objects.get_or_create(name="Employee")
        user.groups.add(group)
        return EmployeeProfile.objects.create(
            user=user,
            company=self.company,
            employee_id=f"LT-{handle.rsplit('.', 1)[-1].upper()}"[:20],
            full_name=handle,
            contract_date=CYCLE_2024[0],
            hire_date=CYCLE_2024[0],
            total_salary=Decimal("3000.00"),
            employment_status=employment_status,
        )

    def _carried_forward(self, profile, days):
        AnnualLeavePaymentRequest.objects.create(
            employee=profile.user,
            employee_profile=profile,
            company=self.company,
            cycle_start=CYCLE_2024[0],
            cycle_end=CYCLE_2024[1],
            eligible_unused_days=Decimal(days),
            carry_forward_days=Decimal(days),
            resolution=Resolution.CARRY_FORWARD,
            status=Status.CARRIED_FORWARD,
        )

    def _create(self, profile=None, **payload):
        self.client.force_authenticate(self.hr)
        body = {"employee_id": (profile or self.leaver).id, "decision": "pay", **payload}
        if (profile or self.leaver).employment_status == EmployeeProfile.EmploymentStatus.TERMINATED:
            body.setdefault("termination_date", str(self.TERMINATION_DATE))
        return self.client.post("/api/leaves/annual-leave-payments/", body)

    def _approve(self, payment_id):
        self.client.force_authenticate(self.ceo)
        return self.client.post(f"/api/leaves/annual-leave-payments/{payment_id}/approve/", {})

    # --- snapshot ------------------------------------------------------------------------

    def test_snapshot_prices_locked_days_only_when_asked_on_a_termination(self):
        off = build_annual_leave_payment_snapshot(self.leaver, termination_date=self.TERMINATION_DATE)
        on = build_annual_leave_payment_snapshot(
            self.leaver, termination_date=self.TERMINATION_DATE, include_locked_days=True
        )
        # Six months into 2025: 10.50 accrued -> 10 payable; 10 leave-only carried in.
        for snapshot in (off, on):
            self.assertEqual(
                (snapshot["eligible_unused_days"], snapshot["locked_unused_days"]), (_days("10"), _days("10"))
            )
        self.assertEqual(off["payment_amount"], Decimal("1000.00"))
        self.assertEqual(on["payment_amount"], Decimal("2000.00"))

        # Not a termination: the flag has no effect.
        not_termination = build_annual_leave_payment_snapshot(
            self.leaver, as_of=self.TERMINATION_DATE, include_locked_days=True
        )
        self.assertEqual(not_termination["payment_amount"], Decimal("1000.00"))

    # --- flag off: today's behaviour --------------------------------------------------------

    @patch(NOTIFY)
    def test_termination_without_the_flag_forfeits_locked_days(self, notify):
        created = self._create()
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        data = created.data["data"]
        self.assertFalse(data["include_locked_days_in_termination_payout"])
        self.assertTrue(data["is_termination_settlement"])
        self.assertEqual(Decimal(str(data["locked_unused_days"])), Decimal("10.00"))
        self.assertEqual(Decimal(str(data["payment_amount"])), Decimal("1000.00"))

        approved = self._approve(data["id"])
        self.assertEqual(approved.data["data"]["status"], Status.APPROVED)
        self.assertEqual(Decimal(str(approved.data["data"]["payment_amount"])), Decimal("1000.00"))
        # The locked days were not paid, so they are still recorded as locked.
        self.assertEqual(get_prior_annual_carry_forward_split(self.leaver, CYCLE_2026[0]), (_days("0"), _days("10")))

    # --- flag on ---------------------------------------------------------------------------

    @patch(NOTIFY)
    def test_termination_with_the_flag_pays_locked_days_at_the_live_salary(self, notify):
        created = self._create(include_locked_days_in_termination_payout=True)
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        data = created.data["data"]
        self.assertTrue(data["include_locked_days_in_termination_payout"])
        self.assertEqual(Decimal(str(data["payment_amount"])), Decimal("2000.00"))  # 20 days x 3000 / 30

        # A raise lands before the CEO approves: the CEO re-price covers the locked days too.
        self.leaver.total_salary = Decimal("3600.00")
        self.leaver.save(update_fields=["total_salary"])
        approved = self._approve(data["id"])
        self.assertEqual(approved.status_code, status.HTTP_200_OK)
        payment = AnnualLeavePaymentRequest.objects.get(pk=data["id"])
        self.assertEqual(payment.status, Status.APPROVED)
        self.assertTrue(payment.include_locked_days_in_termination_payout)
        self.assertEqual(payment.payment_amount, Decimal("2400.00"))  # 20 x 3600 / 30
        # Paid out, so nothing is left to carry.
        self.assertEqual(get_prior_annual_carry_forward_split(self.leaver, CYCLE_2026[0]), (_days("0"), _days("0")))

    @patch(NOTIFY)
    def test_only_locked_days_left_can_still_be_paid_on_termination(self, notify):
        leaver = self._employee("locked.term.onlylocked", EmployeeProfile.EmploymentStatus.TERMINATED)
        self._carried_forward(leaver, "8.00")
        early = date(2025, 1, 20)  # no 2025 month completed yet: nothing payable but the locked days

        refused = self._create(leaver, termination_date=str(early))
        self.assertEqual(refused.status_code, 422)

        created = self._create(leaver, termination_date=str(early), include_locked_days_in_termination_payout=True)
        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.data)
        self.assertEqual(Decimal(str(created.data["data"]["payment_amount"])), Decimal("800.00"))

    @patch(NOTIFY)
    def test_hr_review_decides_the_flag_on_a_termination_settlement(self, notify):
        # Opened without a decision, so it waits for HR review.
        self.client.force_authenticate(self.hr)
        created = self.client.post(
            "/api/leaves/annual-leave-payments/",
            {"employee_id": self.leaver.id, "termination_date": str(self.TERMINATION_DATE)},
        )
        self.assertEqual(created.data["data"]["status"], Status.PENDING_HR)
        payment_id = created.data["data"]["id"]

        review = self.client.post(
            f"/api/leaves/annual-leave-payments/{payment_id}/review/",
            {"decision": "forward", "include_locked_days_in_termination_payout": True},
        )
        self.assertEqual(review.status_code, status.HTTP_200_OK, review.data)
        self.assertTrue(review.data["data"]["include_locked_days_in_termination_payout"])
        self.assertEqual(Decimal(str(review.data["data"]["payment_amount"])), Decimal("2000.00"))

    # --- scoped to termination settlements that pay ------------------------------------------

    def test_flag_is_refused_outside_a_paying_termination_settlement(self):
        active = self._employee("locked.term.active", EmployeeProfile.EmploymentStatus.ACTIVE)
        self._carried_forward(active, "10.00")
        with self.subTest("not a termination"):
            response = self._create(active, include_locked_days_in_termination_payout=True)
            self.assertEqual(response.status_code, 422)
        with self.subTest("termination carried forward"):
            response = self._create(decision="carry_forward", include_locked_days_in_termination_payout=True)
            self.assertEqual(response.status_code, 422)
        with self.subTest("employee self-service"):
            self.client.force_authenticate(self.leaver.user)
            response = self.client.post(
                "/api/leaves/annual-leave-payments/", {"include_locked_days_in_termination_payout": True}
            )
            self.assertEqual(response.status_code, 422)
        self.assertFalse(
            AnnualLeavePaymentRequest.objects.filter(include_locked_days_in_termination_payout=True).exists()
        )

    def test_hr_review_refuses_the_flag_on_a_non_termination_settlement(self):
        active = self._employee("locked.term.review", EmployeeProfile.EmploymentStatus.ACTIVE)
        payment = AnnualLeavePaymentRequest.objects.create(
            employee=active.user,
            employee_profile=active,
            company=self.company,
            cycle_start=CYCLE_2025[0],
            cycle_end=CYCLE_2025[1],
            eligible_unused_days=Decimal("21.00"),
            locked_unused_days=Decimal("10.00"),
            payment_amount=Decimal("2100.00"),
            status=Status.PENDING_HR,
        )
        self.client.force_authenticate(self.hr)
        response = self.client.post(
            f"/api/leaves/annual-leave-payments/{payment.id}/review/",
            {"decision": "forward", "include_locked_days_in_termination_payout": True},
        )

        self.assertEqual(response.status_code, 422)
        payment.refresh_from_db()
        self.assertEqual((payment.status, payment.payment_amount), (Status.PENDING_HR, Decimal("2100.00")))
        self.assertFalse(payment.include_locked_days_in_termination_payout)

    def test_model_refuses_the_flag_on_a_non_termination_record(self):
        from django.core.exceptions import ValidationError

        with self.assertRaises(ValidationError):
            AnnualLeavePaymentRequest.objects.create(
                employee=self.leaver.user,
                employee_profile=self.leaver,
                company=self.company,
                cycle_start=CYCLE_2025[0],
                cycle_end=CYCLE_2025[1],
                include_locked_days_in_termination_payout=True,
            )

    def test_settlement_picker_query_returns_only_terminated_archived_employees(self):
        """The Open Settlement picker asks for ``archive_state=archived&status=TERMINATED``."""
        terminated = self._employee("locked.term.picked", EmployeeProfile.EmploymentStatus.TERMINATED)
        other = self._employee("locked.term.otherarch", EmployeeProfile.EmploymentStatus.ACTIVE)
        EmployeeProfile.objects.filter(pk=terminated.pk).update(
            is_archived=True, archive_reason=EmployeeProfile.ArchiveReason.FIRED
        )
        EmployeeProfile.objects.filter(pk=other.pk).update(
            is_archived=True, archive_reason=EmployeeProfile.ArchiveReason.OTHER
        )
        self.client.force_authenticate(self.hr)

        response = self.client.get("/api/employees/?archive_state=archived&status=TERMINATED&page_size=300")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = {item["id"] for item in response.data["data"]["results"]}
        self.assertIn(terminated.id, ids)
        self.assertNotIn(other.id, ids)
        self.assertNotIn(self.leaver.id, ids)  # terminated but not archived: already in the default list
