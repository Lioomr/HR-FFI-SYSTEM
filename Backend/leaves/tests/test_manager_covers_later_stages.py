from datetime import date

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.contenttypes.models import ContentType

from unittest import mock

from django.test import TestCase

from core.models import WorkflowAction, WorkflowInstance
from employees.models import EmployeeProfile
from leaves.models import LeaveRequest, LeaveType
from leaves.services import (
    apply_ceo_referral,
    apply_delegate_approval,
    notify_after_delegate_approval,
    apply_hr_approval,
    apply_manager_approval,
    notify_after_ceo_referral,
    notify_after_hr_approval,
    notify_after_manager_approval,
    record_leave_submission,
)
from organization.services import get_default_company

User = get_user_model()
Status = LeaveRequest.RequestStatus


class ManagerCoversLaterStagesTests(TestCase):
    def setUp(self):
        self.company = get_default_company()
        self.leave_type, _ = LeaveType.objects.get_or_create(
            company=self.company, code="ANNUAL", defaults={"name": "Annual Leave", "is_active": True}
        )
        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.ceo_group, _ = Group.objects.get_or_create(name="CEO")
        self.admin_group, _ = Group.objects.get_or_create(name="SystemAdmin")
        self.hr_user = self._user("cover-hr@example.com", "EMP-COV-HR", groups=[self.hr_group])

    def _user(self, email, employee_id, *, manager=None, groups=()):
        user = User.objects.create_user(email=email, password="password")
        for group in groups:
            user.groups.add(group)
        EmployeeProfile.objects.create(
            user=user,
            company=self.company,
            employee_id=employee_id,
            department="Ops",
            job_title="Staff",
            hire_date=date(2021, 1, 1),
            manager_profile=manager.employee_profile if manager else None,
        )
        return user

    def _pending_leave(self, manager, employee=None):
        employee = employee or self._user(f"emp-{manager.pk}@example.com", f"EMP-{manager.pk}", manager=manager)
        leave = LeaveRequest.objects.create(
            employee=employee,
            employee_profile=employee.employee_profile,
            company=self.company,
            leave_type=self.leave_type,
            start_date=date(2027, 5, 2),
            end_date=date(2027, 5, 4),
            status=Status.PENDING_MANAGER,
            reason="Family visit",
        )
        record_leave_submission(leave, actor=employee)
        return leave

    def _stages(self, leave):
        workflow = WorkflowInstance.objects.get(
            content_type=ContentType.objects.get_for_model(LeaveRequest), object_id=leave.id
        )
        return [
            (action.approver_role, action.actor_id, action.metadata.get("auto_satisfied_by"))
            for action in workflow.actions.filter(action=WorkflowAction.Action.APPROVE).order_by("created_at", "id")
        ]

    def test_ordinary_manager_still_sends_to_hr(self):
        manager = self._user("cover-plain-mgr@example.com", "EMP-COV-M1")
        leave = apply_manager_approval(self._pending_leave(manager), actor=manager).instance

        self.assertEqual(leave.status, Status.PENDING_HR)

    def test_hr_manager_as_line_manager_skips_the_hr_stage(self):
        manager = self._user("cover-hr-mgr@example.com", "EMP-COV-M2", groups=[self.hr_group])
        leave = apply_manager_approval(self._pending_leave(manager), actor=manager).instance

        self.assertEqual(leave.status, Status.PENDING_CEO)
        self.assertEqual(leave.decided_by, manager)
        self.assertEqual(self._stages(leave), [("manager", manager.id, None), ("hr", manager.id, "manager")])

    def test_ceo_as_line_manager_still_goes_through_hr_then_completes(self):
        manager = self._user("cover-ceo-mgr@example.com", "EMP-COV-M3", groups=[self.ceo_group])
        leave = apply_manager_approval(self._pending_leave(manager), actor=manager).instance
        self.assertEqual(leave.status, Status.PENDING_HR)

        leave = apply_hr_approval(leave, actor=self.hr_user).instance

        self.assertEqual(leave.status, Status.APPROVED)
        self.assertEqual(leave.ceo_decision_by, manager)
        self.assertIsNotNone(leave.ceo_decision_at)
        self.assertEqual(
            self._stages(leave),
            [("manager", manager.id, None), ("hr", self.hr_user.id, None), ("ceo", manager.id, "manager")],
        )

    def test_hr_referral_to_ceo_also_completes_when_the_manager_is_the_ceo(self):
        manager = self._user("cover-ceo-ref@example.com", "EMP-COV-M4", groups=[self.ceo_group])
        leave = apply_manager_approval(self._pending_leave(manager), actor=manager).instance

        leave = apply_ceo_referral(leave, actor=self.hr_user).instance

        self.assertEqual(leave.status, Status.APPROVED)

    def test_manager_who_is_hr_and_ceo_completes_immediately(self):
        manager = self._user("cover-both@example.com", "EMP-COV-M5", groups=[self.hr_group, self.ceo_group])
        leave = apply_manager_approval(self._pending_leave(manager), actor=manager).instance

        self.assertEqual(leave.status, Status.APPROVED)
        self.assertEqual(
            self._stages(leave),
            [("manager", manager.id, None), ("hr", manager.id, "manager"), ("ceo", manager.id, "manager")],
        )

    def test_system_admin_manager_covers_nothing(self):
        manager = self._user("cover-admin@example.com", "EMP-COV-M6", groups=[self.admin_group])
        leave = apply_manager_approval(self._pending_leave(manager), actor=manager).instance
        self.assertEqual(leave.status, Status.PENDING_HR)

        leave = apply_hr_approval(leave, actor=self.hr_user).instance

        self.assertEqual(leave.status, Status.PENDING_CEO)

    def test_hr_managers_own_leave_is_not_cleared_at_hr_by_their_manager(self):
        manager = self._user("cover-hr-mgr2@example.com", "EMP-COV-M7", groups=[self.hr_group])
        employee = self._user("cover-hr-emp@example.com", "EMP-COV-E7", manager=manager, groups=[self.hr_group])
        leave = apply_manager_approval(self._pending_leave(manager, employee), actor=manager).instance

        self.assertEqual(leave.status, Status.PENDING_CEO)
        self.assertIsNone(leave.decided_by)
        self.assertEqual(self._stages(leave), [("manager", manager.id, None)])


