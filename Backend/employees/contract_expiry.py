from __future__ import annotations

import logging
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from django.contrib.auth import get_user_model
from django.db import InterfaceError, OperationalError, transaction
from django.db.models import Q
from django.utils import timezone

from audit.utils import audit
from core.services import get_ceo_approver_users
from core.services.workflow_engine import sync_workflow
from in_app_notifications.dispatcher import dispatch_notification_channels
from in_app_notifications.models import Notification

from .models import ContractDecision, EmployeeProfile

logger = logging.getLogger(__name__)
User = get_user_model()

CONTRACT_MILESTONES = {90: "90_DAY", 45: "45_DAY", 31: "31_DAY", 17: "17_DAY"}
CEO_REMINDER_INTERVAL = timedelta(hours=10)
CEO_APPROVAL_WINDOW = timedelta(hours=48)
FINAL_NOTIFICATION_RETRY_INTERVAL = timedelta(hours=1)
TERM_FIELDS = (
    "basic_salary",
    "transportation_allowance",
    "accommodation_allowance",
    "telephone_allowance",
    "petrol_allowance",
    "other_allowance",
    "total_salary",
)
FINAL_NOTIFICATION_STATUSES = {
    ContractDecision.Status.APPROVED,
    ContractDecision.Status.AUTO_APPROVED,
    ContractDecision.Status.REJECTED,
    ContractDecision.Status.AUTO_RENEWED,
    ContractDecision.Status.AUTO_RENEWAL_FAILED,
    ContractDecision.Status.MANUAL_RESOLUTION_REQUIRED,
}


def contract_terms_snapshot(profile: EmployeeProfile) -> dict:
    return {field: str(getattr(profile, field)) if getattr(profile, field) is not None else None for field in TERM_FIELDS}


@transaction.atomic
def ensure_contract_decision(profile: EmployeeProfile) -> tuple[ContractDecision, bool]:
    decision, created = ContractDecision.objects.get_or_create(
        employee_profile=profile,
        original_contract_expiry=profile.contract_expiry,
        defaults={
            "company": profile.company,
            "original_contract_date": profile.contract_date,
            "original_terms": contract_terms_snapshot(profile),
            "status": ContractDecision.Status.PENDING_HR,
        },
    )
    if created:
        sync_workflow(decision)
    return decision, created


def _company_hr_recipients(company_id: int):
    return (
        User.objects.filter(is_active=True, groups__name="HRManager")
        .filter(Q(employee_profile__company_id=company_id) | Q(organization_access_entries__organization_id=company_id))
        .distinct()
    )


def _company_ceo_recipients(company_id: int):
    return get_ceo_approver_users().filter(
        Q(employee_profile__company_id=company_id) | Q(organization_access_entries__organization_id=company_id)
    ).distinct()


def _dispatch(*, recipient, decision, title, message, action_url, category, deduplication_key, metadata):
    return dispatch_notification_channels(
        recipient=recipient,
        company=decision.company,
        event_key="contract.expiry",
        title=title,
        message=message,
        category=category,
        action_url=action_url,
        related_object=decision,
        metadata=metadata,
        deduplication_key=deduplication_key,
        email_enabled=True,
        whatsapp_enabled=True,
        email_context={
            "title_ar": title,
            "message_ar": message,
            "employee_name": decision.employee_profile.full_name or decision.employee_profile.employee_id,
        },
    )


def notify_hr_milestone(decision: ContractDecision, milestone: str, days_left: int) -> int | None:
    count = 0
    attempted = False
    failed = False
    profile = decision.employee_profile
    for recipient in _company_hr_recipients(decision.company_id):
        result = _dispatch(
            recipient=recipient,
            decision=decision,
            title=f"Contract expiry: {profile.full_name or profile.employee_id}",
            message=(
                f"{profile.full_name or profile.employee_id}'s contract expires on "
                f"{decision.original_contract_expiry.isoformat()} ({days_left} days remaining)."
            ),
            action_url=f"/hr/contract-decisions/{decision.id}",
            category=Notification.Category.DOCUMENT,
            deduplication_key=f"contract.expiry:{decision.id}:hr:{milestone}",
            metadata={
                "contract_decision_id": decision.id,
                "employee_profile_id": profile.id,
                "milestone": milestone,
                "days_left": days_left,
                "requires_action": days_left <= 45,
            },
        )
        attempted = True
        failed = failed or result.get("notification") is None
        count += int(result.get("created", False))
    return count if attempted and not failed else None


