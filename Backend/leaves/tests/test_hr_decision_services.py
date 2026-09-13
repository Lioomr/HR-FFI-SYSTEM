from datetime import date
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework import status
from rest_framework.test import APITestCase

from core.models import WorkflowAction
from employees.models import EmployeeProfile
from leaves.models import LeaveRequest, LeaveType
from leaves.services import (
    COMMENT_REQUIRED_MESSAGE,
    HR_ORIGIN_MESSAGE,
    NOT_HR_APPROVABLE_MESSAGE,
    NOT_HR_REJECTABLE_MESSAGE,
    LeaveTransitionError,
    apply_hr_approval,
    apply_hr_rejection,
)
from organization.models import UserOrganizationAccess
from organization.services import get_default_company

User = get_user_model()

Status = LeaveRequest.RequestStatus
REQUESTS_URL = "/api/leaves/leave-requests/"


class HRLeaveDecisionTests(APITestCase):
    def setUp(self):
        self.company = get_default_company()
        self.leave_type = LeaveType.objects.create(company=self.company, name="Annual Leave", code="ANNUAL")
        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        Group.objects.get_or_create(name="CEO")

        self.employee = self._user("hr-decision-employee@example.com", "EMP-HRD-1")
        self.hr_user = self._user("hr-decision-hr@example.com", "EMP-HRD-HR")
        self.hr_user.groups.add(self.hr_group)
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

    def _leave(self, *, employee=None, status=Status.PENDING_HR):
        employee = employee or self.employee
        return LeaveRequest.objects.create(
            employee=employee,
            employee_profile=employee.employee_profile,
            leave_type=self.leave_type,
            start_date=date(2026, 11, 1),
            end_date=date(2026, 11, 3),
            status=status,
        )

    # --- service: approval ---

    def test_approval_sends_request_to_ceo_and_records_hr_workflow_action(self):
        leave = self._leave()

        transition = apply_hr_approval(leave, actor=self.hr_user, note="Looks fine")

        leave.refresh_from_db()
        self.assertEqual(transition.from_status, Status.PENDING_HR)
        self.assertEqual(leave.status, Status.PENDING_CEO)
        self.assertEqual(leave.decided_by, self.hr_user)
        self.assertIsNotNone(leave.decided_at)
        self.assertEqual(leave.hr_decision_note, "Looks fine")
        self.assertTrue(
            WorkflowAction.objects.filter(workflow__object_id=leave.id, approver_role="hr", actor=self.hr_user).exists()
        )

    def test_approval_refuses_hr_manager_own_request(self):
        leave = self._leave(employee=self.hr_user)

        with self.assertRaisesMessage(LeaveTransitionError, HR_ORIGIN_MESSAGE):
            apply_hr_approval(leave, actor=self.hr_user)

        leave.refresh_from_db()
        self.assertEqual(leave.status, Status.PENDING_HR)

    def test_approval_refuses_request_outside_hr_stage(self):
        for current in (Status.PENDING_MANAGER, Status.PENDING_CEO, Status.APPROVED, Status.REJECTED):
            with self.subTest(status=current):
                leave = self._leave(status=current)
                with self.assertRaisesMessage(LeaveTransitionError, NOT_HR_APPROVABLE_MESSAGE):
                    apply_hr_approval(leave, actor=self.hr_user)
                leave.refresh_from_db()
                self.assertEqual(leave.status, current)

    # --- service: rejection ---

    def test_rejection_requires_comment(self):
        leave = self._leave()

        with self.assertRaisesMessage(LeaveTransitionError, COMMENT_REQUIRED_MESSAGE):
            apply_hr_rejection(leave, actor=self.hr_user, comment="   ")

        leave.refresh_from_db()
        self.assertEqual(leave.status, Status.PENDING_HR)

    def test_rejection_allowed_while_waiting_on_manager(self):
        leave = self._leave(status=Status.PENDING_MANAGER)

        transition = apply_hr_rejection(leave, actor=self.hr_user, comment="  Missing documents  ")

        leave.refresh_from_db()
        self.assertEqual(transition.from_status, Status.PENDING_MANAGER)
        self.assertEqual(leave.status, Status.REJECTED)
        self.assertEqual(leave.decided_by, self.hr_user)
        self.assertEqual(leave.hr_decision_note, "Missing documents")

    def test_rejection_refuses_request_past_hr_stage(self):
        for current in (Status.PENDING_CEO, Status.APPROVED, Status.CANCELLED):
            with self.subTest(status=current):
                leave = self._leave(status=current)
                with self.assertRaisesMessage(LeaveTransitionError, NOT_HR_REJECTABLE_MESSAGE):
                    apply_hr_rejection(leave, actor=self.hr_user, comment="No")
                leave.refresh_from_db()
                self.assertEqual(leave.status, current)

    # --- API ---

    @patch("leaves.services.notify_users_for_pending_status")
    def test_approve_endpoint_notifies_ceo(self, notify_ceo):
        leave = self._leave()
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.post(f"{REQUESTS_URL}{leave.id}/approve/", {"comment": "OK"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["status"], Status.PENDING_CEO)
        notify_ceo.assert_called_once()
        self.assertEqual(notify_ceo.call_args.kwargs["action_path"], "/ceo/leave/requests")

    def test_approve_endpoint_rejects_hr_manager_own_request(self):
        leave = self._leave(employee=self.hr_user)
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.post(f"{REQUESTS_URL}{leave.id}/approve/", {"comment": "OK"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn(HR_ORIGIN_MESSAGE, str(response.data))

    @patch("leaves.services.notify_leave_rejected")
    def test_reject_endpoint_rejects_and_notifies_employee(self, notify_rejected):
        leave = self._leave()
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.post(f"{REQUESTS_URL}{leave.id}/reject/", {"comment": "Overlaps"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["status"], Status.REJECTED)
        notify_rejected.assert_called_once()
        self.assertEqual(notify_rejected.call_args.args[1], "Overlaps")

    def test_reject_endpoint_requires_comment(self):
        leave = self._leave()
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.post(f"{REQUESTS_URL}{leave.id}/reject/", {"comment": ""}, format="json")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        leave.refresh_from_db()
        self.assertEqual(leave.status, Status.PENDING_HR)

    def test_rejection_notification_failure_does_not_undo_decision(self):
        leave = self._leave()
        self.client.force_authenticate(user=self.hr_user)

        with (
            self.assertLogs("leaves.services", level="ERROR") as logs,
            patch("leaves.services.notify_leave_rejected", side_effect=RuntimeError("provider down")),
        ):
            response = self.client.post(f"{REQUESTS_URL}{leave.id}/reject/", {"comment": "No"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        leave.refresh_from_db()
        self.assertEqual(leave.status, Status.REJECTED)
        self.assertTrue(any("leave_hr_rejection_notification_failed" in line for line in logs.output))
