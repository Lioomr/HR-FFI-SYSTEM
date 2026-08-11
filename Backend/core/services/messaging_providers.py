import logging
import re
import time
from typing import Any

import requests
from django.conf import settings

logger = logging.getLogger(__name__)


E164_PATTERN = re.compile(r"^\+[1-9]\d{7,14}$")


def normalize_phone_number(raw_phone: str | None) -> str:
    phone = (raw_phone or "").strip()
    if not phone:
        return ""
    cleaned = "".join(ch for ch in phone if ch.isdigit() or ch == "+")
    if not cleaned:
        return ""
    if cleaned.startswith("+"):
        return cleaned
    return f"+{cleaned}"


def is_e164(phone_number: str | None) -> bool:
    return bool(E164_PATTERN.fullmatch(phone_number or ""))


def mask_phone(phone_number: str | None) -> str:
    phone = phone_number or ""
    if len(phone) <= 6:
        return "***"
    return f"{phone[:3]}***{phone[-3:]}"


def render_template_message(template_name: str, template_variables: dict[str, Any]) -> str:
    renderer = EVOLUTION_TEMPLATE_RENDERERS.get(template_name)
    if renderer:
        return renderer(template_variables)

    title = template_name.replace("_", " ").strip().title() or "HR Notification"
    lines = [f"إشعار من نظام الموارد البشرية FFI - {title}", "", f"FFI HR - {title}"]
    for key, value in template_variables.items():
        label = key.replace("_", " ").strip().title()
        lines.append(f"{label}: {value or '-'}")
    return "\n".join(lines)


def _value(variables: dict[str, Any], key: str, fallback: str = "-") -> str:
    value = variables.get(key)
    text = str(value).strip() if value is not None else ""
    return text or fallback


def _optional_line(label: str, value: Any) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    return f"{label}: {text}"


def _compact_lines(*lines: str | None) -> str:
    return "\n".join(line for line in lines if line)


def _render_announcement(variables: dict[str, Any]) -> str:
    return _compact_lines(
        f"مرحباً {_value(variables, 'employee_name', 'there')},",
        "",
        "إعلان من نظام الموارد البشرية FFI",
        f"العنوان: {_value(variables, 'announcement_title')}",
        _optional_line("رابط المرفق", variables.get("attachment_url")),
        "",
        "يرجى فتح نظام الموارد البشرية للاطلاع على التفاصيل الكاملة.",
        "",
        f"Hello {_value(variables, 'employee_name', 'there')},",
        "",
        "FFI HR announcement",
        f"Title: {_value(variables, 'announcement_title')}",
        _optional_line("Attachment", variables.get("attachment_url")),
        "",
        "Please open the HR system for the full announcement details.",
    )


def _render_meeting(variables: dict[str, Any]) -> str:
    return _compact_lines(
        f"مرحباً {_value(variables, 'employee_name', 'there')},",
        "",
        "دعوة اجتماع من نظام الموارد البشرية FFI",
        f"العنوان: {_value(variables, 'meeting_title')}",
        f"التاريخ: {_value(variables, 'meeting_date')}",
        f"الوقت: {_value(variables, 'meeting_time')}",
        f"المنظم: {_value(variables, 'organizer_name')}",
        _optional_line("Google Meet", variables.get("google_meet_url")),
        _optional_line("Microsoft Teams", variables.get("microsoft_teams_url")),
        _optional_line("Zoom", variables.get("zoom_url")),
        "",
        "يرجى مراجعة نظام الموارد البشرية لمعرفة تفاصيل الاجتماع.",
        "",
        f"Hello {_value(variables, 'employee_name', 'there')},",
        "",
        "FFI HR meeting invitation",
        f"Title: {_value(variables, 'meeting_title')}",
        f"Date: {_value(variables, 'meeting_date')}",
        f"Time: {_value(variables, 'meeting_time')}",
        f"Organizer: {_value(variables, 'organizer_name')}",
        _optional_line("Google Meet", variables.get("google_meet_url")),
        _optional_line("Microsoft Teams", variables.get("microsoft_teams_url")),
        _optional_line("Zoom", variables.get("zoom_url")),
        "",
        "Please check the HR system for full meeting details.",
    )