def notify_ceo_pending(
    decision: ContractDecision,
    *,
    reminder: bool = False,
    reminder_number: int | None = None,
) -> int | None:
    profile = decision.employee_profile
    label = "CEO reminder: contract decision" if reminder else "Contract decision requires CEO approval"
    message = (
        f"HR selected {decision.get_decision_type_display()} for {profile.full_name or profile.employee_id}. "
        f"Review before {decision.ceo_deadline.isoformat() if decision.ceo_deadline else 'the deadline'}."
    )
    count = 0
    attempted = False
    failed = False
    suffix = (
        f"reminder:{reminder_number if reminder_number is not None else decision.ceo_reminder_count}"
        if reminder
        else "submitted"
    )
    for recipient in _company_ceo_recipients(decision.company_id):
        result = _dispatch(
            recipient=recipient,
            decision=decision,
            title=label,
            message=message,
            action_url=f"/ceo/contract-decisions/{decision.id}",
            category=Notification.Category.APPROVAL,
            deduplication_key=f"contract.expiry:{decision.id}:ceo:{suffix}",
            metadata={
                "contract_decision_id": decision.id,
                "employee_profile_id": profile.id,
                "decision_type": decision.decision_type,
                "ceo_deadline": decision.ceo_deadline.isoformat() if decision.ceo_deadline else None,
                "reminder": reminder,
            },
        )
        attempted = True
        failed = failed or result.get("notification") is None
        count += int(result.get("created", False))
    return count if attempted and not failed else None


@transaction.atomic
def _claim_final_notification_attempt(decision_id: int, now):
    decision = ContractDecision.objects.select_for_update().select_related("employee_profile", "company").get(pk=decision_id)
    if decision.final_notification_sent_at:
        return None
    if (
        decision.last_final_notification_attempt_at
        and now - decision.last_final_notification_attempt_at < FINAL_NOTIFICATION_RETRY_INTERVAL
    ):
        return None
    decision.final_notification_attempts += 1
    decision.last_final_notification_attempt_at = now
    decision.save(update_fields=["final_notification_attempts", "last_final_notification_attempt_at", "updated_at"])
    return decision


def _mark_final_notification_sent(decision: ContractDecision, now):
    return ContractDecision.objects.filter(
        pk=decision.id,
        status=decision.status,
        last_final_notification_attempt_at=decision.last_final_notification_attempt_at,
        final_notification_sent_at__isnull=True,
    ).update(final_notification_sent_at=now, updated_at=now)


def notify_hr_final(decision: ContractDecision, *, automatic: bool = False) -> int | None:
    decision = _claim_final_notification_attempt(decision.id, timezone.now())
    if decision is None:
        return None
    profile = decision.employee_profile
    profile.refresh_from_db(fields=["contract_expiry", "full_name", "employee_id"])
    status_label = decision.get_status_display()
    message = (
        f"Contract decision for {profile.full_name or profile.employee_id}: {status_label}. "
        f"New expiry: {profile.contract_expiry.isoformat() if profile.contract_expiry else 'none'}."
    )
    count = 0
    attempted = False
    failed = False
    for recipient in _company_hr_recipients(decision.company_id):
        result = _dispatch(
            recipient=recipient,
            decision=decision,
            title="Contract decision completed",
            message=message,
            action_url=f"/hr/contract-decisions/{decision.id}",
            category=Notification.Category.APPROVAL,
            deduplication_key=f"contract.expiry:{decision.id}:final:{decision.status}",
            metadata={
                "contract_decision_id": decision.id,
                "employee_profile_id": profile.id,
                "status": decision.status,
                "automatic": automatic,
            },
        )
        attempted = True
        failed = failed or result.get("notification") is None
        count += int(result.get("created", False))
    if not attempted or failed:
        return None
    if not _mark_final_notification_sent(decision, timezone.now()):
        return None
    return count


