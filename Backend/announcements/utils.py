from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from django.utils import timezone

from core.permissions import get_role
from core.services.bird_email_service import send_announcement_notification_email, send_meeting_notification_email
from core.services.whatsapp_service import WhatsAppService
from .models import Announcement

User = get_user_model()
ANNOUNCEMENT_ATTACHMENT_SALT = "announcement-email-attachment"


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
    tzinfo = getattr(settings, "EMAIL_DISPLAY_TZINFO", None)
    return timezone.localtime(value, tzinfo) if tzinfo else timezone.localtime(value)


def _format_announcement_published_at(value):
    if not value:
        return None
    localized = _email_localtime(value)
    return localized.strftime("%Y-%m-%d %I:%M %p %Z")


def send_announcement_email(announcement):
    """
    Send announcement via email to users with target roles.
    """
    if not announcement.publish_to_email:
        return

    # Private targeted announcement
    if getattr(announcement, "target_user_id", None):
        users = User.objects.filter(id=announcement.target_user_id, is_active=True)
    else:
        role_map = {
            "ADMIN": "SystemAdmin",
            "HR_MANAGER": "HRManager",
            "MANAGER": "Manager",
            "EMPLOYEE": "Employee",
        }
        expected_roles = {role_map[r] for r in (announcement.target_roles or []) if r in role_map}
        users = [u for u in User.objects.filter(is_active=True) if get_role(u) in expected_roles]

    recipient_emails = [user.email for user in users if getattr(user, "email", None)]

    if not recipient_emails:
        return

    publisher_name = announcement.created_by.full_name or announcement.created_by.email
    attachment_name = announcement.attachment.name.rsplit("/", 1)[-1] if announcement.attachment else None
    attachment_url = _announcement_attachment_url(announcement)
    meeting_date, meeting_time = _meeting_datetime_parts(announcement)

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
            print(f"Error sending announcement email to {recipient_email}: {result.get('error', 'Unknown error')}")


def send_announcement_whatsapp(announcement):
    if not announcement.publish_to_sms:
        return

    if getattr(announcement, "target_user_id", None):
        users = User.objects.filter(id=announcement.target_user_id, is_active=True)
    else:
        role_map = {
            "ADMIN": "SystemAdmin",
            "HR_MANAGER": "HRManager",
            "MANAGER": "Manager",
            "EMPLOYEE": "Employee",
        }
        expected_roles = {role_map[r] for r in (announcement.target_roles or []) if r in role_map}
        users = [u for u in User.objects.filter(is_active=True) if get_role(u) in expected_roles]

    service = WhatsAppService()
    sent_count = 0
    organizer_name = announcement.created_by.full_name or announcement.created_by.email
    meeting_date, meeting_time = _meeting_datetime_parts(announcement)

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
                },
                language="en",
            )
        if result.get("success"):
            sent_count += 1
        else:
            print(f"Error sending announcement WhatsApp to {phone}: {result.get('error', 'Unknown error')}")

    print(f"WhatsApp notifications sent: {sent_count}")


def send_announcement_sms(announcement):
    """
    Backward-compatible wrapper. SMS channel has been replaced by WhatsApp.
    """
    return send_announcement_whatsapp(announcement)
