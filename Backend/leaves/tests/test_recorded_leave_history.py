from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.contenttypes.models import ContentType
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from core.models import WorkflowAction, WorkflowInstance
from core.services.workflow_engine import get_or_create_workflow_definition, sync_workflow, uses_recorded_history
from employees.models import EmployeeProfile
from leaves.models import LeaveRequest, LeaveType
from leaves.services import (
    apply_ceo_approval,
    apply_delegate_approval,
    apply_hr_approval,
    apply_hr_rejection,
    apply_manager_approval,
    first_approval_status,
    record_leave_submission,
)
from leaves.views import _approval_path_rows
from organization.models import UserOrganizationAccess
from organization.services import get_default_company

User = get_user_model()

Status = LeaveRequest.RequestStatus
Action = WorkflowAction.Action


class RecordedLeaveHistoryTests(APITestCase):
    def setUp(self):
        self.company = get_default_company()
        self.leave_type, _ = LeaveType.objects.get_or_create(
            company=self.company, code="ANNUAL", defaults={"name": "Annual Leave", "is_active": True}
        )
        hr_group, _ = Group.objects.get_or_create(name="HRManager")
        ceo_group, _ = Group.objects.get_or_create(name="CEO")

        self.manager = self._user("history-manager@example.com", "EMP-HIST-MGR")
        self.employee = self._user("history-employee@example.com", "EMP-HIST-1", manager=self.manager)
        self.delegate = self._user("history-delegate@example.com", "EMP-HIST-2")
        self.hr_user = self._user("history-hr@example.com", "EMP-HIST-HR")
        self.hr_user.groups.add(hr_group)
        UserOrganizationAccess.objects.create(user=self.hr_user, organization=self.company)
        self.ceo_user = self._user("history-ceo@example.com", "EMP-HIST-CEO")
        self.ceo_user.groups.add(ceo_group)

    def _user(self, email, employee_id, *, manager=None):
        user = User.objects.create_user(email=email, password="password")
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

    def _leave(self, *, status=Status.PENDING_MANAGER, **fields):
        return LeaveRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee.employee_profile,
            company=self.company,
            leave_type=self.leave_type,
            start_date=date(2027, 5, 2),
            end_date=date(2027, 5, 4),
            status=status,
            reason="Family visit",
            **fields,
        )

    def _workflow(self, leave):
        return WorkflowInstance.objects.get(
            content_type=ContentType.objects.get_for_model(LeaveRequest), object_id=leave.id
        )

    def _steps(self, leave):
        return [
            (action.action, action.from_stage, action.to_stage, action.actor_id)
            for action in self._workflow(leave).actions.order_by("created_at", "id")
        ]

    def test_submission_records_where_the_request_actually_went(self):
        leave = self._leave()

        record_leave_submission(leave, actor=self.employee)

        workflow = self._workflow(leave)
        self.assertTrue(uses_recorded_history(workflow))
        self.assertEqual(self._steps(leave), [(Action.SUBMIT, "", "manager", self.employee.id)])
        submission = workflow.actions.get()
        self.assertEqual(
            (submission.from_status, submission.to_status, submission.note), ("draft", "in_review", "Family visit")
        )

    def test_submission_through_api_is_recorded(self):
        self.client.force_authenticate(user=self.employee)
        start = timezone.localdate() + timedelta(days=3)

        response = self.client.post(
            "/api/leaves/leave-requests/",
            {
                "leave_type": self.leave_type.id,
                "start_date": str(start),
                "end_date": str(start + timedelta(days=1)),
                "reason": "Wedding",
            },
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        leave = LeaveRequest.objects.get(pk=response.data["data"]["id"])
        self.assertEqual(leave.status, Status.PENDING_MANAGER)
        self.assertEqual(self._steps(leave), [(Action.SUBMIT, "", "manager", self.employee.id)])

    def test_full_route_records_one_row_per_decision_and_resync_adds_nothing(self):
        leave = self._leave()
        record_leave_submission(leave, actor=self.employee)

        leave = apply_manager_approval(leave, actor=self.manager, note="Fine by me").instance
        leave = apply_hr_approval(leave, actor=self.hr_user, note="Balance checked").instance
        leave = apply_ceo_approval(leave, actor=self.ceo_user, note="Approved").instance

        expected = [
            (Action.SUBMIT, "", "manager", self.employee.id),
            (Action.APPROVE, "manager", "hr", self.manager.id),
            (Action.APPROVE, "hr", "ceo", self.hr_user.id),
            (Action.APPROVE, "ceo", "", self.ceo_user.id),
        ]
        self.assertEqual(self._steps(leave), expected)
        leave.refresh_from_db()
        sync_workflow(leave)
        sync_workflow(leave)
        self.assertEqual(self._steps(leave), expected)
        self.assertEqual(self._workflow(leave).status, WorkflowInstance.Status.APPROVED)

    def test_legacy_request_keeps_its_rebuilt_history_when_it_switches(self):
        leave = self._leave()
        sync_workflow(leave)
        self.assertFalse(uses_recorded_history(self._workflow(leave)))

        apply_manager_approval(leave, actor=self.manager)

        actions = list(self._workflow(leave).actions.order_by("created_at", "id"))
        self.assertTrue(uses_recorded_history(self._workflow(leave)))
        self.assertEqual(actions[0].metadata.get("legacy_signature"), "submitted")
        self.assertEqual(
            (actions[1].action, actions[1].from_stage, actions[1].to_stage, actions[1].metadata.get("recorded")),
            (Action.APPROVE, "manager", "hr", True),
        )
        leave.refresh_from_db()
        sync_workflow(leave)
        self.assertEqual(self._workflow(leave).actions.count(), 2)

    def test_alternative_employee_approval_is_followed_by_the_manager(self):
        leave = self._leave(status=Status.PENDING_DELEGATE, delegated_to=self.delegate)
        record_leave_submission(leave, actor=self.employee)

        apply_delegate_approval(leave, actor=self.delegate)

        leave.refresh_from_db()
        self.assertEqual(leave.status, Status.PENDING_MANAGER)
        self.assertEqual(
            self._steps(leave),
            [
                (Action.SUBMIT, "", "delegate", self.employee.id),
                (Action.APPROVE, "delegate", "manager", self.delegate.id),
            ],
        )

    def test_hr_rejection_during_manager_stage_is_recorded_as_an_hr_decision(self):
        leave = self._leave()
        record_leave_submission(leave, actor=self.employee)

        apply_hr_rejection(leave, actor=self.hr_user, comment="Overlaps a blackout period")

        rejection = self._workflow(leave).actions.order_by("created_at", "id").last()
        self.assertEqual(
            (rejection.action, rejection.approver_role, rejection.from_stage, rejection.to_stage, rejection.note),
            (Action.REJECT, "hr", "manager", "", "Overlaps a blackout period"),
        )

    def test_first_approval_stage_is_the_manager_for_everyone_who_has_one(self):
        managed_hr = self._user("history-managed-hr@example.com", "EMP-HIST-HR2", manager=self.manager)
        managed_hr.groups.add(Group.objects.get(name="HRManager"))
        self.assertEqual(first_approval_status(managed_hr, managed_hr.employee_profile), Status.PENDING_MANAGER)

        # Without a manager: HR for employees, the CEO for an HR manager's own leave.
        self.assertEqual(first_approval_status(self.employee, self.employee.employee_profile), Status.PENDING_MANAGER)
        self.assertEqual(first_approval_status(self.delegate, self.delegate.employee_profile), Status.PENDING_HR)
        self.assertEqual(first_approval_status(self.hr_user, self.hr_user.employee_profile), Status.PENDING_CEO)

    def test_ceo_stage_is_required_for_leave_requests(self):
        ceo_stage = get_or_create_workflow_definition("leave_request").stages.get(key="ceo")
        self.assertFalse(ceo_stage.is_optional)

        labels = [row[0] for row in _approval_path_rows(self._leave())]
        self.assertIn("CEO Review", labels)
