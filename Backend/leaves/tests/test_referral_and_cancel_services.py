from datetime import date
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.contenttypes.models import ContentType
from rest_framework import status
from rest_framework.test import APITestCase

from audit.models import AuditLog
from core.models import WorkflowAction
from core.services import get_workflow_snapshot
from employees.models import EmployeeProfile
from leaves.models import LeaveRequest, LeaveType
from leaves.services import (
    ALREADY_WITH_CEO_MESSAGE,
    COMMENT_REQUIRED_MESSAGE,
    CONTACT_HR_TO_CANCEL_MESSAGE,
    NOT_CANCELLABLE_MESSAGE,
    NOT_CEO_REFERRABLE_MESSAGE,
    SELF_CANCELLATION_MESSAGE,
    LeaveTransitionError,
    apply_ceo_referral,
    apply_hr_cancellation,
)
from organization.models import UserOrganizationAccess
from organization.services import get_default_company

User = get_user_model()

Status = LeaveRequest.RequestStatus
Action = WorkflowAction.Action
REQUESTS_URL = "/api/leaves/leave-requests/"


class LeaveReferralAndCancellationTests(APITestCase):
    def setUp(self):
        self.company = get_default_company()
        self.leave_type, _ = LeaveType.objects.get_or_create(
            company=self.company, code="ANNUAL", defaults={"name": "Annual Leave", "is_active": True}
        )
        hr_group, _ = Group.objects.get_or_create(name="HRManager")
        Group.objects.get_or_create(name="CEO")

        self.employee = self._user("referral-cancel-employee@example.com", "EMP-RFC-1")
        self.colleague = self._user("referral-cancel-colleague@example.com", "EMP-RFC-2")
        self.hr_user = self._user("referral-cancel-hr@example.com", "EMP-RFC-HR")
        self.other_hr_user = self._user("referral-cancel-hr2@example.com", "EMP-RFC-HR2")
        for user in (self.hr_user, self.other_hr_user):
            user.groups.add(hr_group)
            UserOrganizationAccess.objects.create(user=user, organization=self.company)

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

    def _leave(self, *, employee=None, status=Status.PENDING_HR, **fields):
        employee = employee or self.employee
        if status == Status.PENDING_DELEGATE:
            fields.setdefault("delegated_to", self.colleague)
        return LeaveRequest.objects.create(
            employee=employee,
            employee_profile=employee.employee_profile,
            company=self.company,
            leave_type=self.leave_type,
            start_date=date(2027, 3, 1),
            end_date=date(2027, 3, 3),
            status=status,
            **fields,
        )

    def _actions(self, leave, action):
        return WorkflowAction.objects.filter(
            workflow__content_type=ContentType.objects.get_for_model(LeaveRequest),
            workflow__object_id=leave.id,
            action=action,
        )

    # --- service: referral to CEO ---

    def test_referral_sends_hr_stage_request_to_ceo_and_records_it(self):
        leave = self._leave()

        transition = apply_ceo_referral(leave, actor=self.hr_user, note="  Urgent  ")

        leave.refresh_from_db()
        self.assertEqual(transition.from_status, Status.PENDING_HR)
        self.assertEqual(leave.status, Status.PENDING_CEO)
        self.assertEqual(leave.decided_by, self.hr_user)
        self.assertEqual(leave.hr_decision_note, "Urgent")
        referral = self._actions(leave, Action.ADVANCE).get()
        self.assertEqual(
            (referral.actor, referral.approver_role, referral.from_stage, referral.to_stage, referral.note),
            (self.hr_user, "hr", "hr", "ceo", "Urgent"),
        )

    def test_referral_refuses_request_still_waiting_on_manager_or_delegate(self):
        for current in (
            Status.PENDING_MANAGER,
            Status.PENDING_DELEGATE,
            Status.PENDING_HR_COMPLETION,
            Status.APPROVED,
            Status.REJECTED,
            Status.CANCELLED,
        ):
            with self.subTest(status=current):
                leave = self._leave(status=current)
                with self.assertRaisesMessage(LeaveTransitionError, NOT_CEO_REFERRABLE_MESSAGE):
                    apply_ceo_referral(leave, actor=self.hr_user)
                leave.refresh_from_db()
                self.assertEqual(leave.status, current)

    def test_second_referral_is_refused_and_keeps_the_original_referral(self):
        leave = self._leave()
        apply_ceo_referral(leave, actor=self.hr_user, note="First")
        leave.refresh_from_db()
        first_decided_at = leave.decided_at

        with self.assertRaisesMessage(LeaveTransitionError, ALREADY_WITH_CEO_MESSAGE):
            apply_ceo_referral(leave, actor=self.other_hr_user, note="Second")

        leave.refresh_from_db()
        self.assertEqual(
            (leave.decided_by, leave.decided_at, leave.hr_decision_note), (self.hr_user, first_decided_at, "First")
        )
        self.assertEqual(self._actions(leave, Action.ADVANCE).count(), 1)

    # --- API: referral to CEO ---

    @patch("leaves.services.notify_users_for_pending_status")
    def test_send_to_ceo_endpoint_notifies_ceo_and_audits_note(self, notify_ceo):
        leave = self._leave()
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.post(f"{REQUESTS_URL}{leave.id}/send-to-ceo/", {"comment": " Urgent "}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["data"]["status"], Status.PENDING_CEO)
        notify_ceo.assert_called_once()
        self.assertEqual(notify_ceo.call_args.kwargs["action_path"], "/ceo/leave/requests")
        audit_log = AuditLog.objects.filter(action="send_to_ceo", entity_id=str(leave.id)).last()
        self.assertEqual(audit_log.metadata, {"status": Status.PENDING_CEO, "note": "Urgent"})

    def test_send_to_ceo_notification_failure_does_not_undo_referral(self):
        leave = self._leave()
        self.client.force_authenticate(user=self.hr_user)

        with (
            self.assertLogs("leaves.services", level="ERROR") as logs,
            patch("leaves.services.notify_users_for_pending_status", side_effect=RuntimeError("provider down")),
        ):
            response = self.client.post(f"{REQUESTS_URL}{leave.id}/send-to-ceo/", {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        leave.refresh_from_db()
        self.assertEqual(leave.status, Status.PENDING_CEO)
        self.assertTrue(any("leave_ceo_referral_notification_failed" in line for line in logs.output))

    # --- cancellation ---

    def test_employee_cannot_cancel_at_any_stage(self):
        self.client.force_authenticate(user=self.employee)
        for current in (Status.PENDING_DELEGATE, Status.PENDING_MANAGER, Status.PENDING_HR, Status.PENDING_CEO):
            with self.subTest(status=current):
                leave = self._leave(status=current)

                response = self.client.post(f"{REQUESTS_URL}{leave.id}/cancel/")

                self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
                self.assertEqual(response.data["errors"], [CONTACT_HR_TO_CANCEL_MESSAGE])
                leave.refresh_from_db()
                self.assertEqual(leave.status, current)
                self.assertFalse(get_workflow_snapshot(leave, actor=self.employee)["can_cancel"])

    def test_hr_cancels_any_request_still_in_progress_and_records_why(self):
        for current in (
            Status.PENDING_DELEGATE,
            Status.PENDING_MANAGER,
            Status.PENDING_HR,
            Status.PENDING_CEO,
            Status.PENDING_HR_COMPLETION,
            Status.APPROVED,
        ):
            with self.subTest(status=current):
                leave = self._leave(status=current)

                transition = apply_hr_cancellation(leave, actor=self.hr_user, comment=" Employee called HR ")

                leave.refresh_from_db()
                self.assertEqual((transition.from_status, leave.status), (current, Status.CANCELLED))
                cancel = self._actions(leave, Action.CANCEL).get()
                self.assertEqual(
                    (cancel.actor, cancel.approver_role, cancel.note, cancel.to_status),
                    (self.hr_user, "hr", "Employee called HR", "cancelled"),
                )

    def test_hr_cancellation_requires_reason(self):
        leave = self._leave()

        with self.assertRaisesMessage(LeaveTransitionError, COMMENT_REQUIRED_MESSAGE):
            apply_hr_cancellation(leave, actor=self.hr_user, comment="  ")

    def test_hr_cannot_cancel_rejected_or_cancelled_requests(self):
        for current in (Status.REJECTED, Status.CANCELLED):
            with self.subTest(status=current):
                leave = self._leave(status=current)
                with self.assertRaisesMessage(LeaveTransitionError, NOT_CANCELLABLE_MESSAGE):
                    apply_hr_cancellation(leave, actor=self.hr_user, comment="No longer needed")

    def test_hr_member_cannot_cancel_own_request(self):
        leave = self._leave(employee=self.hr_user)

        with self.assertRaisesMessage(LeaveTransitionError, SELF_CANCELLATION_MESSAGE) as caught:
            apply_hr_cancellation(leave, actor=self.hr_user, comment="Plans changed")

        self.assertEqual(caught.exception.status, 403)
        apply_hr_cancellation(leave, actor=self.other_hr_user, comment="Plans changed")
        leave.refresh_from_db()
        self.assertEqual(leave.status, Status.CANCELLED)

    @patch("leaves.services.dispatch_notification_channels")
    def test_hr_cancel_endpoint_notifies_employee_with_reason(self, dispatch):
        leave = self._leave(status=Status.PENDING_CEO)
        self.client.force_authenticate(user=self.hr_user)

        response = self.client.post(
            f"{REQUESTS_URL}{leave.id}/hr-cancel/", {"comment": "Trip was called off"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["data"]["status"], Status.CANCELLED)
        dispatch.assert_called_once()
        self.assertEqual(dispatch.call_args.kwargs["recipient"], self.employee)
        self.assertEqual(dispatch.call_args.kwargs["whatsapp_variables"]["reason"], "Trip was called off")
        audit_log = AuditLog.objects.filter(action="cancel_hr", entity_id=str(leave.id)).last()
        self.assertEqual(audit_log.metadata["from_status"], Status.PENDING_CEO)

    def test_hr_cancel_endpoint_is_hr_only(self):
        leave = self._leave()
        self.client.force_authenticate(user=self.colleague)

        response = self.client.post(f"{REQUESTS_URL}{leave.id}/hr-cancel/", {"comment": "Not mine"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        leave.refresh_from_db()
        self.assertEqual(leave.status, Status.PENDING_HR)
