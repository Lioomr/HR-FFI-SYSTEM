from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from core.services.pending_approval_email import get_hr_approver_users
from employees.models import EmployeeProfile
from in_app_notifications.dispatcher import dispatch_notification_channels
from in_app_notifications.models import Notification
from organization.models import OrganizationNode

from .models import AnnualLeavePaymentRequest
from .utils import get_contract_year_cycle


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
                    title="Annual Leave year-end is approaching",
                    message=(
                        f"{profile.full_name or profile.employee_id}'s contract year ends on {cycle_end}. "
                        "Review unused Annual Leave during the final 5 days."
                    ),
                    category=Notification.Category.LEAVE,
                    action_url=f"/employees/{profile.id}",
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
                        title="Annual Leave settlement decision required",
                        message=(
                            f"{profile.full_name or profile.employee_id}'s Annual Leave year ended on {previous_end}. "
                            "Decide whether to carry forward or pay the unused balance."
                        ),
                        category=Notification.Category.LEAVE,
                        action_url=f"/employees/{profile.id}",
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
