from datetime import timedelta

import pytest
from django.utils import timezone

from contract_ratings.models import ContractRating
from contract_ratings.services import (
    ensure_contract_rating,
    request_hr_comment,
    submit_ceo_decision,
    submit_employee_response,
    submit_hr_comment,
    submit_manager_response,
)
from contract_ratings.tasks import process_contract_ratings

from .conftest import answers
from .test_final_phase2 import pending_ceo

pytestmark = pytest.mark.django_db


def calls_for(notifications, event):
    return [call.kwargs for call in notifications.call_args_list if call.kwargs["metadata"]["event"] == event]


def test_scheduler_opens_current_cycle_once_and_notifies_both_raters(world, notifications):
    assert process_contract_ratings()["created"] == 1
    assert process_contract_ratings()["created"] == 0
    assert ContractRating.objects.count() == 1
    opened = calls_for(notifications, "opened")
    assert {call["recipient"].pk for call in opened} == {world.manager.pk, world.employee.pk}
    assert len(opened) == 2


@pytest.mark.parametrize("days_left", [0, 1, 45, 65, 89, 90])
def test_scheduler_catches_up_eligible_current_contracts(world, days_left):
    today = timezone.localdate()
    world.profile.contract_expiry = today + timedelta(days=days_left)
    world.profile.save(update_fields=["contract_expiry"])
    assert process_contract_ratings(today=today)["created"] == 1
    assert process_contract_ratings(today=today)["created"] == 0


@pytest.mark.parametrize("submitted,expected_pending", [("none", {"manager", "employee"}), ("manager", {"employee"}), ("employee", {"manager"})])
def test_65_day_incomplete_breakdown_goes_to_ceo_and_pending_raters(
    world, notifications, submitted, expected_pending
):
    rating, _ = ensure_contract_rating(world.profile)
    if submitted == "manager":
        submit_manager_response(rating.pk, actor=world.manager, criterion_ratings=answers())
    elif submitted == "employee":
        submit_employee_response(rating.pk, actor=world.employee, criterion_ratings=answers())
    notifications.reset_mock()

    today = world.profile.contract_expiry - timedelta(days=65)
    process_contract_ratings(today=today)
    process_contract_ratings(today=today)

    incomplete = calls_for(notifications, "incomplete")
    assert {call["recipient"].pk for call in incomplete} == {world.ceo.pk, world.admin.pk}
    assert world.hr.pk not in {call["recipient"].pk for call in incomplete}
    reminded = {call["recipient"].pk for call in calls_for(notifications, "reminder")}
    expected_users = {getattr(world, name).pk for name in expected_pending}
    assert reminded == expected_users


def test_both_submitted_notifies_ceo_never_hr(world, notifications):
    pending_ceo(world)
    recipients = {call["recipient"].pk for call in calls_for(notifications, "both_submitted")}
    assert recipients == {world.ceo.pk, world.admin.pk}
    assert world.hr.pk not in recipients


def test_hr_comment_notifications_are_request_scoped(world, notifications):
    rating = pending_ceo(world)
    notifications.reset_mock()
    request_hr_comment(rating.pk, actor=world.ceo)
    requested = {call["recipient"].pk for call in calls_for(notifications, "hr_comment_requested")}
    assert requested == {world.hr.pk}

    notifications.reset_mock()
    submit_hr_comment(rating.pk, actor=world.hr, comment="Advisory")
    submitted = {call["recipient"].pk for call in calls_for(notifications, "hr_comment_submitted")}
    assert submitted == {world.ceo.pk}


@pytest.mark.parametrize(
    "decision,event",
    [
        ("RENEW", "ceo_decided_renew"),
        ("RENEW_WITH_CHANGES", "ceo_decided_renew_with_increase"),
        ("TERMINATE", "ceo_decided_terminate"),
    ],
)
def test_final_decision_notifies_hr_and_manager(world, notifications, decision, event):
    rating = pending_ceo(world)
    notifications.reset_mock()
    kwargs = {}
    if decision == "RENEW_WITH_CHANGES":
        kwargs = {
            "ceo_approved_terms": {"basic_salary": "1200.00"},
            "salary_effective_date": world.profile.contract_expiry + timedelta(days=1),
        }
    submit_ceo_decision(rating.pk, actor=world.ceo, ceo_decision=decision, **kwargs)
    recipients = {call["recipient"].pk for call in calls_for(notifications, event)}
    assert recipients == {world.hr.pk, world.manager.pk}
    assert world.employee.pk not in recipients


def test_failed_notification_is_persisted_and_retried(world, notifications):
    notifications.return_value = {"notification": None, "created": False}
    rating, _ = ensure_contract_rating(world.profile)
    rating.refresh_from_db()
    assert any(not entry.get("sent_at") for entry in rating.notification_milestones.values())

    notifications.return_value = {"notification": object(), "created": True}
    process_contract_ratings()
    rating.refresh_from_db()
    assert all(entry.get("sent_at") for entry in rating.notification_milestones.values())


def test_stalled_pending_ceo_receives_periodic_nudge(world, notifications):
    rating = pending_ceo(world)
    notifications.reset_mock()
    now = timezone.now() + timedelta(hours=10)
    process_contract_ratings(now=now)
    process_contract_ratings(now=now + timedelta(hours=1))
    reminders = calls_for(notifications, "ceo_reminder")
    assert {call["recipient"].pk for call in reminders} == {world.ceo.pk, world.admin.pk}
    assert len(reminders) == 2
