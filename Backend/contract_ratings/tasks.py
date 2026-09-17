import logging
from datetime import datetime, timedelta

from celery import shared_task
from django.db import InterfaceError, OperationalError, transaction
from django.db.models import Exists, OuterRef
from django.utils import timezone

from core.services.workflow_engine import begin_recorded_transition
from employees.contract_expiry import CEO_REMINDER_INTERVAL, _company_ceo_recipients, _company_hr_recipients
from employees.models import EmployeeProfile
from employees.services.archiving import retire_biotime_mapping_and_archive_profile
from employees.services.manager_relationships import get_valid_direct_manager_user
from in_app_notifications.dispatcher import dispatch_notification_channels
from in_app_notifications.i18n import contract_rating_event_label, contract_rating_message, notification_text
from in_app_notifications.models import Notification

from .models import ContractRating

logger = logging.getLogger(__name__)


def _dispatch(rating, recipient, audience, key, event, message):
    return dispatch_notification_channels(
        recipient=recipient,
        company=rating.company,
        event_key="contract.rating",
        **notification_text(
            "contract.rating",
            event=contract_rating_event_label(event),
            message=contract_rating_message(message),
        ),
        category=Notification.Category.APPROVAL,
        action_url=f"/{audience}/contract-ratings/{rating.id}",
        related_object=rating,
        metadata={"rating_id": rating.id, "event": event},
        deduplication_key=f"contract.rating:{rating.id}:{key}:{audience}",
        email_enabled=True,
        whatsapp_enabled=True,
    )


def _deliver(rating, key, entry):
    profile = rating.employee_profile
    delivered = True
    for audience in entry["audiences"]:
        if audience == "hr":
            recipients = _company_hr_recipients(rating.company_id)
        elif audience == "ceo":
            recipients = _company_ceo_recipients(rating.company_id)
        else:
            recipient = get_valid_direct_manager_user(profile) if audience == "manager" else profile.user
            recipients = [recipient] if recipient else []
        eligible = [r for r in recipients if r and r.is_active and (audience == "employee" or r.id != profile.user_id)]
        if not eligible:
            delivered = False
        for recipient in eligible:
            try:
                with transaction.atomic():
                    result = _dispatch(rating, recipient, audience, key, entry["event"], entry["message"])
                if result.get("notification") is None:
                    delivered = False
            except Exception:
                delivered = False
                logger.exception("contract_rating_notification_failed", extra={"rating_id": rating.id})
    entry["attempts"] = entry.get("attempts", 0) + 1
    entry["last_attempt_at"] = timezone.now().isoformat()
    if delivered:
        entry["sent_at"] = timezone.now().isoformat()
    rating.notification_milestones = {**rating.notification_milestones, key: entry}
    rating.save(update_fields=["notification_milestones", "updated_at"])


def notify_event(rating, event, audiences, message="", *, key=None):
    key = key or f"{event}:{rating.updated_at.isoformat()}"
    if rating.notification_milestones.get(key, {}).get("sent_at"):
        return
    entry = rating.notification_milestones.get(key) or {
        "event": event,
        "audiences": list(dict.fromkeys(audiences)),
        "message": message,
    }
    _deliver(rating, key, entry)


