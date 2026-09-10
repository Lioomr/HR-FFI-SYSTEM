from decimal import Decimal
from unittest.mock import patch

import pytest
from django.contrib.contenttypes.models import ContentType
from django.db import IntegrityError

from attendance.models import AttendanceRecord, BioTimeEmployeeMap
from audit.models import AuditLog
from core.models import WorkflowInstance
from core.services.workflow_engine import sync_workflow
from employees import test_contract_expiry as fixtures
from employees.contract_expiry import ensure_contract_decision, finalize_decision, reject_decision, submit_decision
from employees.models import ContractDecision, EmployeeProfile

pytestmark = pytest.mark.django_db


@pytest.fixture
def contract():
    case = fixtures.ContractExpiryWorkflowTests(methodName="runTest")
    case.setUp()
    with patch("employees.contract_expiry.notify_ceo_pending"):
        yield case


@pytest.mark.parametrize("automatic", [False, True])
@pytest.mark.parametrize("linked_user", [False, True])
def test_termination_retires_mapping_preserves_attendance_and_disables_account(contract, automatic, linked_user):
    profile = contract.profile
    if not linked_user:
        profile.user = None
        profile.save(update_fields=["user"])
    mapping = BioTimeEmployeeMap.objects.create(employee_profile=profile, biotime_emp_code="TERM-SUCCESS")
    attendance = AttendanceRecord.objects.create(employee_profile=profile, date=profile.contract_date, status="PRESENT")
    version = contract.employee.auth_token_version
    decision, _ = ensure_contract_decision(profile)
    submit_decision(decision.id, actor=contract.hr, decision_type="TERMINATE")
    finalized = finalize_decision(decision.id, actor=None if automatic else contract.ceo, automatic=automatic)
    profile.refresh_from_db()
    contract.employee.refresh_from_db()
    assert profile.is_archived and profile.archive_reason == EmployeeProfile.ArchiveReason.END_OF_CONTRACT
    assert profile.archived_by_id == (None if automatic else contract.ceo.id)
    assert not BioTimeEmployeeMap.objects.filter(pk=mapping.pk).exists()
    assert AttendanceRecord.objects.filter(pk=attendance.pk).exists()
    assert contract.employee.is_active is (not linked_user)
    assert contract.employee.auth_token_version == version + int(linked_user)
    assert finalized.status == ("AUTO_APPROVED" if automatic else "APPROVED")
    action = "contract_decision_auto_approved" if automatic else "contract_decision_approved"
    audit = AuditLog.objects.get(action=action, entity_id=decision.id)
    assert audit.metadata["biotime_mappings_removed"] == [{"id": mapping.id, "biotime_emp_code": "TERM-SUCCESS"}]


def test_archive_integrity_failure_returns_422_and_restores_mapping(contract):
    mapping = BioTimeEmployeeMap.objects.create(employee_profile=contract.profile, biotime_emp_code="TERM-ROLLBACK")
    decision, _ = ensure_contract_decision(contract.profile)
    submit_decision(decision.id, actor=contract.hr, decision_type="TERMINATE")
    contract.client.force_authenticate(contract.ceo)
    with patch("employees.models.EmployeeProfile.save", side_effect=IntegrityError("archive guard")):
        response = contract.client.post(f"/api/employees/contract-decisions/{decision.id}/approve/", {}, secure=True)
    assert response.status_code == 422
    contract.profile.refresh_from_db()
    decision.refresh_from_db()
    assert not contract.profile.is_archived
    assert decision.status == "PENDING_CEO"
    assert BioTimeEmployeeMap.objects.filter(pk=mapping.pk).exists()


def test_late_termination_failure_rolls_back_account_profile_mapping_and_history(contract):
    mapping = BioTimeEmployeeMap.objects.create(employee_profile=contract.profile, biotime_emp_code="TERM-LATE")
    version = contract.employee.auth_token_version
    decision, _ = ensure_contract_decision(contract.profile)
    submit_decision(decision.id, actor=contract.hr, decision_type="TERMINATE")
    with patch("employees.contract_expiry.sync_workflow", side_effect=RuntimeError("projection unavailable")):
        with pytest.raises(RuntimeError, match="projection unavailable"):
            finalize_decision(decision.id, actor=contract.ceo)
    decision.refresh_from_db()
    contract.profile.refresh_from_db()
    contract.employee.refresh_from_db()
    assert not contract.profile.is_archived
    assert contract.employee.is_active and contract.employee.auth_token_version == version
    assert decision.status == "PENDING_CEO"
    assert BioTimeEmployeeMap.objects.filter(pk=mapping.pk).exists()
    assert not AuditLog.objects.filter(action="contract_decision_approved", entity_id=decision.id).exists()