class CoveredStageNotificationTests(ManagerCoversLaterStagesTests):
    """Nobody is told to decide a stage the manager already covered; the requester hears the outcome."""

    def _notified(self, notify, leave):
        with (
            mock.patch("leaves.services.notify_users_for_pending_status") as pending,
            mock.patch("leaves.services.notify_leave_approved") as approved,
        ):
            notify(leave)
        return pending, approved

    def test_manager_completing_the_request_notifies_the_requester_only(self):
        manager = self._user("note-both@example.com", "EMP-NOT-1", groups=[self.hr_group, self.ceo_group])
        leave = apply_manager_approval(self._pending_leave(manager), actor=manager).instance

        pending, approved = self._notified(notify_after_manager_approval, leave)

        pending.assert_not_called()
        approved.assert_called_once_with(leave)

    def test_manager_skipping_hr_pages_the_ceo(self):
        manager = self._user("note-hr@example.com", "EMP-NOT-2", groups=[self.hr_group])
        leave = apply_manager_approval(self._pending_leave(manager), actor=manager).instance

        pending, approved = self._notified(notify_after_manager_approval, leave)

        pending.assert_called_once()
        self.assertEqual(pending.call_args.kwargs["action_path"], "/ceo/leave/requests")
        approved.assert_not_called()

    def test_hr_approval_completing_the_request_notifies_the_requester_only(self):
        manager = self._user("note-ceo@example.com", "EMP-NOT-3", groups=[self.ceo_group])
        leave = apply_manager_approval(self._pending_leave(manager), actor=manager).instance
        leave = apply_hr_approval(leave, actor=self.hr_user).instance

        pending, approved = self._notified(notify_after_hr_approval, leave)

        pending.assert_not_called()
        approved.assert_called_once_with(leave)

    def test_referral_completing_the_request_does_not_page_the_ceo(self):
        manager = self._user("note-ref@example.com", "EMP-NOT-4", groups=[self.ceo_group])
        leave = apply_manager_approval(self._pending_leave(manager), actor=manager).instance
        leave = apply_ceo_referral(leave, actor=self.hr_user).instance

        pending, approved = self._notified(notify_after_ceo_referral, leave)

        pending.assert_not_called()
        approved.assert_called_once_with(leave)


class AlternativeEmployeeWhoIsTheManagerTests(ManagerCoversLaterStagesTests):
    def _delegated_leave(self, manager, alternative):
        leave = self._pending_leave(manager)
        leave.status = Status.PENDING_DELEGATE
        leave.delegated_to = alternative
        leave.save(update_fields=["status", "delegated_to"])
        return leave

    def test_alternative_employee_who_is_the_manager_is_not_asked_again(self):
        manager = self._user("alt-mgr@example.com", "EMP-ALT-1")
        leave = apply_delegate_approval(self._delegated_leave(manager, manager), actor=manager).instance

        self.assertEqual(leave.status, Status.PENDING_HR)
        self.assertEqual(leave.manager_decision_by, manager)
        self.assertEqual(
            self._stages(leave),
            [("delegate", manager.id, None), ("manager", manager.id, "alternative_employee")],
        )

    def test_alternative_employee_who_is_manager_and_ceo_still_goes_through_hr(self):
        manager = self._user("alt-ceo@example.com", "EMP-ALT-2", groups=[self.ceo_group])
        leave = apply_delegate_approval(self._delegated_leave(manager, manager), actor=manager).instance
        self.assertEqual(leave.status, Status.PENDING_HR)

        leave = apply_hr_approval(leave, actor=self.hr_user).instance

        self.assertEqual(leave.status, Status.APPROVED)

    def test_alternative_employee_who_is_manager_and_hr_and_ceo_completes(self):
        manager = self._user("alt-all@example.com", "EMP-ALT-3", groups=[self.hr_group, self.ceo_group])
        leave = apply_delegate_approval(self._delegated_leave(manager, manager), actor=manager).instance

        self.assertEqual(leave.status, Status.APPROVED)
        with mock.patch("leaves.services.notify_users_for_pending_status") as pending, mock.patch(
            "leaves.services.notify_leave_approved"
        ) as approved:
            notify_after_delegate_approval(leave)
        pending.assert_not_called()
        approved.assert_called_once_with(leave)

    def test_other_alternative_employee_still_hands_over_to_the_manager(self):
        manager = self._user("alt-plain-mgr@example.com", "EMP-ALT-4")
        alternative = self._user("alt-plain@example.com", "EMP-ALT-5")
        leave = apply_delegate_approval(self._delegated_leave(manager, alternative), actor=alternative).instance

        self.assertEqual(leave.status, Status.PENDING_MANAGER)
        self.assertIsNone(leave.manager_decision_by)
