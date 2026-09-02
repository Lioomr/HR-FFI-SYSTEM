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
        os.path.join(str(settings.BASE_DIR), "static", "email", "ffi-logo.png"),
        os.path.join(str(settings.BASE_DIR), "ffi-logo.png"),
        os.path.join(str(settings.BASE_DIR.parent), "ffi-logo.png"),
        "/app/static/email/ffi-logo.png",
        "/app/ffi-logo.png",
        os.path.join(str(settings.BASE_DIR.parent), "FrontEnd", "public", "ffi-logo.png"),
        os.path.join(str(settings.BASE_DIR.parent), "Logo FFI.png"),
        os.path.join(str(settings.BASE_DIR), "Logo FFI.png"),
        "/app/Logo FFI.png",
    ]
    # An EMAIL_LOGO_PATH is only usable if it actually exists (the Docker path
    # is meaningless on a local checkout); otherwise fall through to the defaults.
    candidate_paths = (
        [configured_logo_path, *default_candidates] if configured_logo_path else default_candidates
    )
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
    """Return the best available logo source for email clients.

    Priority:
      1. EMAIL_LOGO_URL (explicit hosted URL — most reliable).
      2. FRONTEND_URL/ffi-logo.png — the logo shipped in FrontEnd/public/,
         served at the site root in every non-local deployment. Gmail and
         Outlook render hosted images but strip base64, so this is preferred.
      3. Base64 inline data URI (local dev / offline fallback only).
    """
    _PLACEHOLDER_HOSTS = ("your-domain.com", "example.com", "example.org", "changeme")
    configured_logo_url = (getattr(settings, "EMAIL_LOGO_URL", "") or "").strip()
    if configured_logo_url and not any(host in configured_logo_url for host in _PLACEHOLDER_HOSTS):
        return configured_logo_url

    frontend = (getattr(settings, "FRONTEND_URL", "") or "").strip().rstrip("/")
    if frontend.startswith("https://") or (
        frontend.startswith("http://") and "localhost" not in frontend and "127.0.0.1" not in frontend
    ):
        return f"{frontend}/ffi-logo.png"

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
    preheader: str | None = None,
    preheader_ar: str | None = None,
    security_note: str | None = None,
    security_note_ar: str | None = None,
) -> dict[str, Any]:
    return {
        "logo_url": _resolve_logo_source(),
        "contact_email": getattr(settings, "EMAIL_CONTACT_EMAIL", "hr@fficontracting.com"),
        "contact_name": getattr(settings, "EMAIL_CONTACT_NAME", "") or "",
        "contact_phone": getattr(settings, "EMAIL_CONTACT_PHONE", "") or "",
        "title": title,
        "title_ar": title_ar,
        "employee_name": employee_name,
        "message": message,
        "message_ar": message_ar,
        # Inbox preview line; falls back to the message body in the template.
        "preheader": preheader or message,
        "preheader_ar": preheader_ar or message_ar,
        "security_note": security_note,
        "security_note_ar": security_note_ar,
        "action_url": action_url,
        "action_text": action_text or "View Details",
        "action_text_ar": action_text_ar or "عرض التفاصيل",
    }


_STATUS_COLORS = {
    "action": "#C2410C",
    "success": "#15803d",
    "danger": "#b42318",
    "info": "#1d4ed8",
    "invite": "#6d28d9",
    "neutral": "#6b7280",
}


def _row(
    label: str,
    label_ar: str,
    value: Any,
    value_ar: Any | None = None,
    value_color: str | None = None,
    value_html: str | None = None,
) -> dict[str, Any]:
    """Build one bilingual detail row for generic_notification.html.

    ``value`` / ``value_ar`` are always escaped. ``value_html`` is rendered raw
    and must only ever carry template-controlled markup (never user input).
    """
    row: dict[str, Any] = {"label": label, "label_ar": label_ar, "value": value}
    if value_ar is not None:
        row["value_ar"] = value_ar
    if value_color:
        row["value_color"] = value_color
    if value_html:
        row["value_html"] = value_html
    return row