@pytest.mark.parametrize(
    "value", ["Infinity", "-Infinity", "NaN", "sNaN", "10000000000.00", "1.001", "-0.01", "1e999999"]
)
@pytest.mark.parametrize("path", ["submission", "finalization"])
@pytest.mark.parametrize("decision_type", ["RENEW", "RENEW_WITH_CHANGES"])
def test_invalid_salary_returns_422_without_mutation(contract, value, path, decision_type):
    decision, _ = ensure_contract_decision(contract.profile)
    old_date = contract.profile.contract_date
    if path == "submission":
        contract.client.force_authenticate(contract.hr)
        response = contract.client.post(
            f"/api/employees/{contract.profile.id}/contract-decisions/",
            {"decision_type": decision_type, "proposed_terms": {"basic_salary": value}},
            format="json",
            secure=True,
        )
        expected_status = "PENDING_HR"
    else:
        submit_decision(decision.id, actor=contract.hr, decision_type=decision_type)
        # Historical/corrupt persisted payloads must not bypass finalization validation.
        ContractDecision.objects.filter(pk=decision.pk).update(proposed_terms={"basic_salary": value})
        contract.client.force_authenticate(contract.ceo)
        response = contract.client.post(f"/api/employees/contract-decisions/{decision.id}/approve/", {}, secure=True)
        expected_status = "PENDING_CEO"
    assert response.status_code == 422, response.data
    assert response.data["status"] == "error"
    assert response.data["errors"]
    contract.profile.refresh_from_db()
    decision.refresh_from_db()
    assert decision.status == expected_status
    assert contract.profile.basic_salary == Decimal("1000.00")
    assert contract.profile.contract_date == old_date


@pytest.mark.parametrize(
    "terms",
    [
        {"basic_salary": "1500"},
        {"basic_salary": "1500", "total_salary": "1800.00"},
        {"basic_salary": "1500", "total_salary": None},
    ],
)
def test_total_is_derived_and_saved_with_components(contract, terms):
    decision, _ = ensure_contract_decision(contract.profile)
    submitted = submit_decision(
        decision.id, actor=contract.hr, decision_type="RENEW_WITH_CHANGES", proposed_terms=terms
    )
    assert submitted.proposed_terms["total_salary"] == "1800.00"
    finalize_decision(decision.id, actor=contract.ceo)
    contract.profile.refresh_from_db()
    assert contract.profile.total_salary == Decimal("1800.00")


@pytest.mark.parametrize("path", ["submission", "finalization"])
@pytest.mark.parametrize(
    "terms",
    [
        {"basic_salary": "1500", "total_salary": "1300"},
        {"basic_salary": "9999999999.99"},  # Valid component but overflowing total.
    ],
)
def test_contradictory_or_overflowing_total_is_rejected(contract, path, terms):
    decision, _ = ensure_contract_decision(contract.profile)
    if path == "submission":
        with pytest.raises(ValueError):
            submit_decision(decision.id, actor=contract.hr, decision_type="RENEW_WITH_CHANGES", proposed_terms=terms)
    else:
        submit_decision(decision.id, actor=contract.hr, decision_type="RENEW")
        ContractDecision.objects.filter(pk=decision.pk).update(proposed_terms=terms)
        with pytest.raises(ValueError):
            finalize_decision(decision.id, actor=contract.ceo)
    contract.profile.refresh_from_db()
    assert contract.profile.total_salary == Decimal("1300.00")


@pytest.mark.parametrize("legacy", [False, True])
@pytest.mark.parametrize("final_action", ["approve", "reject"])
def test_all_hr_and_ceo_attempts_survive_resubmission_without_rewriting_history(contract, legacy, final_action):
    decision, _ = ensure_contract_decision(contract.profile)
    workflow = WorkflowInstance.objects.get(
        content_type=ContentType.objects.get_for_model(ContractDecision),
        object_id=decision.id,
    )
    preserved = {}
    for attempt in range(3):
        submit_decision(decision.id, actor=contract.hr, decision_type="RENEW", hr_comment=f"HR attempt {attempt}")
        if attempt < 2:
            EmployeeProfile.objects.filter(pk=contract.profile.pk).update(basic_salary=Decimal(1100 + attempt * 100))
            finalized = finalize_decision(decision.id, actor=contract.ceo, comment=f"CEO attempt {attempt}")
            assert finalized.status == "MANUAL_RESOLUTION_REQUIRED"
        elif final_action == "reject":
            finalized = reject_decision(decision.id, actor=contract.ceo, comment=f"CEO attempt {attempt}")
        else:
            finalized = finalize_decision(decision.id, actor=contract.ceo, comment=f"CEO attempt {attempt}")
        if legacy and attempt == 0:
            for action in workflow.actions.all():
                action.metadata["legacy_signature"] = action.metadata.pop("legacy_kind")
                action.save(update_fields=["metadata"])
        for _ in range(2):
            sync_workflow(finalized)
        current = {row["id"]: row for row in workflow.actions.values()}
        assert all(current[key] == row for key, row in preserved.items())
        preserved = current
        assert workflow.actions.filter(approver_role="hr").count() == attempt + 1
        assert workflow.actions.filter(approver_role="ceo").count() == attempt + 1
    assert set(workflow.actions.filter(approver_role="hr").values_list("note", flat=True)) == {
        f"HR attempt {attempt}" for attempt in range(3)
    }
    assert set(workflow.actions.filter(approver_role="ceo").values_list("note", flat=True)) == {
        f"CEO attempt {attempt}" for attempt in range(3)
    }
