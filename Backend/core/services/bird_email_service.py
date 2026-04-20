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
        os.path.join(str(settings.BASE_DIR), "ffi-logo.png"),
        os.path.join(str(settings.BASE_DIR.parent), "ffi-logo.png"),
        "/app/ffi-logo.png",
        os.path.join(str(settings.BASE_DIR.parent), "FrontEnd", "public", "ffi-logo.png"),
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


def _is_inline_logo(value: Any) -> bool:
    return isinstance(value, str) and value.startswith("data:image/")


def _resolve_logo_source() -> str:
    configured_logo_url = (getattr(settings, "EMAIL_LOGO_URL", "") or "").strip()
    if configured_logo_url:
        return configured_logo_url
    return _load_logo_base64()


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

    def _upload_media_endpoint(self) -> str:
        return f"{self.base_url}/{self.workspace_id}/channel-media/presigned-upload"

    def upload_media(
        self,
        *,
        filename: str,
        content: bytes,
        content_type: str,
    ) -> dict[str, Any]:
        if not self.is_configured():
            reason = "Bird email is not configured. Required: BIRD_API_KEY, BIRD_CHANNEL_ID, BIRD_WORKSPACE_ID."
            logger.error("bird_email_not_configured")
            return {"success": False, "media_url": None, "error": reason}

        try:
            presign_response = requests.post(
                self._upload_media_endpoint(),
                headers=self._headers(),
                json={"contentType": content_type},
                timeout=self.timeout_seconds,
            )
            presign_response.raise_for_status()
            presign_payload = presign_response.json()
        except requests.RequestException as exc:
            logger.exception("bird_media_presign_failed", extra={"filename": filename})
            return {"success": False, "media_url": None, "error": str(exc)}

        upload_url = presign_payload.get("uploadUrl")
        upload_method = str(presign_payload.get("uploadMethod") or "POST").upper()
        upload_form_data = presign_payload.get("uploadFormData") or {}
        media_url = presign_payload.get("mediaUrl")

        if not upload_url or not media_url:
            return {"success": False, "media_url": None, "error": "Bird media upload response was incomplete."}

        files = {"file": (filename, content, content_type)}

        try:
            upload_response = requests.request(
                upload_method,
                upload_url,
                data=upload_form_data,
                files=files,
                timeout=self.timeout_seconds,
            )
            upload_response.raise_for_status()
        except requests.RequestException as exc:
            logger.exception("bird_media_upload_failed", extra={"filename": filename})
            return {"success": False, "media_url": None, "error": str(exc)}

        return {"success": True, "media_url": media_url, "error": None}

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
        attachments: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        if not self.is_configured():
            reason = "Bird email is not configured. Required: BIRD_API_KEY, BIRD_CHANNEL_ID, BIRD_WORKSPACE_ID."
            logger.error("bird_email_not_configured")
            return {"success": False, "status_code": None, "error": reason, "response": {}}

        sender_email = from_email or self.default_sender
        current_context = dict(context)

        def _build_payload(render_context: dict[str, Any]) -> dict[str, Any]:
            html_content = self.render_template(template_name, render_context)
            text_fallback = strip_tags(html_content).strip()
            return {
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
                        "attachments": attachments or [],
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
            payload = _build_payload(current_context)
        except Exception as exc:
            logger.exception("bird_email_template_render_failed", extra={"template_name": template_name})
            return {"success": False, "status_code": None, "error": str(exc), "response": {}}

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

        if response.status_code == 413 and _is_inline_logo(current_context.get("logo_url")):
            logger.warning(
                "bird_email_payload_too_large_retrying_without_inline_logo",
                extra={"to_email": to_email, "template_name": template_name},
            )
            current_context["logo_url"] = self.logo_url
            try:
                retry_payload = _build_payload(current_context)
                response = requests.post(
                    self._endpoint(),
                    headers=self._headers(),
                    json=retry_payload,
                    timeout=self.timeout_seconds,
                )
            except requests.RequestException as exc:
                logger.exception(
                    "bird_email_retry_request_failed",
                    extra={"to_email": to_email, "template_name": template_name},
                )
                return {"success": False, "status_code": None, "error": str(exc), "response": {}}
            except Exception as exc:
                logger.exception("bird_email_template_render_failed", extra={"template_name": template_name})
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
        "logo_url": _resolve_logo_source(),
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
    attachment_name: str | None = None,
    attachment_url: str | None = None,
    attachments: list[dict[str, Any]] | None = None,
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
            "attachment_name": attachment_name,
            "attachment_url": attachment_url,
        }
    )
    return service.send_template_email(
        to_email=to_email,
        subject=f"Announcement: {announcement_title}",
        template_name="announcement_notification.html",
        context=context,
        attachments=attachments,
    )