@transaction.atomic
def execute_scheduled_termination(rating_id, *, today=None):
    from .services import _locked, _manual_resolution, _notify, _record, _snapshot_mismatch_reason

    rating, profile = _locked(rating_id)
    if rating.termination_processed_at or not rating.scheduled_termination or rating.status != "APPROVED":
        return rating
    reason = _snapshot_mismatch_reason(rating, profile)
    if reason:
        return _manual_resolution(rating, reason, event="contract_rating_termination_manual_resolution_required")
    if profile.contract_expiry is None or profile.contract_expiry > (today or timezone.localdate()):
        return rating
    start = begin_recorded_transition(rating)
    now = timezone.now()
    execution_snapshot = {}
    retire_biotime_mapping_and_archive_profile(
        profile, execution_snapshot, None, EmployeeProfile.ArchiveReason.END_OF_CONTRACT, now
    )
    EmployeeProfile._base_manager.filter(pk=profile.pk).update(
        employment_status=EmployeeProfile.EmploymentStatus.TERMINATED, updated_at=now
    )
    if profile.user_id:
        from django.contrib.auth import get_user_model

        user = get_user_model().objects.select_for_update().get(pk=profile.user_id)
        user.is_active = False
        user.auth_token_version += 1
        user.save(update_fields=["is_active", "auth_token_version"])
    rating.termination_processed_at = now
    rating.save(update_fields=["termination_processed_at", "updated_at"])
    _record(
        rating,
        "contract_rating_termination_processed",
        start=start,
        metadata={
            "employee_profile_id": profile.id,
            "contract_expiry": str(profile.contract_expiry),
            "contract_decision_id": rating.contract_decision_id,
            "archive_reason": "END_OF_CONTRACT",
            "employee_notified_at": rating.employee_notified_of_termination_at.isoformat()
            if rating.employee_notified_of_termination_at
            else None,
            **execution_snapshot,
        },
    )
    _notify(rating, "termination_finalized", ["hr", "manager"])
    return rating


@transaction.atomic
def _process_rating(rating_id, today, now):
    from .services import RESPONSE_STATES, _guard, _locked

    rating, profile = _locked(rating_id)
    for key, entry in list(rating.notification_milestones.items()):
        if isinstance(entry, dict) and "audiences" in entry and not entry.get("sent_at"):
            _deliver(rating, key, entry)
    if rating.status in RESPONSE_STATES | {"PENDING_HR", "PENDING_CEO"} and _guard(rating, profile):
        return
    days_left = (rating.evaluation_period_to - today).days
    if days_left == 65:
        if rating.status in RESPONSE_STATES:
            pending = [
                name
                for name in ("manager", "employee")
                if not getattr(rating, f"{name}_response") or getattr(rating, f"{name}_response").status != "SUBMITTED"
            ]
            notify_event(rating, "incomplete", ["hr"], "Pending responses: " + ", ".join(pending), key="65_DAY_HR")
            for audience in pending:
                notify_event(rating, "reminder", [audience], key=f"65_DAY_{audience}")
        elif rating.status == "PENDING_HR":
            notify_event(rating, "awaiting_hr_review", ["hr"], key="65_DAY_HR")
    if rating.status == "PENDING_CEO":
        last = rating.notification_milestones.get("ceo_reminder_at")
        if not last or now - datetime.fromisoformat(last) >= CEO_REMINDER_INTERVAL:
            notify_event(rating, "ceo_reminder", ["ceo"], key=f"ceo_reminder:{now.isoformat()}")
            rating.notification_milestones["ceo_reminder_at"] = now.isoformat()
            rating.save(update_fields=["notification_milestones", "updated_at"])


@shared_task
def process_contract_ratings(*, today=None, now=None):
    from .services import ensure_contract_rating

    today, now = today or timezone.localdate(), now or timezone.now()
    summary = {"created": 0, "processed": 0, "failures": 0}
    profiles = EmployeeProfile.objects.filter(
        is_archived=False,
        employment_status="ACTIVE",
        company__is_active=True,
        contract_expiry__gte=today,
        contract_expiry__lte=today + timedelta(days=90),
    ).exclude(
        Exists(
            ContractRating.objects.filter(
                employee_profile_id=OuterRef("pk"),
                contract_decision__original_contract_expiry=OuterRef("contract_expiry"),
            )
        )
    )
    for profile in profiles.iterator():
        try:
            _, created = ensure_contract_rating(profile, only_if_due_on=today)
            summary["created"] += int(created)
        except (OperationalError, InterfaceError):
            raise
        except Exception:
            summary["failures"] += 1
            logger.exception("contract_rating_creation_failed", extra={"profile_id": profile.id})
    for rating_id in ContractRating.objects.values_list("id", flat=True).iterator():
        try:
            _process_rating(rating_id, today, now)
            execute_scheduled_termination(rating_id, today=today)
            summary["processed"] += 1
        except (OperationalError, InterfaceError):
            raise
        except Exception:
            summary["failures"] += 1
            logger.exception("contract_rating_processing_failed", extra={"rating_id": rating_id})
    return summary
