import logging
from datetime import timedelta
from datetime import timezone as datetime_timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from django.db.models import Q
from django.utils import timezone

from core.permissions import get_role
from core.services.bird_email_service import send_announcement_notification_email, send_meeting_notification_email
from core.services.whatsapp_service import WhatsAppService
from in_app_notifications.dispatcher import dispatch_notification_channels
from in_app_notifications.models import Notification

from .models import Announcement

User = get_user_model()
ANNOUNCEMENT_ATTACHMENT_SALT = "announcement-email-attachment"
logger = logging.getLogger(__name__)

EMAIL_TIME_ZONE_FALLBACKS = {
    "Asia/Riyadh": datetime_timezone(timedelta(hours=3), "+03"),
}

ANNOUNCEMENT_ROLE_TO_GROUP = {
    "ADMIN": "SystemAdmin",
    "HR_MANAGER": "HRManager",
    "MANAGER": "Manager",
    "CEO": "CEO",
    "CFO": "CFO",
    "EMPLOYEE": "Employee",
}


def _announcement_users(announcement):
    if not getattr(announcement, "company_id", None):
        return User.objects.none()

    company_users = (
        User.objects.filter(is_active=True)
        .filter(
            Q(
                employee_profile__company_id=announcement.company_id,
                employee_profile__is_archived=False,
            )
            | Q(organization_access_entries__organization_id=announcement.company_id)
            | Q(groups__name="SystemAdmin")
        )
        .distinct()
    )
    if getattr(announcement, "target_user_id", None):
        return company_users.filter(id=announcement.target_user_id)
    expected_roles = {
        ANNOUNCEMENT_ROLE_TO_GROUP[role]
        for role in (announcement.target_roles or [])
        if role in ANNOUNCEMENT_ROLE_TO_GROUP
    }
    return [user for user in company_users if get_role(user) in expected_roles]


def send_announcement_in_app(announcement):
    if not announcement.publish_to_dashboard:
        return []
    is_meeting = announcement.announcement_type == Announcement.AnnouncementType.MEETING
    publisher_name = announcement.created_by.full_name or announcement.created_by.email
    meeting_date, meeting_time = _meeting_datetime_parts(announcement)
    attachment_name = announcement.attachment.name.rsplit("/", 1)[-1] if announcement.attachment else None
    attachment_url = _announcement_attachment_url(announcement)
    dispatches = []
    users = list(_announcement_users(announcement))
    dedup_key = f"announcement.created:{announcement.id}"
    # One batch query up front to learn which recipients already have a
    # notification for this announcement, instead of a per-recipient dedup
    # SELECT inside create_notification for every one of (potentially)
    # hundreds of company-wide recipients.
    existing_recipient_ids = set(
        Notification.objects.filter(
            deduplication_key=dedup_key,
            recipient_id__in=[user.pk for user in users],
        ).values_list("recipient_id", flat=True)
    )
    for user in users:
        profile = getattr(user, "employee_profile", None)
        recipient_name = getattr(profile, "full_name", "") or getattr(user, "full_name", "") or user.email
        if is_meeting:
            email_template = send_meeting_notification_email
            email_context = {
                "employee_name": recipient_name,
                "meeting_title": announcement.title,
                "meeting_message": announcement.content,
                "meeting_date": meeting_date,
                "meeting_time": meeting_time,
                "organizer_name": publisher_name,
                "duration_minutes": announcement.meeting_duration_minutes,
                "location": announcement.meeting_location,
                "agenda": announcement.meeting_agenda,
                "google_meet_url": announcement.google_meet_url,
                "microsoft_teams_url": announcement.microsoft_teams_url,
                "zoom_url": announcement.zoom_url,
                "action_url": _announcement_action_url(user),
            }
            whatsapp_template = "meeting_notification_v1"
            whatsapp_variables = {
                "employee_name": recipient_name,
                "meeting_title": announcement.title,
                "meeting_date": meeting_date,
                "meeting_time": meeting_time,
                "organizer_name": publisher_name,
                "google_meet_url": announcement.google_meet_url or "",
                "microsoft_teams_url": announcement.microsoft_teams_url or "",
                "zoom_url": announcement.zoom_url or "",
            }
        else:
            email_template = send_announcement_notification_email
            email_context = {
                "employee_name": recipient_name,
                "announcement_title": announcement.title,
                "message": announcement.content,
                "published_at": _format_announcement_published_at(announcement.created_at),
                "publisher_name": publisher_name,
                "action_url": _announcement_action_url(user),
                "attachment_name": attachment_name,
                "attachment_url": attachment_url,
            }
            whatsapp_template = "new_announcement_notification"
            whatsapp_variables = {
                "employee_name": recipient_name,
                "announcement_title": announcement.title,
                "attachment_url": attachment_url or "",
            }
        dispatches.append(
            dispatch_notification_channels(
                recipient=user,
                event_key="meeting.created" if is_meeting else "announcement.created",
                title=announcement.title,
                message=announcement.content,
                category=Notification.Category.MEETING if is_meeting else Notification.Category.ANNOUNCEMENT,
                action_url="/employee/announcements",
                related_object=announcement,
                metadata={"announcement_type": announcement.announcement_type},
                deduplication_key=dedup_key,
                whatsapp_template=whatsapp_template,
                whatsapp_variables=whatsapp_variables,
                email_template=email_template,
                email_context=email_context,
                whatsapp_enabled=bool(announcement.publish_to_whatsapp),
                email_enabled=bool(announcement.publish_to_email),
                known_new=user.pk not in existing_recipient_ids,
            )
        )
    return dispatches


