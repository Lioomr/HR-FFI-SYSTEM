from datetime import date
from decimal import Decimal
from unittest import mock

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.contenttypes.models import ContentType
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import DelegationRule, WorkflowAction, WorkflowInstance
from employees.models import EmployeeProfile
from loans.models import LoanRequest
from loans.services import apply_hr_recommendation, apply_manager_recommendation, record_loan_submission
from organization.models import UserOrganizationAccess
from organization.services import get_default_company

User = get_user_model()
Status = LoanRequest.RequestStatus
Recommendation = LoanRequest.Recommendation


class LoanManagerCoversCfoTests(TestCase):
    def setUp(self):
        self.company = get_default_company()
        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.cfo_group, _ = Group.objects.get_or_create(name="CFO")
        self.admin_group, _ = Group.objects.get_or_create(name="SystemAdmin")
        self.manager, self.manager_profile = self._user("cfo-loop-manager@example.com", "EMP-CFO-MGR")
        self.employee, self.employee_profile = self._user(
            "cfo-loop-employee@example.com", "EMP-CFO-EMP", manager_profile=self.manager_profile
        )
        self.hr_user, _ = self._user("cfo-loop-hr@example.com", "EMP-CFO-HR", groups=[self.hr_group])
        UserOrganizationAccess.objects.get_or_create(user=self.hr_user, organization=self.company)
        self.client = APIClient()

    def _user(self, email, employee_id, *, manager_profile=None, groups=()):
        user = User.objects.create_user(email=email, password="password")
        for group in groups:
            user.groups.add(group)
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

    def _loan(self, *, employee=None, profile=None):
        employee = employee or self.employee
        profile = profile or self.employee_profile
        loan = LoanRequest.objects.create(
            employee=employee,
            employee_profile=profile,
            company=self.company,
            requested_amount=Decimal("1500.00"),
            loan_type=LoanRequest.LoanType.OPEN,
            reason="Car repair",
            status=Status.PENDING_MANAGER,
        )
        record_loan_submission(loan, actor=employee)
        return loan

    def _cfo_history(self, loan):
        workflow = WorkflowInstance.objects.get(
            content_type=ContentType.objects.get_for_model(LoanRequest), object_id=loan.id
        )
        return workflow.actions.filter(
            action=WorkflowAction.Action.APPROVE,
            approver_role="cfo",
        )

    def test_cfo_manager_is_not_asked_again_after_hr_approves(self):
        self.manager.groups.add(self.cfo_group)
        loan, _ = apply_manager_recommendation(self._loan(), actor=self.manager, recommendation=Recommendation.APPROVE)

        loan = apply_hr_recommendation(loan, actor=self.hr_user, recommendation=Recommendation.APPROVE)

        self.assertEqual(loan.status, Status.PENDING_DISBURSEMENT)
        self.assertEqual(loan.approved_amount, Decimal("1500.00"))
        self.assertEqual(loan.cfo_decision_by, self.manager)
        self.assertIsNotNone(loan.cfo_decision_at)
        cfo_action = self._cfo_history(loan).get()
        self.assertEqual((cfo_action.actor, cfo_action.metadata["auto_satisfied_by"]), (self.manager, "manager"))

    def test_manager_who_is_hr_and_cfo_completes_both_later_stages(self):
        self.manager.groups.add(self.hr_group, self.cfo_group)

        loan, _ = apply_manager_recommendation(self._loan(), actor=self.manager, recommendation=Recommendation.APPROVE)

        self.assertEqual(loan.status, Status.PENDING_DISBURSEMENT)
        self.assertEqual(loan.finance_decision_by, self.manager)
        self.assertEqual(loan.cfo_decision_by, self.manager)
        self.assertEqual(self._cfo_history(loan).get().metadata["auto_satisfied_by"], "manager")

    def test_reject_recommendations_keep_the_cfo_decision_explicit(self):
        self.manager.groups.add(self.cfo_group)
        manager_reject, _ = apply_manager_recommendation(
            self._loan(), actor=self.manager, recommendation=Recommendation.REJECT
        )
        manager_reject = apply_hr_recommendation(
            manager_reject, actor=self.hr_user, recommendation=Recommendation.APPROVE
        )

        hr_reject, _ = apply_manager_recommendation(
            self._loan(), actor=self.manager, recommendation=Recommendation.APPROVE
        )
        hr_reject = apply_hr_recommendation(hr_reject, actor=self.hr_user, recommendation=Recommendation.REJECT)

        for loan in (manager_reject, hr_reject):
            with self.subTest(loan=loan.id):
                self.assertEqual(loan.status, Status.PENDING_CFO)
                self.assertIsNone(loan.cfo_decision_by)
                self.assertFalse(self._cfo_history(loan).exists())

    def test_system_admin_and_delegated_managers_do_not_cover_cfo(self):
        admin_manager, admin_profile = self._user(
            "cfo-loop-admin@example.com",
            "EMP-CFO-ADMIN",
            groups=[self.admin_group, self.cfo_group],
        )
        admin_employee, admin_employee_profile = self._user(
            "cfo-loop-admin-report@example.com",
            "EMP-CFO-ADMIN-REPORT",
            manager_profile=admin_profile,
        )
        admin_loan, _ = apply_manager_recommendation(
            self._loan(employee=admin_employee, profile=admin_employee_profile),
            actor=admin_manager,
            recommendation=Recommendation.APPROVE,
        )
        admin_loan = apply_hr_recommendation(admin_loan, actor=self.hr_user, recommendation=Recommendation.APPROVE)

        delegate, _ = self._user("cfo-loop-delegate@example.com", "EMP-CFO-DELEGATE", groups=[self.cfo_group])
        DelegationRule.objects.create(
            from_user=self.manager,
            to_user=delegate,
            start_at=timezone.now(),
            created_by=self.manager,
        )
        delegated_loan, source = apply_manager_recommendation(
            self._loan(), actor=delegate, recommendation=Recommendation.APPROVE
        )
        delegated_loan = apply_hr_recommendation(
            delegated_loan, actor=self.hr_user, recommendation=Recommendation.APPROVE
        )

        self.assertEqual(source, "delegate")
        for loan in (admin_loan, delegated_loan):
            with self.subTest(loan=loan.id):
                self.assertEqual(loan.status, Status.PENDING_CFO)
                self.assertIsNone(loan.cfo_decision_by)

    def test_ordinary_manager_still_hands_the_loan_to_a_different_cfo(self):
        loan, _ = apply_manager_recommendation(self._loan(), actor=self.manager, recommendation=Recommendation.APPROVE)

        loan = apply_hr_recommendation(loan, actor=self.hr_user, recommendation=Recommendation.APPROVE)

        self.assertEqual(loan.status, Status.PENDING_CFO)
        self.assertIsNone(loan.cfo_decision_by)

    def test_final_recommendation_notifies_disbursement_instead_of_cfo(self):
        self.manager.groups.add(self.cfo_group)
        loan, _ = apply_manager_recommendation(self._loan(), actor=self.manager, recommendation=Recommendation.APPROVE)
        self.client.force_authenticate(user=self.hr_user)

        with (
            mock.patch("loans.views.get_disbursement_approver_users", return_value=["accountant"]),
            mock.patch("loans.views.get_cfo_approver_users") as cfo_users,
            mock.patch("loans.views.notify_users_for_pending_status") as notify,
        ):
            response = self.client.post(
                f"/api/loans/loan-requests/{loan.id}/approve/",
                {"comment": "Recommended"},
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["data"]["status"], Status.PENDING_DISBURSEMENT)
        cfo_users.assert_not_called()
        notify.assert_called_once()
        self.assertEqual(notify.call_args.kwargs["users"], ["accountant"])
        self.assertEqual(notify.call_args.kwargs["request_type"], "Loan Disbursement")
        self.assertEqual(notify.call_args.kwargs["status_label"], Status.PENDING_DISBURSEMENT)
        self.assertEqual(notify.call_args.kwargs["action_path"], f"/finance/loan-requests/{loan.id}")

    def test_disbursement_audience_excludes_system_admin_viewers(self):
        from core.services.pending_approval_email import get_disbursement_approver_users

        admin, _ = self._user(
            "cfo-loop-disbursement-admin@example.com",
            "EMP-CFO-DISB-ADMIN",
            groups=[self.admin_group],
        )

        self.assertNotIn(admin, get_disbursement_approver_users())
