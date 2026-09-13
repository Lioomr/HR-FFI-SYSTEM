from datetime import date
from unittest.mock import patch

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from employees.models import EmployeeProfile
from leaves.models import LeaveRequest, LeaveType
from leaves.services import (
    COMMENT_REQUIRED_MESSAGE,
    DELEGATE_NOT_ASSIGNED_MESSAGE,
    NOT_DELEGATE_PENDING_MESSAGE,
    LeaveTransitionError,
    apply_delegate_approval,
    apply_delegate_rejection,
)
from organization.services import get_default_company

User = get_user_model()

Status = LeaveRequest.RequestStatus
REQUESTS_URL = "/api/leaves/leave-requests/"


class DelegateLeaveDecisionTests(APITestCase):
    def setUp(self):
        self.company = get_default_company()
        self.leave_type, _ = LeaveType.objects.get_or_create(
            company=self.company, code="ANNUAL", defaults={"name": "Annual Leave", "is_active": True}
        )
        self.employee = self._user("delegate-decision-employee@example.com", "EMP-DLGD-1")
        self.delegate = self._user("delegate-decision-delegate@example.com", "EMP-DLGD-2")
        self.outsider = self._user("delegate-decision-outsider@example.com", "EMP-DLGD-3")

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

    def _leave(self, *, status=Status.PENDING_DELEGATE):
        return LeaveRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee.employee_profile,
            company=self.company,
            leave_type=self.leave_type,
            start_date=date(2027, 2, 1),
            end_date=date(2027, 2, 3),
            status=status,
            delegated_to=self.delegate,
            delegation_note="Cover urgent items.",
        )

    def _post(self, user, leave, action, payload):
        self.client.force_authenticate(user=user)
        return self.client.post(
            f"{REQUESTS_URL}{leave.id}/{action}/",
            payload,
            format="json",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

    # --- service: approval ---

    def test_approval_sends_request_to_hr(self):
        leave = self._leave()

        transition = apply_delegate_approval(leave, actor=self.delegate, note="I can cover this.")

        leave.refresh_from_db()
        self.assertEqual(transition.from_status, Status.PENDING_DELEGATE)
        self.assertEqual(leave.status, Status.PENDING_HR)
        self.assertEqual(leave.delegate_decision_by, self.delegate)
        self.assertIsNotNone(leave.delegate_decision_at)
        self.assertEqual(leave.delegate_decision_note, "I can cover this.")

    def test_only_assigned_alternative_employee_can_decide(self):
        leave = self._leave()

        for actor in (self.outsider, self.employee):
            with self.subTest(actor=actor.email):
                with self.assertRaisesMessage(LeaveTransitionError, DELEGATE_NOT_ASSIGNED_MESSAGE) as caught:
                    apply_delegate_approval(leave, actor=actor)
                self.assertEqual(caught.exception.status, 403)
                with self.assertRaisesMessage(LeaveTransitionError, DELEGATE_NOT_ASSIGNED_MESSAGE):
                    apply_delegate_rejection(leave, actor=actor, comment="No")

        leave.refresh_from_db()
        self.assertEqual(leave.status, Status.PENDING_DELEGATE)

    def test_decision_refuses_request_past_delegate_stage(self):
        leave = self._leave(status=Status.PENDING_HR)

        with self.assertRaisesMessage(LeaveTransitionError, NOT_DELEGATE_PENDING_MESSAGE):
            apply_delegate_approval(leave, actor=self.delegate)
        with self.assertRaisesMessage(LeaveTransitionError, NOT_DELEGATE_PENDING_MESSAGE):
            apply_delegate_rejection(leave, actor=self.delegate, comment="No")

    # --- service: rejection ---

    def test_rejection_requires_comment(self):
        leave = self._leave()

        with self.assertRaisesMessage(LeaveTransitionError, COMMENT_REQUIRED_MESSAGE):
            apply_delegate_rejection(leave, actor=self.delegate, comment=" ")

    def test_rejection_records_delegate_decision(self):
        leave = self._leave()

        apply_delegate_rejection(leave, actor=self.delegate, comment=" Travelling that week ")

        leave.refresh_from_db()
        self.assertEqual(leave.status, Status.REJECTED)
        self.assertEqual(leave.delegate_decision_by, self.delegate)
        self.assertEqual(leave.delegate_decision_note, "Travelling that week")

    # --- routing after the alternative employee ---

    @patch("leaves.services.notify_users_for_pending_status")
    def test_approval_routes_to_employee_manager_before_hr(self, notify):
        manager = self._user("delegate-decision-manager@example.com", "EMP-DLGD-MGR")
        managed = User.objects.create_user(email="delegate-decision-managed@example.com", password="password")
        EmployeeProfile.objects.create(
            user=managed,
            company=self.company,
            employee_id="EMP-DLGD-4",
            department="Ops",
            job_title="Staff",
            hire_date=date(2021, 1, 1),
            manager_profile=manager.employee_profile,
        )
        leave = LeaveRequest.objects.create(
            employee=managed,
            employee_profile=managed.employee_profile,
            company=self.company,
            leave_type=self.leave_type,
            start_date=date(2027, 2, 8),
            end_date=date(2027, 2, 9),
            status=Status.PENDING_DELEGATE,
            delegated_to=self.delegate,
        )

        response = self._post(self.delegate, leave, "delegate-approve", {"comment": "Covered"})

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        leave.refresh_from_db()
        self.assertEqual(leave.status, Status.PENDING_MANAGER)
        notify.assert_called_once()
        self.assertEqual(list(notify.call_args.kwargs["users"]), [manager])
        self.assertEqual(notify.call_args.kwargs["action_path"], f"/manager/leave/requests/{leave.id}")

    # --- API ---

    @patch("leaves.services.notify_users_for_pending_status")
    def test_approve_endpoint_notifies_hr(self, notify_hr):
        leave = self._leave()

        response = self._post(self.delegate, leave, "delegate-approve", {"comment": "OK"})

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["data"]["status"], Status.PENDING_HR)
        notify_hr.assert_called_once()
        self.assertEqual(notify_hr.call_args.kwargs["action_path"], f"/hr/leave/requests/{leave.id}")

    def test_endpoints_hide_request_from_other_users(self):
        leave = self._leave()

        for action, payload in (("delegate-approve", {"comment": "OK"}), ("delegate-reject", {"comment": "No"})):
            with self.subTest(action=action):
                response = self._post(self.outsider, leave, action, payload)
                self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

        leave.refresh_from_db()
        self.assertEqual(leave.status, Status.PENDING_DELEGATE)

    def test_reject_notification_failure_does_not_undo_decision(self):
        leave = self._leave()

        with (
            self.assertLogs("leaves.services", level="ERROR") as logs,
            patch("leaves.services.notify_leave_rejected", side_effect=RuntimeError("provider down")),
        ):
            response = self._post(self.delegate, leave, "delegate-reject", {"comment": "No"})

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        leave.refresh_from_db()
        self.assertEqual(leave.status, Status.REJECTED)
        self.assertTrue(any("leave_delegate_rejection_notification_failed" in line for line in logs.output))
