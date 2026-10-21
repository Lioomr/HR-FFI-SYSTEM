"""Profile change requests of an archived employee, and the shared pending-approval inbox rule."""

from datetime import date

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import WorkflowAction
from core.services.archived_employee import is_stale_request_of_archived_employee
from core.services.workflow_engine import sync_workflow
from employees.models import EmployeeProfile, ProfileChangeRequest
from employees.services import profile_change_requests as services
from employees.services.archiving import retire_biotime_mapping_and_archive_profile
from organization.models import OrganizationNode

pytestmark = pytest.mark.django_db

User = get_user_model()
Status = ProfileChangeRequest.Status


@pytest.fixture
def world():
    company = OrganizationNode.objects.get(code="FFI")

    def make(email, employee_id):
        user = User.objects.create_user(email=email, password="password", full_name=employee_id)
        profile = EmployeeProfile.objects.create(
            user=user,
            company=company,
            employee_id=employee_id,
            full_name=employee_id,
            department="Ops",
            job_title="Staff",
            hire_date=date(2021, 1, 1),
        )
        return user, profile

    hr, _ = make("pcr-arch-hr@example.com", "EMP-PCRA-HR")
    hr.groups.add(Group.objects.get_or_create(name="HRManager")[0])
    employee, profile = make("pcr-arch-employee@example.com", "EMP-PCRA-1")
    other, other_profile = make("pcr-arch-other@example.com", "EMP-PCRA-2")

    def change(owner, owner_profile, status=Status.PENDING_HR):
        return ProfileChangeRequest.objects.create(
            employee_profile=owner_profile,
            company=company,
            submitted_by=owner,
            status=status,
            items=[
                {
                    "field": "mobile",
                    "old": "",
                    "new": "+966511111111",
                    "source": "manual",
                    "decision": "pending",
                    "note": "",
                }
            ],
        )

    return {
        "company": company,
        "hr": hr,
        "profile": profile,
        "other_profile": other_profile,
        "change": lambda status=Status.PENDING_HR: change(employee, profile, status),
        "other_change": lambda: change(other, other_profile),
    }


def _mark_archived(profile):
    EmployeeProfile._base_manager.filter(pk=profile.pk).update(is_archived=True)


def test_archiving_cancels_pending_profile_changes_and_records_the_reason(world):
    approved = world["change"](Status.APPROVED)
    pending = world["change"]()
    snapshot = {}

    retire_biotime_mapping_and_archive_profile(world["profile"], snapshot, world["hr"], "RESIGNED", timezone.now())

    pending.refresh_from_db()
    approved.refresh_from_db()
    assert pending.status == Status.CANCELLED
    assert "Archived employee (RESIGNED)" in pending.decision_note
    assert approved.status == Status.APPROVED
    action = WorkflowAction.objects.filter(workflow__object_id=pending.id).latest("id")
    assert "Archived employee (RESIGNED)" in action.note
    assert snapshot["profile_change_requests_cancelled"] == [pending.id]
    profile = EmployeeProfile._base_manager.get(pk=world["profile"].pk)
    assert profile.mobile != "+966511111111"


def test_approving_is_refused_but_rejecting_everything_is_allowed_for_an_archived_employee(world):
    change = world["change"]()
    _mark_archived(world["profile"])

    with pytest.raises(services.ProfileChangeError) as refused:
        services.decide_change_request(
            change, actor=world["hr"], decisions=[{"field": "mobile", "decision": services.APPROVE}]
        )
    assert refused.value.message == services.ARCHIVED_EMPLOYEE_MESSAGE
    change.refresh_from_db()
    assert change.status == Status.PENDING_HR

    services.decide_change_request(
        change, actor=world["hr"], decisions=[{"field": "mobile", "decision": services.REJECT, "note": "Archived"}]
    )
    change.refresh_from_db()
    assert change.status == Status.REJECTED


def test_inbox_hides_requests_of_archived_employees_but_not_of_active_ones(world):
    stale = world["change"]()
    live = world["other_change"]()
    for request in (stale, live):
        sync_workflow(request, actor=world["hr"])
    _mark_archived(world["profile"])
    client = APIClient()
    client.force_authenticate(world["hr"])
    client.credentials(HTTP_X_ACTIVE_COMPANY_ID=str(world["company"].id))

    response = client.get("/api/core/pending-requests/")

    assert response.status_code == 200
    names = [item["name"] for item in response.data["data"]["items"]]
    assert "EMP-PCRA-2" in names
    assert "EMP-PCRA-1" not in names
    assert live.status == Status.PENDING_HR and stale.pk != live.pk


def test_stale_request_helper_ignores_termination_settlements_and_unrelated_models(world):
    from leaves.models import AnnualLeavePaymentRequest

    profile = EmployeeProfile._base_manager.get(pk=world["profile"].pk)
    profile.is_archived = True
    regular = AnnualLeavePaymentRequest(employee_profile=profile, is_termination_settlement=False)
    settlement = AnnualLeavePaymentRequest(employee_profile=profile, is_termination_settlement=True)

    assert is_stale_request_of_archived_employee(regular)
    assert not is_stale_request_of_archived_employee(settlement)
    assert not is_stale_request_of_archived_employee(profile)
    assert not is_stale_request_of_archived_employee(None)