def _render_document_expiry(variables: dict[str, Any]) -> str:
    return _compact_lines(
        f"مرحباً {_value(variables, 'employee_name', 'there')},",
        "",
        "تذكير بانتهاء مستند من نظام الموارد البشرية FFI",
        f"المستند: {_value(variables, 'document_type')}",
        f"تاريخ الانتهاء: {_value(variables, 'expiry_date')}",
        "",
        "يرجى تحديث أو تجديد هذا المستند في أقرب وقت.",
        "",
        f"Hello {_value(variables, 'employee_name', 'there')},",
        "",
        "FFI HR document expiry reminder",
        f"Document: {_value(variables, 'document_type')}",
        f"Expiry date: {_value(variables, 'expiry_date')}",
        "",
        "Please update or renew this document as soon as possible.",
    )


def _render_leave_submitted(variables: dict[str, Any]) -> str:
    return _compact_lines(
        f"مرحباً {_value(variables, 'manager_name', 'there')},",
        "",
        "طلب إجازة يحتاج إلى مراجعتك.",
        f"الموظف: {_value(variables, 'employee_name')}",
        f"نوع الإجازة: {_value(variables, 'leave_type')}",
        f"تاريخ البداية: {_value(variables, 'start_date')}",
        f"تاريخ النهاية: {_value(variables, 'end_date')}",
        f"عدد الأيام: {_value(variables, 'total_days')}",
        "",
        "يرجى مراجعته في نظام الموارد البشرية.",
        "",
        f"Hello {_value(variables, 'manager_name', 'there')},",
        "",
        "A leave request requires your review.",
        f"Employee: {_value(variables, 'employee_name')}",
        f"Leave type: {_value(variables, 'leave_type')}",
        f"Start date: {_value(variables, 'start_date')}",
        f"End date: {_value(variables, 'end_date')}",
        f"Total days: {_value(variables, 'total_days')}",
        "",
        "Please review it in the HR system.",
    )


def _render_leave_approved(variables: dict[str, Any]) -> str:
    return _compact_lines(
        f"مرحباً {_value(variables, 'employee_name', 'there')},",
        "",
        "تمت الموافقة على طلب الإجازة الخاص بك.",
        f"نوع الإجازة: {_value(variables, 'leave_type')}",
        f"تاريخ البداية: {_value(variables, 'start_date')}",
        f"تاريخ النهاية: {_value(variables, 'end_date')}",
        f"عدد الأيام: {_value(variables, 'total_days')}",
        "",
        "يرجى مراجعة نظام الموارد البشرية لمعرفة التفاصيل.",
        "",
        f"Hello {_value(variables, 'employee_name', 'there')},",
        "",
        "Your leave request has been approved.",
        f"Leave type: {_value(variables, 'leave_type')}",
        f"Start date: {_value(variables, 'start_date')}",
        f"End date: {_value(variables, 'end_date')}",
        f"Total days: {_value(variables, 'total_days')}",
        "",
        "Please check the HR system for details.",
    )


def _render_leave_rejected(variables: dict[str, Any]) -> str:
    return _compact_lines(
        f"مرحباً {_value(variables, 'employee_name', 'there')},",
        "",
        "تم رفض طلب الإجازة الخاص بك.",
        f"نوع الإجازة: {_value(variables, 'leave_type')}",
        f"تاريخ البداية: {_value(variables, 'start_date')}",
        f"تاريخ النهاية: {_value(variables, 'end_date')}",
        f"السبب: {_value(variables, 'rejection_reason', 'غير محدد')}",
        "",
        "يرجى مراجعة نظام الموارد البشرية لمعرفة التفاصيل.",
        "",
        f"Hello {_value(variables, 'employee_name', 'there')},",
        "",
        "Your leave request has been rejected.",
        f"Leave type: {_value(variables, 'leave_type')}",
        f"Start date: {_value(variables, 'start_date')}",
        f"End date: {_value(variables, 'end_date')}",
        f"Reason: {_value(variables, 'rejection_reason', 'Not specified')}",
        "",
        "Please check the HR system for details.",
    )


