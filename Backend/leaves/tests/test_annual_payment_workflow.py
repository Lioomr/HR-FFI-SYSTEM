from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.utils import timezone
from rest_framework.test import APITestCase

from core.models import WorkflowAction, WorkflowInstance
from core.services.workflow_engine import (
    build_pending_approval_item,
    get_pending_approvals_for_role,
    sync_workflow,
)
from employees.models import EmployeeProfile
from leaves.annual_payment_services import (
    NOT_PENDING_CEO_MESSAGE,
    NOT_PENDING_HR_MESSAGE,
    apply_annual_payment_ceo_approval,
    apply_annual_payment_ceo_rejection,
    apply_annual_payment_hr_review,
    record_annual_payment_submission,
)
from leaves.models import AnnualLeavePaymentRequest
from leaves.services import COMMENT_REQUIRED_MESSAGE, LeaveTransitionError
from organization.services import get_default_company

User = get_user_model()

Status = AnnualLeavePaymentRequest.Status
Action = WorkflowAction.Action


class AnnualPaymentWorkflowTests(APITestCase):
    def setUp(self):
        self.company = get_default_company()
        self.employee = self._user("settlement-employee@example.com", "EMP-SET-1")
        self.hr_user = self._user("settlement-hr@example.com", "EMP-SET-HR")
        self.ceo_user = self._user("settlement-ceo@example.com", "EMP-SET-CEO")

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

    def _payment(self, *, status=Status.PENDING_HR, **fields):
        return AnnualLeavePaymentRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee.employee_profile,
            company=self.company,
            cycle_start=date(2026, 1, 1),
            cycle_end=date(2026, 12, 31),
            eligible_unused_days=Decimal("10.00"),
            payment_amount=Decimal("1000.00"),
            submitted_by=self.employee,
            status=status,
            **fields,
        )

    def _workflow(self, payment):
        return WorkflowInstance.objects.get(
            content_type=ContentType.objects.get_for_model(AnnualLeavePaymentRequest), object_id=payment.id
        )

    def _steps(self, payment):
        return [
            (action.action, action.from_stage, action.to_stage, action.actor_id)
            for action in self._workflow(payment).actions.order_by("created_at", "id")
        ]

    def test_submission_review_and_ceo_approval_record_one_row_each(self):
        payment = self._payment()
        record_annual_payment_submission(payment, actor=self.employee)

        payment = apply_annual_payment_hr_review(payment, actor=self.hr_user, decision="forward", comment="Checked")
        payment = apply_annual_payment_ceo_approval(payment, actor=self.ceo_user, note="Pay it")

        expected = [
            (Action.SUBMIT, "", "hr", self.employee.id),
            (Action.ADVANCE, "hr", "ceo", self.hr_user.id),
            (Action.APPROVE, "ceo", "", self.ceo_user.id),
        ]
        self.assertEqual(payment.status, Status.APPROVED)
        self.assertEqual(self._steps(payment), expected)
        sync_workflow(payment)
        sync_workflow(payment)
        self.assertEqual(self._steps(payment), expected)
        self.assertEqual(self._workflow(payment).status, WorkflowInstance.Status.APPROVED)

    def test_carried_forward_balance_is_settled_as_carried_forward(self):
        payment = self._payment()
        record_annual_payment_submission(payment, actor=self.employee)

        payment = apply_annual_payment_hr_review(payment, actor=self.hr_user, decision="carry_forward")
        self.assertEqual((payment.payment_amount, payment.carry_forward_days), (Decimal("0"), Decimal("10.00")))
        payment = apply_annual_payment_ceo_approval(payment, actor=self.ceo_user)

        self.assertEqual(payment.status, Status.CARRIED_FORWARD)
        self.assertIsNotNone(payment.settled_at)
        self.assertEqual(self._workflow(payment).status, WorkflowInstance.Status.APPROVED)

    def test_ceo_approval_reprices_payout_at_the_live_salary(self):
        profile = self.employee.employee_profile
        profile.total_salary = Decimal("3000.00")
        profile.save(update_fields=["total_salary"])
        payment = self._payment(salary_at_year_end=Decimal("3000.00"))
        record_annual_payment_submission(payment, actor=self.employee)
        payment = apply_annual_payment_hr_review(payment, actor=self.hr_user, decision="forward")
        # A renewal with a raise lands while the payout waits on the CEO.
        profile.total_salary = Decimal("3600.00")
        profile.save(update_fields=["total_salary"])

        payment = apply_annual_payment_ceo_approval(payment, actor=self.ceo_user)

        payment.refresh_from_db()
        self.assertEqual(payment.status, Status.APPROVED)
        self.assertEqual(payment.salary_at_year_end, Decimal("3600.00"))
        self.assertEqual(payment.payment_amount, Decimal("1200.00"))  # 10 days x 3600 / 30
        approval = self._workflow(payment).actions.get(action=Action.APPROVE)
        self.assertEqual(approval.metadata["salary_refresh"]["previous_salary_at_year_end"], "3000.00")

    def test_ceo_approval_keeps_current_salary_snapshot_and_carry_forward_unpriced(self):
        profile = self.employee.employee_profile
        profile.total_salary = Decimal("3000.00")
        profile.save(update_fields=["total_salary"])
        current = self._payment(salary_at_year_end=Decimal("3000.00"))
        record_annual_payment_submission(current, actor=self.employee)
        current = apply_annual_payment_hr_review(current, actor=self.hr_user, decision="forward")
        carried = self._payment(salary_at_year_end=Decimal("2000.00"))
        record_annual_payment_submission(carried, actor=self.employee)
        carried = apply_annual_payment_hr_review(carried, actor=self.hr_user, decision="carry_forward")

        current = apply_annual_payment_ceo_approval(current, actor=self.ceo_user)
        carried = apply_annual_payment_ceo_approval(carried, actor=self.ceo_user)

        self.assertEqual((current.salary_at_year_end, current.payment_amount), (Decimal("3000.00"), Decimal("1000.00")))
        self.assertEqual((carried.salary_at_year_end, carried.payment_amount), (Decimal("2000.00"), Decimal("0")))

    def test_refusals(self):
        with self.assertRaisesMessage(LeaveTransitionError, NOT_PENDING_HR_MESSAGE):
            apply_annual_payment_hr_review(
                self._payment(status=Status.PENDING_CEO), actor=self.hr_user, decision="forward"
            )
        with self.assertRaisesMessage(LeaveTransitionError, NOT_PENDING_CEO_MESSAGE):
            apply_annual_payment_ceo_approval(self._payment(), actor=self.ceo_user)
        with self.assertRaisesMessage(LeaveTransitionError, COMMENT_REQUIRED_MESSAGE):
            apply_annual_payment_ceo_rejection(
                self._payment(status=Status.PENDING_CEO), actor=self.ceo_user, comment=" "
            )

    def test_payment_waiting_on_ceo_appears_in_ceo_inbox(self):
        payment = self._payment()
        record_annual_payment_submission(payment, actor=self.employee)
        payment = apply_annual_payment_hr_review(payment, actor=self.hr_user, decision="forward")

        workflow = self._workflow(payment)
        self.assertIn(workflow.id, {item.id for item in get_pending_approvals_for_role("ceo", limit=None)})
        item = build_pending_approval_item(workflow)
        self.assertEqual(
            (item["request_type"], item["request_type_label"]), ("ANNUAL_LEAVE_PAYMENT", "Annual Leave Settlement")
        )
        self.assertTrue(item["review_path"].endswith(f"/ceo/annual-leave-payments/{payment.id}"))

    def test_existing_payment_keeps_rebuilt_history_when_ceo_rejects(self):
        payment = self._payment(status=Status.PENDING_CEO)
        # HR reviewed it after submission, before recorded history existed.
        AnnualLeavePaymentRequest.objects.filter(pk=payment.pk).update(
            hr_reviewed_by=self.hr_user, hr_reviewed_at=timezone.now(), hr_review_note="Reviewed before the switch"
        )
        payment.refresh_from_db()

        apply_annual_payment_ceo_rejection(payment, actor=self.ceo_user, comment="Budget closed")

        actions = list(self._workflow(payment).actions.order_by("created_at", "id"))
        self.assertEqual(
            [action.metadata.get("legacy_signature") for action in actions[:2]],
            ["submitted", "hr"],
        )
        self.assertEqual(
            (actions[2].action, actions[2].from_stage, actions[2].metadata.get("recorded")),
            (Action.REJECT, "ceo", True),
        )