def notify_manual_resolution(decision: ContractDecision) -> int | None:
    decision = _claim_final_notification_attempt(decision.id, timezone.now())
    if decision is None:
        return None
    profile = decision.employee_profile
    message = (
        f"Contract processing requires manual resolution for {profile.full_name or profile.employee_id}. "
        f"Manual resolution is required: {decision.failure_reason}"
    )
    recipients = {}
    for recipient in _company_hr_recipients(decision.company_id):
        recipients[recipient.id] = (recipient, f"/hr/contract-decisions/{decision.id}")
    for recipient in _company_ceo_recipients(decision.company_id):
        recipients[recipient.id] = (recipient, f"/ceo/contract-decisions/{decision.id}")

    count = 0
    attempted = False
    failed = False
    for recipient, action_url in recipients.values():
        result = _dispatch(
            recipient=recipient,
            decision=decision,
            title="Contract processing requires manual resolution",
            message=message,
            action_url=action_url,
            category=Notification.Category.APPROVAL,
            deduplication_key=f"contract.expiry:{decision.id}:auto-renewal-failure",
            metadata={
                "contract_decision_id": decision.id,
                "employee_profile_id": profile.id,
                "status": decision.status,
                "failure_reason": decision.failure_reason,
            },
        )
        attempted = True
        failed = failed or result.get("notification") is None
        count += int(result.get("created", False))
    if not attempted or failed:
        return None
    if not _mark_final_notification_sent(decision, timezone.now()):
        return None
    return count


def notify_auto_renewal_failure(decision: ContractDecision) -> int | None:
    return notify_manual_resolution(decision)


def _parse_term_values(values: dict) -> dict:
    parsed = {}
    for field, value in values.items():
        if field not in TERM_FIELDS:
            raise ValueError(f"Unsupported contract term: {field}")
        if value in (None, ""):
            parsed[field] = None
            continue
        try:
            parsed[field] = str(Decimal(str(value)))
        except (InvalidOperation, ValueError):
            raise ValueError(f"Invalid numeric value for {field}") from None
    return parsed


def _renewal_dates(decision: ContractDecision) -> tuple[date, date]:
    start = decision.proposed_contract_date
    expiry = decision.proposed_contract_expiry
    if start and expiry:
        if expiry < start:
            raise ValueError("Proposed contract expiry must be on or after the proposed contract date.")
        return start, expiry
    if not decision.original_contract_date or not decision.original_contract_expiry:
        raise ValueError("Original contract dates are required to calculate renewal duration.")
    duration = decision.original_contract_expiry - decision.original_contract_date
    if duration.days <= 0:
        raise ValueError("Original contract duration must be positive.")
    start = start or decision.original_contract_expiry + timedelta(days=1)
    expiry = expiry or start + duration - timedelta(days=1)
    if expiry < start:
        raise ValueError("Proposed contract expiry must be on or after the proposed contract date.")
    return start, expiry


def _snapshot_mismatch_reason(decision: ContractDecision, profile: EmployeeProfile) -> str:
    mismatches = []
    if profile.contract_date != decision.original_contract_date:
        mismatches.append("contract date")
    if profile.contract_expiry != decision.original_contract_expiry:
        mismatches.append("contract expiry")
    if contract_terms_snapshot(profile) != (decision.original_terms or {}):
        mismatches.append("salary or allowance terms")
    if not mismatches:
        return ""
    return "The employee record changed after this decision was created: " + ", ".join(mismatches) + "."


