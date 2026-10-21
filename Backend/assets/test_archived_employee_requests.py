from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from assets.models import Asset, AssetReturnRequest
from assets.services.return_requests import (
    ARCHIVED_EMPLOYEE_MESSAGE,
    AssetReturnTransitionError,
    apply_ceo_decision,
    apply_hr_decision,
    apply_manager_decision,
)
from core.models import WorkflowAction
from employees.models import EmployeeProfile
from employees.services.archiving import retire_biotime_mapping_and_archive_profile
from organization.services import get_default_company

User = get_user_model()

Status = AssetReturnRequest.RequestStatus


class ArchivedEmployeeAssetReturnTests(TestCase):
    def setUp(self):
        self.company = get_default_company()
        self.manager, manager_profile = self._user("ret-arch-manager@example.com", "EMP-RARCH-MGR")
        self.employee, self.profile = self._user(
            "ret-arch-employee@example.com", "EMP-RARCH-1", manager_profile=manager_profile
        )
        self.actor, _ = self._user("ret-arch-actor@example.com", "EMP-RARCH-ACT")
        self.asset = Asset.objects.create(
            company=self.company,
            name_en="Archive Laptop",
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

    def _request(self, status):
        return AssetReturnRequest.objects.create(
            asset=self.asset, employee=self.profile, note="Leaving the project", status=status
        )

    def _mark_archived(self):
        EmployeeProfile._base_manager.filter(pk=self.profile.pk).update(is_archived=True)

    def _archive(self):
        snapshot = {}
        retire_biotime_mapping_and_archive_profile(self.profile, snapshot, self.actor, "RESIGNED", timezone.now())
        return snapshot

    def test_archiving_cancels_pending_return_requests_and_records_the_reason(self):
        pending = [
            self._request(Status.PENDING_MANAGER),
            self._request(Status.PENDING),
            self._request(Status.PENDING_CEO),
        ]

        snapshot = self._archive()

        for return_request in pending:
            return_request.refresh_from_db()
            self.assertEqual(return_request.status, Status.CANCELLED)
            action = WorkflowAction.objects.filter(workflow__object_id=return_request.id).latest("id")
            self.assertIn("Archived employee (RESIGNED)", action.note)
        self.assertCountEqual(snapshot["asset_return_requests_cancelled"], [r.id for r in pending])

    def test_archiving_keeps_approved_returns_so_hr_can_still_receive_the_asset(self):
        approved = self._request(Status.APPROVED)

        snapshot = self._archive()

        approved.refresh_from_db()
        self.assertEqual(approved.status, Status.APPROVED)
        self.assertNotIn("asset_return_requests_cancelled", snapshot)

    def test_approvals_are_refused_for_an_archived_employee(self):
        manager_request = self._request(Status.PENDING_MANAGER)
        hr_request = self._request(Status.PENDING)
        ceo_request = self._request(Status.PENDING_CEO)
        self._mark_archived()

        calls = [
            lambda: apply_manager_decision(manager_request, actor=self.manager, approve=True),
            lambda: apply_hr_decision(hr_request, actor=self.actor, approve=True),
            lambda: apply_ceo_decision(ceo_request, actor=self.actor, approve=True),
        ]
        for call in calls:
            with self.assertRaises(AssetReturnTransitionError) as raised:
                call()
            self.assertEqual(str(raised.exception), ARCHIVED_EMPLOYEE_MESSAGE)

        hr_request.refresh_from_db()
        self.assertEqual(hr_request.status, Status.PENDING)

    def test_rejecting_is_still_allowed_for_an_archived_employee(self):
        hr_request = self._request(Status.PENDING)
        self._mark_archived()

        apply_hr_decision(hr_request, actor=self.actor, approve=False, comment="Employee archived")

        hr_request.refresh_from_db()
        self.assertEqual(hr_request.status, Status.REJECTED)
