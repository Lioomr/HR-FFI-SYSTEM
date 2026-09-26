import logging
from datetime import timedelta
from decimal import Decimal

from celery import shared_task
from django.utils import timezone

from core.services.pending_approval_email import get_hr_approver_users
from employees.models import EmployeeProfile
from in_app_notifications.dispatcher import dispatch_notification_channels
from in_app_notifications.i18n import notification_text, profile_name
from in_app_notifications.models import Notification
from organization.models import OrganizationNode

from .models import AnnualLeavePaymentRequest
from .utils import build_annual_leave_eligibility, get_contract_year_cycle

logger = logging.getLogger(__name__)

SETTLEMENT_WINDOW_OPEN_EVENT = "annual_leave.settlement_window_open"
SETTLEMENT_WINDOW_OPEN_ACTION_URL = "/employee/leave/balance?focus=settlement"


def _hr_users_for_company(company):
    users = get_hr_approver_users().filter(is_active=True)
    if (
        company is None
        or company.node_type != OrganizationNode.NodeType.COMPANY
        or not company.is_active
    ):
        return users.none()
    return users.filter(
        employee_profile__company=company,
        employee_profile__is_archived=False,
        employee_profile__employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
    ).distinct()


@shared_task
def send_annual_leave_year_end_notifications():
    """Notify HR five days before each contract year-end and after an undecided cycle ends."""
    today = timezone.localdate()
    reminder_count = 0
    decision_count = 0
    profiles = EmployeeProfile.objects.filter(
        is_archived=False,
        employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        company_id__isnull=False,
        company__node_type=OrganizationNode.NodeType.COMPANY,
        company__is_active=True,
    ).select_related("company", "user")

    for profile in profiles:
        cycle_start, cycle_end = get_contract_year_cycle(profile, today)
        if not cycle_start:
            continue
        if cycle_end == today + timedelta(days=5):
            for hr_user in _hr_users_for_company(profile.company):
                dispatch_notification_channels(
                    recipient=hr_user,
                    event_key="annual_leave.year_end_reminder",
                    **notification_text(
                        "annual_leave.year_end_reminder",
                        employee_name=profile_name(profile),
                        date=cycle_end,
                    ),
                    category=Notification.Category.LEAVE,
                    action_url=f"/hr/employees/{profile.id}",
                    related_object=profile,
                    metadata={
                        "employee_profile_id": profile.id,
                        "cycle_start": cycle_start.isoformat(),
                        "cycle_end": cycle_end.isoformat(),
                        "days_until_year_end": 5,
                    },
                    deduplication_key=f"annual_leave.year_end_reminder:{profile.id}:{cycle_end.isoformat()}",
                    company=profile.company,
                )
                reminder_count += 1

        previous_cycle_start = cycle_start - timedelta(days=1)
        previous_start, previous_end = get_contract_year_cycle(profile, previous_cycle_start)
        if previous_start and previous_end == today - timedelta(days=1):
            exists = AnnualLeavePaymentRequest.objects.filter(
                employee_profile=profile,
                cycle_start=previous_start,
                cycle_end=previous_end,
            ).exists()
            if not exists:
                for hr_user in _hr_users_for_company(profile.company):
                    dispatch_notification_channels(
                        recipient=hr_user,
                        event_key="annual_leave.year_end_decision_required",
                        **notification_text(
                            "annual_leave.year_end_decision_required",
                            employee_name=profile_name(profile),
                            date=previous_end,
                        ),
                        category=Notification.Category.LEAVE,
                        action_url=f"/hr/employees/{profile.id}",
                        related_object=profile,
                        metadata={
                            "employee_profile_id": profile.id,
                            "cycle_start": previous_start.isoformat(),
                            "cycle_end": previous_end.isoformat(),
                            "decision_options": ["carry_forward", "pay"],
                        },
                        deduplication_key=f"annual_leave.year_end_decision_required:{profile.id}:{previous_end.isoformat()}",
                        company=profile.company,
                    )
                    decision_count += 1

    return {"reminders_sent": reminder_count, "decisions_sent": decision_count}


def _format_days(value) -> str:
    """Whole settlement days render as ``10``; a fractional value keeps its decimals (``10.5``)."""
    number = Decimal(str(value or 0))
    if number == number.to_integral_value():
        return str(int(number))
    return format(number.normalize(), "f")


def settlement_window_open_deduplication_key(profile, cycle_end) -> str:
    return f"{SETTLEMENT_WINDOW_OPEN_EVENT}:{profile.id}:{cycle_end.isoformat()}"