@transaction.atomic
def submit_decision(decision_id: int, *, actor, decision_type: str, proposed_contract_date=None,
                    proposed_contract_expiry=None, proposed_terms=None, hr_comment: str = ""):
    decision = ContractDecision.objects.select_for_update().select_related("employee_profile", "company").get(pk=decision_id)
    if decision.status not in {ContractDecision.Status.PENDING_HR, ContractDecision.Status.MANUAL_RESOLUTION_REQUIRED}:
        raise ValueError("This contract decision is no longer awaiting HR action.")
    profile = EmployeeProfile.objects.select_for_update().get(pk=decision.employee_profile_id)
    if decision.status == ContractDecision.Status.MANUAL_RESOLUTION_REQUIRED:
        decision.original_contract_date = profile.contract_date
        decision.original_contract_expiry = profile.contract_expiry
        decision.original_terms = contract_terms_snapshot(profile)
        decision.failure_reason = ""
    if decision_type not in ContractDecision.DecisionType.values:
        raise ValueError("Invalid contract decision type.")
    if decision_type == ContractDecision.DecisionType.TERMINATE:
        proposed_contract_date = None
        proposed_contract_expiry = None
        proposed_terms = {}
    else:
        if proposed_contract_date and proposed_contract_expiry and proposed_contract_expiry < proposed_contract_date:
            raise ValueError("Proposed contract expiry must be on or after the proposed contract date.")
        proposed_terms = _parse_term_values(proposed_terms or {})
        decision.proposed_contract_date = proposed_contract_date
        decision.proposed_contract_expiry = proposed_contract_expiry
        _renewal_dates(decision)
    now = timezone.now()
    decision.decision_type = decision_type
    decision.proposed_contract_date = proposed_contract_date
    decision.proposed_contract_expiry = proposed_contract_expiry
    decision.proposed_terms = proposed_terms or {}
    decision.hr_comment = hr_comment or ""
    decision.requested_by = actor
    decision.submitted_at = now
    decision.ceo_deadline = now + CEO_APPROVAL_WINDOW
    decision.last_ceo_reminder_at = None
    decision.ceo_reminder_count = 0
    decision.status = ContractDecision.Status.PENDING_CEO
    decision.ceo_decided_by = None
    decision.ceo_decided_at = None
    decision.ceo_comment = ""
    decision.finalized_by = None
    decision.finalized_at = None
    decision.finalized_by_system = False
    decision.automatic_renewal = False
    decision.automatic_renewal_reason = ""
    decision.final_notification_sent_at = None
    decision.final_notification_attempts = 0
    decision.last_final_notification_attempt_at = None
    decision.save()
    sync_workflow(decision, actor=actor)
    try:
        notification_result = notify_ceo_pending(decision)
        if notification_result is not None:
            decision.last_ceo_reminder_at = now
            decision.ceo_reminder_count = 1
            decision.save(update_fields=["last_ceo_reminder_at", "ceo_reminder_count", "updated_at"])
    except Exception:
        logger.exception("contract_decision_initial_ceo_notification_failed", extra={"decision_id": decision.id})
    return decision