def _render_leave_delegation(variables: dict[str, Any]) -> str:
    return _compact_lines(
        f"مرحباً {_value(variables, 'delegate_name', 'there')},",
        "",
        "تم تعيينك كمفوّض لفترة إجازة.",
        f"الموظف: {_value(variables, 'employee_name')}",
        f"نوع الإجازة: {_value(variables, 'leave_type')}",
        f"تاريخ البداية: {_value(variables, 'start_date')}",
        f"تاريخ النهاية: {_value(variables, 'end_date')}",
        f"عدد الأيام: {_value(variables, 'total_days')}",
        "",
        "يرجى مراجعة نظام الموارد البشرية لمعرفة الإجراءات المفوضة.",
        "",
        f"Hello {_value(variables, 'delegate_name', 'there')},",
        "",
        "You have been assigned as leave delegate.",
        f"Employee: {_value(variables, 'employee_name')}",
        f"Leave type: {_value(variables, 'leave_type')}",
        f"Start date: {_value(variables, 'start_date')}",
        f"End date: {_value(variables, 'end_date')}",
        f"Total days: {_value(variables, 'total_days')}",
        "",
        "Please check the HR system for delegated actions.",
    )


def _render_pending_approval(variables: dict[str, Any]) -> str:
    details = variables.get("details") or []
    if isinstance(details, str):
        details = [details]
    detail_lines = [f"- {item}" for item in details if str(item or "").strip()]
    return _compact_lines(
        f"مرحباً {_value(variables, 'approver_name', 'there')},",
        "",
        "طلب يحتاج إلى مراجعتك.",
        f"نوع الطلب: {_value(variables, 'request_type')}",
        f"رقم الطلب: {_value(variables, 'request_id')}",
        f"مقدم الطلب: {_value(variables, 'requester_name')}",
        f"الحالة: {_value(variables, 'status_label')}",
        "التفاصيل:" if detail_lines else None,
        *detail_lines,
        _optional_line("رابط المراجعة", variables.get("action_url")),
        "",
        f"Hello {_value(variables, 'approver_name', 'there')},",
        "",
        "A request requires your review.",
        f"Request type: {_value(variables, 'request_type')}",
        f"Request ID: {_value(variables, 'request_id')}",
        f"Requested by: {_value(variables, 'requester_name')}",
        f"Status: {_value(variables, 'status_label')}",
        "Details:" if detail_lines else None,
        *detail_lines,
        _optional_line("Review link", variables.get("action_url")),
    )


def _render_request_status_update(variables: dict[str, Any]) -> str:
    details = variables.get("details") or []
    if isinstance(details, str):
        details = [details]
    detail_lines = [f"- {item}" for item in details if str(item or "").strip()]
    reason = _value(variables, "reason", "")
    return _compact_lines(
        f"مرحباً {_value(variables, 'employee_name', 'there')},",
        "",
        "تحديث حالة الطلب من نظام الموارد البشرية FFI",
        f"نوع الطلب: {_value(variables, 'request_type')}",
        f"رقم الطلب: {_value(variables, 'request_id')}",
        f"الحالة: {_value(variables, 'status_label')}",
        _optional_line("السبب", reason),
        "التفاصيل:" if detail_lines else None,
        *detail_lines,
        _optional_line("رابط المتابعة", variables.get("action_url")),
        "",
        f"Hello {_value(variables, 'employee_name', 'there')},",
        "",
        "FFI HR request status update",
        f"Request type: {_value(variables, 'request_type')}",
        f"Request ID: {_value(variables, 'request_id')}",
        f"Status: {_value(variables, 'status_label')}",
        _optional_line("Reason", reason),
        "Details:" if detail_lines else None,
        *detail_lines,
        _optional_line("Follow-up link", variables.get("action_url")),
    )


def _render_employee_invitation(variables: dict[str, Any]) -> str:
    inviter_name = _value(variables, "inviter_name", "")
    return _compact_lines(
        "دعوة للانضمام إلى نظام الموارد البشرية FFI",
        f"الدور: {_value(variables, 'role')}",
        f"رابط الدعوة: {_value(variables, 'invite_link')}",
        f"تنتهي الدعوة خلال: {_value(variables, 'expires_in_hours')} ساعة",
        _optional_line("أرسل الدعوة", inviter_name),
        "",
        "FFI HR system invitation",
        f"Role: {_value(variables, 'role')}",
        f"Invitation link: {_value(variables, 'invite_link')}",
        f"Expires in: {_value(variables, 'expires_in_hours')} hours",
        _optional_line("Invited by", inviter_name),
    )


