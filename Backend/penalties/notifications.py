"""Privacy-safe, company-linked penalty notifications through enabled channels."""

import logging

from django.contrib.auth import get_user_model
from django.db import transaction

from in_app_notifications.dispatcher import dispatch_notification_channels
from in_app_notifications.i18n import notification_text
from in_app_notifications.models import Notification

logger = logging.getLogger(__name__)


ACTION_REQUIRED_EVENTS = {"candidate_ready", "candidate_updated", "disputed", "manual_review", "reopened"}


def queue_penalty_notification(record, event, *, hr=False, transition=None):
    """Capture the transition version before a later update can change the row."""
    version = transition or record.updated_at.isoformat()
    audience = "hr" if hr else "employee"
    deduplication_key = f"penalty.{event}:{record.pk}:{audience}:{version}"
    transaction.on_commit(lambda: notify_penalty(record, event, hr=hr, deduplication_key=deduplication_key))


def notify_penalty(record, event, *, hr=False, deduplication_key=None):
    if hr:
        recipients = (
            get_user_model()
            .objects.filter(
                is_active=True,
                groups__name="HRManager",
                organization_access_entries__organization_id=record.company_id,
            )
            .distinct()
        )
    elif record.employee_profile.user_id:
        recipients = [record.employee_profile.user]
    else:
        recipients = []
    payroll_review_needed = hr and event == "issued" and record.total_deduction_amount > 0
    key = "penalty.issued_hr_review" if payroll_review_needed else f"penalty.{event}"
    wording = notification_text(key, record_id=record.pk)
    action_url = f"/hr/penalties/{record.pk}" if hr else f"/employee/penalties/{record.pk}"
    action_required = (hr and event in ACTION_REQUIRED_EVENTS) or payroll_review_needed
    for recipient in recipients:
        try:
            variables = (
                {
                    "approver_name": getattr(recipient, "full_name", "") or recipient.email,
                    "request_type": "Penalty record",
                    "request_type_ar": "سجل جزاء",
                    "request_id": str(record.pk),
                    "requester_name": "An employee",
                    "status_label": "Needs review" if action_required else event.replace("_", " ").title(),
                    "status_label_ar": "يتطلب مراجعة الموارد البشرية",
                    "details": "Open the secure app for details.",
                    "action_url": action_url,
                }
                if hr
                else {
                    "employee_name": getattr(recipient, "full_name", "") or recipient.email,
                    "request_type": "Penalty record",
                    "request_type_ar": "سجل جزاء",
                    "request_id": str(record.pk),
                    "status_label": event.replace("_", " ").title(),
                    "status_label_ar": "يرجى مراجعة التطبيق",
                    "status_icon": "",
                    "reason": "",
                    "details": "Open the secure app for details.",
                    "action_url": action_url,
                }
            )
            dispatch_notification_channels(
                recipient=recipient,
                company=record.company,
                related_object=record,
                event_key=key,
                **wording,
                category=Notification.Category.PENALTY
                if hr
                else (
                    Notification.Category.ATTENDANCE if record.source == "automatic" else Notification.Category.REQUEST
                ),
                action_url=action_url,
                whatsapp_template="pending_approval" if action_required else (None if hr else "request_status_update"),
                whatsapp_variables=variables if (action_required or not hr) else None,
                deduplication_key=deduplication_key or f"{key}:{record.pk}:{record.updated_at.isoformat()}",
                redeliver_existing=False,
            )
        except Exception:
            logger.exception("penalty_notification_failed", extra={"penalty_id": record.pk, "event": event})
