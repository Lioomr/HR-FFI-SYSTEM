import base64
import logging
import os
from typing import Any

import requests
from django.conf import settings
from django.template.loader import render_to_string
from django.utils.html import strip_tags

logger = logging.getLogger(__name__)


def _load_logo_base64() -> str:
    """Return the FFI logo as a base64 inline data URI.

    Embeds the image directly into the HTML so it renders in every email client
    without requiring a publicly accessible URL.
    Falls back to EMAIL_LOGO_URL if the file cannot be opened.
    """
    configured_logo_path = getattr(settings, "EMAIL_LOGO_PATH", "")
    default_candidates = [
        os.path.join(str(settings.BASE_DIR.parent), "Logo FFI.png"),
        os.path.join(str(settings.BASE_DIR), "Logo FFI.png"),
        "/app/Logo FFI.png",
    ]
    candidate_paths = [configured_logo_path] if configured_logo_path else default_candidates
    logo_path = next((path for path in candidate_paths if path and os.path.exists(path)), "")
    try:
        with open(logo_path, "rb") as fh:
            encoded = base64.b64encode(fh.read()).decode("ascii")
        ext = os.path.splitext(logo_path)[1].lstrip(".").lower()
        mime_type = "jpeg" if ext in ("jpg", "jpeg") else ext  # e.g. "png"
        return f"data:image/{mime_type};base64,{encoded}"
    except Exception:
        logger.warning(
            "email_logo_file_not_found",
            extra={"logo_path": logo_path or configured_logo_path, "candidate_paths": candidate_paths},
        )
        return getattr(settings, "EMAIL_LOGO_URL", "https://mail.fficontracting.com/logo.png")


class BirdEmailService:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        channel_id: str | None = None,
        workspace_id: str | None = None,
        base_url: str | None = None,
        timeout_seconds: int | None = None,
        default_sender: str | None = None,
    ) -> None:
        self.api_key = api_key or getattr(settings, "BIRD_API_KEY", "") or getattr(settings, "BIRD_ACCESS_KEY", "")
        self.channel_id = (
            channel_id or getattr(settings, "BIRD_CHANNEL_ID", "") or getattr(settings, "BIRD_EMAIL_CHANNEL_ID", "")
        )
        self.workspace_id = workspace_id or getattr(settings, "BIRD_WORKSPACE_ID", "")
        self.base_url = (base_url or getattr(settings, "BIRD_API_BASE_URL", "https://api.bird.com/workspaces")).rstrip(
            "/"
        )
        self.timeout_seconds = timeout_seconds or int(getattr(settings, "NOTIFICATION_HTTP_TIMEOUT_SECONDS", 10))
        self.default_sender = default_sender or getattr(settings, "DEFAULT_FROM_EMAIL", "no-reply@fficontracting.com")
        self.logo_url = getattr(settings, "EMAIL_LOGO_URL", "https://mail.fficontracting.com/logo.png")
        self.contact_email = getattr(settings, "EMAIL_CONTACT_EMAIL", "hr@fficontracting.com")

    def is_configured(self) -> bool:
        return bool(self.api_key and self.channel_id and self.workspace_id)

    def _endpoint(self) -> str:
        return f"{self.base_url}/{self.workspace_id}/channels/{self.channel_id}/messages"

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"AccessKey {self.api_key}",
            "Content-Type": "application/json",
        }

    @staticmethod
    def _username_from_email(email_address: str) -> str:
        return (email_address or "no-reply@fficontracting.com").split("@", 1)[0]

    def render_template(self, template_name: str, context: dict[str, Any]) -> str:
        return render_to_string(f"emails/{template_name}", context)

    def send_template_email(
        self,
        *,
        to_email: str,
        subject: str,
        template_name: str,
        context: dict[str, Any],
        from_email: str | None = None,
    ) -> dict[str, Any]:
        if not self.is_configured():
            reason = "Bird email is not configured. Required: BIRD_API_KEY, BIRD_CHANNEL_ID, BIRD_WORKSPACE_ID."
            logger.error("bird_email_not_configured")
            return {"success": False, "status_code": None, "error": reason, "response": {}}

        try:
            html_content = self.render_template(template_name, context)
        except Exception as exc:
            logger.exception("bird_email_template_render_failed", extra={"template_name": template_name})
            return {"success": False, "status_code": None, "error": str(exc), "response": {}}

        text_fallback = strip_tags(html_content).strip()
        sender_email = from_email or self.default_sender

        payload = {
            "receiver": {
                "contacts": [
                    {
                        "identifierKey": "emailaddress",
                        "identifierValue": to_email,
                    }
                ]
            },
            "body": {
                "type": "html",
                "html": {
                    "text": text_fallback,
                    "html": html_content,
                    "metadata": {
                        "subject": subject,
                        "emailFrom": {
                            "username": self._username_from_email(sender_email),
                        },
                    },
                },
            },
            "meta": {"email": {"subject": subject}},
        }

        try:
            response = requests.post(
                self._endpoint(),
                headers=self._headers(),
                json=payload,
                timeout=self.timeout_seconds,
            )
        except requests.RequestException as exc:
            logger.exception("bird_email_request_failed", extra={"to_email": to_email, "template_name": template_name})
            return {"success": False, "status_code": None, "error": str(exc), "response": {}}

        try:
            response_data = response.json()
        except ValueError:
            response_data = {"raw": (response.text or "")[:1000]}

        if 200 <= response.status_code < 300:
            return {
                "success": True,
                "status_code": response.status_code,
                "message_id": response_data.get("id"),
                "error": None,
                "response": response_data,
            }

        error_message = response_data.get("message") or response_data.get("error") or response.text[:500]
        logger.error(
            "bird_email_api_error",
            extra={
                "to_email": to_email,
                "template_name": template_name,
                "status_code": response.status_code,
                "error": error_message,
            },
        )
        return {
            "success": False,
            "status_code": response.status_code,
            "message_id": None,
            "error": error_message or f"Bird API returned status {response.status_code}",
            "response": response_data,
        }


