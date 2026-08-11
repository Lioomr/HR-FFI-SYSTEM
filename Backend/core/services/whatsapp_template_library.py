import re
from dataclasses import dataclass
from typing import Any

from django.db import DatabaseError

from core.models import WhatsAppMessageTemplate

from .messaging_providers import render_template_message

PLACEHOLDER_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}|\{([a-zA-Z0-9_]+)\}")


@dataclass(frozen=True)
class WhatsAppTemplateDefinition:
    key: str
    title: str
    description: str
    variables: tuple[str, ...]
    sample_variables: dict[str, Any]
    default_body: str


DEFAULT_WHATSAPP_TEMPLATES: dict[str, WhatsAppTemplateDefinition] = {
    "employee_invitation": WhatsAppTemplateDefinition(
        key="employee_invitation",
        title="Employee Invitation",
        description="Invitation link sent to new employees.",
        variables=("role", "invite_link", "expires_in_hours", "inviter_name"),
        sample_variables={
            "role": "Employee",
            "invite_link": "https://app.asecopro.com/register?token=sample",
            "expires_in_hours": "72",
            "inviter_name": "HR Manager",
        },
        default_body="""دعوة للانضمام إلى نظام الموارد البشرية FFI
الدور: {{ role }}
رابط الدعوة: {{ invite_link }}
تنتهي الدعوة خلال: {{ expires_in_hours }} ساعة
أرسل الدعوة: {{ inviter_name }}

FFI HR system invitation
Role: {{ role }}
Invitation link: {{ invite_link }}
Expires in: {{ expires_in_hours }} hours
Invited by: {{ inviter_name }}""",
    ),
    "new_announcement_notification": WhatsAppTemplateDefinition(
        key="new_announcement_notification",
        title="Announcement",
        description="General announcement notification, including optional attachment link.",
        variables=("employee_name", "announcement_title", "attachment_url"),
        sample_variables={
            "employee_name": "Sara",
            "announcement_title": "Policy Update",
            "attachment_url": "https://api.asecopro.com/api/announcements/1/attachment-public?token=sample",
        },
        default_body="""مرحباً {{ employee_name }},

إعلان من نظام الموارد البشرية FFI
العنوان: {{ announcement_title }}
رابط المرفق: {{ attachment_url }}

يرجى فتح نظام الموارد البشرية للاطلاع على التفاصيل الكاملة.

Hello {{ employee_name }},

FFI HR announcement
Title: {{ announcement_title }}
Attachment: {{ attachment_url }}

Please open the HR system for the full announcement details.""",
    ),
    "meeting_notification_v1": WhatsAppTemplateDefinition(
        key="meeting_notification_v1",
        title="Meeting Invitation",
        description="Meeting announcement with date, time, organizer, and optional links.",
        variables=(
            "employee_name",
            "meeting_title",
            "meeting_date",
            "meeting_time",
            "organizer_name",
            "google_meet_url",
            "microsoft_teams_url",
            "zoom_url",
        ),
        sample_variables={
            "employee_name": "Sara",
            "meeting_title": "Safety Briefing",
            "meeting_date": "2026-07-15",
            "meeting_time": "10:00 AM",
            "organizer_name": "HR",
            "google_meet_url": "",
            "microsoft_teams_url": "https://teams.example/meeting",
            "zoom_url": "",
        },
        default_body="""مرحباً {{ employee_name }},

دعوة اجتماع من نظام الموارد البشرية FFI
العنوان: {{ meeting_title }}
التاريخ: {{ meeting_date }}
الوقت: {{ meeting_time }}
المنظم: {{ organizer_name }}
Microsoft Teams: {{ microsoft_teams_url }}

يرجى مراجعة نظام الموارد البشرية لمعرفة تفاصيل الاجتماع.

Hello {{ employee_name }},

FFI HR meeting invitation
Title: {{ meeting_title }}
Date: {{ meeting_date }}
Time: {{ meeting_time }}
Organizer: {{ organizer_name }}
Microsoft Teams: {{ microsoft_teams_url }}

Please check the HR system for full meeting details.""",
    ),
    "pending_approval": WhatsAppTemplateDefinition(
        key="pending_approval",
        title="Pending Approval",
        description="Notification sent to the next approver.",
        variables=(
            "approver_name",
            "request_type",
            "request_id",
            "requester_name",
            "status_label",
            "details",
            "action_url",
        ),
        sample_variables={
            "approver_name": "Manager",
            "request_type": "Leave Request",
            "request_id": "LR-1042",
            "requester_name": "Sara",
            "status_label": "Pending Manager Approval",
            "details": ["Annual Leave", "2026-07-20 to 2026-07-24"],
            "action_url": "https://app.asecopro.com/pending-inbox",
        },
        default_body="""مرحباً {{ approver_name }},

طلب يحتاج إلى مراجعتك.
نوع الطلب: {{ request_type }}
رقم الطلب: {{ request_id }}
مقدم الطلب: {{ requester_name }}
الحالة: {{ status_label }}
التفاصيل:
{{ details }}
رابط المراجعة: {{ action_url }}

Hello {{ approver_name }},

A request requires your review.
Request type: {{ request_type }}
Request ID: {{ request_id }}
Requested by: {{ requester_name }}
Status: {{ status_label }}
Details:
{{ details }}
Review link: {{ action_url }}""",
    ),
    "request_status_update": WhatsAppTemplateDefinition(
        key="request_status_update",
        title="Request Status Update",
        description="Final status update sent to the employee.",
        variables=("employee_name", "request_type", "request_id", "status_label", "reason", "details", "action_url"),
        sample_variables={
            "employee_name": "Sara",
            "request_type": "Leave Request",
            "request_id": "LR-1042",
            "status_label": "Approved",
            "reason": "",
            "details": ["Approved by HR"],
            "action_url": "https://app.asecopro.com/employee/leave/requests/1042",
        },
        default_body="""مرحباً {{ employee_name }},

تحديث حالة الطلب من نظام الموارد البشرية FFI
نوع الطلب: {{ request_type }}
رقم الطلب: {{ request_id }}
الحالة: {{ status_label }}
السبب: {{ reason }}
التفاصيل:
{{ details }}
رابط المتابعة: {{ action_url }}

Hello {{ employee_name }},

FFI HR request status update
Request type: {{ request_type }}
Request ID: {{ request_id }}
Status: {{ status_label }}
Reason: {{ reason }}
Details:
{{ details }}
Follow-up link: {{ action_url }}""",
    ),
    "leave_request_submitted_v1": WhatsAppTemplateDefinition(
        key="leave_request_submitted_v1",
        title="Leave Submitted",
        description="Leave request submitted notification for managers.",
        variables=("manager_name", "employee_name", "leave_type", "start_date", "end_date", "total_days"),
        sample_variables={
            "manager_name": "Manager",
            "employee_name": "Sara",
            "leave_type": "Annual Leave",
            "start_date": "2026-07-20",
            "end_date": "2026-07-24",
            "total_days": "5",
        },
        default_body="""مرحباً {{ manager_name }},

طلب إجازة يحتاج إلى مراجعتك.
الموظف: {{ employee_name }}
نوع الإجازة: {{ leave_type }}
تاريخ البداية: {{ start_date }}
تاريخ النهاية: {{ end_date }}
عدد الأيام: {{ total_days }}

يرجى مراجعته في نظام الموارد البشرية.

Hello {{ manager_name }},

A leave request requires your review.
Employee: {{ employee_name }}
Leave type: {{ leave_type }}
Start date: {{ start_date }}
End date: {{ end_date }}
Total days: {{ total_days }}

Please review it in the HR system.""",
    ),
    "leave_request_approved_v1": WhatsAppTemplateDefinition(
        key="leave_request_approved_v1",
        title="Leave Approved",
        description="Approval notification sent to the employee.",
        variables=("employee_name", "leave_type", "start_date", "end_date", "total_days"),
        sample_variables={
            "employee_name": "Sara",
            "leave_type": "Annual Leave",
            "start_date": "2026-07-20",
            "end_date": "2026-07-24",
            "total_days": "5",
        },
        default_body="""مرحباً {{ employee_name }},

تمت الموافقة على طلب الإجازة الخاص بك.
نوع الإجازة: {{ leave_type }}
تاريخ البداية: {{ start_date }}
تاريخ النهاية: {{ end_date }}
عدد الأيام: {{ total_days }}

يرجى مراجعة نظام الموارد البشرية لمعرفة التفاصيل.

Hello {{ employee_name }},

Your leave request has been approved.
Leave type: {{ leave_type }}
Start date: {{ start_date }}
End date: {{ end_date }}
Total days: {{ total_days }}

Please check the HR system for details.""",
    ),
    "leave_request_rejected_v1": WhatsAppTemplateDefinition(
        key="leave_request_rejected_v1",
        title="Leave Rejected",
        description="Rejection notification sent to the employee.",
        variables=("employee_name", "leave_type", "start_date", "end_date", "rejection_reason"),
        sample_variables={
            "employee_name": "Sara",
            "leave_type": "Annual Leave",
            "start_date": "2026-07-20",
            "end_date": "2026-07-24",
            "rejection_reason": "Insufficient balance",
        },
        default_body="""مرحباً {{ employee_name }},

تم رفض طلب الإجازة الخاص بك.
نوع الإجازة: {{ leave_type }}
تاريخ البداية: {{ start_date }}
تاريخ النهاية: {{ end_date }}
السبب: {{ rejection_reason }}

يرجى مراجعة نظام الموارد البشرية لمعرفة التفاصيل.

Hello {{ employee_name }},

Your leave request has been rejected.
Leave type: {{ leave_type }}
Start date: {{ start_date }}
End date: {{ end_date }}
Reason: {{ rejection_reason }}

Please check the HR system for details.""",
    ),
    "leave_delegation_assigned_v1": WhatsAppTemplateDefinition(
        key="leave_delegation_assigned_v1",
        title="Leave Delegation Assigned",
        description="Notification sent to an assigned leave delegate.",
        variables=("delegate_name", "employee_name", "leave_type", "start_date", "end_date", "total_days"),
        sample_variables={
            "delegate_name": "Ahmed",
            "employee_name": "Sara",
            "leave_type": "Annual Leave",
            "start_date": "2026-07-20",
            "end_date": "2026-07-24",
            "total_days": "5",
        },
        default_body="""مرحباً {{ delegate_name }},

تم تعيينك كمفوّض لفترة إجازة.
الموظف: {{ employee_name }}
نوع الإجازة: {{ leave_type }}
تاريخ البداية: {{ start_date }}
تاريخ النهاية: {{ end_date }}
عدد الأيام: {{ total_days }}

يرجى مراجعة نظام الموارد البشرية لمعرفة الإجراءات المفوضة.

Hello {{ delegate_name }},

You have been assigned as leave delegate.
Employee: {{ employee_name }}
Leave type: {{ leave_type }}
Start date: {{ start_date }}
End date: {{ end_date }}
Total days: {{ total_days }}

Please check the HR system for delegated actions.""",
    ),
    "document_expiry_reminder": WhatsAppTemplateDefinition(
        key="document_expiry_reminder",
        title="Document Expiry Reminder",
        description="Reminder sent for expiring employee documents.",
        variables=("employee_name", "document_type", "expiry_date"),
        sample_variables={"employee_name": "Sara", "document_type": "Passport", "expiry_date": "2026-07-31"},
        default_body="""مرحباً {{ employee_name }},

تذكير بانتهاء مستند من نظام الموارد البشرية FFI
المستند: {{ document_type }}
تاريخ الانتهاء: {{ expiry_date }}

يرجى تحديث أو تجديد هذا المستند في أقرب وقت.

Hello {{ employee_name }},

FFI HR document expiry reminder
Document: {{ document_type }}
Expiry date: {{ expiry_date }}

Please update or renew this document as soon as possible.""",
    ),
    "whatsapp_provider_test": WhatsAppTemplateDefinition(
        key="whatsapp_provider_test",
        title="WhatsApp Provider Test",
        description="Short test message used to verify Evolution configuration.",
        variables=("provider_name",),
        sample_variables={"provider_name": "Evolution"},
        default_body="""رسالة اختبار من نظام الموارد البشرية FFI
مزود واتساب: {{ provider_name }}
تم إرسال هذه الرسالة للتحقق من إعدادات واتساب فقط.

FFI HR WhatsApp provider test
WhatsApp provider: {{ provider_name }}
This message was sent only to verify WhatsApp configuration.""",
    ),
}