@transaction.atomic
def finalize_decision(decision_id: int, *, actor=None, automatic: bool = False, comment: str = ""):
    decision = ContractDecision.objects.select_for_update().select_related("employee_profile", "company").get(pk=decision_id)
    if decision.status != ContractDecision.Status.PENDING_CEO:
        raise ValueError("This contract decision is no longer pending CEO approval.")
    profile = EmployeeProfile.objects.select_for_update(of=("self",)).select_related("user").get(pk=decision.employee_profile_id)
    now = timezone.now()
    mismatch_reason = _snapshot_mismatch_reason(decision, profile)
    if mismatch_reason:
        decision.status = ContractDecision.Status.MANUAL_RESOLUTION_REQUIRED
        decision.failure_reason = mismatch_reason
        decision.ceo_decided_by = actor if not automatic else None
        decision.ceo_decided_at = now
        decision.ceo_comment = comment or ""
        decision.finalized_by = actor if not automatic else None
        decision.finalized_by_system = automatic
        decision.automatic_renewal = False
        decision.automatic_renewal_reason = ""
        decision.final_notification_sent_at = None
        decision.final_notification_attempts = 0
        decision.last_final_notification_attempt_at = None
        decision.finalized_at = now
        decision.save()
        sync_workflow(decision, actor=actor)
        audit(
            None,
            "contract_decision_manual_resolution_required",
            entity="ContractDecision",
            entity_id=decision.id,
            metadata={"reason": mismatch_reason, "automatic": automatic},
            actor=actor,
        )
        return decision
    if decision.decision_type in {ContractDecision.DecisionType.RENEW, ContractDecision.DecisionType.RENEW_WITH_CHANGES}:
        start, expiry = _renewal_dates(decision)
        update_fields = ["contract_date", "contract_expiry", "updated_at"]
        profile.contract_date = start
        profile.contract_expiry = expiry
        for field, value in decision.proposed_terms.items():
            setattr(profile, field, Decimal(value) if value is not None else None)
            update_fields.append(field)
        profile.save(update_fields=list(dict.fromkeys(update_fields)))
    elif decision.decision_type == ContractDecision.DecisionType.TERMINATE:
        profile.is_archived = True
        profile.archived_at = now
        profile.archived_by = actor if not automatic else None
        profile.archive_reason = EmployeeProfile.ArchiveReason.END_OF_CONTRACT
        profile.save(update_fields=["is_archived", "archived_at", "archived_by", "archive_reason", "updated_at"])
        if profile.user_id:
            profile.user.is_active = False
            profile.user.auth_token_version += 1
            profile.user.save(update_fields=["is_active", "auth_token_version"])
    else:
        raise ValueError("A decision type is required before CEO approval.")

    decision.status = ContractDecision.Status.AUTO_APPROVED if automatic else ContractDecision.Status.APPROVED
    decision.ceo_decided_by = actor if not automatic else None
    decision.ceo_decided_at = now
    decision.ceo_comment = comment or ""
    decision.finalized_by = actor if not automatic else None
    decision.finalized_by_system = automatic
    decision.automatic_renewal = False
    decision.automatic_renewal_reason = ""
    decision.final_notification_sent_at = None
    decision.final_notification_attempts = 0
    decision.last_final_notification_attempt_at = None
    decision.finalized_at = now
    decision.save()
    sync_workflow(decision, actor=actor)
    audit(
        None,
        "contract_decision_auto_approved" if automatic else "contract_decision_approved",
        entity="ContractDecision",
        entity_id=decision.id,
        metadata={"decision_type": decision.decision_type, "employee_profile_id": profile.id, "automatic": automatic},
        actor=actor,
    )
    return decision


@transaction.atomic
def reject_decision(decision_id: int, *, actor, comment: str = ""):
    decision = ContractDecision.objects.select_for_update().get(pk=decision_id)
    if decision.status != ContractDecision.Status.PENDING_CEO:
        raise ValueError("This contract decision is no longer pending CEO approval.")
    now = timezone.now()
    decision.status = ContractDecision.Status.REJECTED
    decision.ceo_decided_by = actor
    decision.ceo_decided_at = now
    decision.ceo_comment = comment or ""
    decision.finalized_by = actor
    decision.finalized_at = now
    decision.finalized_by_system = False
    decision.automatic_renewal = False
    decision.automatic_renewal_reason = ""
    decision.final_notification_sent_at = None
    decision.final_notification_attempts = 0
    decision.last_final_notification_attempt_at = None
    decision.save()
    sync_workflow(decision, actor=actor)
    audit(
        None,
        "contract_decision_rejected",
        entity="ContractDecision",
        entity_id=decision.id,
        metadata={"decision_type": decision.decision_type, "comment": comment or ""},
        actor=actor,
    )
    return decision


