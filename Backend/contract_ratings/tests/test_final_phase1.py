from decimal import Decimal

import pytest
from rest_framework.exceptions import PermissionDenied, ValidationError

from audit.models import AuditLog
from contract_ratings.criteria import CRITERIA, GRADE_RANGES, RatingGrade
from contract_ratings.models import ContractRating, ContractRatingResponse
from contract_ratings.scoring import compute_average_and_grade, validate_criterion_ratings
from contract_ratings.services import ensure_contract_rating, submit_employee_response, submit_manager_response

from .conftest import answers, rated_cycle

pytestmark = pytest.mark.django_db


def test_final_model_has_only_decision_free_response_fields():
    field_names = {field.name for field in ContractRatingResponse._meta.get_fields()}
    assert {
        "recommendation",
        "recommended_change_types",
        "proposed_terms",
        "proposed_job_title",
        "proposed_position_id",
        "other_change_notes",
    }.isdisjoint(field_names)
    assert {field.name for field in ContractRating._meta.get_fields()} >= {
        "ceo_decision",
        "hr_comment_requested_by",
        "hr_comment_requested_at",
        "hr_comment_by",
        "hr_comment_submitted_at",
    }
    assert "PENDING_HR" not in ContractRating.Status.values
    assert "APPROVED" not in ContractRating.Status.values
    assert "REJECTED" not in ContractRating.Status.values
    assert ContractRating.Status.DECIDED in ContractRating.Status.values


def test_criteria_are_the_authoritative_bilingual_eighteen():
    assert len(CRITERIA) == 18
    assert len({item["code"] for item in CRITERIA}) == 18
    assert [item["display_order"] for item in CRITERIA] == list(range(1, 19))
    assert all(item["label_en"].strip() and item["label_ar"].strip() for item in CRITERIA)
    assert set(GRADE_RANGES) == set(RatingGrade.values)


@pytest.mark.parametrize("grade,bounds", list(GRADE_RANGES.items()))
def test_each_grade_accepts_only_its_integer_range(grade, bounds):
    lower, upper = bounds
    for score in (lower, upper):
        average, overall = compute_average_and_grade(answers(score, grade))
        assert average == Decimal(score)
        assert overall == grade
    for score in (-1, 101, lower - 1, upper + 1, True, "85", 85.0, None):
        with pytest.raises(ValueError):
            validate_criterion_ratings(answers(score, grade))


@pytest.mark.parametrize("mutation", ["missing", "extra", "grade", "remark", "score", "shape", "unknown_grade"])
def test_exact_criterion_shape_is_required(mutation):
    data = answers()
    if mutation == "missing":
        data.pop("appearance")
    elif mutation == "extra":
        data["unknown"] = data["appearance"]
    elif mutation in {"grade", "remark", "score"}:
        data["appearance"].pop(mutation)
    elif mutation == "shape":
        data["appearance"] = []
    else:
        data["appearance"]["grade"] = "UNKNOWN"
    with pytest.raises(ValueError):
        validate_criterion_ratings(data)


def test_fractional_average_uses_grade_lower_bound():
    data = answers(89, "VERY_GOOD")
    for item in CRITERIA[:9]:
        data[item["code"]] = {"grade": "EXCELLENT", "score": 90, "remark": ""}
    assert compute_average_and_grade(data) == (Decimal("89.50"), RatingGrade.VERY_GOOD)


def test_rating_creation_is_idempotent_and_snapshots_the_cycle(world):
    first, created = ensure_contract_rating(world.profile)
    second, created_again = ensure_contract_rating(world.profile)
    assert created is True
    assert created_again is False
    assert first.pk == second.pk
    assert first.status == ContractRating.Status.PENDING_HR_GATE
    assert first.employee_profile == world.profile
    assert first.company == world.company
    assert first.evaluation_period_from == world.profile.contract_date
    assert first.evaluation_period_to == world.profile.contract_expiry
    assert AuditLog.objects.filter(action="contract_rating_created", entity_id=str(first.pk)).count() == 1


@pytest.mark.parametrize("employee_first", [True, False])
def test_responses_are_independent_and_go_straight_to_ceo(world, employee_first):
    rating = rated_cycle(world)
    if employee_first:
        submit_employee_response(
            rating.pk,
            actor=world.employee,
            criterion_ratings=answers(94, "EXCELLENT"),
            overall_remark="employee-only",
        )
        rating.refresh_from_db()
        assert rating.status == ContractRating.Status.WAITING_MANAGER
    submit_manager_response(
        rating.pk,
        actor=world.manager,
        criterion_ratings=answers(85, "VERY_GOOD"),
        overall_remark="manager-only",
    )
    if not employee_first:
        rating.refresh_from_db()
        assert rating.status == ContractRating.Status.WAITING_EMPLOYEE
        submit_employee_response(
            rating.pk,
            actor=world.employee,
            criterion_ratings=answers(94, "EXCELLENT"),
            overall_remark="employee-only",
        )
    rating.refresh_from_db()
    assert rating.status == ContractRating.Status.PENDING_CEO
    assert rating.manager_response.average_score == Decimal("85.00")
    assert rating.employee_response.average_score == Decimal("94.00")
    assert rating.comparison_summary["appearance"]["difference"] == -9


def test_response_payload_ignores_computed_fields(world):
    rating = rated_cycle(world)
    result = submit_manager_response(
        rating.pk,
        actor=world.manager,
        criterion_ratings=answers(75, "GOOD"),
        average_score="100.00",
        overall_grade="EXCELLENT",
    )
    assert result.manager_response.average_score == Decimal("75.00")
    assert result.manager_response.overall_grade == RatingGrade.GOOD


@pytest.mark.parametrize(
    "forbidden",
    [
        {"recommendation": "TERMINATE"},
        {"change_types": ["SALARY_INCREASE"]},
        {"recommended_change_types": ["SALARY_INCREASE"]},
        {"proposed_terms": {"basic_salary": "9999"}},
        {"salary_effective_date": "2027-01-01"},
    ],
)
def test_response_payload_rejects_decision_fields(world, forbidden):
    rating = rated_cycle(world)
    with pytest.raises(ValidationError):
        submit_employee_response(
            rating.pk,
            actor=world.employee,
            criterion_ratings=answers(),
            **forbidden,
        )


def test_live_manager_and_employee_permissions_are_enforced(world):
    rating = rated_cycle(world)
    with pytest.raises(PermissionDenied):
        submit_manager_response(rating.pk, actor=world.outsider, criterion_ratings=answers())
    with pytest.raises(PermissionDenied):
        submit_employee_response(rating.pk, actor=world.manager, criterion_ratings=answers())


def test_submitted_response_is_locked_until_a_ceo_return(world):
    rating = rated_cycle(world)
    submit_manager_response(rating.pk, actor=world.manager, criterion_ratings=answers())
    with pytest.raises(ValueError, match="locked"):
        submit_manager_response(rating.pk, actor=world.manager, criterion_ratings=answers())


def test_response_api_rejects_recommendation_and_salary_fields(world):
    rating = rated_cycle(world)
    world.client.force_authenticate(world.manager)
    url = f"/contract-ratings/{rating.pk}/manager-response/"
    for forbidden in (
        {"recommendation": "RENEW"},
        {"change_types": ["SALARY_INCREASE"]},
        {"proposed_terms": {"basic_salary": "1200.00"}},
    ):
        response = world.client.post(url, {"criterion_ratings": answers(), **forbidden}, format="json")
        assert response.status_code == 422
        assert not ContractRatingResponse.objects.filter(rating=rating).exists()
