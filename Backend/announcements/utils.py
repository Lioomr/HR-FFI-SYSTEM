from django.contrib.auth import get_user_model

from core.notifications import send_email_notification
from core.permissions import get_role
from core.services.whatsapp_service import WhatsAppService

User = get_user_model()


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

    subject = f"New Announcement: {announcement.title}"
    message = f"""
{announcement.title}

{announcement.content}

---
This announcement was sent by {announcement.created_by.full_name or announcement.created_by.email}
"""

    for recipient_email in recipient_emails:
        result = send_email_notification(recipient_email, subject, message)
        if not result.get("sent"):
            print(f"Error sending announcement email to {recipient_email}: {result.get('reason', 'Unknown error')}")


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

    for user in users:
        profile = getattr(user, "employee_profile", None)
        phone = getattr(profile, "mobile", "")
        if not phone:
            continue
        employee_name = getattr(profile, "full_name", "") or getattr(user, "full_name", "") or user.email
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
