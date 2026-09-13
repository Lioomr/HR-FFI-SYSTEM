from datetime import date
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from rest_framework import status
from rest_framework.test import APITestCase

from core.models import WorkflowAction
from employees.models import EmployeeProfile
from leaves.models import LeaveRequest, LeaveType
from leaves.services import (
    DELEGATE_NOT_ASSIGNABLE_MESSAGE,
    SELF_DELEGATE_MESSAGE,
    LeaveTransitionError,
    apply_delegate_approval,
    apply_delegate_assignment,
)
from organization.services import get_default_company

User = get_user_model()

Status = LeaveRequest.RequestStatus
REQUESTS_URL = "/api/leaves/leave-requests/"


class LateAlternativeEmployeeTests(APITestCase):
    def setUp(self):
        self.company = get_default_company()
        self.leave_type, _ = LeaveType.objects.get_or_create(
            company=self.company, code="ANNUAL", defaults={"name": "Annual Leave", "is_active": True}
        )
        self.employee = self._user("late-delegate-employee@example.com", "EMP-LATE-1")
        self.delegate = self._user("late-delegate-delegate@example.com", "EMP-LATE-2")
        self.replacement = self._user("late-delegate-replacement@example.com", "EMP-LATE-3")

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

    def _leave(self, *, status):
        return LeaveRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee.employee_profile,
            company=self.company,
            leave_type=self.leave_type,
            start_date=date(2027, 6, 1),
            end_date=date(2027, 6, 3),
            status=status,
        )

    def test_added_alternative_employee_approves_before_request_returns_to_its_stage(self):
        leave = self._leave(status=Status.PENDING_CEO)

        transition = apply_delegate_assignment(leave, actor=self.employee, delegated_to=self.delegate, note="Cover me")

        leave.refresh_from_db()
        self.assertEqual(transition.from_status, Status.PENDING_CEO)
        self.assertEqual(
            (leave.status, leave.delegate_return_status, leave.delegated_to, leave.delegation_note),
            (Status.PENDING_DELEGATE, Status.PENDING_CEO, self.delegate, "Cover me"),
        )
        assignment = WorkflowAction.objects.get(
            workflow__content_type=ContentType.objects.get_for_model(LeaveRequest),
            workflow__object_id=leave.id,
            action=WorkflowAction.Action.REASSIGN,
        )
        self.assertEqual((assignment.from_stage, assignment.to_stage), ("ceo", "delegate"))

        apply_delegate_approval(leave, actor=self.delegate)

        leave.refresh_from_db()
        self.assertEqual((leave.status, leave.delegate_return_status), (Status.PENDING_CEO, ""))

    def test_replacing_alternative_employee_keeps_the_return_stage(self):
        leave = self._leave(status=Status.PENDING_HR)
        apply_delegate_assignment(leave, actor=self.employee, delegated_to=self.delegate)

        apply_delegate_assignment(leave, actor=self.employee, delegated_to=self.replacement)

        leave.refresh_from_db()
        self.assertEqual(
            (leave.status, leave.delegate_return_status, leave.delegated_to),
            (Status.PENDING_DELEGATE, Status.PENDING_HR, self.replacement),
        )

    def test_alternative_employee_cannot_be_added_once_decided_or_be_the_requester(self):
        for current in (Status.PENDING_HR_COMPLETION, Status.APPROVED, Status.REJECTED, Status.CANCELLED):
            with self.subTest(status=current):
                with self.assertRaisesMessage(LeaveTransitionError, DELEGATE_NOT_ASSIGNABLE_MESSAGE):
                    apply_delegate_assignment(
                        self._leave(status=current), actor=self.employee, delegated_to=self.delegate
                    )

        with self.assertRaisesMessage(LeaveTransitionError, SELF_DELEGATE_MESSAGE):
            apply_delegate_assignment(
                self._leave(status=Status.PENDING_HR), actor=self.employee, delegated_to=self.employee
            )

    @patch("leaves.services.notify_delegation_assigned")
    def test_set_delegate_endpoint_sends_request_to_alternative_employee(self, notify):
        leave = self._leave(status=Status.PENDING_HR)
        self.client.force_authenticate(user=self.employee)

        response = self.client.post(
            f"{REQUESTS_URL}{leave.id}/set-delegate/",
            {"delegated_to": self.delegate.id, "delegation_note": "Please cover"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["data"]["status"], Status.PENDING_DELEGATE)
        notify.assert_called_once()