@transaction.atomic
def auto_renew_decision(decision_id: int):
    decision = ContractDecision.objects.select_for_update().select_related("employee_profile", "company").get(pk=decision_id)
    if decision.status != ContractDecision.Status.PENDING_HR:
        return decision, False
    profile = EmployeeProfile.objects.select_for_update().get(pk=decision.employee_profile_id)
    mismatch_reason = _snapshot_mismatch_reason(decision, profile)
    if mismatch_reason:
        decision.status = ContractDecision.Status.MANUAL_RESOLUTION_REQUIRED
        decision.failure_reason = mismatch_reason
        decision.finalized_at = timezone.now()
        decision.finalized_by_system = True
        decision.automatic_renewal = True
        decision.automatic_renewal_reason = "HR took no action before contract expiry, but the live contract changed."
        decision.final_notification_sent_at = None
        decision.final_notification_attempts = 0
        decision.last_final_notification_attempt_at = None
        decision.save()
        sync_workflow(decision)
        return decision, False
    try:
        start, expiry = _renewal_dates(decision)
    except ValueError as exc:
        decision.status = ContractDecision.Status.AUTO_RENEWAL_FAILED
        decision.failure_reason = str(exc)
        decision.finalized_at = timezone.now()
        decision.finalized_by_system = True
        decision.automatic_renewal = True
        decision.automatic_renewal_reason = "HR took no action before contract expiry, but the original duration was invalid."
        decision.final_notification_sent_at = None
        decision.final_notification_attempts = 0
        decision.last_final_notification_attempt_at = None
        decision.save()
        sync_workflow(decision)
        return decision, False
    profile.contract_date = start
    profile.contract_expiry = expiry
    profile.save(update_fields=["contract_date", "contract_expiry", "updated_at"])
    decision.status = ContractDecision.Status.AUTO_RENEWED
    decision.proposed_contract_date = start
    decision.proposed_contract_expiry = expiry
    decision.finalized_at = timezone.now()
    decision.finalized_by_system = True
    decision.automatic_renewal = True
    decision.automatic_renewal_reason = "HR took no action before contract expiry."
    decision.final_notification_sent_at = None
    decision.final_notification_attempts = 0
    decision.last_final_notification_attempt_at = None
    decision.save()
    sync_workflow(decision)
    audit(
        None,
        "contract_decision_auto_renewed",
        entity="ContractDecision",
        entity_id=decision.id,
        metadata={"employee_profile_id": profile.id, "new_contract_expiry": expiry.isoformat(), "reason": "hr_no_action"},
    )
    return decision, True


