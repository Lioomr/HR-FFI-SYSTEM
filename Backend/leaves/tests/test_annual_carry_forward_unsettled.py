"""Carry-forward of Annual Leave from a contract term a renewal closed out without a settlement.

A contract renewal (automatic at 59 days before expiry, or approved earlier through either
flow) moves ``contract_date``/``contract_expiry`` onto the new term before the employee's
final-five-days settlement window for the old term opens. With no settlement request for the
old term, its unused days used to reset to ``0.00`` in the next cycle's opening balance.
"""

from datetime import date, timedelta
from decimal import ROUND_FLOOR, Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from employees.models import ContractDecision, EmployeeProfile
from leaves.models import AnnualLeavePaymentRequest, LeaveRequest, LeaveType
from leaves.utils import (
    _annual_cycle_accrual,
    _batch_prior_annual_carry_forward,
    _renewal_decisions,
    build_annual_leave_payment_snapshot,
    get_previous_annual_cycle,
    get_prior_annual_carry_forward_days,
)
from organization.models import OrganizationNode

User = get_user_model()

TERM_2023 = (date(2023, 1, 1), date(2023, 12, 31))
TERM_2024 = (date(2024, 1, 1), date(2024, 12, 31))
TERM_2025 = (date(2025, 1, 1), date(2025, 12, 31))


