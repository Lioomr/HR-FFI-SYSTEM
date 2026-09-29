"""Privacy-safe, company-linked penalty notifications through enabled channels."""

import logging

from django.contrib.auth import get_user_model

from in_app_notifications.dispatcher import dispatch_notification_channels
from in_app_notifications.i18n import notification_text
from in_app_notifications.models import Notification

logger = logging.getLogger(__name__)


def notify_penalty(record, event, *, hr=False):
    if hr:
        recipients = (
            get_user_model()
            .objects.filter(
                is_active=True,
                groups__name__in=["HRManager", "SystemAdmin"],
                organization_access_entries__organization_id=record.company_id,
            )
            .distinct()
        )
    elif record.employee_profile.user_id:
        recipients = [record.employee_profile.user]
    else:
        recipients = []
    key = f"penalty.{event}"
    wording = notification_text(key, record_id=record.pk)
    action_url = f"/hr/penalties/{record.pk}" if hr else f"/employee/penalties/{record.pk}"
    for recipient in recipients:
        try:
            variables = (
                {
                    "approver_name": getattr(recipient, "full_name", "") or recipient.email,
                    "request_type": "Penalty record",
                    "request_id": str(record.pk),
                    "requester_name": "An employee",
                    "status_label": "Needs review",
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
                category=Notification.Category.ATTENDANCE
                if record.source == "automatic"
                else Notification.Category.REQUEST,
                action_url=action_url,
                whatsapp_template="pending_approval" if hr else "request_status_update",
                whatsapp_variables=variables,
                deduplication_key=f"{key}:{record.pk}:{record.updated_at.isoformat()}",
            )
        except Exception:
            logger.exception("penalty_notification_failed", extra={"penalty_id": record.pk, "event": event})