def _announcement_action_url(user):
    base_url = (getattr(settings, "FRONTEND_URL", "") or "").rstrip("/")
    if not base_url:
        return None

    role_path_map = {
        "SystemAdmin": "/admin/announcements",
        "HRManager": "/hr/announcements",
        "Manager": "/manager/announcements",
        "CEO": "/ceo/announcements",
        "Employee": "/employee/announcements",
    }
    return f"{base_url}{role_path_map.get(get_role(user), '/employee/announcements')}"


def _announcement_attachment_url(announcement):
    if not announcement.attachment:
        return None

    base_url = (getattr(settings, "BACKEND_PUBLIC_URL", "") or "").rstrip("/")
    if not base_url:
        allowed_hosts = getattr(settings, "ALLOWED_HOSTS", []) or []
        public_host = next((host for host in allowed_hosts if host and host not in {"*", ".localhost"}), "")
        if public_host:
            scheme = "http" if getattr(settings, "DEBUG", False) else "https"
            base_url = f"{scheme}://{public_host}".rstrip("/")
    if not base_url:
        return None

    token = signing.dumps({"announcement_id": announcement.id}, salt=ANNOUNCEMENT_ATTACHMENT_SALT)
    return f"{base_url}/api/announcements/{announcement.id}/attachment-public?token={token}&download=1"


def _meeting_datetime_parts(announcement):
    if not announcement.meeting_starts_at:
        return "", ""
    starts_at = _email_localtime(announcement.meeting_starts_at)
    return starts_at.strftime("%Y-%m-%d"), starts_at.strftime("%I:%M %p %Z")


def _email_localtime(value):
    timezone_name = getattr(settings, "EMAIL_DISPLAY_TIME_ZONE", "")
    tzinfo = None
    if timezone_name:
        try:
            tzinfo = ZoneInfo(timezone_name)
        except ZoneInfoNotFoundError:
            tzinfo = EMAIL_TIME_ZONE_FALLBACKS.get(timezone_name)
    if not tzinfo:
        tzinfo = getattr(settings, "EMAIL_DISPLAY_TZINFO", None)
    return timezone.localtime(value, tzinfo) if tzinfo else timezone.localtime(value)


def _format_announcement_published_at(value):
    if not value:
        return None
    # Published timestamps are persisted as UTC. Normalize callers that pass a
    # database-style timestamp carrying the application timezone instead.
    if timezone.is_aware(value) and value.utcoffset() != timedelta(0):
        value = value.replace(tzinfo=datetime_timezone.utc)
    localized = _email_localtime(value)
    return localized.strftime("%Y-%m-%d %I:%M %p %Z")


