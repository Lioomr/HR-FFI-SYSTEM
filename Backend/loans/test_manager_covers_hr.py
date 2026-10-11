from unittest import mock

from loans.models import LoanRequest
from loans.services import apply_hr_recommendation, apply_manager_recommendation, record_loan_submission
from loans.test_loan_workflow_history import Recommendation, Status, LoanWorkflowHistoryTests as _Base


class LoanManagerCoversHrTests(_Base):
    def _hr_manager_as_line_manager(self):
        from django.contrib.auth.models import Group

        self.manager.groups.add(Group.objects.get_or_create(name="HRManager")[0])

    def test_hr_manager_as_line_manager_sends_the_loan_straight_to_the_cfo(self):
        self._hr_manager_as_line_manager()
        loan = self._loan()
        record_loan_submission(loan, actor=self.employee)

        loan, _ = apply_manager_recommendation(loan, actor=self.manager, recommendation=Recommendation.APPROVE)

        self.assertEqual(loan.status, Status.PENDING_CFO)
        self.assertEqual(loan.finance_decision_by, self.manager)
        self.assertEqual(loan.hr_recommendation, Recommendation.APPROVE)
        roles = [
            (a.approver_role, a.metadata.get("auto_satisfied_by"))
            for a in self._workflow(loan).actions.order_by("id")
        ]
        self.assertEqual(roles[-2:], [("manager", None), ("hr", "manager")])

    def test_ordinary_manager_still_hands_over_to_hr(self):
        loan = self._loan()
        record_loan_submission(loan, actor=self.employee)

        loan, _ = apply_manager_recommendation(loan, actor=self.manager, recommendation=Recommendation.APPROVE)

        self.assertEqual(loan.status, Status.PENDING_HR)
        apply_hr_recommendation(loan, actor=self.hr_user, recommendation=Recommendation.APPROVE)

    def test_cfo_is_notified_when_hr_is_covered(self):
        from loans.views import _next_approvers_after_manager

        self._hr_manager_as_line_manager()
        loan = self._loan()
        record_loan_submission(loan, actor=self.employee)
        loan, _ = apply_manager_recommendation(loan, actor=self.manager, recommendation=Recommendation.APPROVE)

        with mock.patch("loans.views.get_cfo_approver_users", return_value=["cfo"]):
            users, path = _next_approvers_after_manager(loan)

        self.assertEqual((users, path), (["cfo"], f"/cfo/loan-requests/{loan.id}"))
