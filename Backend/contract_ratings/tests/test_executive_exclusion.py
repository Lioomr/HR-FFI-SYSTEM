from datetime import timedelta
from unittest.mock import patch

import pytest
from audit.models import AuditLog
from core.models import WorkflowInstance
from django.contrib.contenttypes.models import ContentType
from django.utils import timezone
from employees.contract_expiry import contract_rating_due
from employees.models import ContractDecision, EmployeeProfile

from contract_ratings.models import ContractRating
from contract_ratings.services import ensure_contract_rating
from contract_ratings.tasks import process_contract_ratings

pytestmark = pytest.mark.django_db


def _with_contract(profile, *, days_left=90):
    profile.contract_date = timezone.localdate() - timedelta(days=275)
    profile.contract_expiry = timezone.localdate() + timedelta(days=days_left)
    profile.save()
    return profile


def _legacy_rating(profile):
    """A rating created before executives were excluded."""
    with (
        patch("contract_ratings.services.is_executive_profile", return_value=False),
        patch("employees.contract_expiry.is_executive_profile", return_value=False),
    ):
        rating, _ = ensure_contract_rating(profile)
    return rating


def test_scheduler_rates_employees_but_never_executives(world):
    ceo = _with_contract(world.ceo.employee_profile)
    gm = _with_contract(
        EmployeeProfile.objects.create(company=world.company, employee_id="RATING-GM", job_title_en="General Manager")
    )
    agm = _with_contract(
        EmployeeProfile.objects.create(
            company=world.company, employee_id="RATING-AGM", job_title_en="Assistant General Manager"
        )
    )

    summary = process_contract_ratings()

    assert summary["failures"] == 0
    rated = set(ContractRating.objects.values_list("employee_profile_id", flat=True))
    assert rated == {world.profile.id, agm.id}
    assert not ContractDecision.objects.filter(employee_profile__in=[ceo, gm]).exists()
    assert ensure_contract_rating(ceo) == (None, False)
    decision = ContractDecision(
        employee_profile=ceo,
        company=ceo.company,
        status=ContractDecision.Status.PENDING_HR,
        original_contract_date=ceo.contract_date,
        original_contract_expiry=ceo.contract_expiry,
    )
    assert not contract_rating_due(ceo, decision, timezone.localdate())


def test_existing_executive_rating_is_cancelled_once_and_hidden(world):
    ceo = _with_contract(world.ceo.employee_profile)
    rating = _legacy_rating(ceo)
    assert rating.status == ContractRating.Status.PENDING_HR_GATE

    process_contract_ratings()
    process_contract_ratings()

    rating.refresh_from_db()
    decision = rating.contract_decision
    decision.refresh_from_db()
    assert rating.status == ContractRating.Status.CANCELLED
    assert decision.status == ContractDecision.Status.CANCELLED
    assert AuditLog.objects.filter(action="contract_decision_cancelled", entity_id=str(decision.id)).count() == 1
    workflow = WorkflowInstance.objects.get(
        content_type=ContentType.objects.get_for_model(ContractRating), object_id=rating.id
    )
    assert workflow.status == WorkflowInstance.Status.CANCELLED
    assert workflow.current_approver_role == ""

    for user in (world.hr, world.ceo):
        world.client.force_authenticate(user)
        response = world.client.get("/contract-ratings/")
        assert response.status_code == 200
        assert rating.id not in {row["id"] for row in response.data["data"]["items"]}
        response = world.client.get("/api/employees/contract-decisions/")
        assert response.status_code == 200
        assert decision.id not in {row["id"] for row in response.data["data"]["items"]}


def test_ceo_still_decides_an_employees_contract_rating(world):
    from contract_ratings.services import submit_ceo_decision, submit_hr_gate_decision

    rating, _ = ensure_contract_rating(world.profile)
    rating = submit_hr_gate_decision(rating.pk, actor=world.hr, rating_mode=ContractRating.RatingMode.SKIP_TO_CEO)
    rating = submit_ceo_decision(rating.pk, actor=world.ceo, ceo_decision="RENEW", comment="Keep")
    assert rating.status == ContractRating.Status.DECIDED
    assert rating.ceo_decided_by_id == world.ceo.id