def _render_whatsapp_provider_test(variables: dict[str, Any]) -> str:
    provider_name = _value(variables, "provider_name", "Evolution")
    return _compact_lines(
        "رسالة اختبار من نظام الموارد البشرية FFI",
        f"مزود واتساب: {provider_name}",
        "تم إرسال هذه الرسالة للتحقق من إعدادات واتساب فقط.",
        "",
        "FFI HR WhatsApp provider test",
        f"WhatsApp provider: {provider_name}",
        "This message was sent only to verify WhatsApp configuration.",
    )


EVOLUTION_TEMPLATE_RENDERERS = {
    "new_announcement_notification": _render_announcement,
    "meeting_notification": _render_meeting,
    "meeting_notification_v1": _render_meeting,
    "document_expiry_reminder": _render_document_expiry,
    "document_expiry_reminder_v1": _render_document_expiry,
    "hr_leave_notifications_manager": _render_leave_submitted,
    "leave_request_submitted_v1": _render_leave_submitted,
    "leave_request_approved": _render_leave_approved,
    "leave_request_approved_v1": _render_leave_approved,
    "leave_request_rejected": _render_leave_rejected,
    "leave_request_rejected_v1": _render_leave_rejected,
    "leave_delegation_assigned": _render_leave_delegation,
    "leave_delegation_assigned_v1": _render_leave_delegation,
    "pending_approval": _render_pending_approval,
    "request_status_update": _render_request_status_update,
    "employee_invitation": _render_employee_invitation,
    "whatsapp_provider_test": _render_whatsapp_provider_test,
}


def _log_delivery(
    *,
    provider: str,
    event: str,
    phone_number: str,
    success: bool,
    message_id: str | None,
    latency_ms: int,
    status_code: int | None = None,
    error: str | None = None,
) -> None:
    log_fn = logger.info if success else logger.warning
    log_fn(
        "messaging_provider_delivery",
        extra={
            "provider": provider,
            "event": event,
            "recipient": mask_phone(phone_number),
            "success": success,
            "message_id": message_id,
            "latency_ms": latency_ms,
            "status_code": status_code,
            "error": (error or "")[:300],
        },
    )