def _base_email_context(
    *,
    title: str,
    title_ar: str,
    employee_name: str,
    message: str,
    message_ar: str,
    action_url: str | None = None,
    action_text: str | None = None,
    action_text_ar: str | None = None,
) -> dict[str, Any]:
    return {
        "logo_url": _load_logo_base64(),
        "contact_email": getattr(settings, "EMAIL_CONTACT_EMAIL", "hr@fficontracting.com"),
        "title": title,
        "title_ar": title_ar,
        "employee_name": employee_name,
        "message": message,
        "message_ar": message_ar,
        "action_url": action_url,
        "action_text": action_text or "View Details",
        "action_text_ar": action_text_ar or "عرض التفاصيل",
    }


def send_leave_request_submitted_email(
    *,
    to_email: str,
    employee_name: str,
    leave_type: str,
    start_date: str,
    end_date: str,
    total_days: int,
    manager_name: str | None = None,
    action_url: str | None = None,
) -> dict[str, Any]:
    service = BirdEmailService()
    context = _base_email_context(
        title="Leave Request Submitted",
        title_ar="تم تقديم طلب الإجازة",
        employee_name=employee_name,
        message="Your leave request has been submitted successfully and is pending approval.",
        message_ar="تم تقديم طلب الإجازة الخاص بك بنجاح وهو الآن بانتظار الاعتماد.",
        action_url=action_url,
        action_text_ar="عرض الطلب",
    )
    context.update(
        {
            "leave_type": leave_type,
            "start_date": start_date,
            "end_date": end_date,
            "total_days": total_days,
            "manager_name": manager_name,
        }
    )
    return service.send_template_email(
        to_email=to_email,
        subject="Leave Request Submitted",
        template_name="leave_request_submitted.html",
        context=context,
    )


def send_leave_approved_email(
    *,
    to_email: str,
    employee_name: str,
    leave_type: str,
    start_date: str,
    end_date: str,
    total_days: int,
    action_url: str | None = None,
) -> dict[str, Any]:
    service = BirdEmailService()
    context = _base_email_context(
        title="Leave Request Approved",
        title_ar="تمت الموافقة على طلب الإجازة",
        employee_name=employee_name,
        message="Your leave request has been approved.",
        message_ar="تمت الموافقة على طلب الإجازة الخاص بك.",
        action_url=action_url,
        action_text_ar="عرض الطلب",
    )
    context.update(
        {
            "leave_type": leave_type,
            "start_date": start_date,
            "end_date": end_date,
            "total_days": total_days,
        }
    )
    return service.send_template_email(
        to_email=to_email,
        subject="Leave Request Approved",
        template_name="leave_request_approved.html",
        context=context,
    )


def send_leave_rejected_email(
    *,
    to_email: str,
    employee_name: str,
    leave_type: str,
    start_date: str,
    end_date: str,
    rejection_reason: str | None = None,
    action_url: str | None = None,
) -> dict[str, Any]:
    service = BirdEmailService()
    context = _base_email_context(
        title="Leave Request Rejected",
        title_ar="تم رفض طلب الإجازة",
        employee_name=employee_name,
        message="Your leave request was reviewed and could not be approved.",
        message_ar="تمت مراجعة طلب الإجازة الخاص بك ولم تتم الموافقة عليه.",
        action_url=action_url,
        action_text_ar="تقديم طلب جديد",
    )
    context.update(
        {
            "leave_type": leave_type,
            "start_date": start_date,
            "end_date": end_date,
            "rejection_reason": rejection_reason,
        }
    )
    return service.send_template_email(
        to_email=to_email,
        subject="Leave Request Rejected",
        template_name="leave_request_rejected.html",
        context=context,
    )


def send_document_expiry_reminder_email(
    *,
    to_email: str,
    employee_name: str,
    document_type: str,
    expiry_date: str,
    days_remaining: int | None = None,
    action_url: str | None = None,
) -> dict[str, Any]:
    service = BirdEmailService()
    context = _base_email_context(
        title="Document Expiry Reminder",
        title_ar="تذكير بانتهاء صلاحية مستند",
        employee_name=employee_name,
        message="One of your employment documents is approaching its expiry date.",
        message_ar="أحد مستنداتك الوظيفية يقترب من تاريخ انتهاء الصلاحية.",
        action_url=action_url,
        action_text="Update Document",
        action_text_ar="تحديث المستند",
    )
    context.update(
        {
            "document_type": document_type,
            "expiry_date": expiry_date,
            "days_remaining": days_remaining,
        }
    )
    return service.send_template_email(
        to_email=to_email,
        subject="Document Expiry Reminder",
        template_name="document_expiry_reminder.html",
        context=context,
    )


