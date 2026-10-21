from datetime import date
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APITestCase

from core.models import WorkflowAction
from employees.models import EmployeeProfile
from employees.services.archiving import retire_biotime_mapping_and_archive_profile
from leaves.models import LeaveRequest, LeaveType
from leaves.services import (
    ARCHIVED_EMPLOYEE_MESSAGE,
    LeaveTransitionError,
    apply_hr_approval,
    apply_hr_rejection,
    apply_manager_approval,
    notify_after_hr_cancellation,
)
from organization.services import get_default_company

User = get_user_model()

Status = LeaveRequest.RequestStatus


class ArchivedEmployeeLeaveRequestTests(APITestCase):
    def setUp(self):
        self.company = get_default_company()
        self.leave_type = LeaveType.objects.create(company=self.company, name="Annual Leave", code="ANNUAL")
        Group.objects.get_or_create(name="HRManager")
        self.employee = self._user("archived-emp@example.com", "EMP-ARCH-1")
        self.actor = self._user("archived-actor@example.com", "EMP-ARCH-ACTOR")

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

    def _leave(self, status):
        return LeaveRequest.objects.create(
            employee=self.employee,
            employee_profile=self.employee.employee_profile,
            leave_type=self.leave_type,
            start_date=date(2026, 11, 1),
            end_date=date(2026, 11, 3),
            status=status,
        )

    def _archive(self):
        profile = self.employee.employee_profile
        snapshot = {}
        retire_biotime_mapping_and_archive_profile(profile, snapshot, self.actor, "RESIGNED", timezone.now())
        return snapshot

    def test_archiving_cancels_pending_requests_and_records_the_reason(self):
        pending = [self._leave(Status.PENDING_MANAGER), self._leave(Status.PENDING_HR), self._leave(Status.PENDING_CEO)]

        snapshot = self._archive()

        for leave in pending:
            leave.refresh_from_db()
            self.assertEqual(leave.status, Status.CANCELLED)
            action = WorkflowAction.objects.filter(workflow__object_id=leave.id).order_by("-id").first()
            self.assertIn("Archived employee", action.note)
        self.assertCountEqual(snapshot["leave_requests_cancelled"], [leave.id for leave in pending])

    def test_archiving_leaves_approved_and_closed_requests_alone(self):
        approved = self._leave(Status.APPROVED)
        rejected = self._leave(Status.REJECTED)

        snapshot = self._archive()

        approved.refresh_from_db()
        rejected.refresh_from_db()
        self.assertEqual(approved.status, Status.APPROVED)
        self.assertEqual(rejected.status, Status.REJECTED)
        self.assertNotIn("leave_requests_cancelled", snapshot)

    def test_approvals_are_refused_for_an_archived_employee(self):
        manager_leave = self._leave(Status.PENDING_MANAGER)
        hr_leave = self._leave(Status.PENDING_HR)
        EmployeeProfile._base_manager.filter(pk=self.employee.employee_profile.pk).update(is_archived=True)

        with self.assertRaises(LeaveTransitionError) as hr_error:
            apply_hr_approval(hr_leave, actor=self.actor)
        self.assertEqual(str(hr_error.exception), ARCHIVED_EMPLOYEE_MESSAGE)
        with self.assertRaises(LeaveTransitionError):
            apply_manager_approval(manager_leave, actor=self.actor)

        hr_leave.refresh_from_db()
        self.assertEqual(hr_leave.status, Status.PENDING_HR)

    def test_rejecting_is_still_allowed_for_an_archived_employee(self):
        leave = self._leave(Status.PENDING_HR)
        EmployeeProfile._base_manager.filter(pk=self.employee.employee_profile.pk).update(is_archived=True)

        apply_hr_rejection(leave, actor=self.actor, comment="Employee archived")

        leave.refresh_from_db()
        self.assertEqual(leave.status, Status.REJECTED)

    def test_archiving_marks_employment_as_terminated(self):
        self._archive()

        profile = EmployeeProfile._base_manager.get(pk=self.employee.employee_profile.pk)
        self.assertTrue(profile.is_archived)
        self.assertEqual(profile.employment_status, EmployeeProfile.EmploymentStatus.TERMINATED)

    def test_hr_cancellation_notice_is_skipped_when_the_request_has_no_user_account(self):
        leave = LeaveRequest.objects.create(
            employee=None,
            employee_profile=self.employee.employee_profile,
            leave_type=self.leave_type,
            start_date=date(2026, 11, 1),
            end_date=date(2026, 11, 3),
            status=Status.CANCELLED,
            source=LeaveRequest.RequestSource.HR_MANUAL,
        )

        with patch("leaves.services._log_notification_failure") as failure:
            notify_after_hr_cancellation(leave, reason="Entered by mistake", actor_id=self.actor.pk)

        failure.assert_not_called()

    def test_serializer_flags_requests_of_archived_employees(self):
        from leaves.serializers import LeaveRequestSerializer

        leave = self._leave(Status.PENDING_HR)
        self.assertFalse(LeaveRequestSerializer(leave).data["employee_archived"])

        EmployeeProfile._base_manager.filter(pk=self.employee.employee_profile.pk).update(is_archived=True)
        leave = LeaveRequest.objects.get(pk=leave.pk)

        self.assertTrue(LeaveRequestSerializer(leave).data["employee_archived"])
