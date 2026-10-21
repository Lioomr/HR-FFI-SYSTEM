from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from core.models import WorkflowAction
from core.services import notify_profile_request_status_whatsapp
from employees.models import EmployeeProfile
from employees.services.archiving import retire_biotime_mapping_and_archive_profile
from loans.models import LoanRequest
from loans.services import (
    ARCHIVED_EMPLOYEE_MESSAGE,
    LoanTransitionError,
    apply_ceo_approval,
    apply_ceo_referral,
    apply_cfo_approval,
    apply_cfo_rejection,
    apply_disbursement,
    apply_hr_cancellation,
    apply_hr_recommendation,
    apply_manager_recommendation,
)
from organization.services import get_default_company

User = get_user_model()

Status = LoanRequest.RequestStatus


class ArchivedEmployeeLoanRequestTests(TestCase):
    def setUp(self):
        self.company = get_default_company()
        self.manager, manager_profile = self._user("loan-arch-manager@example.com", "EMP-LARCH-MGR")
        self.employee, self.profile = self._user(
            "loan-arch-employee@example.com", "EMP-LARCH-1", manager_profile=manager_profile
        )
        self.actor, _ = self._user("loan-arch-actor@example.com", "EMP-LARCH-ACT")

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

    def _loan(self, status):
        return LoanRequest.objects.create(
            employee=self.employee,
            employee_profile=self.profile,
            company=self.company,
            requested_amount=Decimal("1500.00"),
            loan_type=LoanRequest.LoanType.OPEN,
            reason="Car repair",
            status=status,
        )

    def _mark_archived(self):
        EmployeeProfile._base_manager.filter(pk=self.profile.pk).update(is_archived=True)

    def _archive(self):
        snapshot = {}
        retire_biotime_mapping_and_archive_profile(self.profile, snapshot, self.actor, "RESIGNED", timezone.now())
        return snapshot

    def test_archiving_cancels_every_unpaid_loan_and_records_the_reason(self):
        open_statuses = [
            Status.SUBMITTED,
            Status.PENDING_MANAGER,
            Status.PENDING_HR,
            Status.PENDING_CFO,
            Status.PENDING_CEO,
            Status.PENDING_DISBURSEMENT,
        ]
        loans = [self._loan(status) for status in open_statuses]

        snapshot = self._archive()

        for loan in loans:
            loan.refresh_from_db()
            self.assertEqual(loan.status, Status.CANCELLED)
            action = WorkflowAction.objects.filter(workflow__object_id=loan.id, action=WorkflowAction.Action.CANCEL)
            self.assertIn("Archived employee (RESIGNED)", action.latest("id").note)
        self.assertCountEqual(snapshot["loan_requests_cancelled"], [loan.id for loan in loans])

    def test_archiving_leaves_paid_and_closed_loans_alone(self):
        approved = self._loan(Status.APPROVED)
        rejected = self._loan(Status.REJECTED)

        snapshot = self._archive()

        approved.refresh_from_db()
        rejected.refresh_from_db()
        self.assertEqual(approved.status, Status.APPROVED)
        self.assertEqual(rejected.status, Status.REJECTED)
        self.assertNotIn("loan_requests_cancelled", snapshot)

    def test_every_approval_or_advance_is_refused_for_an_archived_employee(self):
        manager_loan = self._loan(Status.PENDING_MANAGER)
        hr_loan = self._loan(Status.PENDING_HR)
        cfo_loan = self._loan(Status.PENDING_CFO)
        ceo_loan = self._loan(Status.PENDING_CEO)
        disbursement_loan = self._loan(Status.PENDING_DISBURSEMENT)
        self._mark_archived()

        calls = [
            lambda: apply_manager_recommendation(
                manager_loan, actor=self.manager, recommendation=LoanRequest.Recommendation.APPROVE
            ),
            lambda: apply_hr_recommendation(
                hr_loan, actor=self.actor, recommendation=LoanRequest.Recommendation.APPROVE
            ),
            lambda: apply_cfo_approval(cfo_loan, actor=self.actor),
            lambda: apply_ceo_referral(cfo_loan, actor=self.actor, comment="Needs CEO"),
            lambda: apply_ceo_approval(ceo_loan, actor=self.actor),
            lambda: apply_disbursement(disbursement_loan, actor=self.actor),
        ]
        for call in calls:
            with self.assertRaises(LoanTransitionError) as raised:
                call()
            self.assertEqual(str(raised.exception), ARCHIVED_EMPLOYEE_MESSAGE)

        cfo_loan.refresh_from_db()
        self.assertEqual(cfo_loan.status, Status.PENDING_CFO)

    def test_rejecting_and_hr_cancelling_stay_allowed_for_an_archived_employee(self):
        cfo_loan = self._loan(Status.PENDING_CFO)
        hr_loan = self._loan(Status.PENDING_HR)
        self._mark_archived()

        apply_cfo_rejection(cfo_loan, actor=self.actor, comment="Employee archived")
        apply_hr_cancellation(hr_loan, actor=self.actor, note="Employee archived")

        cfo_loan.refresh_from_db()
        hr_loan.refresh_from_db()
        self.assertEqual(cfo_loan.status, Status.REJECTED)
        self.assertEqual(hr_loan.status, Status.CANCELLED)

    def test_hr_cannot_cancel_an_early_stage_loan_of_an_active_employee(self):
        loan = self._loan(Status.PENDING_HR)

        with self.assertRaises(LoanTransitionError):
            apply_hr_cancellation(loan, actor=self.actor)

    def test_no_status_notification_goes_to_an_archived_employee(self):
        self._mark_archived()
        profile = EmployeeProfile._base_manager.get(pk=self.profile.pk)

        with patch("in_app_notifications.integrations.dispatch_notification_channels") as dispatch:
            result = notify_profile_request_status_whatsapp(
                profile=profile, request_type="Loan Request", request_id=1, status_label="Rejected"
            )

        dispatch.assert_not_called()
        self.assertTrue(result["skipped"])
