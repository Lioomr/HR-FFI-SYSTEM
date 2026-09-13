from datetime import date
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from core.models import DelegationRule
from employees.models import EmployeeProfile
from leaves.models import LeaveRequest, LeaveType
from leaves.services import (
    COMMENT_REQUIRED_MESSAGE,
    MANAGER_CANNOT_APPROVE_MESSAGE,
    MANAGER_CANNOT_REJECT_MESSAGE,
    NOT_MANAGER_APPROVABLE_MESSAGE,
    NOT_MANAGER_REJECTABLE_MESSAGE,
    LeaveTransitionError,
    apply_manager_approval,
    apply_manager_rejection,
)
from organization.services import get_default_company

User = get_user_model()

Status = LeaveRequest.RequestStatus
MANAGER_REQUESTS_URL = "/api/leaves/manager/leave-requests/"


class ManagerLeaveDecisionTests(APITestCase):
    def setUp(self):
        self.company = get_default_company()
        self.leave_type, _ = LeaveType.objects.get_or_create(
            company=self.company, code="ANNUAL", defaults={"name": "Annual Leave", "is_active": True}
        )
        Group.objects.get_or_create(name="HRManager")

        self.manager, self.manager_profile = self._user("mgr-decision-manager@example.com", "EMP-MGRD-MGR")
        self.employee, self.employee_profile = self._user(
            "mgr-decision-employee@example.com", "EMP-MGRD-1", manager_profile=self.manager_profile
        )
        self.delegate, _ = self._user("mgr-decision-delegate@example.com", "EMP-MGRD-DEL")
        self.outsider, _ = self._user("mgr-decision-outsider@example.com", "EMP-MGRD-OUT")

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

    def _leave(self, *, status=Status.PENDING_MANAGER):
        return LeaveRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee_profile,
            company=self.company,
            leave_type=self.leave_type,
            start_date=date(2027, 1, 10),
            end_date=date(2027, 1, 12),
            status=status,
        )

    # --- service: approval ---

    def test_direct_manager_approval_sends_request_to_hr(self):
        leave = self._leave()

        transition = apply_manager_approval(leave, actor=self.manager, note="Enjoy")

        leave.refresh_from_db()
        self.assertEqual((transition.from_status, transition.actor_source), (Status.PENDING_MANAGER, "direct_manager"))
        self.assertEqual(leave.status, Status.PENDING_HR)
        self.assertEqual(leave.manager_decision_by, self.manager)
        self.assertIsNotNone(leave.manager_decision_at)
        self.assertEqual(leave.manager_decision_note, "Enjoy")

    def test_delegate_of_manager_can_approve(self):
        DelegationRule.objects.create(
            from_user=self.manager, to_user=self.delegate, start_at=timezone.now(), created_by=self.manager
        )
        leave = self._leave()

        transition = apply_manager_approval(leave, actor=self.delegate)

        self.assertEqual(transition.actor_source, "delegate")
        leave.refresh_from_db()
        self.assertEqual(leave.status, Status.PENDING_HR)

    def test_unrelated_user_and_requester_cannot_decide(self):
        leave = self._leave()

        for actor in (self.outsider, self.employee):
            with self.subTest(actor=actor.email):
                with self.assertRaisesMessage(LeaveTransitionError, MANAGER_CANNOT_APPROVE_MESSAGE) as caught:
                    apply_manager_approval(leave, actor=actor)
                self.assertEqual(caught.exception.status, 403)
                with self.assertRaisesMessage(LeaveTransitionError, MANAGER_CANNOT_REJECT_MESSAGE):
                    apply_manager_rejection(leave, actor=actor, comment="No")

        leave.refresh_from_db()
        self.assertEqual(leave.status, Status.PENDING_MANAGER)

    def test_approval_refuses_request_past_manager_stage(self):
        leave = self._leave(status=Status.PENDING_HR)

        with self.assertRaisesMessage(LeaveTransitionError, NOT_MANAGER_APPROVABLE_MESSAGE):
            apply_manager_approval(leave, actor=self.manager)

    # --- service: rejection ---

    def test_rejection_requires_comment(self):
        leave = self._leave()

        with self.assertRaisesMessage(LeaveTransitionError, COMMENT_REQUIRED_MESSAGE):
            apply_manager_rejection(leave, actor=self.manager, comment="  ")

    def test_rejection_refuses_request_past_manager_stage(self):
        leave = self._leave(status=Status.APPROVED)

        with self.assertRaisesMessage(LeaveTransitionError, NOT_MANAGER_REJECTABLE_MESSAGE):
            apply_manager_rejection(leave, actor=self.manager, comment="No")

    def test_rejection_records_manager_decision(self):
        leave = self._leave()

        transition = apply_manager_rejection(leave, actor=self.manager, comment=" Team is short-staffed ")

        leave.refresh_from_db()
        self.assertEqual(transition.actor_source, "direct_manager")
        self.assertEqual(leave.status, Status.REJECTED)
        self.assertEqual(leave.manager_decision_by, self.manager)
        self.assertEqual(leave.manager_decision_note, "Team is short-staffed")

    @patch("leaves.services.notify_users_for_pending_status")
    def test_hr_manager_leave_goes_to_their_manager_then_the_ceo(self, notify):
        hr_manager, hr_profile = self._user(
            "mgr-decision-hr-manager@example.com", "EMP-MGRD-HRM", manager_profile=self.manager_profile
        )
        hr_manager.groups.add(Group.objects.get(name="HRManager"))
        leave = LeaveRequest.objects.create(
            employee=hr_manager,
            employee_profile=hr_profile,
            company=self.company,
            leave_type=self.leave_type,
            start_date=date(2027, 1, 20),
            end_date=date(2027, 1, 21),
            status=Status.PENDING_MANAGER,
        )
        self.client.force_authenticate(user=self.manager)

        response = self.client.post(f"{MANAGER_REQUESTS_URL}{leave.id}/approve/", {"comment": "OK"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["data"]["status"], Status.PENDING_CEO)
        notify.assert_called_once()
        self.assertEqual(notify.call_args.kwargs["action_path"], "/ceo/leave/requests")

    # --- API ---

    @patch("leaves.services.notify_users_for_pending_status")
    def test_approve_endpoint_notifies_hr(self, notify_hr):
        leave = self._leave()
        self.client.force_authenticate(user=self.manager)

        response = self.client.post(f"{MANAGER_REQUESTS_URL}{leave.id}/approve/", {"comment": "OK"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["status"], Status.PENDING_HR)
        notify_hr.assert_called_once()
        self.assertEqual(notify_hr.call_args.kwargs["action_path"], f"/hr/leave/requests/{leave.id}")

    def test_forbidden_refusal_keeps_forbidden_response_shape(self):
        leave = self._leave()

        with self.assertRaises(LeaveTransitionError) as caught:
            apply_manager_approval(leave, actor=self.outsider)
        response = caught.exception.to_response()

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["message"], "Forbidden")
        self.assertEqual(response.data["errors"], [MANAGER_CANNOT_APPROVE_MESSAGE])

    def test_reject_notification_failure_does_not_undo_decision(self):
        leave = self._leave()
        self.client.force_authenticate(user=self.manager)

        with (
            self.assertLogs("leaves.services", level="ERROR") as logs,
            patch("leaves.services.notify_leave_rejected", side_effect=RuntimeError("provider down")),
        ):
            response = self.client.post(f"{MANAGER_REQUESTS_URL}{leave.id}/reject/", {"comment": "No"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        leave.refresh_from_db()
        self.assertEqual(leave.status, Status.REJECTED)
        self.assertTrue(any("manager_leave_rejection_notification_failed" in line for line in logs.output))
