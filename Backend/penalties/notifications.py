"""Privacy-safe, company-linked penalty notifications through enabled channels."""

import logging

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from in_app_notifications.dispatcher import dispatch_notification_channels
from in_app_notifications.i18n import notification_text
from in_app_notifications.models import Notification

logger = logging.getLogger(__name__)


ACTION_REQUIRED_EVENTS = {"candidate_ready", "candidate_updated", "disputed", "manual_review", "reopened"}


def queue_penalty_notification(record, event, *, hr=False, transition=None):
    """Capture the transition version before a later update can change the row."""
    if not hr and (event in {"waived", "warning_withdrawn"} or record.status == "waived"):
        return
    version = transition or record.updated_at.isoformat()
    audience = "hr" if hr else "employee"
    deduplication_key = f"penalty.{event}:{record.pk}:{audience}:{version}"
    transaction.on_commit(lambda: notify_penalty(record, event, hr=hr, deduplication_key=deduplication_key))


def notify_penalty(record, event, *, hr=False, deduplication_key=None):
    if not hr and (event in {"waived", "warning_withdrawn"} or record.status == "waived"):
        return
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


def notify_late_arrival(record_id):
    """Notify once after attendance commits; never issue a penalty or claim wages."""
    from attendance.biotime_policy import is_attendance_enforced_on
    from core.executives import is_executive_profile
    from employees.models import EmployeeProfile

    from .models import PenaltyRecord
    from .services import LATE_NOTIFICATION_ROWS, current_replacement, late_notifications_effective_from

    start = late_notifications_effective_from()
    if start is None:
        return False
    try:
        with transaction.atomic():
            profile_id = (
                PenaltyRecord.objects.filter(pk=record_id).values_list("employee_profile_id", flat=True).first()
            )
            if profile_id is None:
                return False
            # Same lock order as attendance reconciliation and HR waiver actions.
            profile = EmployeeProfile.objects.select_for_update().get(pk=profile_id)
            record = (
                PenaltyRecord.objects.select_for_update(of=("self",))
                .select_related("company", "catalog", "attendance_result")
                .get(pk=record_id)
            )
            employee = profile.user
            if (
                record.occurred_on < start
                or record.source != PenaltyRecord.Source.AUTOMATIC
                or record.source_kind != "late_arrival"
                or record.catalog.code not in LATE_NOTIFICATION_ROWS
                or record.status != PenaltyRecord.Status.PENDING_HR_MARK
                or record.late_arrival_notified_at is not None
                or employee is None
                or not employee.is_active
                or is_executive_profile(profile)
                or not is_attendance_enforced_on(profile, record.occurred_on)
            ):
                return False
            # Re-read the evidence: a queued callback must not notify an excused incident.
            replacement = current_replacement(record)
            if replacement is None or replacement[0] != record.catalog.code:
                return False
            wording = notification_text("penalty.late_arrival_recorded", date=record.occurred_on.isoformat())
            result = dispatch_notification_channels(
                recipient=employee,
                company=record.company,
                related_object=record,
                event_key="penalty.late_arrival_recorded",
                **wording,
                category=Notification.Category.ATTENDANCE,
                action_url=f"/employee/penalties/{record.pk}",
                deduplication_key=f"penalty.late_arrival_recorded:{record.pk}",
                whatsapp_template="request_status_update",
                whatsapp_variables={
                    "employee_name": getattr(employee, "full_name", "") or employee.email,
                    "request_type": "Late attendance",
                    "request_type_ar": "التأخر في الحضور",
                    "request_id": str(record.pk),
                    "status_label": "Recorded",
                    "status_label_ar": "تم التسجيل",
                    "status_icon": "",
                    "reason": "",
                    "details": wording["message"],
                    "action_url": f"/employee/penalties/{record.pk}",
                },
                redeliver_existing=False,
            )
            if not isinstance(result, dict) or result.get("notification") is None:
                return False
            record.late_arrival_notified_at = timezone.now()
            record.save(update_fields=["late_arrival_notified_at"])
            return True
    except Exception:
        logger.exception("penalty_late_arrival_notification_failed", extra={"penalty_id": record_id})
        return False
