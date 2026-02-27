import calendar
from dataclasses import dataclass
from datetime import date

from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.utils import timezone

from announcements.models import Announcement
from core.services import send_announcement_notification_email

from .models import Rent, RentReminderLog

User = get_user_model()


@dataclass
class RentComputed:
    next_due_date: date | None
    days_remaining: int | None
    status: str


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
    due_date = compute_next_due_date(rent, today=ref_date)
    if due_date is None:
        return RentComputed(next_due_date=None, days_remaining=None, status="SCHEDULED")

    days_remaining = (due_date - ref_date).days
    if days_remaining < 0:
        status = "OVERDUE"
    elif days_remaining <= rent.reminder_days:
        status = "UPCOMING"
    else:
        status = "SCHEDULED"

    return RentComputed(next_due_date=due_date, days_remaining=days_remaining, status=status)


def get_last_reminder_sent_at(rent: Rent):
    last_log = rent.reminder_logs.filter(status="sent").order_by("-sent_at").first()
    return last_log.sent_at if last_log else None


def get_hr_manager_users():
    return User.objects.filter(groups__name="HRManager", is_active=True).distinct()


def _notify_via_announcement(*, rent: Rent, due_date: date, days_remaining: int):
    title = "Rent Reminder"
    source_name = (
        (rent.asset.name_en or rent.asset.name_ar or "")
        if rent.asset_id
        else (rent.property_name_en or rent.property_name_ar or "")
    )
    content = (
        f"{rent.rent_type.name_en}: {source_name} is due on {due_date.isoformat()} "
        f"({days_remaining} day(s) remaining)."
    )
    creator = rent.updated_by or rent.created_by or get_hr_manager_users().first()
    if not creator:
        return {"sent": False, "reason": "No HR manager user available for announcement creation."}

    announcement = Announcement.objects.create(
        title=title,
        content=content,
        target_roles=["HR_MANAGER"],
        publish_to_dashboard=True,
        publish_to_email=False,
        publish_to_sms=False,
        created_by=creator,
    )
    return {"sent": True, "announcement_id": announcement.id}


def _notify_via_email(*, rent: Rent, due_date: date, days_remaining: int):
    users = list(get_hr_manager_users())
    if not users:
        return {"sent": False, "reason": "No HR manager users found."}

    sent_count = 0
    for user in users:
        if not user.email:
            continue
        result = send_announcement_notification_email(
            to_email=user.email,
            employee_name=user.full_name or user.email,
            announcement_title="Rent Reminder",
            message=(
                f"{rent.rent_type.name_en} is due on {due_date.isoformat()} "
                f"for {((rent.asset.name_en or rent.asset.name_ar) if rent.asset_id else (rent.property_name_en or rent.property_name_ar))} "
                f"({days_remaining} day(s) remaining)."
            ),
            publisher_name="HR Rent Reminder",
        )
        if result.get("success"):
            sent_count += 1

    if sent_count == 0:
        return {"sent": False, "reason": "No emails were delivered."}

    return {"sent": True, "count": sent_count}


def send_rent_notifications(rent: Rent, *, manual: bool = False, today: date | None = None):
    computed = compute_rent_state(rent, today=today)
    due_date = computed.next_due_date
    if due_date is None or computed.days_remaining is None:
        return {"announcement": {"sent": False, "reason": "No due date available."}, "email": {"sent": False, "reason": "No due date available."}}

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