class UnsettledAnnualCarryForwardTests(TestCase):
    def setUp(self):
        head_office = OrganizationNode.objects.create(
            code="HEAD_OFFICE_UNSETTLED_CARRY",
            name="Unsettled Carry Head Office",
            node_type=OrganizationNode.NodeType.HEAD_OFFICE,
        )
        self.company = OrganizationNode.objects.create(
            code="UNSETTLED_CARRY_COMPANY",
            name="Unsettled Carry Company",
            node_type=OrganizationNode.NodeType.COMPANY,
            parent=head_office,
        )
        self.employee = User.objects.create_user(email="unsettled.carry@test.com", password="password")
        self.profile = EmployeeProfile.objects.create(
            user=self.employee,
            company=self.company,
            employee_id="EMP-UNSETTLED-CARRY",
            full_name="Unsettled Carry Employee",
            contract_date=TERM_2023[0],
            contract_expiry=TERM_2023[1],
            hire_date=TERM_2023[0],
            total_salary=Decimal("3000.00"),
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        self.annual = LeaveType.objects.create(company=self.company, name="Annual Leave", code="ANNUAL", is_active=True)

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

    def _settlement(self, term, status, *, eligible="16.00", carry="0.00"):
        return AnnualLeavePaymentRequest.objects.create(
            employee=self.employee,
            employee_profile=self.profile,
            company=self.company,
            cycle_start=term[0],
            cycle_end=term[1],
            accrued_days=Decimal("21.00"),
            used_days=Decimal("5.00"),
            eligible_unused_days=Decimal(eligible),
            carry_forward_days=Decimal(carry),
            status=status,
        )

    def _renew(self, old, new, *, status=ContractDecision.Status.AUTO_RENEWED, **extra):
        """Record a finalized renewal exactly as the flows leave it: profile moved onto ``new``."""
        self.profile.contract_date, self.profile.contract_expiry = new
        self.profile.save(update_fields=["contract_date", "contract_expiry", "updated_at"])
        return ContractDecision.objects.create(
            company=self.company,
            employee_profile=self.profile,
            status=status,
            original_contract_date=old[0],
            original_contract_expiry=old[1],
            proposed_contract_date=new[0],
            proposed_contract_expiry=new[1],
            **extra,
        )

    # --- Behaviour that must not change -------------------------------------------------

    def test_first_cycle_of_employment_has_no_carry_forward(self):
        self._approved_leave(date(2023, 3, 5), date(2023, 3, 9))

        self.assertIsNone(get_previous_annual_cycle(self.profile, TERM_2023[0]))
        self.assertEqual(get_prior_annual_carry_forward_days(self.profile, TERM_2023[0]), Decimal("0.00"))

    def test_paid_out_prior_term_carries_nothing(self):
        self._renew(TERM_2023, TERM_2024)
        self._settlement(TERM_2023, AnnualLeavePaymentRequest.Status.APPROVED)

        self.assertEqual(get_prior_annual_carry_forward_days(self.profile, TERM_2024[0]), Decimal("0.00"))

    def test_carried_forward_prior_term_uses_recorded_carry_forward_days(self):
        self._renew(TERM_2023, TERM_2024)
        self._settlement(TERM_2023, AnnualLeavePaymentRequest.Status.CARRIED_FORWARD, eligible="16.00", carry="12.00")

        self.assertEqual(get_prior_annual_carry_forward_days(self.profile, TERM_2024[0]), Decimal("12.00"))

    def test_pending_and_rejected_prior_term_keep_recorded_eligible_days(self):
        self._renew(TERM_2023, TERM_2024)
        for status in (
            AnnualLeavePaymentRequest.Status.PENDING_HR,
            AnnualLeavePaymentRequest.Status.PENDING_CEO,
            AnnualLeavePaymentRequest.Status.REJECTED,
        ):
            with self.subTest(status=status):
                AnnualLeavePaymentRequest.objects.all().delete()
                # A recorded figure deliberately different from the live one (21 accrued, 0 used).
                self._settlement(TERM_2023, status, eligible="9.00")

                self.assertEqual(get_prior_annual_carry_forward_days(self.profile, TERM_2024[0]), Decimal("9.00"))

    def test_anniversary_cycle_without_a_renewal_keeps_existing_rule(self):
        # No contract term and no renewal: the employee's own settlement window was reachable,
        # so the pre-existing rule (no settlement -> nothing carried) is deliberately unchanged.
        self.profile.contract_expiry = None
        self.profile.save(update_fields=["contract_expiry", "updated_at"])

        self.assertIsNone(get_previous_annual_cycle(self.profile, date(2024, 1, 1)))
        self.assertEqual(get_prior_annual_carry_forward_days(self.profile, date(2024, 1, 1)), Decimal("0.00"))

    def test_unfinalized_rejected_or_termination_decisions_do_not_define_a_prior_term(self):
        for status, decision_type in (
            (ContractDecision.Status.REJECTED, ContractDecision.DecisionType.RENEW),
            (ContractDecision.Status.APPROVED, ContractDecision.DecisionType.TERMINATE),
            (ContractDecision.Status.PENDING_CEO, ContractDecision.DecisionType.RENEW),
            (ContractDecision.Status.MANUAL_RESOLUTION_REQUIRED, ContractDecision.DecisionType.RENEW),
        ):
            with self.subTest(status=status, decision_type=decision_type):
                ContractDecision.objects.all().delete()
                self._renew(TERM_2023, TERM_2024, status=status, decision_type=decision_type)

                self.assertIsNone(get_previous_annual_cycle(self.profile, TERM_2024[0]))
                self.assertEqual(get_prior_annual_carry_forward_days(self.profile, TERM_2024[0]), Decimal("0.00"))

    # --- The fixed case: a renewal closed the term with no settlement --------------------

    def test_unsettled_term_closed_by_auto_renewal_carries_its_unused_days(self):
        self._renew(TERM_2023, TERM_2024)
        self._approved_leave(date(2023, 3, 5), date(2023, 3, 9))  # 5 working days

        self.assertEqual(get_previous_annual_cycle(self.profile, TERM_2024[0]), (*TERM_2023, TERM_2023[0]))
        # 12 months x 1.75 = 21 accrued, 5 used -> 16 (was 0.00 before the fix).
        self.assertEqual(get_prior_annual_carry_forward_days(self.profile, TERM_2024[0]), Decimal("16"))

        snapshot = build_annual_leave_payment_snapshot(self.profile, as_of=date(2024, 1, 15))
        self.assertEqual(snapshot["cycle_start"], TERM_2024[0])
        self.assertEqual(snapshot["accrued_days"], Decimal("16.00"))  # opening 16 + 0 accrued yet in 2024

    def test_rating_flow_and_legacy_approved_renewals_are_recognised(self):
        for decision_type in (ContractDecision.DecisionType.RENEW, ContractDecision.DecisionType.RENEW_WITH_CHANGES):
            with self.subTest(decision_type=decision_type):
                ContractDecision.objects.all().delete()
                self._renew(TERM_2023, TERM_2024, status=ContractDecision.Status.APPROVED, decision_type=decision_type)

                self.assertEqual(get_prior_annual_carry_forward_days(self.profile, TERM_2024[0]), Decimal("21"))

    def test_legacy_renewal_without_stored_proposed_dates_is_recognised(self):
        # finalize_decision derives the renewed dates and does not store them on the decision.
        self._renew(
            TERM_2023,
            TERM_2024,
            status=ContractDecision.Status.AUTO_APPROVED,
            decision_type=ContractDecision.DecisionType.RENEW,
        )
        ContractDecision.objects.update(proposed_contract_date=None, proposed_contract_expiry=None)

        self.assertEqual(get_prior_annual_carry_forward_days(self.profile, TERM_2024[0]), Decimal("21"))

    def test_older_settlement_is_opening_of_unsettled_term_and_counted_once(self):
        self._renew(TERM_2023, TERM_2024)
        self._settlement(TERM_2023, AnnualLeavePaymentRequest.Status.CARRIED_FORWARD, carry="6.00")
        self._renew(TERM_2024, TERM_2025)
        self._approved_leave(date(2024, 4, 7), date(2024, 4, 9))  # 3 days in the unsettled 2024 term

        # 6 carried into 2024 + 21 accrued in 2024 - 3 used = 24; the 2023 carry is not added again.
        self.assertEqual(get_prior_annual_carry_forward_days(self.profile, TERM_2025[0]), Decimal("24"))

    def test_live_lookup_is_exactly_one_term_deep(self):
        # 2023 and 2024 both unsettled: 2024's opening comes only from recorded settlements (none),
        # never from another live computation of 2023, so there is no recursive chain.
        self._renew(TERM_2023, TERM_2024)
        self._renew(TERM_2024, TERM_2025)
        self._approved_leave(date(2024, 4, 7), date(2024, 4, 9))

        self.assertEqual(get_prior_annual_carry_forward_days(self.profile, TERM_2025[0]), Decimal("18"))

    def test_running_term_closed_early_by_renewal_accrues_only_to_today(self):
        today = date.today()
        old = (today - timedelta(days=300), today + timedelta(days=59))
        new = (old[1] + timedelta(days=1), old[1] + timedelta(days=365))
        self._renew(old, new)
        _periods, accrued_to_today = _annual_cycle_accrual(old[0], old[1], today, old[0])

        carried = get_prior_annual_carry_forward_days(self.profile, new[0])

        self.assertLess(accrued_to_today, Decimal("21.00"))
        self.assertEqual(carried, accrued_to_today.quantize(Decimal("1"), rounding=ROUND_FLOOR))

    def test_batched_balance_path_matches_single_profile_path(self):
        self._renew(TERM_2023, TERM_2024)
        self._settlement(TERM_2023, AnnualLeavePaymentRequest.Status.CARRIED_FORWARD, carry="6.00")
        self._renew(TERM_2024, TERM_2025)
        self._approved_leave(date(2024, 4, 7), date(2024, 4, 9))
        rows = list(
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
        batch = {
            "rows_by_profile": {self.profile.id: rows},
            "leave_types_by_company": {self.company.id: [self.annual]},
            "adjustments": {},
            "payment_rows": list(
                AnnualLeavePaymentRequest.objects.values(
                    "id", "employee_profile_id", "cycle_end", "status", "carry_forward_days", "eligible_unused_days"
                )
            ),
            "renewal_decisions_by_profile": {self.profile.id: list(_renewal_decisions([self.profile.id]))},
        }

        for cycle_start in (TERM_2023[0], TERM_2024[0], TERM_2025[0]):
            with self.subTest(cycle_start=cycle_start):
                self.assertEqual(
                    _batch_prior_annual_carry_forward(batch, self.profile, cycle_start),
                    get_prior_annual_carry_forward_days(self.profile, cycle_start),
                )
        self.assertEqual(get_prior_annual_carry_forward_days(self.profile, TERM_2025[0]), Decimal("24"))
