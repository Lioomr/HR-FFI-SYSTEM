from datetime import timedelta
from unittest.mock import patch

import pytest
from rest_framework.exceptions import PermissionDenied

from audit.models import AuditLog
from contract_ratings.models import ContractRating
from contract_ratings.services import acknowledge_termination_notice, submit_ceo_decision, submit_employee_response
from contract_ratings.tasks import execute_scheduled_termination, process_contract_ratings
from employees.contract_expiry import finalize_decision, submit_decision
from employees.models import EmployeeProfile

from .conftest import answers, rated_cycle
from .test_final_phase2 import pending_ceo
from .test_final_phase3 import calls_for

pytestmark = pytest.mark.django_db


def scheduled_termination(world):
    rating = pending_ceo(world)
    return submit_ceo_decision(rating.pk, actor=world.ceo, ceo_decision="TERMINATE", comment="Contract end")


def test_terminate_decision_is_scheduled_without_immediate_profile_mutation(world):
    result = scheduled_termination(world)
    world.profile.refresh_from_db()
    world.employee.refresh_from_db()
    assert result.status == ContractRating.Status.DECIDED
    assert result.ceo_decision == "TERMINATE"
    assert result.scheduled_termination is True
    assert result.termination_processed_at is None
    assert world.profile.employment_status == EmployeeProfile.EmploymentStatus.ACTIVE
    assert world.profile.is_archived is False
    assert world.employee.is_active is True


def test_scheduled_termination_waits_until_expiry_then_processes_exactly_once(world):
    rating = scheduled_termination(world)
    early = execute_scheduled_termination(rating.pk, today=world.profile.contract_expiry - timedelta(days=1))
    assert early.termination_processed_at is None

    first = execute_scheduled_termination(rating.pk, today=world.profile.contract_expiry)
    processed_at = first.termination_processed_at
    second = execute_scheduled_termination(rating.pk, today=world.profile.contract_expiry)
    world.profile.refresh_from_db()
    world.employee.refresh_from_db()
    assert processed_at is not None
    assert second.termination_processed_at == processed_at
    assert world.profile.employment_status == EmployeeProfile.EmploymentStatus.TERMINATED
    assert world.profile.is_archived is True
    assert world.profile.archive_reason == EmployeeProfile.ArchiveReason.END_OF_CONTRACT
    assert world.employee.is_active is False
    assert (
        AuditLog.objects.filter(action="contract_rating_termination_processed", entity_id=str(rating.pk)).count() == 1
    )


def test_acknowledgment_is_hr_only_idempotent_and_never_gates_execution(world):
    rating = scheduled_termination(world)
    with pytest.raises(PermissionDenied):
        acknowledge_termination_notice(rating.pk, actor=world.manager)
    first = acknowledge_termination_notice(rating.pk, actor=world.hr)
    second = acknowledge_termination_notice(rating.pk, actor=world.hr)
    assert first.employee_notified_of_termination_at == second.employee_notified_of_termination_at
    assert first.employee_notified_of_termination_by == world.hr

    other = scheduled_termination_for_outsider(world)
    processed = execute_scheduled_termination(other.pk, today=other.employee_profile.contract_expiry)
    assert processed.termination_processed_at is not None
    assert processed.employee_notified_of_termination_at is None


def scheduled_termination_for_outsider(world):
    profile = world.outsider.employee_profile
    profile.manager_profile = world.manager.employee_profile
    profile.contract_date = world.profile.contract_date
    profile.contract_expiry = world.profile.contract_expiry
    profile.save()
    rating = pending_ceo_for_outsider(world)
    return submit_ceo_decision(rating.pk, actor=world.ceo, ceo_decision="TERMINATE")


def pending_ceo_for_outsider(world):
    from contract_ratings.services import submit_manager_response

    rating = rated_cycle(world, world.outsider.employee_profile)
    submit_manager_response(rating.pk, actor=world.manager, criterion_ratings=answers())
    submit_employee_response(rating.pk, actor=world.outsider, criterion_ratings=answers())
    return ContractRating.objects.get(pk=rating.pk)


@pytest.mark.parametrize("conflict", ["archive", "renewal"])
def test_stale_or_already_archived_profile_requires_manual_resolution(world, conflict):
    rating = scheduled_termination(world)
    if conflict == "archive":
        EmployeeProfile.objects.filter(pk=world.profile.pk).update(is_archived=True)
    else:
        EmployeeProfile.objects.filter(pk=world.profile.pk).update(
            contract_expiry=world.profile.contract_expiry + timedelta(days=365)
        )
    result = execute_scheduled_termination(rating.pk, today=world.profile.contract_expiry)
    assert result.status == ContractRating.Status.MANUAL_RESOLUTION_REQUIRED
    assert result.termination_processed_at is None
    assert AuditLog.objects.filter(action="contract_rating_termination_manual_resolution_required").exists()


def test_termination_rolls_back_profile_account_and_history_on_failure(world):
    rating = scheduled_termination(world)
    with patch("contract_ratings.services._record", side_effect=RuntimeError("history unavailable")):
        with pytest.raises(RuntimeError):
            execute_scheduled_termination(rating.pk, today=world.profile.contract_expiry)
    world.profile.refresh_from_db()
    world.employee.refresh_from_db()
    rating.refresh_from_db()
    assert world.profile.is_archived is False
    assert world.profile.employment_status == EmployeeProfile.EmploymentStatus.ACTIVE
    assert world.employee.is_active is True
    assert rating.termination_processed_at is None


def test_same_hourly_task_executes_due_termination_and_notifies_hr_manager(world, notifications):
    rating = scheduled_termination(world)
    notifications.reset_mock()
    process_contract_ratings(today=world.profile.contract_expiry)
    rating.refresh_from_db()
    assert rating.termination_processed_at is not None
    recipients = {call["recipient"].pk for call in calls_for(notifications, "termination_finalized")}
    assert recipients == {world.hr.pk, world.manager.pk}


def test_acknowledgment_endpoint_records_only(world):
    rating = scheduled_termination(world)
    url = f"/contract-ratings/{rating.pk}/acknowledge-termination-notice/"
    world.client.force_authenticate(world.manager)
    assert world.client.post(url, {}).status_code == 403
    world.client.force_authenticate(world.hr)
    response = world.client.post(url, {})
    assert response.status_code == 200
    rating.refresh_from_db()
    assert rating.employee_notified_of_termination_at is not None
    assert rating.termination_processed_at is None


def test_standalone_contract_decision_termination_remains_immediate(world):
    rating = pending_ceo(world)
    with patch("employees.contract_expiry.notify_ceo_pending"):
        submit_decision(rating.contract_decision_id, actor=world.hr, decision_type="TERMINATE")
    finalize_decision(rating.contract_decision_id, actor=world.ceo)
    world.profile.refresh_from_db()
    assert world.profile.is_archived is True
    assert world.profile.employment_status == EmployeeProfile.EmploymentStatus.TERMINATED
    result = submit_ceo_decision(rating.pk, actor=world.ceo, ceo_decision="RENEW")
    assert result.status == ContractRating.Status.MANUAL_RESOLUTION_REQUIRED
