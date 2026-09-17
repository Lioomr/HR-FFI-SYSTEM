from datetime import timedelta

import pytest
from django.utils import timezone

from contract_ratings.models import ContractRatingResponse
from contract_ratings.services import ensure_contract_rating
from core.models import DelegationRule
from hr_reference.models import Position

from .conftest import answers

pytestmark = pytest.mark.django_db


def test_manager_proposal_error_uses_existing_422_envelope(world):
    rating, _ = ensure_contract_rating(world.profile)
    world.client.force_authenticate(world.manager)
    response = world.client.post(
        f"/contract-ratings/{rating.pk}/manager-response/",
        {"criterion_ratings": answers(), "recommendation": "CONTINUE_WITH_CHANGES"},
        format="json",
    )
    assert response.status_code == 422
    assert response.data == {
        "status": "error",
        "message": "Select at least one change type.",
        "errors": [{"field": "non_field_errors", "message": "Select at least one change type."}],
    }
    assert not ContractRatingResponse.objects.filter(rating=rating).exists()


def test_manager_position_lookup_is_minimal_and_company_scoped(world):
    rating, _ = ensure_contract_rating(world.profile)
    position = Position.objects.create(company=world.company, code="LOCAL", name="Engineer", description="Private")
    Position.objects.create(company=world.foreign, code="FOREIGN", name="Foreign")
    Position.objects.create(company=None, code="GLOBAL", name="Global")
    Position.objects.create(company=world.company, code="INACTIVE", name="Inactive", is_active=False)
    world.client.force_authenticate(world.manager)
    response = world.client.get(f"/contract-ratings/{rating.pk}/positions/")
    assert response.status_code == 200
    assert response.data == {"status": "success", "data": [{"id": position.pk, "name": "Engineer"}]}
    # Lookup access does not grant reference-data administration.
    assert world.client.get("/api/hr/positions/").status_code == 403
    response = world.client.post(
        f"/contract-ratings/{rating.pk}/manager-response/",
        {
            "criterion_ratings": answers(),
            "recommendation": "CONTINUE_WITH_CHANGES",
            "recommended_change_types": ["POSITION_CHANGE"],
            "proposed_position_id": position.pk,
        },
        format="json",
    )
    assert response.status_code == 200
    assert response.data["data"]["manager_response"]["proposed_position_id"] == position.pk


@pytest.mark.parametrize("role", ["employee", "outsider", "foreign_hr", "hr", "ceo"])
def test_position_lookup_rejects_non_managers(world, role):
    rating, _ = ensure_contract_rating(world.profile)
    world.client.force_authenticate(getattr(world, role))
    response = world.client.get(f"/contract-ratings/{rating.pk}/positions/")
    assert response.status_code in {403, 404}


def test_position_lookup_checks_active_company_and_authentication(world):
    rating, _ = ensure_contract_rating(world.profile)
    url = f"/contract-ratings/{rating.pk}/positions/"
    assert world.client.get(url).status_code == 401
    world.client.force_authenticate(world.manager)
    world.client.credentials(HTTP_X_ACTIVE_COMPANY_ID=str(world.foreign.pk))
    assert world.client.get(url).status_code in {403, 404}


def test_position_lookup_follows_current_manager_and_delegation(world):
    rating, _ = ensure_contract_rating(world.profile)
    url = f"/contract-ratings/{rating.pk}/positions/"
    DelegationRule.objects.create(
        from_user=world.manager,
        to_user=world.outsider,
        start_at=timezone.now() - timedelta(hours=1),
        end_at=timezone.now() + timedelta(days=1),
        capabilities=["workflow.approve"],
    )
    world.client.force_authenticate(world.outsider)
    assert world.client.get(url).status_code == 200
    world.profile.manager_profile = world.hr.employee_profile
    world.profile.save(update_fields=["manager_profile"])
    assert world.client.get(url).status_code in {403, 404}
    world.client.force_authenticate(world.manager)
    assert world.client.get(url).status_code in {403, 404}
