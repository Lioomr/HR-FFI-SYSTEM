from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.test import TestCase

from core.models import WorkflowAction, WorkflowInstance
from core.services.workflow_engine import sync_workflow
from employees.models import EmployeeProfile
from loans.models import LoanRequest
from loans.services import (
    NOT_CANCELLABLE_MESSAGE,
    SELF_APPROVAL_MESSAGE,
    LoanTransitionError,
    apply_cancellation,
    apply_ceo_approval,
    apply_ceo_referral,
    apply_disbursement,
    apply_hr_recommendation,
    apply_manager_recommendation,
    record_loan_submission,
)
from organization.services import get_default_company

User = get_user_model()

Status = LoanRequest.RequestStatus
Recommendation = LoanRequest.Recommendation
Action = WorkflowAction.Action


class LoanWorkflowHistoryTests(TestCase):
    def setUp(self):
        self.company = get_default_company()
        self.manager, manager_profile = self._user("loan-history-manager@example.com", "EMP-LOANH-MGR")
        self.employee, self.profile = self._user(
            "loan-history-employee@example.com", "EMP-LOANH-1", manager_profile=manager_profile
        )
        self.hr_user, _ = self._user("loan-history-hr@example.com", "EMP-LOANH-HR")
        self.cfo_user, _ = self._user("loan-history-cfo@example.com", "EMP-LOANH-CFO")
        self.ceo_user, _ = self._user("loan-history-ceo@example.com", "EMP-LOANH-CEO")
        self.accountant, _ = self._user("loan-history-accountant@example.com", "EMP-LOANH-ACC")

    def _user(self, email, employee_id, *, manager_profile=None):
        user = User.objects.create_user(email=email, password="password")
        profile = EmployeeProfile.objects.create(
            user=user,
            company=self.company,
            employee_id=employee_id,
            department="Ops",
            job_title="Staff",
            hire_date=date(2021, 1, 1),
            manager_profile=manager_profile,
        )
        return user, profile

    def _loan(self, *, status=Status.PENDING_MANAGER):
        return LoanRequest.objects.create(
            employee=self.employee,
            employee_profile=self.profile,
            company=self.company,
            requested_amount=Decimal("1500.00"),
            loan_type=LoanRequest.LoanType.OPEN,
            reason="Car repair",
            status=status,
        )

    def _workflow(self, loan):
        return WorkflowInstance.objects.get(
            content_type=ContentType.objects.get_for_model(LoanRequest), object_id=loan.id
        )

    def _steps(self, loan):
        return [
            (action.action, action.from_stage, action.to_stage, action.actor_id)
            for action in self._workflow(loan).actions.order_by("created_at", "id")
        ]

    def test_full_route_records_one_row_per_decision_and_resync_adds_nothing(self):
        loan = self._loan()
        record_loan_submission(loan, actor=self.employee)

        loan, actor_source = apply_manager_recommendation(
            loan, actor=self.manager, recommendation=Recommendation.REJECT, note="Too large"
        )
        loan = apply_hr_recommendation(loan, actor=self.hr_user, recommendation=Recommendation.APPROVE)
        loan = apply_ceo_referral(loan, actor=self.cfo_user, comment="Needs CEO")
        loan = apply_ceo_approval(loan, actor=self.ceo_user)
        loan = apply_disbursement(loan, actor=self.accountant, note="Paid")

        expected = [
            (Action.SUBMIT, "", "manager", self.employee.id),
            (Action.ADVANCE, "manager", "hr", self.manager.id),
            (Action.ADVANCE, "hr", "cfo", self.hr_user.id),
            (Action.ADVANCE, "cfo", "ceo", self.cfo_user.id),
            (Action.APPROVE, "ceo", "disbursement", self.ceo_user.id),
            (Action.DISBURSE, "disbursement", "", self.accountant.id),
        ]
        self.assertEqual(actor_source, "direct_manager")
        self.assertEqual(loan.status, Status.APPROVED)
        self.assertEqual(loan.approved_amount, Decimal("1500.00"))
        self.assertEqual(self._steps(loan), expected)
        manager_row = self._workflow(loan).actions.get(from_stage="manager")
        self.assertEqual((manager_row.note, manager_row.metadata["recommendation"]), ("Too large", "reject"))
        sync_workflow(loan)
        sync_workflow(loan)
        self.assertEqual(self._steps(loan), expected)

    def test_self_approval_is_refused(self):
        loan = self._loan(status=Status.PENDING_HR)

        with self.assertRaisesMessage(LoanTransitionError, SELF_APPROVAL_MESSAGE):
            apply_hr_recommendation(loan, actor=self.employee, recommendation=Recommendation.APPROVE)

    def test_only_the_requester_cancels_a_pending_loan_and_it_is_recorded(self):
        loan = self._loan(status=Status.PENDING_CFO)

        with self.assertRaises(LoanTransitionError) as caught:
            apply_cancellation(loan, actor=self.hr_user)
        self.assertEqual(caught.exception.status, 403)

        loan = apply_cancellation(loan, actor=self.employee)
        self.assertEqual(loan.status, Status.CANCELLED)
        self.assertEqual(self._workflow(loan).actions.order_by("created_at", "id").last().action, Action.CANCEL)
        with self.assertRaisesMessage(LoanTransitionError, NOT_CANCELLABLE_MESSAGE):
            apply_cancellation(loan, actor=self.employee)
