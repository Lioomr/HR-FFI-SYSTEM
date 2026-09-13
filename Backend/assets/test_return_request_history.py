from datetime import date

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.contenttypes.models import ContentType
from django.test import TestCase

from assets.models import Asset, AssetReturnRequest
from assets.services.return_requests import (
    COMMENT_REQUIRED_MESSAGE,
    MANAGER_CANNOT_APPROVE_MESSAGE,
    SELF_APPROVAL_MESSAGE,
    AssetReturnTransitionError,
    apply_ceo_decision,
    apply_hr_decision,
    apply_manager_decision,
    mark_return_request_processed,
    record_return_request_submission,
    submission_status,
)
from core.models import WorkflowAction, WorkflowInstance
from core.services.workflow_engine import sync_workflow
from employees.models import EmployeeProfile
from organization.services import get_default_company

User = get_user_model()

Status = AssetReturnRequest.RequestStatus
Action = WorkflowAction.Action


class AssetReturnHistoryTests(TestCase):
    def setUp(self):
        self.company = get_default_company()
        self.manager, manager_profile = self._user("return-history-manager@example.com", "EMP-RET-MGR")
        self.employee, self.profile = self._user(
            "return-history-employee@example.com", "EMP-RET-1", manager_profile=manager_profile
        )
        self.outsider, _ = self._user("return-history-outsider@example.com", "EMP-RET-2")
        self.hr_user, _ = self._user("return-history-hr@example.com", "EMP-RET-HR")
        self.ceo_user, _ = self._user("return-history-ceo@example.com", "EMP-RET-CEO")
        self.asset = Asset.objects.create(
            company=self.company,
            name_en="Return History Laptop",
            type=Asset.AssetType.OTHER,
            status=Asset.AssetStatus.ASSIGNED,
            flexible_attributes={"category": "laptop"},
        )

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

    def _request(self, *, profile=None, status=Status.PENDING_MANAGER):
        return AssetReturnRequest.objects.create(
            asset=self.asset, employee=profile or self.profile, note="Leaving the project", status=status
        )

    def _steps(self, request_obj):
        workflow = WorkflowInstance.objects.get(
            content_type=ContentType.objects.get_for_model(AssetReturnRequest), object_id=request_obj.id
        )
        return [
            (action.action, action.from_stage, action.to_stage, action.actor_id)
            for action in workflow.actions.order_by("created_at", "id")
        ]

    def test_manager_then_hr_route_and_processing_record_one_row_each(self):
        request_obj = self._request()
        record_return_request_submission(request_obj, actor=self.employee)

        request_obj, actor_source = apply_manager_decision(request_obj, actor=self.manager, approve=True, comment="OK")
        request_obj = apply_hr_decision(request_obj, actor=self.hr_user, approve=True)
        request_obj = mark_return_request_processed(request_obj, actor=self.hr_user)

        expected = [
            (Action.SUBMIT, "", "manager", self.employee.id),
            (Action.ADVANCE, "manager", "hr", self.manager.id),
            (Action.APPROVE, "hr", "", self.hr_user.id),
            (Action.OVERRIDE, "", "", self.hr_user.id),
        ]
        self.assertEqual(actor_source, "direct_manager")
        self.assertEqual(request_obj.status, Status.PROCESSED)
        self.assertEqual(self._steps(request_obj), expected)
        sync_workflow(request_obj)
        self.assertEqual(self._steps(request_obj), expected)

    def test_hr_manager_request_goes_to_ceo_who_cannot_decide_their_own(self):
        hr_manager, hr_profile = self._user("return-history-hr-manager@example.com", "EMP-RET-HRM")
        hr_manager.groups.add(Group.objects.get_or_create(name="HRManager")[0])
        self.assertEqual(submission_status(hr_manager, hr_profile), Status.PENDING_CEO)
        request_obj = self._request(profile=hr_profile, status=Status.PENDING_CEO)

        with self.assertRaisesMessage(AssetReturnTransitionError, SELF_APPROVAL_MESSAGE):
            apply_ceo_decision(request_obj, actor=hr_manager, approve=True)
        with self.assertRaisesMessage(AssetReturnTransitionError, COMMENT_REQUIRED_MESSAGE):
            apply_ceo_decision(request_obj, actor=self.ceo_user, approve=False, comment=" ")

        request_obj = apply_ceo_decision(request_obj, actor=self.ceo_user, approve=False, comment="Still needed")
        self.assertEqual(request_obj.status, Status.REJECTED)
        self.assertEqual(self._steps(request_obj)[-1], (Action.REJECT, "ceo", "", self.ceo_user.id))

    def test_unrelated_user_cannot_decide_the_manager_stage(self):
        request_obj = self._request()

        with self.assertRaisesMessage(AssetReturnTransitionError, MANAGER_CANNOT_APPROVE_MESSAGE) as caught:
            apply_manager_decision(request_obj, actor=self.outsider, approve=True)

        self.assertEqual(caught.exception.status, 403)
        request_obj.refresh_from_db()
        self.assertEqual(request_obj.status, Status.PENDING_MANAGER)