def send_announcement_email(announcement):
    """
    Send announcement via email to users with target roles.
    """
    if not announcement.publish_to_email:
        logger.warning(
            "announcement_email_skipped_publish_to_email_false",
            extra={"announcement_id": announcement.id, "title": announcement.title},
        )
        return {"sent": 0, "failed": 0, "reason": "publish_to_email_false"}

    users = _announcement_users(announcement)
    recipient_emails = [user.email for user in users if getattr(user, "email", None)]

    if not recipient_emails:
        logger.warning(
            "announcement_email_skipped_no_recipients",
            extra={
                "announcement_id": announcement.id,
                "title": announcement.title,
                "target_roles": announcement.target_roles,
                "target_user_id": getattr(announcement, "target_user_id", None),
            },
        )
        return {"sent": 0, "failed": 0, "reason": "no_recipients"}

    publisher_name = announcement.created_by.full_name or announcement.created_by.email
    attachment_name = announcement.attachment.name.rsplit("/", 1)[-1] if announcement.attachment else None
    attachment_url = _announcement_attachment_url(announcement)
    meeting_date, meeting_time = _meeting_datetime_parts(announcement)
    sent_count = 0
    failed_count = 0

    for user in users:
        recipient_email = getattr(user, "email", None)
        if not recipient_email:
            continue

        profile = getattr(user, "employee_profile", None)
        recipient_name = getattr(profile, "full_name", "") or getattr(user, "full_name", "") or recipient_email
        if announcement.announcement_type == Announcement.AnnouncementType.MEETING:
            result = send_meeting_notification_email(
                to_email=recipient_email,
                employee_name=recipient_name,
                meeting_title=announcement.title,
                meeting_message=announcement.content,
                meeting_date=meeting_date,
                meeting_time=meeting_time,
                organizer_name=publisher_name,
                duration_minutes=announcement.meeting_duration_minutes,
                location=announcement.meeting_location,
                agenda=announcement.meeting_agenda,
                google_meet_url=announcement.google_meet_url,
                microsoft_teams_url=announcement.microsoft_teams_url,
                zoom_url=announcement.zoom_url,
                action_url=_announcement_action_url(user),
            )
        else:
            result = send_announcement_notification_email(
                to_email=recipient_email,
                employee_name=recipient_name,
                announcement_title=announcement.title,
                message=announcement.content,
                published_at=_format_announcement_published_at(announcement.created_at),
                publisher_name=publisher_name,
                action_url=_announcement_action_url(user),
                attachment_name=attachment_name,
                attachment_url=attachment_url,
            )
        if not result.get("success"):
            failed_count += 1
            logger.error(
                "announcement_email_failed",
                extra={
                    "announcement_id": announcement.id,
                    "recipient_email": recipient_email,
                    "error": result.get("error", "Unknown error"),
                    "status_code": result.get("status_code"),
                },
            )
            continue

        sent_count += 1

    logger.warning(
        "announcement_email_delivery_finished",
        extra={
            "announcement_id": announcement.id,
            "recipient_count": len(recipient_emails),
            "sent_count": sent_count,
            "failed_count": failed_count,
        },
    )
    return {"sent": sent_count, "failed": failed_count, "reason": None}


def send_announcement_whatsapp(announcement):
    if not announcement.publish_to_whatsapp:
        return

    users = _announcement_users(announcement)

    service = WhatsAppService()
    sent_count = 0
    document_sent_count = 0
    organizer_name = announcement.created_by.full_name or announcement.created_by.email
    meeting_date, meeting_time = _meeting_datetime_parts(announcement)
    attachment_url = _announcement_attachment_url(announcement)
    attachment_name = announcement.attachment.name.rsplit("/", 1)[-1] if announcement.attachment else None

    for user in users:
        profile = getattr(user, "employee_profile", None)
        phone = getattr(profile, "mobile", "")
        if not phone:
            continue
        employee_name = getattr(profile, "full_name", "") or getattr(user, "full_name", "") or user.email
        if announcement.announcement_type == Announcement.AnnouncementType.MEETING:
            result = service.send_template_message(
                phone_number=phone,
                template_name="meeting_notification_v1",
                template_variables={
                    "employee_name": employee_name,
                    "meeting_title": announcement.title,
                    "meeting_date": meeting_date,
                    "meeting_time": meeting_time,
                    "organizer_name": organizer_name,
                    "google_meet_url": announcement.google_meet_url,
                    "microsoft_teams_url": announcement.microsoft_teams_url,
                    "zoom_url": announcement.zoom_url,
                },
                language="en",
            )
        else:
            result = service.send_template_message(
                phone_number=phone,
                template_name="new_announcement_notification",
                template_variables={
                    "employee_name": employee_name,
                    "announcement_title": announcement.title,
                    "attachment_url": attachment_url or "",
                },
                language="en",
            )
        if result.get("success"):
            sent_count += 1
            if attachment_url and attachment_name:
                document_result = service.send_document_message(
                    phone_number=phone,
                    document_url=attachment_url,
                    file_name=attachment_name,
                    caption=f"{announcement.title} - PDF attachment",
                )
                if document_result.get("success"):
                    document_sent_count += 1
                else:
                    logger.warning(
                        "announcement_whatsapp_document_failed",
                        extra={
                            "announcement_id": announcement.id,
                            "phone": phone,
                            "status_code": document_result.get("status_code"),
                            "error": document_result.get("error"),
                        },
                    )
        else:
            print(f"Error sending announcement WhatsApp to {phone}: {result.get('error', 'Unknown error')}")

    print(f"WhatsApp notifications sent: {sent_count}; documents sent: {document_sent_count}")


def send_announcement_sms(announcement):
    """
    Backward-compatible wrapper. SMS channel has been replaced by WhatsApp.
    """
    return send_announcement_whatsapp(announcement)