def settlement_window_open_notification_kwargs(profile, eligibility) -> dict:
    """Everything ``dispatch_notification_channels`` needs for one employee's window-open notice.

    Kept separate from the task so the exact wording can be rendered and tested on its own.
    """
    cycle_start = eligibility["cycle_start"]
    cycle_end = eligibility["cycle_end"]
    eligible_days = _format_days(eligibility["eligible_unused_days"])
    locked_days = _format_days(eligibility.get("locked_unused_days"))
    has_locked = Decimal(str(eligibility.get("locked_unused_days") or 0)) > 0
    text_key = (
        "annual_leave.settlement_window_open_with_locked" if has_locked else "annual_leave.settlement_window_open"
    )
    params = {"cycle_end": cycle_end, "eligible_days": eligible_days}
    if has_locked:
        params["locked_days"] = locked_days
    rows = [
        {"label": "Contract year", "label_ar": "سنة العقد", "value": f"{cycle_start} - {cycle_end}"},
        {"label": "Window closes on", "label_ar": "تُغلق الفترة في", "value": str(cycle_end)},
        {"label": "Cash-eligible days", "label_ar": "الأيام المستحقة للصرف النقدي", "value": eligible_days},
    ]
    if has_locked:
        rows.append(
            {
                "label": "Leave-only days (not payable)",
                "label_ar": "أيام الإجازة فقط (غير قابلة للصرف)",
                "value": locked_days,
            }
        )
    return {
        "recipient": profile.user,
        "event_key": SETTLEMENT_WINDOW_OPEN_EVENT,
        **notification_text(text_key, **params),
        "category": Notification.Category.LEAVE,
        "action_url": SETTLEMENT_WINDOW_OPEN_ACTION_URL,
        "related_object": profile,
        "metadata": {
            "employee_profile_id": profile.id,
            "cycle_start": cycle_start.isoformat(),
            "cycle_end": cycle_end.isoformat(),
            "eligible_unused_days": str(eligibility["eligible_unused_days"]),
            "locked_unused_days": str(eligibility.get("locked_unused_days") or Decimal("0.00")),
        },
        "email_context": {
            "employee_name": profile_name(profile)["en"],
            "rows": rows,
            "details_title": "Settlement details",
            "details_title_ar": "تفاصيل التسوية",
            "action_text": "Open Leave Balance",
            "action_text_ar": "فتح رصيد الإجازات",
        },
        "deduplication_key": settlement_window_open_deduplication_key(profile, cycle_end),
        "company": profile.company,
        # The task runs daily; an existing row must never re-queue WhatsApp/email.
        "redeliver_existing": False,
    }


@shared_task
def send_annual_leave_settlement_window_open_notifications():
    """Tell each employee, once per contract cycle, that their Annual Leave settlement can be requested.

    ``build_annual_leave_eligibility`` stays the single source of truth: the employee is notified
    only when ``window_open`` and ``can_request`` are both true. Because the task runs hourly through the working day and
    the deduplication key is per profile and cycle end, an employee blocked on the first window day
    (for example by a pending Annual Leave request) is notified within the hour the block clears, matching the dashboard prompt.
    No settlement record is created here.
    """
    today = timezone.localdate()
    sent = 0
    failed = 0
    profiles = EmployeeProfile.objects.filter(
        is_archived=False,
        employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        user__isnull=False,
        user__is_active=True,
        company_id__isnull=False,
        company__node_type=OrganizationNode.NodeType.COMPANY,
        company__is_active=True,
    ).select_related("company", "user")

    for profile in profiles:
        try:
            cycle_start, cycle_end = get_contract_year_cycle(profile, today)
            # Cheap pre-filters; eligibility below still decides.
            if not cycle_start or not (cycle_end - timedelta(days=4) <= today <= cycle_end):
                continue
            if Notification.objects.filter(
                recipient=profile.user,
                deduplication_key=settlement_window_open_deduplication_key(profile, cycle_end),
            ).exists():
                continue
            eligibility = build_annual_leave_eligibility(profile, active_company=profile.company, as_of=today)
            if not (eligibility["window_open"] and eligibility["can_request"]):
                continue
            result = dispatch_notification_channels(**settlement_window_open_notification_kwargs(profile, eligibility))
            if result.get("created"):
                sent += 1
        except Exception:
            failed += 1
            logger.exception(
                "annual_leave_settlement_window_notification_failed",
                extra={"employee_profile_id": getattr(profile, "id", None)},
            )

    return {"window_open_sent": sent, "failed": failed}