def list_template_definitions() -> list[WhatsAppTemplateDefinition]:
    ordered_keys = [
        "employee_invitation",
        "new_announcement_notification",
        "meeting_notification_v1",
        "pending_approval",
        "request_status_update",
        "leave_request_submitted_v1",
        "leave_request_approved_v1",
        "leave_request_rejected_v1",
        "leave_delegation_assigned_v1",
        "document_expiry_reminder",
        "whatsapp_provider_test",
    ]
    return [DEFAULT_WHATSAPP_TEMPLATES[key] for key in ordered_keys if key in DEFAULT_WHATSAPP_TEMPLATES]


def get_template_definition(key: str) -> WhatsAppTemplateDefinition | None:
    return DEFAULT_WHATSAPP_TEMPLATES.get(key)


def render_body_template(body: str, variables: dict[str, Any]) -> str:
    def replace(match: re.Match) -> str:
        name = match.group(1) or match.group(2) or ""
        value = variables.get(name, "")
        if isinstance(value, (list, tuple)):
            return "\n".join(f"- {item}" for item in value if str(item or "").strip())
        return str(value or "")

    return PLACEHOLDER_RE.sub(replace, body)


def get_custom_template_body(key: str) -> str | None:
    try:
        template = WhatsAppMessageTemplate.objects.filter(key=key).only("body").first()
    except DatabaseError:
        return None
    return template.body if template else None


def render_configured_template_message(template_name: str, variables: dict[str, Any]) -> str:
    body = get_custom_template_body(template_name)
    if body:
        return render_body_template(body, variables)

    definition = get_template_definition(template_name)
    if definition:
        return render_body_template(definition.default_body, variables)

    return render_template_message(template_name, variables)


def ensure_known_template_key(key: str) -> bool:
    return key in DEFAULT_WHATSAPP_TEMPLATES
