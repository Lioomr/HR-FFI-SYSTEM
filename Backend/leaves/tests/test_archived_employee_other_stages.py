"""Archived employees: annual leave payment requests and the leave stages not covered by the first guard."""

from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APITestCase

from core.models import WorkflowAction
from employees.models import EmployeeProfile
from employees.services.archiving import retire_biotime_mapping_and_archive_profile
from leaves.annual_payment_services import (
    ARCHIVED_EMPLOYEE_MESSAGE as PAYMENT_ARCHIVED_MESSAGE,
)
from leaves.annual_payment_services import (
    apply_annual_payment_ceo_approval,
    apply_annual_payment_ceo_rejection,
    apply_annual_payment_hr_review,
)
from leaves.models import AnnualLeavePaymentRequest, LeaveRequest, LeaveType
from leaves.services import (
    ARCHIVED_EMPLOYEE_MESSAGE,
    LeaveTransitionError,
    apply_delegate_approval,
    apply_delegate_assignment,
    apply_hr_completion,
)
from organization.services import get_default_company

User = get_user_model()

LeaveStatus = LeaveRequest.RequestStatus
PaymentStatus = AnnualLeavePaymentRequest.Status


class ArchivedEmployeeOtherStagesTests(APITestCase):
    def setUp(self):
        self.company = get_default_company()
        self.leave_type = LeaveType.objects.create(company=self.company, name="Annual Leave", code="ANNUAL")
        Group.objects.get_or_create(name="HRManager")
        self.employee = self._user("other-stage-emp@example.com", "EMP-OSTAGE-1")
        self.actor = self._user("other-stage-actor@example.com", "EMP-OSTAGE-ACT")
        self.delegate = self._user("other-stage-delegate@example.com", "EMP-OSTAGE-DEL")
        self.profile = self.employee.employee_profile

    def _user(self, email, employee_id):
        user = User.objects.create_user(email=email, password="password")
        EmployeeProfile.objects.create(
            user=user,
            company=self.company,
            employee_id=employee_id,
            department="Ops",
            job_title="Staff",
            hire_date=date(2021, 1, 1),
        )
        return user

    def _leave(self, status, **extra):
        return LeaveRequest.objects.create(
            employee=self.employee,
            employee_profile=self.profile,
            leave_type=self.leave_type,
            start_date=date(2026, 11, 1),
            end_date=date(2026, 11, 3),
            status=status,
            **extra,
        )

    def _payment(self, status, *, termination=False):
        return AnnualLeavePaymentRequest.objects.create(
            employee=self.employee,
            employee_profile=self.profile,
            company=self.company,
            cycle_start=date(2025, 1, 1),
            cycle_end=date(2025, 12, 31),
            eligible_unused_days=Decimal("5"),
            status=status,
            is_termination_settlement=termination,
            submitted_by=self.employee,
        )

    def _mark_archived(self):
        EmployeeProfile._base_manager.filter(pk=self.profile.pk).update(is_archived=True)

    def _archive(self):
        snapshot = {}
        retire_biotime_mapping_and_archive_profile(self.profile, snapshot, self.actor, "RESIGNED", timezone.now())
        return snapshot

    # -- leave: delegate and HR completion -----------------------------------

    def test_archiving_cancels_leave_waiting_on_a_delegate_or_hr_completion(self):
        delegate_leave = self._leave(LeaveStatus.PENDING_DELEGATE, delegated_to=self.delegate)
        completion_leave = self._leave(LeaveStatus.PENDING_HR_COMPLETION)

        self._archive()

        for leave in (delegate_leave, completion_leave):
            leave.refresh_from_db()
            self.assertEqual(leave.status, LeaveStatus.CANCELLED)

    def test_delegate_and_hr_completion_stages_are_refused_for_an_archived_employee(self):
        delegate_leave = self._leave(LeaveStatus.PENDING_DELEGATE, delegated_to=self.delegate)
        completion_leave = self._leave(LeaveStatus.PENDING_HR_COMPLETION)
        hr_leave = self._leave(LeaveStatus.PENDING_HR)
        self._mark_archived()

        with self.assertRaises(LeaveTransitionError) as approval:
            apply_delegate_approval(delegate_leave, actor=self.delegate)
        self.assertEqual(str(approval.exception), ARCHIVED_EMPLOYEE_MESSAGE)
        with self.assertRaises(LeaveTransitionError):
            apply_hr_completion(completion_leave, actor=self.actor)
        with self.assertRaises(LeaveTransitionError):
            apply_delegate_assignment(hr_leave, actor=self.actor, delegated_to=self.delegate)

        delegate_leave.refresh_from_db()
        completion_leave.refresh_from_db()
        hr_leave.refresh_from_db()
        self.assertEqual(delegate_leave.status, LeaveStatus.PENDING_DELEGATE)
        self.assertEqual(completion_leave.status, LeaveStatus.PENDING_HR_COMPLETION)
        self.assertEqual(hr_leave.status, LeaveStatus.PENDING_HR)

    # -- annual leave payment requests ---------------------------------------

    def test_archiving_cancels_pending_payment_requests_but_not_termination_settlements(self):
        pending_hr = self._payment(PaymentStatus.PENDING_HR)
        pending_ceo = self._payment(PaymentStatus.PENDING_CEO)
        approved = self._payment(PaymentStatus.APPROVED)
        settlement = self._payment(PaymentStatus.PENDING_HR, termination=True)

        snapshot = self._archive()

        for payment in (pending_hr, pending_ceo, approved, settlement):
            payment.refresh_from_db()
        self.assertEqual(pending_hr.status, PaymentStatus.CANCELLED)
        self.assertEqual(pending_ceo.status, PaymentStatus.CANCELLED)
        self.assertIsNotNone(pending_hr.cancelled_at)
        self.assertEqual(approved.status, PaymentStatus.APPROVED)
        self.assertEqual(settlement.status, PaymentStatus.PENDING_HR)
        action = WorkflowAction.objects.filter(workflow__object_id=pending_hr.id).latest("id")
        self.assertIn("Archived employee (RESIGNED)", action.note)
        self.assertCountEqual(snapshot["annual_leave_payment_requests_cancelled"], [pending_hr.id, pending_ceo.id])

    def test_payment_approvals_are_refused_for_an_archived_employee(self):
        hr_payment = self._payment(PaymentStatus.PENDING_HR)
        ceo_payment = self._payment(PaymentStatus.PENDING_CEO)
        self._mark_archived()

        with self.assertRaises(LeaveTransitionError) as hr_error:
            apply_annual_payment_hr_review(hr_payment, actor=self.actor, decision="forward")
        self.assertEqual(str(hr_error.exception), PAYMENT_ARCHIVED_MESSAGE)
        with self.assertRaises(LeaveTransitionError):
            apply_annual_payment_ceo_approval(ceo_payment, actor=self.actor)

        hr_payment.refresh_from_db()
        self.assertEqual(hr_payment.status, PaymentStatus.PENDING_HR)

    def test_payment_rejecting_is_still_allowed_for_an_archived_employee(self):
        ceo_payment = self._payment(PaymentStatus.PENDING_CEO)
        self._mark_archived()

        apply_annual_payment_ceo_rejection(ceo_payment, actor=self.actor, comment="Employee archived")

        ceo_payment.refresh_from_db()
        self.assertEqual(ceo_payment.status, PaymentStatus.REJECTED)

    def test_a_termination_settlement_can_still_be_reviewed_after_the_archive(self):
        settlement = self._payment(PaymentStatus.PENDING_HR, termination=True)
        self._mark_archived()

        apply_annual_payment_hr_review(settlement, actor=self.actor, decision="forward")

        settlement.refresh_from_db()
        self.assertEqual(settlement.status, PaymentStatus.PENDING_CEO)