def process_contract_expiry(*, today=None, now=None) -> dict:
    today = today or timezone.localdate()
    now = now or timezone.now()
    summary = {
        "milestones": 0,
        "ceo_reminders": 0,
        "auto_approved": 0,
        "auto_renewed": 0,
        "renewal_failures": 0,
        "manual_resolutions": 0,
        "profile_failures": 0,
        "notification_failures": 0,
    }
    profiles = EmployeeProfile.objects.filter(
        is_archived=False,
        employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        contract_expiry__isnull=False,
        company__is_active=True,
    ).select_related("company")
    for profile in profiles.iterator():
        try:
            days_left = (profile.contract_expiry - today).days
            decision, _ = ensure_contract_decision(profile)
            if days_left in CONTRACT_MILESTONES:
                milestone = CONTRACT_MILESTONES[days_left]
                if not decision.notification_milestones.get(milestone):
                    notification_result = notify_hr_milestone(decision, milestone, days_left)
                    if notification_result is not None:
                        decision.notification_milestones = {
                            **decision.notification_milestones,
                            milestone: now.isoformat(),
                        }
                        decision.save(update_fields=["notification_milestones", "updated_at"])
                        summary["milestones"] += notification_result
                    else:
                        summary["notification_failures"] += 1
        except (OperationalError, InterfaceError):
            raise
        except Exception:
            summary["profile_failures"] = summary.get("profile_failures", 0) + 1
            logger.exception("contract_expiry_profile_processing_failed", extra={"profile_id": profile.id})

    pending_ceo = ContractDecision.objects.filter(status=ContractDecision.Status.PENDING_CEO, ceo_deadline__isnull=False)
    for decision in pending_ceo.select_related("employee_profile", "company").iterator():
        if decision.ceo_deadline <= now:
            try:
                finalized = finalize_decision(decision.id, automatic=True)
                if finalized.status == ContractDecision.Status.AUTO_APPROVED:
                    summary["auto_approved"] += 1
                elif finalized.status == ContractDecision.Status.MANUAL_RESOLUTION_REQUIRED:
                    summary["manual_resolutions"] += 1
            except (OperationalError, InterfaceError):
                raise
            except Exception:
                logger.exception("contract_decision_auto_approval_failed", extra={"decision_id": decision.id})
            continue
        if decision.last_ceo_reminder_at is None or now - decision.last_ceo_reminder_at >= CEO_REMINDER_INTERVAL:
            try:
                with transaction.atomic():
                    locked = ContractDecision.objects.select_for_update().get(pk=decision.id)
                    if locked.status != ContractDecision.Status.PENDING_CEO:
                        continue
                    reminder_number = locked.ceo_reminder_count + 1
                    notification_result = notify_ceo_pending(
                        locked,
                        reminder=True,
                        reminder_number=reminder_number,
                    )
                    if notification_result is not None:
                        locked.last_ceo_reminder_at = now
                        locked.ceo_reminder_count = reminder_number
                        locked.save(update_fields=["last_ceo_reminder_at", "ceo_reminder_count", "updated_at"])
                        summary["ceo_reminders"] += notification_result
                    else:
                        summary["notification_failures"] += 1
            except (OperationalError, InterfaceError):
                raise
            except Exception:
                summary["notification_failures"] = summary.get("notification_failures", 0) + 1
                logger.exception("contract_decision_ceo_reminder_failed", extra={"decision_id": decision.id})

    pending_hr = ContractDecision.objects.filter(
        status=ContractDecision.Status.PENDING_HR,
        original_contract_expiry__lte=today,
    )
    for decision in pending_hr.values_list("id", flat=True).iterator():
        try:
            renewed, changed = auto_renew_decision(decision)
            if changed:
                summary["auto_renewed"] += 1
            elif renewed.status in {
                ContractDecision.Status.AUTO_RENEWAL_FAILED,
                ContractDecision.Status.MANUAL_RESOLUTION_REQUIRED,
            }:
                if renewed.status == ContractDecision.Status.MANUAL_RESOLUTION_REQUIRED:
                    summary["manual_resolutions"] += 1
                else:
                    summary["renewal_failures"] += 1
        except (OperationalError, InterfaceError):
            raise
        except Exception:
            logger.exception("contract_decision_auto_renewal_failed", extra={"decision_id": decision})
            summary["renewal_failures"] += 1

    pending_final_notifications = ContractDecision.objects.filter(
        status__in=FINAL_NOTIFICATION_STATUSES,
        finalized_at__isnull=False,
        final_notification_sent_at__isnull=True,
    ).filter(
        Q(last_final_notification_attempt_at__isnull=True)
        | Q(last_final_notification_attempt_at__lte=now - FINAL_NOTIFICATION_RETRY_INTERVAL)
    )
    for decision in pending_final_notifications.select_related("employee_profile", "company").iterator():
        try:
            if decision.status in {
                ContractDecision.Status.AUTO_RENEWAL_FAILED,
                ContractDecision.Status.MANUAL_RESOLUTION_REQUIRED,
            }:
                notification_result = notify_manual_resolution(decision)
            else:
                notification_result = notify_hr_final(
                    decision,
                    automatic=decision.status in {
                        ContractDecision.Status.AUTO_APPROVED,
                        ContractDecision.Status.AUTO_RENEWED,
                    },
                )
            if notification_result is None:
                summary["notification_failures"] += 1
        except (OperationalError, InterfaceError):
            raise
        except Exception:
            summary["notification_failures"] += 1
            logger.exception("contract_decision_final_notification_failed", extra={"decision_id": decision.id})
    return summary
