import calendar
from dataclasses import dataclass
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.db.models import Q
from django.utils import timezone

from announcements.models import Announcement
from announcements.utils import send_announcement_in_app

from .models import Rent, RentReminderLog

User = get_user_model()


@dataclass
class RentComputed:
    next_due_date: date | None
    days_remaining: int | None
    status: str
    remaining_lease_duration: int | None
    notification_date: date | None


def compute_next_due_date(rent: Rent, today: date | None = None) -> date | None:
    ref_date = today or timezone.localdate()

    if rent.recurrence == Rent.Recurrence.ONE_TIME:
        return rent.one_time_due_date

    if rent.recurrence != Rent.Recurrence.MONTHLY or not rent.start_date or rent.due_day is None:
        return None

    month_start = date(ref_date.year, ref_date.month, 1)
    anchor = date(rent.start_date.year, rent.start_date.month, 1)
    if month_start < anchor:
        return date(rent.start_date.year, rent.start_date.month, rent.due_day)

    for offset in range(0, 13):
        month = ref_date.month + offset
        year = ref_date.year + (month - 1) // 12
        month = ((month - 1) % 12) + 1
        _, last_day = calendar.monthrange(year, month)
        day = min(rent.due_day, last_day)
        candidate = date(year, month, day)
        if candidate >= ref_date:
            return candidate

    return None


def compute_rent_state(rent: Rent, today: date | None = None) -> RentComputed:
    ref_date = today or timezone.localdate()
    if rent.lease_end_date:
        days_remaining = (rent.lease_end_date - ref_date).days
        if days_remaining < 0:
            status = "OVERDUE"
        elif days_remaining <= rent.reminder_days:
            status = "UPCOMING"
        else:
            status = "SCHEDULED"

        return RentComputed(
            next_due_date=rent.lease_end_date,
            days_remaining=days_remaining,
            status=status,
            remaining_lease_duration=days_remaining,
            notification_date=rent.lease_end_date - timedelta(days=rent.reminder_days),
        )

    due_date = compute_next_due_date(rent, today=ref_date)
    if due_date is None:
        return RentComputed(
            next_due_date=None,
            days_remaining=None,
            status="SCHEDULED",
            remaining_lease_duration=None,
            notification_date=None,
        )

    days_remaining = (due_date - ref_date).days
    if days_remaining < 0:
        status = "OVERDUE"
    elif days_remaining <= rent.reminder_days:
        status = "UPCOMING"
    else:
        status = "SCHEDULED"

    return RentComputed(
        next_due_date=due_date,
        days_remaining=days_remaining,
        status=status,
        remaining_lease_duration=None,
        notification_date=due_date - timedelta(days=rent.reminder_days),
    )


def get_last_reminder_sent_at(rent: Rent):
    last_log = rent.reminder_logs.filter(status="sent").order_by("-sent_at").first()
    return last_log.sent_at if last_log else None


def get_hr_manager_users(company_id=None):
    if not company_id:
        return User.objects.none()
    return (
        User.objects.filter(groups__name="HRManager", is_active=True)
        .filter(
            Q(employee_profile__company_id=company_id)
            | Q(organization_access_entries__organization_id=company_id)
        )
        .distinct()
    )


def _notify_via_announcement(*, rent: Rent, due_date: date, days_remaining: int):
    title = "Rent Reminder"
    source_name = (
        (rent.asset.name_en or rent.asset.name_ar or "")
        if rent.asset_id
        else (rent.property_name_en or rent.property_name_ar or "")
    )
    content = (
        f"{rent.rent_type.name_en}: {source_name} is due on {due_date.isoformat()} ({days_remaining} day(s) remaining)."
    )
    creator = rent.updated_by or rent.created_by or get_hr_manager_users(rent.company_id).first()
    if not creator:
        return {"sent": False, "reason": "No HR manager user available for announcement creation."}

    announcement = Announcement.objects.create(
        company=rent.company,
        title=title,
        content=content,
        target_roles=["HR_MANAGER"],
        publish_to_dashboard=True,
        publish_to_email=True,
        publish_to_sms=False,
        publish_to_whatsapp=True,
        created_by=creator,
    )
    dispatches = send_announcement_in_app(announcement)
    # Dispatcher results contain a Notification model instance for internal
    # callers. Rent delivery data is returned over the API and stored in an
    # AuditLog JSON field, so expose only its stable identifier here.
    safe_dispatches = []
    for dispatch in dispatches:
        notification = dispatch.get("notification") if isinstance(dispatch, dict) else None
        safe_dispatches.append(
            {
                "notification_id": getattr(notification, "id", None),
                "created": bool(dispatch.get("created")) if isinstance(dispatch, dict) else False,
                "whatsapp": dispatch.get("whatsapp") if isinstance(dispatch, dict) else None,
                "email": dispatch.get("email") if isinstance(dispatch, dict) else None,
            }
        )
    return {"sent": True, "announcement_id": announcement.id, "dispatches": safe_dispatches}


def _notify_via_email(*, rent: Rent, due_date: date, days_remaining: int):
    return {"sent": True, "reason": "Handled by the centralized WhatsApp-first announcement dispatcher."}


def send_rent_notifications(rent: Rent, *, manual: bool = False, today: date | None = None):
    computed = compute_rent_state(rent, today=today)
    due_date = computed.next_due_date
    if due_date is None or computed.days_remaining is None:
        return {
            "announcement": {"sent": False, "reason": "No due date available."},
            "email": {"sent": False, "reason": "No due date available."},
        }

    should_send = manual or computed.days_remaining <= rent.reminder_days
    if not should_send:
        return {
            "announcement": {"sent": False, "reason": "Outside reminder window."},
            "email": {"sent": False, "reason": "Outside reminder window."},
        }

    delivery = {}
    for channel in (RentReminderLog.Channel.ANNOUNCEMENT, RentReminderLog.Channel.EMAIL):
        if not manual and RentReminderLog.objects.filter(rent=rent, due_date=due_date, channel=channel).exists():
            delivery[channel] = {"sent": False, "reason": "Already sent for this due date."}
            continue

        if channel == RentReminderLog.Channel.ANNOUNCEMENT:
            result = _notify_via_announcement(rent=rent, due_date=due_date, days_remaining=computed.days_remaining)
        else:
            result = _notify_via_email(rent=rent, due_date=due_date, days_remaining=computed.days_remaining)

        delivery[channel] = result
        if result.get("sent"):
            try:
                RentReminderLog.objects.create(rent=rent, due_date=due_date, channel=channel, status="sent")
            except IntegrityError:
                pass
        elif not manual:
            try:
                RentReminderLog.objects.create(
                    rent=rent,
                    due_date=due_date,
                    channel=channel,
                    status="failed",
                    error_message=result.get("reason", ""),
                )
            except IntegrityError:
                pass

    return delivery
