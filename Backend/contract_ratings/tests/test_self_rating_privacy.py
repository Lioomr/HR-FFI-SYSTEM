"""The rated person never sees more than the employee view of their own rating.

Holding an HR approver role must not widen what someone sees about their
*own* contract rating: not the manager's answers, not the decision, and no HR
comment duties on themselves.
"""

from unittest.mock import patch

import pytest
from django.contrib.auth.models import Group
from rest_framework.exceptions import PermissionDenied

from contract_ratings.models import ContractRating
from contract_ratings.services import (
    acknowledge_termination_notice,
    ensure_contract_rating,
    request_hr_comment,
    submit_ceo_decision,
    submit_hr_gate_decision,
)

from .conftest import rated_cycle
from .test_final_phase2 import pending_ceo

pytestmark = pytest.mark.django_db


def _make_hr_approver(user):
    user.groups.add(Group.objects.get_or_create(name="HRManager")[0])


def test_hr_approver_rated_as_employee_gets_only_the_employee_view(world):
    _make_hr_approver(world.employee)
    rating = pending_ceo(world)
    request_hr_comment(rating.pk, actor=world.ceo)
    submit_ceo_decision(rating.pk, actor=world.ceo, ceo_decision="RENEW")

    world.client.force_authenticate(world.employee)
    payload = world.client.get(f"/contract-ratings/{rating.pk}/").data["data"]
    assert "employee_response" in payload
    for hidden in ("manager_response", "comparison_summary", "ceo_decision", "ceo_comment", "hr_comment"):
        assert hidden not in payload, hidden

    item = next(row for row in world.client.get("/contract-ratings/").data["data"]["items"] if row["id"] == rating.pk)
    assert "manager_response" not in item and "ceo_decision" not in item


def test_pdf_for_an_hr_approver_rated_as_employee_is_the_employee_copy_without_decision(world):
    _make_hr_approver(world.employee)
    rating = pending_ceo(world)
    request_hr_comment(rating.pk, actor=world.ceo)
    rating.refresh_from_db()

    world.client.force_authenticate(world.employee)
    with patch("contract_ratings.views.build_contract_rating_pdf", return_value=b"%PDF-1.4 stub") as build:
        response = world.client.get(f"/contract-ratings/{rating.pk}/pdf/")
    assert response.status_code == 200
    _, kwargs = build.call_args
    assert kwargs["include_decision"] is False
    assert kwargs["response"] == rating.employee_response


def test_skip_to_ceo_rating_is_invisible_to_the_rated_hr_approver(world):
    rating, _ = ensure_contract_rating(world.profile)
    rating = submit_hr_gate_decision(
        rating.pk, actor=world.hr, rating_mode=ContractRating.RatingMode.SKIP_TO_CEO
    )
    _make_hr_approver(world.employee)

    world.client.force_authenticate(world.employee)
    assert world.client.get(f"/contract-ratings/{rating.pk}/").status_code == 404
    assert world.client.get(f"/contract-ratings/{rating.pk}/pdf/").status_code == 404
    ids = [row["id"] for row in world.client.get("/contract-ratings/").data["data"]["items"]]
    assert rating.pk not in ids

    # Other HR approvers still see it as before.
    world.client.force_authenticate(world.hr)
    assert world.client.get(f"/contract-ratings/{rating.pk}/").status_code == 200


def test_rated_hr_approver_cannot_acknowledge_their_own_termination_notice(world):
    _make_hr_approver(world.employee)
    rating = rated_cycle(world)
    with pytest.raises(PermissionDenied):
        acknowledge_termination_notice(rating.pk, actor=world.employee)