def send_meeting_notification_email(
    *,
    to_email: str,
    employee_name: str,
    meeting_title: str,
    meeting_message: str,
    meeting_date: str,
    meeting_time: str,
    organizer_name: str,
    duration_minutes: int | None = None,
    location: str | None = None,
    agenda: str | None = None,
    google_meet_url: str | None = None,
    microsoft_teams_url: str | None = None,
    zoom_url: str | None = None,
    action_url: str | None = None,
) -> dict[str, Any]:
    service = BirdEmailService()
    context = _base_email_context(
        title="Meeting Invitation",
        title_ar="دعوة اجتماع",
        employee_name=employee_name,
        message=meeting_message,
        message_ar=meeting_message,
        action_url=action_url or google_meet_url or microsoft_teams_url or zoom_url,
        action_text="Open Meeting",
        action_text_ar="فتح الاجتماع",
    )
    context.update(
        {
            "meeting_title": meeting_title,
            "meeting_date": meeting_date,
            "meeting_time": meeting_time,
            "organizer_name": organizer_name,
            "duration_minutes": duration_minutes,
            "location": location,
            "agenda": agenda,
            "google_meet_url": google_meet_url,
            "microsoft_teams_url": microsoft_teams_url,
            "zoom_url": zoom_url,
        }
    )
    return service.send_template_email(
        to_email=to_email,
        subject=f"Meeting Invitation: {meeting_title}",
        template_name="meeting_notification.html",
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


def send_delegation_notification_email(
    *,
    to_email: str,
    recipient_name: str,
    from_user_name: str,
    to_user_name: str,
    start_at: str,
    end_at: str | None = None,
    reason: str | None = None,
    recipient_role: str,
    action_url: str | None = None,
) -> dict[str, Any]:
    service = BirdEmailService()
    if recipient_role == "delegate":
        title = "You have been delegated approval authority"
        title_ar = "تم تفويضك بصلاحية الموافقة"
        message = (
            f"{from_user_name} has delegated approval responsibilities to you for the specified period."
        )
        message_ar = "قام المستخدم الأصلي بتفويض مسؤوليات الموافقة إليك خلال الفترة المحددة."
    else:
        title = "Your delegation rule is active"
        title_ar = "تم تفعيل قاعدة التفويض الخاصة بك"
        message = (
            f"Your approval responsibilities have been delegated to {to_user_name} for the specified period."
        )
        message_ar = "تم تفويض مسؤوليات الموافقة الخاصة بك إلى المستخدم الآخر خلال الفترة المحددة."

    context = _base_email_context(
        title=title,
        title_ar=title_ar,
        employee_name=recipient_name,
        message=message,
        message_ar=message_ar,
        action_url=action_url,
        action_text="View Delegation",
        action_text_ar="عرض التفويض",
    )
    context.update(
        {
            "subtitle": "Delegation details",
            "subtitle_ar": "تفاصيل التفويض",
            "from_user_name": from_user_name,
            "to_user_name": to_user_name,
            "start_at": start_at,
            "end_at": end_at,
            "reason": reason,
        }
    )
    subject = f"Delegation rule active: {from_user_name} -> {to_user_name}"
    return service.send_template_email(
        to_email=to_email,
        subject=subject,
        template_name="delegation_notification.html",
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