def send_announcement_notification_email(
    *,
    to_email: str,
    employee_name: str,
    announcement_title: str,
    message: str,
    message_ar: str | None = None,
    published_at: str | None = None,
    publisher_name: str | None = None,
    action_url: str | None = None,
) -> dict[str, Any]:
    service = BirdEmailService()
    context = _base_email_context(
        title="New Company Announcement",
        title_ar="إعلان جديد من الشركة",
        employee_name=employee_name,
        message=message,
        message_ar=message_ar or message,
        action_url=action_url,
        action_text="Read Announcement",
        action_text_ar="قراءة الإعلان",
    )
    context.update(
        {
            "announcement_title": announcement_title,
            "published_at": published_at,
            "publisher_name": publisher_name,
        }
    )
    return service.send_template_email(
        to_email=to_email,
        subject=f"Announcement: {announcement_title}",
        template_name="announcement_notification.html",
        context=context,
    )


def send_user_invite_email(
    *,
    to_email: str,
    role: str,
    invite_link: str,
    expires_in_hours: int,
    inviter_name: str | None = None,
    is_reminder: bool = False,
) -> dict[str, Any]:
    service = BirdEmailService()
    action_text = "Accept Invite"
    action_text_ar = "قبول الدعوة"
    title = "Invitation to FFI HR System"
    title_ar = "دعوة إلى نظام الموارد البشرية"
    message = (
        f"You have been invited to join the FFI HR System as {role}. "
        f"This invitation expires in {expires_in_hours} hours."
    )
    message_ar = (
        f"تمت دعوتك للانضمام إلى نظام الموارد البشرية بدور {role}. "
        f"تنتهي صلاحية هذه الدعوة خلال {expires_in_hours} ساعة."
    )
    subject = "You have been invited to FFI HR System"

    if is_reminder:
        title = "Invitation Reminder"
        title_ar = "تذكير بالدعوة"
        message = (
            f"This is a reminder to accept your FFI HR System invitation as {role}. "
            f"The link expires in {expires_in_hours} hours."
        )
        message_ar = (
            f"هذا تذكير بقبول دعوتك إلى نظام الموارد البشرية بدور {role}. "
            f"تنتهي صلاحية الرابط خلال {expires_in_hours} ساعة."
        )
        subject = "Invitation Reminder: FFI HR System"

    context = _base_email_context(
        title=title,
        title_ar=title_ar,
        employee_name=to_email,
        message=message,
        message_ar=message_ar,
        action_url=invite_link,
        action_text=action_text,
        action_text_ar=action_text_ar,
    )
    context.update(
        {
            "role": role,
            "invite_link": invite_link,
            "expires_in_hours": expires_in_hours,
            "inviter_name": inviter_name or "",
        }
    )
    return service.send_template_email(
        to_email=to_email,
        subject=subject,
        template_name="invite_user.html",
        context=context,
    )


def example_email_usage() -> dict[str, Any]:
    return {
        "leave_submitted": send_leave_request_submitted_email(
            to_email="employee@fficontracting.com",
            employee_name="Ahmed Ali",
            leave_type="Annual Leave",
            start_date="2026-03-10",
            end_date="2026-03-15",
            total_days=6,
            manager_name="Fatima Noor",
            action_url="https://hr.fficontracting.com/leaves/123",
        ),
        "leave_approved": send_leave_approved_email(
            to_email="employee@fficontracting.com",
            employee_name="Ahmed Ali",
            leave_type="Annual Leave",
            start_date="2026-03-10",
            end_date="2026-03-15",
            total_days=6,
            action_url="https://hr.fficontracting.com/leaves/123",
        ),
        "leave_rejected": send_leave_rejected_email(
            to_email="employee@fficontracting.com",
            employee_name="Ahmed Ali",
            leave_type="Emergency Leave",
            start_date="2026-04-01",
            end_date="2026-04-03",
            rejection_reason="Insufficient leave balance.",
            action_url="https://hr.fficontracting.com/leaves/new",
        ),
        "document_expiry": send_document_expiry_reminder_email(
            to_email="employee@fficontracting.com",
            employee_name="Ahmed Ali",
            document_type="Iqama",
            expiry_date="2026-05-01",
            days_remaining=14,
            action_url="https://hr.fficontracting.com/documents",
        ),
        "announcement": send_announcement_notification_email(
            to_email="employee@fficontracting.com",
            employee_name="Ahmed Ali",
            announcement_title="Ramadan Working Hours",
            message="Please review the updated working schedule effective from next week.",
            published_at="2026-02-17 09:00",
            publisher_name="HR Department",
            action_url="https://hr.fficontracting.com/announcements/55",
        ),
    }
