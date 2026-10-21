from datetime import date, time

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.utils import timezone

from core.models import WorkflowAction
from employees.models import EmployeeProfile
from employees.services.archiving import retire_biotime_mapping_and_archive_profile
from organization.models import OrganizationNode
from permission_requests.models import PermissionRequest
from permission_requests.services import (
    ARCHIVED_EMPLOYEE_MESSAGE,
    PermissionRequestError,
    apply_hr_decision,
    apply_manager_decision,
)

pytestmark = pytest.mark.django_db

User = get_user_model()
Status = PermissionRequest.Status
Decision = PermissionRequest.Decision


@pytest.fixture
def setup():
    company = OrganizationNode.objects.get(code="FFI")

    def make(email, employee_id, *, manager_profile=None):
        user = User.objects.create_user(email=email, password="password")
        profile = EmployeeProfile.objects.create(
            user=user,
            company=company,
            employee_id=employee_id,
            department="Ops",
            job_title="Staff",
            hire_date=date(2021, 1, 1),
            manager_profile=manager_profile,
        )
        return user, profile

    manager, manager_profile = make("perm-arch-manager@example.com", "EMP-PARCH-MGR")
    employee, profile = make("perm-arch-employee@example.com", "EMP-PARCH-1", manager_profile=manager_profile)
    actor, _ = make("perm-arch-actor@example.com", "EMP-PARCH-ACT")
    actor.groups.add(Group.objects.get_or_create(name="HRManager")[0])
    counter = iter(range(1, 100))

    def request(status):
        return PermissionRequest.objects.create(
            employee=employee,
            employee_profile=profile,
            company=company,
            reference_no=f"PARCH-{next(counter)}",
            request_date=date(2026, 11, 1),
            from_time=time(10, 0),
            to_time=time(11, 0),
            duration_minutes=60,
            exit_type=PermissionRequest.ExitType.PERSONAL,
            reason="Errand",
            status=status,
        )

    return {"manager": manager, "profile": profile, "actor": actor, "request": request}


def _mark_archived(profile):
    EmployeeProfile._base_manager.filter(pk=profile.pk).update(is_archived=True)


def test_archiving_cancels_pending_permission_requests_and_keeps_approved_ones(setup):
    pending = [setup["request"](Status.PENDING_MANAGER), setup["request"](Status.PENDING_HR)]
    approved = setup["request"](Status.APPROVED)
    snapshot = {}

    retire_biotime_mapping_and_archive_profile(setup["profile"], snapshot, setup["actor"], "RESIGNED", timezone.now())

    for permission in pending:
        permission.refresh_from_db()
        assert permission.status == Status.CANCELLED
        assert permission.cancelled_at is not None
        action = WorkflowAction.objects.filter(workflow__object_id=permission.id).latest("id")
        assert "Archived employee (RESIGNED)" in action.note
    approved.refresh_from_db()
    assert approved.status == Status.APPROVED
    assert sorted(snapshot["permission_requests_cancelled"]) == sorted(p.id for p in pending)


def test_approvals_are_refused_for_an_archived_employee(setup):
    manager_request = setup["request"](Status.PENDING_MANAGER)
    hr_request = setup["request"](Status.PENDING_HR)
    _mark_archived(setup["profile"])

    with pytest.raises(PermissionRequestError) as manager_error:
        apply_manager_decision(manager_request, actor=setup["manager"], decision=Decision.APPROVED)
    assert str(manager_error.value) == ARCHIVED_EMPLOYEE_MESSAGE
    with pytest.raises(PermissionRequestError) as hr_error:
        apply_hr_decision(hr_request, actor=setup["actor"], decision=Decision.APPROVED)
    assert str(hr_error.value) == ARCHIVED_EMPLOYEE_MESSAGE

    hr_request.refresh_from_db()
    assert hr_request.status == Status.PENDING_HR


def test_rejecting_is_still_allowed_for_an_archived_employee(setup):
    hr_request = setup["request"](Status.PENDING_HR)
    _mark_archived(setup["profile"])

    apply_hr_decision(hr_request, actor=setup["actor"], decision=Decision.REJECTED, note="Employee archived")

    hr_request.refresh_from_db()
    assert hr_request.status == Status.REJECTED