class EvolutionWhatsAppProvider:
    provider = "evolution_whatsapp"

    def __init__(
        self,
        *,
        api_base_url: str | None = None,
        api_key: str | None = None,
        instance_name: str | None = None,
        timeout_seconds: int | None = None,
    ) -> None:
        self.api_base_url = (api_base_url or getattr(settings, "EVOLUTION_API_BASE_URL", "")).rstrip("/")
        self.api_key = api_key if api_key is not None else getattr(settings, "EVOLUTION_API_KEY", "")
        self.instance_name = (
            instance_name if instance_name is not None else getattr(settings, "EVOLUTION_INSTANCE_NAME", "")
        )
        self.timeout_seconds = timeout_seconds or int(getattr(settings, "NOTIFICATION_HTTP_TIMEOUT_SECONDS", 10))

    def is_configured(self) -> bool:
        return bool(self.api_base_url and self.api_key and self.instance_name)

    def send_text(
        self,
        *,
        phone_number: str,
        text: str,
        event: str = "",
    ) -> dict[str, Any]:
        normalized_phone = normalize_phone_number(phone_number)
        started_at = time.monotonic()

        if not self.is_configured():
            return self._result(
                phone_number=normalized_phone,
                event=event,
                success=False,
                status_code=0,
                error="Evolution WhatsApp provider is not configured.",
                started_at=started_at,
            )

        if not is_e164(normalized_phone):
            return self._result(
                phone_number=normalized_phone,
                event=event,
                success=False,
                status_code=0,
                error="Phone number must be in E.164 format.",
                started_at=started_at,
            )

        endpoint = f"{self.api_base_url}/message/sendText/{self.instance_name}"
        payload = {"number": normalized_phone.lstrip("+"), "text": text}
        headers = {"apikey": self.api_key, "Content-Type": "application/json"}

        try:
            response = requests.post(endpoint, headers=headers, json=payload, timeout=self.timeout_seconds)
        except requests.RequestException as exc:
            return self._result(
                phone_number=normalized_phone,
                event=event,
                success=False,
                status_code=0,
                error=str(exc),
                started_at=started_at,
            )

        response_data = _safe_json(response)
        message_id = _extract_message_id(response_data)
        provider_status = _extract_message_status(response_data)
        if 200 <= response.status_code < 300:
            return self._result(
                phone_number=normalized_phone,
                event=event,
                success=True,
                status_code=response.status_code,
                message_id=message_id,
                provider_status=provider_status,
                started_at=started_at,
            )

        error = _extract_error(response_data, response.text)
        return self._result(
            phone_number=normalized_phone,
            event=event,
            success=False,
            status_code=response.status_code,
            error=error,
            started_at=started_at,
        )

    def send_document(
        self,
        *,
        phone_number: str,
        document_url: str,
        file_name: str,
        caption: str = "",
        event: str = "",
    ) -> dict[str, Any]:
        normalized_phone = normalize_phone_number(phone_number)
        started_at = time.monotonic()

        if not self.is_configured():
            return self._result(
                phone_number=normalized_phone,
                event=event,
                success=False,
                status_code=0,
                error="Evolution WhatsApp provider is not configured.",
                started_at=started_at,
            )

        if not is_e164(normalized_phone):
            return self._result(
                phone_number=normalized_phone,
                event=event,
                success=False,
                status_code=0,
                error="Phone number must be in E.164 format.",
                started_at=started_at,
            )

        media_url = str(document_url or "").strip()
        if not media_url:
            return self._result(
                phone_number=normalized_phone,
                event=event,
                success=False,
                status_code=0,
                error="Document URL is required.",
                started_at=started_at,
            )

        endpoint = f"{self.api_base_url}/message/sendMedia/{self.instance_name}"
        payload = {
            "number": normalized_phone.lstrip("+"),
            "mediatype": "document",
            "mimetype": "application/pdf",
            "caption": caption,
            "media": media_url,
            "fileName": file_name or "announcement.pdf",
        }
        headers = {"apikey": self.api_key, "Content-Type": "application/json"}

        try:
            response = requests.post(endpoint, headers=headers, json=payload, timeout=self.timeout_seconds)
        except requests.RequestException as exc:
            return self._result(
                phone_number=normalized_phone,
                event=event,
                success=False,
                status_code=0,
                error=str(exc),
                started_at=started_at,
            )

        response_data = _safe_json(response)
        message_id = _extract_message_id(response_data)
        provider_status = _extract_message_status(response_data)
        if 200 <= response.status_code < 300:
            return self._result(
                phone_number=normalized_phone,
                event=event,
                success=True,
                status_code=response.status_code,
                message_id=message_id,
                provider_status=provider_status,
                started_at=started_at,
            )

        error = _extract_error(response_data, response.text)
        return self._result(
            phone_number=normalized_phone,
            event=event,
            success=False,
            status_code=response.status_code,
            error=error,
            started_at=started_at,
        )

    def _result(
        self,
        *,
        phone_number: str,
        event: str,
        success: bool,
        status_code: int | None,
        started_at: float,
        message_id: str | None = None,
        provider_status: str | None = None,
        error: str | None = None,
    ) -> dict[str, Any]:
        latency_ms = int((time.monotonic() - started_at) * 1000)
        _log_delivery(
            provider=self.provider,
            event=event,
            phone_number=phone_number,
            success=success,
            message_id=message_id,
            latency_ms=latency_ms,
            status_code=status_code,
            error=error,
        )
        return {
            "success": success,
            "provider": self.provider,
            "status_code": status_code if status_code else None,
            "message_id": message_id,
            "provider_status": provider_status,
            "error": error,
        }


