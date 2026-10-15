"""The employee cancels their own pending annual leave settlement request."""

from datetime import date
from decimal import Decimal

from audit.models import AuditLog
from core.models import WorkflowAction, WorkflowInstance
from core.services.workflow_engine import get_pending_approvals_for_role
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.contenttypes.models import ContentType
from employees.models import EmployeeProfile
from organization.models import UserOrganizationAccess
from organization.services import get_default_company
from rest_framework import status
from rest_framework.test import APITestCase

from leaves.annual_payment_services import (
    NOT_CANCELLABLE_MESSAGE,
    apply_annual_payment_hr_review,
    record_annual_payment_submission,
)
from leaves.models import AnnualLeavePaymentRequest
from leaves.utils import has_active_annual_leave_settlement

User = get_user_model()

Status = AnnualLeavePaymentRequest.Status
Action = WorkflowAction.Action
URL = "/api/leaves/annual-leave-payments/"


class AnnualPaymentRequesterCancelTests(APITestCase):
    def setUp(self):
        self.company = get_default_company()
        self.employee = self._user("settlement-cancel-employee@example.com", "EMP-SCX-1")
        self.colleague = self._user("settlement-cancel-colleague@example.com", "EMP-SCX-2")
        self.hr_user = self._user("settlement-cancel-hr@example.com", "EMP-SCX-HR")
        hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.hr_user.groups.add(hr_group)
        UserOrganizationAccess.objects.create(user=self.hr_user, organization=self.company)

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

    def _payment(self, *, status=Status.PENDING_HR, submitted_by=None, **fields):
        payment = AnnualLeavePaymentRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee.employee_profile,
            company=self.company,
            cycle_start=date(2026, 1, 1),
            cycle_end=date(2026, 12, 31),
            eligible_unused_days=Decimal("10.00"),
            payment_amount=Decimal("1000.00"),
            submitted_by=submitted_by or self.employee,
            status=status,
            **fields,
        )
        record_annual_payment_submission(payment, actor=submitted_by or self.employee)
        return payment

    def _cancel(self, payment, user=None):
        self.client.force_authenticate(user=user or self.employee)
        return self.client.post(f"{URL}{payment.id}/cancel/", {}, format="json")

    def _cancel_actions(self, payment):
        return WorkflowAction.objects.filter(
            workflow__content_type=ContentType.objects.get_for_model(AnnualLeavePaymentRequest),
            workflow__object_id=payment.id,
            action=Action.CANCEL,
        )

    def test_employee_cancels_pending_hr_and_pending_ceo_requests(self):
        hr_stage = self._payment()
        ceo_stage = self._payment()
        apply_annual_payment_hr_review(ceo_stage, actor=self.hr_user, decision="forward")

        for payment, from_status in ((hr_stage, Status.PENDING_HR), (ceo_stage, Status.PENDING_CEO)):
            with self.subTest(status=from_status):
                self.client.force_authenticate(user=self.employee)
                detail = self.client.get(f"{URL}{payment.id}/")
                self.assertTrue(detail.data["data"]["can_cancel"])

                response = self._cancel(payment)

                self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
                data = response.data["data"]
                self.assertEqual((data["status"], data["can_cancel"]), ("cancelled", False))
                self.assertIsNotNone(data["cancelled_at"])
                history = data["workflow"]["history"]
                self.assertEqual(history[-1]["action"], "cancel")
                self.assertEqual(history[-1]["actor"]["id"], self.employee.id)
                self.assertFalse(data["workflow"]["can_cancel"])
                cancel = self._cancel_actions(payment).get()
                self.assertEqual((cancel.actor, cancel.to_status), (self.employee, "cancelled"))
                workflow = WorkflowInstance.objects.get(pk=cancel.workflow_id)
                self.assertEqual(workflow.status, WorkflowInstance.Status.CANCELLED)
                audit_log = AuditLog.objects.filter(
                    action="annual_leave_payment_cancelled", entity_id=str(payment.id)
                ).last()
                self.assertEqual(audit_log.metadata["from_status"], from_status)

    def test_decided_requests_cannot_be_cancelled(self):
        for current in (Status.APPROVED, Status.REJECTED, Status.CARRIED_FORWARD, Status.CANCELLED):
            with self.subTest(status=current):
                payment = self._payment(status=current)
                response = self._cancel(payment)
                self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
                self.assertEqual(response.data["errors"], [NOT_CANCELLABLE_MESSAGE])
                payment.refresh_from_db()
                self.assertEqual(payment.status, current)

    def test_other_employees_get_not_found(self):
        payment = self._payment()
        response = self._cancel(payment, user=self.colleague)
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        payment.refresh_from_db()
        self.assertEqual(payment.status, Status.PENDING_HR)

    def test_hr_opened_and_termination_settlements_are_not_the_employees_to_cancel(self):
        hr_opened = self._payment(submitted_by=self.hr_user)
        termination = self._payment(is_termination_settlement=True)

        for payment in (hr_opened, termination):
            with self.subTest(payment=payment.id):
                self.client.force_authenticate(user=self.employee)
                self.assertFalse(self.client.get(f"{URL}{payment.id}/").data["data"]["can_cancel"])
                response = self._cancel(payment)
                self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
                payment.refresh_from_db()
                self.assertEqual(payment.status, Status.PENDING_HR)

    def test_cancel_frees_the_cycle_and_leaves_the_inbox(self):
        payment = self._payment()
        profile = self.employee.employee_profile
        self.assertTrue(has_active_annual_leave_settlement(profile, payment.cycle_start, company=self.company))
        content_type = ContentType.objects.get_for_model(AnnualLeavePaymentRequest)

        def pending_hr():
            return {(w.content_type_id, w.object_id) for w in get_pending_approvals_for_role("hr", limit=None)}

        self.assertIn((content_type.id, payment.id), pending_hr())
        self.client.force_authenticate(user=self.hr_user)
        inbox = self.client.get(f"{URL}?status=pending_hr")
        self.assertIn(payment.id, {row["id"] for row in inbox.data["data"]["items"]})

        self.assertEqual(self._cancel(payment).status_code, status.HTTP_200_OK)

        self.assertFalse(has_active_annual_leave_settlement(profile, payment.cycle_start, company=self.company))
        self.assertNotIn((content_type.id, payment.id), pending_hr())
        self.client.force_authenticate(user=self.hr_user)
        inbox = self.client.get(f"{URL}?status=pending_hr")
        self.assertNotIn(payment.id, {row["id"] for row in inbox.data["data"]["items"]})