def _details(
    rows: list[dict[str, Any]],
    *,
    status: str | None = None,
    status_ar: str | None = None,
    status_tone: str = "info",
    title: str = "Details",
    title_ar: str = "التفاصيل",
    next_steps_html: str | None = None,
    next_steps_html_ar: str | None = None,
) -> dict[str, Any]:
    """Extra context keys consumed by generic_notification.html."""
    return {
        "rows": rows,
        "status_label": status,
        "status_label_ar": status_ar or status,
        "status_color": _STATUS_COLORS.get(status_tone, "#1d4ed8"),
        "details_title": title,
        "details_title_ar": title_ar,
        "next_steps_html": next_steps_html,
        "next_steps_html_ar": next_steps_html_ar,
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
    rows = [
        _row("Leave type", "نوع الإجازة", leave_type),
        _row("Start date", "تاريخ البداية", start_date),
        _row("End date", "تاريخ النهاية", end_date),
        _row("Total days", "إجمالي الأيام", total_days),
    ]
    if manager_name:
        rows.append(_row("Approver", "المعتمد", manager_name))
    context.update(
        _details(
            rows,
            status="Pending review",
            status_ar="قيد المراجعة",
            status_tone="info",
            title="Leave request",
            title_ar="طلب الإجازة",
        )
    )
    return service.send_template_email(
        to_email=to_email,
        subject="Leave Request Submitted",
        template_name="generic_notification.html",
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
        _details(
            [
                _row("Leave type", "نوع الإجازة", leave_type),
                _row("Approved from", "بداية الإجازة المعتمدة", start_date),
                _row("Approved to", "نهاية الإجازة المعتمدة", end_date),
                _row("Total days", "إجمالي الأيام", total_days),
            ],
            status="Approved",
            status_ar="معتمد",
            status_tone="success",
            title="Approval details",
            title_ar="تفاصيل الموافقة",
        )
    )
    return service.send_template_email(
        to_email=to_email,
        subject="Leave Request Approved",
        template_name="generic_notification.html",
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
    rows = [
        _row("Leave type", "نوع الإجازة", leave_type),
        _row("Requested from", "بداية الإجازة المطلوبة", start_date),
        _row("Requested to", "نهاية الإجازة المطلوبة", end_date),
    ]
    if rejection_reason:
        rows.append(_row("Reason", "السبب", rejection_reason, value_color="#b42318"))
    context.update(
        _details(
            rows,
            status="Not approved",
            status_ar="غير معتمد",
            status_tone="danger",
            title="Request details",
            title_ar="تفاصيل الطلب",
            next_steps_html=(
                "<strong>Next step:</strong> you can adjust the dates and submit a new "
                "request, or contact HR if you have questions about this decision."
            ),
            next_steps_html_ar=(
                "<strong>الخطوة التالية:</strong> يمكنك تعديل التواريخ وتقديم طلب جديد، "
                "أو التواصل مع الموارد البشرية لأي استفسار بخصوص هذا القرار."
            ),
        )
    )
    return service.send_template_email(
        to_email=to_email,
        subject="Leave Request Rejected",
        template_name="generic_notification.html",
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
    rows = [
        _row("Document", "المستند", document_type),
        _row("Expiry date", "تاريخ الانتهاء", expiry_date, value_color="#b42318"),
    ]
    if days_remaining is not None:
        urgent = days_remaining <= 30
        rows.append(
            _row(
                "Days remaining",
                "الأيام المتبقية",
                f"{days_remaining} days",
                value_ar=f"{days_remaining} يوم",
                value_color="#b42318" if urgent else "#15803d",
            )
        )
    context.update(
        _details(
            rows,
            status="Action required",
            status_ar="إجراء مطلوب",
            status_tone="action",
            title="Document details",
            title_ar="تفاصيل المستند",
            next_steps_html=(
                "<strong>Next step:</strong> upload the renewed document from your "
                "profile page, or contact HR if you need assistance with the renewal."
            ),
            next_steps_html_ar=(
                "<strong>الخطوة التالية:</strong> ارفع المستند بعد تجديده من صفحة ملفك "
                "الشخصي، أو تواصل مع الموارد البشرية للمساعدة في إجراءات التجديد."
            ),
        )
    )
    return service.send_template_email(
        to_email=to_email,
        subject="Document Expiry Reminder",
        template_name="generic_notification.html",
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
    rows = [
        _row("Title", "العنوان", meeting_title),
        _row("Organizer", "المنظّم", organizer_name),
        _row("Date &amp; time", "التاريخ والوقت", f"{meeting_date} &middot; {meeting_time}"),
    ]
    if duration_minutes:
        rows.append(_row("Duration", "المدة", f"{duration_minutes} minutes", value_ar=f"{duration_minutes} دقيقة"))
    if location:
        rows.append(_row("Location", "المكان", location))
    if agenda:
        from django.utils.html import escape as _esc

        rows.append(
            _row("Agenda", "جدول الأعمال", agenda, value_html=_esc(str(agenda)).replace("\n", "<br>"))
        )

    def _join_links(align: str) -> str:
        links = []
        for url, name in (
            (google_meet_url, "Google Meet"),
            (microsoft_teams_url, "Microsoft Teams"),
            (zoom_url, "Zoom"),
        ):
            if url:
                links.append(
                    f'<a href="{url}" style="display:inline-block;margin:6px 8px 0 0;padding:9px 16px;'
                    f'border-radius:4px;background-color:#1c1f24;color:#ffffff;text-decoration:none;'
                    f'font-weight:600;font-size:13px;">Join {name}</a>'
                )
        return "".join(links) if links else ""

    join_html = _join_links("left")
    context.update(
        _details(
            rows,
            status="Meeting invitation",
            status_ar="دعوة اجتماع",
            status_tone="info",
            title="Meeting details",
            title_ar="تفاصيل الاجتماع",
            next_steps_html=join_html or None,
            next_steps_html_ar=join_html or None,
        )
    )
    return service.send_template_email(
        to_email=to_email,
        subject=f"Meeting Invitation: {meeting_title}",
        template_name="generic_notification.html",
        context=context,
    )


def send_user_invite_email(
    *,
    to_email: str,
    role: str,
    invite_link: str,
    expires_in_hours: int,
    inviter_name: str | None = None,
    invitee_name: str | None = None,
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

    greeting_name = (invitee_name or "").strip() or "Colleague / الزميل"
    context = _base_email_context(
        title=title,
        title_ar=title_ar,
        employee_name=greeting_name,
        message=message,
        message_ar=message_ar,
        action_url=invite_link,
        action_text=action_text,
        action_text_ar=action_text_ar,
        preheader=message,
        preheader_ar=message_ar,
    )
    rows = [_row("Assigned role", "الدور المُسند", role)]
    if inviter_name:
        rows.append(_row("Invited by", "بدعوة من", inviter_name))
    rows.append(
        _row("Invitation expires in", "تنتهي الدعوة خلال", f"{expires_in_hours} hours", value_ar=f"{expires_in_hours} ساعة")
    )
    context.update(
        _details(
            rows,
            status="Invitation Reminder" if is_reminder else "You're invited",
            status_ar="تذكير بالدعوة" if is_reminder else "دعوة",
            status_tone="invite",
            title="Invitation details",
            title_ar="تفاصيل الدعوة",
        )
    )
    return service.send_template_email(
        to_email=to_email,
        subject=subject,
        template_name="generic_notification.html",
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
        title = "You have been assigned as an alternative employee"
        title_ar = "تم تعيينك كموظف بديل لصلاحية الموافقة"
        message = f"{from_user_name} has assigned you as an alternative employee for the specified period."
        message_ar = "قام المستخدم الأصلي بإسناد مسؤوليات الموافقة إليك كموظف بديل خلال الفترة المحددة."
    else:
        title = "Your alternative employee option is active"
        title_ar = "تم تفعيل خيار الموظف البديل الخاص بك"
        message = f"Your approval responsibilities have been assigned to {to_user_name} for the specified period."
        message_ar = "تم إسناد مسؤوليات الموافقة الخاصة بك إلى الموظف البديل خلال الفترة المحددة."

    context = _base_email_context(
        title=title,
        title_ar=title_ar,
        employee_name=recipient_name,
        message=message,
        message_ar=message_ar,
        action_url=action_url,
        action_text="View Details",
        action_text_ar="عرض الموظف البديل",
    )
    context.update(
        _details(
            [
                _row("From", "من", from_user_name),
                _row("To", "إلى", to_user_name),
                _row("Start", "تاريخ البدء", start_at),
                _row("End", "تاريخ الانتهاء", end_at or "No end date", value_ar=end_at or "بدون تاريخ انتهاء"),
                _row("Reason", "السبب", reason or "Not provided", value_ar=reason or "غير محدد"),
            ],
            status="Deputy approver",
            status_ar="نائب المعتمد",
            status_tone="info",
            title="Delegation details",
            title_ar="تفاصيل التفويض",
        )
    )
    subject = f"Deputy approver active: {from_user_name} -> {to_user_name}"
    return service.send_template_email(
        to_email=to_email,
        subject=subject,
        template_name="generic_notification.html",
        context=context,
    )


def send_generic_notification_email(
    *,
    to_email: str,
    subject: str,
    title: str,
    title_ar: str,
    message: str,
    message_ar: str,
    employee_name: str = "Colleague / الزميل",
    rows: list[dict[str, Any]] | None = None,
    status: str | None = None,
    status_ar: str | None = None,
    status_tone: str = "info",
    details_title: str = "Details",
    details_title_ar: str = "التفاصيل",
    next_steps_html: str | None = None,
    next_steps_html_ar: str | None = None,
    action_url: str | None = None,
    action_text: str | None = None,
    action_text_ar: str | None = None,
    security_note: str | None = None,
    security_note_ar: str | None = None,
    attachments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Render any bilingual notification through generic_notification.html.

    Use this for events that don't have (and don't need) their own template —
    the dispatcher fallback and the job-offer notifications route through here.
    """
    context = _base_email_context(
        title=title,
        title_ar=title_ar,
        employee_name=employee_name,
        message=message,
        message_ar=message_ar,
        action_url=action_url,
        action_text=action_text,
        action_text_ar=action_text_ar,
        preheader=message,
        preheader_ar=message_ar,
        security_note=security_note,
        security_note_ar=security_note_ar,
    )
    context.update(
        _details(
            rows or [],
            status=status,
            status_ar=status_ar,
            status_tone=status_tone,
            title=details_title,
            title_ar=details_title_ar,
            next_steps_html=next_steps_html,
            next_steps_html_ar=next_steps_html_ar,
        )
    )
    return BirdEmailService().send_template_email(
        to_email=to_email,
        subject=subject,
        template_name="generic_notification.html",
        context=context,
        attachments=attachments,
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