class TextBeeSmsProvider:
    provider = "textbee_sms"

    def __init__(
        self,
        *,
        api_base_url: str | None = None,
        api_key: str | None = None,
        device_id: str | None = None,
        timeout_seconds: int | None = None,
    ) -> None:
        self.api_base_url = (
            api_base_url or getattr(settings, "TEXTBEE_API_BASE_URL", "https://api.textbee.dev")
        ).rstrip("/")
        self.api_key = api_key if api_key is not None else getattr(settings, "TEXTBEE_API_KEY", "")
        self.device_id = device_id if device_id is not None else getattr(settings, "TEXTBEE_DEVICE_ID", "")
        self.timeout_seconds = timeout_seconds or int(getattr(settings, "NOTIFICATION_HTTP_TIMEOUT_SECONDS", 10))

    def is_configured(self) -> bool:
        return bool(self.api_base_url and self.api_key and self.device_id)

    def send_sms(self, *, phone_number: str, message: str, event: str = "") -> dict[str, Any]:
        normalized_phone = normalize_phone_number(phone_number)
        started_at = time.monotonic()

        if not self.is_configured():
            return self._result(
                phone_number=normalized_phone,
                event=event,
                success=False,
                status_code=0,
                error="TextBee SMS provider is not configured.",
                started_at=started_at,
            )

        if not is_e164(normalized_phone):
            return self._result(
                phone_number=normalized_phone,
                event=event,
                success=False,
                status_code=0,
                error="Phone number must be in E.164 format.",
                started_at=started_at,
            )

        endpoint = f"{self.api_base_url}/api/v1/gateway/devices/{self.device_id}/send-sms"
        payload = {"recipients": [normalized_phone], "message": message}
        headers = {"x-api-key": self.api_key, "Content-Type": "application/json"}

        try:
            response = requests.post(endpoint, headers=headers, json=payload, timeout=self.timeout_seconds)
        except requests.RequestException as exc:
            return self._result(
                phone_number=normalized_phone,
                event=event,
                success=False,
                status_code=0,
                error=str(exc),
                started_at=started_at,
            )

        response_data = _safe_json(response)
        message_id = _extract_message_id(response_data)
        if 200 <= response.status_code < 300:
            return self._result(
                phone_number=normalized_phone,
                event=event,
                success=True,
                status_code=response.status_code,
                message_id=message_id,
                started_at=started_at,
            )

        error = _extract_error(response_data, response.text)
        return self._result(
            phone_number=normalized_phone,
            event=event,
            success=False,
            status_code=response.status_code,
            error=error,
            started_at=started_at,
        )

    def _result(
        self,
        *,
        phone_number: str,
        event: str,
        success: bool,
        status_code: int | None,
        started_at: float,
        message_id: str | None = None,
        error: str | None = None,
    ) -> dict[str, Any]:
        latency_ms = int((time.monotonic() - started_at) * 1000)
        _log_delivery(
            provider=self.provider,
            event=event,
            phone_number=phone_number,
            success=success,
            message_id=message_id,
            latency_ms=latency_ms,
            status_code=status_code,
            error=error,
        )
        return {
            "success": success,
            "sent": success,
            "provider": self.provider,
            "status_code": status_code if status_code else None,
            "message_id": message_id,
            "error": error,
            "reason": error,
        }


def _safe_json(response: requests.Response) -> dict[str, Any]:
    try:
        data = response.json()
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {"data": data}


def _extract_message_id(data: dict[str, Any]) -> str | None:
    for key in ("id", "messageId", "message_id"):
        value = data.get(key)
        if value:
            return str(value)
    nested_key = data.get("key")
    if isinstance(nested_key, dict) and nested_key.get("id"):
        return str(nested_key["id"])
    return None


def _extract_message_status(data: dict[str, Any]) -> str | None:
    for key in ("provider_status", "messageStatus", "message_status", "deliveryStatus", "delivery_status", "status"):
        value = data.get(key)
        if value not in (None, ""):
            return str(value)
    for key in ("message", "data", "response"):
        nested = data.get(key)
        if isinstance(nested, dict):
            value = _extract_message_status(nested)
            if value:
                return value
    return None


def _extract_error(data: dict[str, Any], fallback_text: str) -> str:
    for key in ("message", "error", "detail"):
        value = data.get(key)
        if value:
            return str(value)[:500]
    response = data.get("response")
    if isinstance(response, dict) and response.get("message"):
        return str(response["message"])[:500]
    return (fallback_text or "Provider request failed.")[:500]
