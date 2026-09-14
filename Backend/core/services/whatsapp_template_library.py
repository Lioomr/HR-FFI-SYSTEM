import re
from dataclasses import dataclass
from typing import Any

from django.conf import settings
from django.db import DatabaseError

from core.models import WhatsAppMessageTemplate

PLACEHOLDER_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}|\{([a-zA-Z0-9_]+)\}")
_EXTRA_BLANK_LINES_RE = re.compile(r"\n{3,}")

DIVIDER = "━━━━━━━━━━━━"
SIGNATURE = "_FFI HR · الموارد البشرية_"
# WhatsApp truncates or rejects longer media captions; longer text is sent as its own message.
CAPTION_MAX_CHARS = 1024


@dataclass(frozen=True)
class WhatsAppTemplateDefinition:
    key: str
    title: str
    description: str
    variables: tuple[str, ...]
    sample_variables: dict[str, Any]
    default_body: str


_LEAVE_SAMPLE = {
    "leave_type": "Annual Leave",
    "start_date": "2026-07-20",
    "end_date": "2026-07-24",
    "total_days": "5",
}

_ANNOUNCEMENT_BODY = """📢 *إعلان جديد*
*New announcement*

*{{ announcement_title }}*

{{ announcement_message }}

_FFI HR · الموارد البشرية_"""

DEFAULT_WHATSAPP_TEMPLATES: dict[str, WhatsAppTemplateDefinition] = {
    "job_offer": WhatsAppTemplateDefinition(
        key="job_offer",
        title="Job Offer",
        description="Secure job offer response link sent to a candidate. The offer PDF follows as a document.",
        variables=("candidate_name", "position_title", "reference_number", "expiry_date", "response_link"),
        sample_variables={
            "candidate_name": "Ahmed",
            "position_title": "Engineer",
            "reference_number": "JO-2026-001",
            "expiry_date": "2026-08-31",
            "response_link": "https://app.asecopro.com/job-offers/respond?token=sample",
        },
        default_body="""💼 *عرض عمل من FFI*

مرحباً {{ candidate_name }}،
يسعدنا أن نقدّم لك عرض عمل، ونتطلع إلى انضمامك إلى فريقنا. يمكنك قبول العرض أو رفضه من الرابط أدناه.

• *المسمى الوظيفي:* {{ position_title }}
• *الرقم المرجعي:* {{ reference_number }}
• *آخر موعد للرد:* {{ expiry_date }}

━━━━━━━━━━━━

💼 *Job offer from FFI*

Hi {{ candidate_name }},
We're pleased to offer you a position and look forward to welcoming you to the team. You can accept or decline the offer using the link below.

• *Position:* {{ position_title }}
• *Reference:* {{ reference_number }}
• *Respond by:* {{ expiry_date }}

🔗 {{ response_link }}

_FFI HR · الموارد البشرية_""",
    ),
    "employee_invitation": WhatsAppTemplateDefinition(
        key="employee_invitation",
        title="Employee Invitation",
        description="Invitation link sent to new employees.",
        variables=("role", "role_ar", "invite_link", "expires_in_hours", "inviter_name"),
        sample_variables={
            "role": "Employee",
            "role_ar": "موظف",
            "invite_link": "https://app.asecopro.com/register?token=sample",
            "expires_in_hours": "72",
            "inviter_name": "HR Manager",
        },
        default_body="""👋 *دعوة للانضمام إلى نظام الموارد البشرية FFI*

تمت دعوتك لإنشاء حسابك. افتح الرابط أدناه لإكمال التسجيل.

• *الدور:* {{ role_ar }}
• *الدعوة من:* {{ inviter_name }}
• *صالحة لمدة:* {{ expires_in_hours }} ساعة

━━━━━━━━━━━━

👋 *You're invited to the FFI HR System*

You've been invited to create your account. Open the link below to finish signing up.

• *Role:* {{ role }}
• *Invited by:* {{ inviter_name }}
• *Link valid for:* {{ expires_in_hours }} hours

🔗 {{ invite_link }}

_FFI HR · الموارد البشرية_""",
    ),
    "new_announcement_notification": WhatsAppTemplateDefinition(
        key="new_announcement_notification",
        title="Announcement (legacy)",
        description="Legacy announcement key retained for compatibility; attachments are sent directly as WhatsApp documents.",
        variables=("employee_name", "announcement_title", "announcement_message"),
        sample_variables={
            "employee_name": "Sara",
            "announcement_title": "Policy Update",
            "announcement_message": "Please review the updated attendance policy.",
        },
        default_body=_ANNOUNCEMENT_BODY,
    ),
    "announcement_notification_v2": WhatsAppTemplateDefinition(
        key="announcement_notification_v2",
        title="Announcement",
        description="Announcement text. An attached PDF is delivered as a WhatsApp document with this text as its caption.",
        variables=("employee_name", "announcement_title", "announcement_message"),
        sample_variables={
            "employee_name": "Sara",
            "announcement_title": "Policy Update",
            "announcement_message": "Please review the updated attendance policy.",
        },
        default_body=_ANNOUNCEMENT_BODY,
    ),
    "meeting_notification_v1": WhatsAppTemplateDefinition(
        key="meeting_notification_v1",
        title="Meeting Invitation",
        description="Meeting invitation with date, time, location, organizer, and optional online meeting links.",
        variables=(
            "employee_name",
            "meeting_title",
            "meeting_message",
            "meeting_date",
            "meeting_time",
            "meeting_location",
            "meeting_agenda",
            "organizer_name",
            "google_meet_url",
            "microsoft_teams_url",
            "zoom_url",
        ),
        sample_variables={
            "employee_name": "Sara",
            "meeting_title": "Safety Briefing",
            "meeting_message": "Quarterly safety review for all site staff.",
            "meeting_date": "2026-07-15",
            "meeting_time": "10:00 AM",
            "meeting_location": "Main meeting room",
            "meeting_agenda": "",
            "organizer_name": "HR",
            "google_meet_url": "",
            "microsoft_teams_url": "https://teams.example/meeting",
            "zoom_url": "",
        },
        default_body="""📅 *دعوة لاجتماع*
*Meeting invitation*

*{{ meeting_title }}*
{{ meeting_message }}

🗓️ {{ meeting_date }}
⏰ {{ meeting_time }}
📍 {{ meeting_location }}
👤 {{ organizer_name }}
📝 {{ meeting_agenda }}

🔗 Google Meet: {{ google_meet_url }}
🔗 Microsoft Teams: {{ microsoft_teams_url }}
🔗 Zoom: {{ zoom_url }}

_FFI HR · الموارد البشرية_""",
    ),
    "pending_approval": WhatsAppTemplateDefinition(
        key="pending_approval",
        title="Pending Approval",
        description="Notification sent to the next approver.",
        variables=(
            "approver_name",
            "request_type",
            "request_type_ar",
            "request_id",
            "requester_name",
            "status_label",
            "status_label_ar",
            "details",
            "action_url",
        ),
        sample_variables={
            "approver_name": "Manager",
            "request_type": "Leave Request",
            "request_type_ar": "طلب إجازة",
            "request_id": "1042",
            "requester_name": "Sara",
            "status_label": "Pending Manager Approval",
            "status_label_ar": "بانتظار موافقة المدير المباشر",
            "details": ["Annual Leave", "2026-07-20 to 2026-07-24"],
            "action_url": "https://app.asecopro.com/pending-inbox",
        },
        default_body="""📝 *طلب بانتظار مراجعتك*

مرحباً {{ approver_name }}،
{{ request_type_ar }} من {{ requester_name }} بانتظار إجراء منك.

• *رقم الطلب:* {{ request_id }}
• *الحالة:* {{ status_label_ar }}

━━━━━━━━━━━━

📝 *Request awaiting your review*

Hi {{ approver_name }},
{{ request_type }} from {{ requester_name }} is waiting for your action.

• *Request ID:* {{ request_id }}
• *Status:* {{ status_label }}
{{ details }}

🔗 {{ action_url }}

_FFI HR · الموارد البشرية_""",
    ),
    "request_status_update": WhatsAppTemplateDefinition(
        key="request_status_update",
        title="Request Status Update",
        description="Status update sent to the employee who submitted the request.",
        variables=(
            "employee_name",
            "request_type",
            "request_type_ar",
            "request_id",
            "status_label",
            "status_label_ar",
            "status_icon",
            "reason",
            "details",
            "action_url",
        ),
        sample_variables={
            "employee_name": "Sara",
            "request_type": "Leave Request",
            "request_type_ar": "طلب إجازة",
            "request_id": "1042",
            "status_label": "Approved",
            "status_label_ar": "معتمد",
            "status_icon": "✅",
            "reason": "",
            "details": ["Approved by HR"],
            "action_url": "https://app.asecopro.com/employee/leave/requests/1042",
        },
        default_body="""{{ status_icon }} *تحديث حالة {{ request_type_ar }}*

مرحباً {{ employee_name }}،
أصبحت حالة طلبك: *{{ status_label_ar }}*

• *رقم الطلب:* {{ request_id }}
• *السبب:* {{ reason }}

━━━━━━━━━━━━

{{ status_icon }} *{{ request_type }} update*

Hi {{ employee_name }},
Your request is now *{{ status_label }}*.

• *Request ID:* {{ request_id }}
• *Reason:* {{ reason }}
{{ details }}

🔗 {{ action_url }}

_FFI HR · الموارد البشرية_""",
    ),
    "leave_request_submitted_v1": WhatsAppTemplateDefinition(
        key="leave_request_submitted_v1",
        title="Leave Submitted (Manager)",
        description="Sent to the direct manager when an employee submits a leave request.",
        variables=("manager_name", "employee_name", "leave_type", "start_date", "end_date", "total_days", "action_url"),
        sample_variables={
            "manager_name": "Omar",
            "employee_name": "Sara",
            **_LEAVE_SAMPLE,
            "action_url": "https://app.asecopro.com/manager/leave/requests/1042",
        },
        default_body="""📝 *طلب إجازة بانتظار موافقتك*

مرحباً {{ manager_name }}،
وصلك طلب إجازة من {{ employee_name }} ويحتاج إلى مراجعتك.

• *نوع الإجازة:* {{ leave_type }}
• *من:* {{ start_date }}
• *إلى:* {{ end_date }}
• *عدد الأيام:* {{ total_days }}

━━━━━━━━━━━━

📝 *Leave request awaiting your approval*

Hi {{ manager_name }},
{{ employee_name }} has requested leave and it requires your review.

• *Leave type:* {{ leave_type }}
• *From:* {{ start_date }}
• *To:* {{ end_date }}
• *Days:* {{ total_days }}

🔗 {{ action_url }}

_FFI HR · الموارد البشرية_""",
    ),
    "leave_request_received_v1": WhatsAppTemplateDefinition(
        key="leave_request_received_v1",
        title="Leave Submitted (Employee)",
        description="Confirmation sent to the employee after submitting a leave request.",
        variables=("employee_name", "leave_type", "start_date", "end_date", "total_days", "action_url"),
        sample_variables={
            "employee_name": "Sara",
            **_LEAVE_SAMPLE,
            "action_url": "https://app.asecopro.com/employee/leave/requests",
        },
        default_body="""📨 *تم استلام طلب إجازتك*

مرحباً {{ employee_name }}،
استلمنا طلب إجازتك وأُرسل للمراجعة، وسنبلغك فور اتخاذ القرار.

• *نوع الإجازة:* {{ leave_type }}
• *من:* {{ start_date }}
• *إلى:* {{ end_date }}
• *عدد الأيام:* {{ total_days }}

━━━━━━━━━━━━

📨 *Leave request received*

Hi {{ employee_name }},
We've received your leave request and sent it for review. We'll let you know as soon as a decision is made.

• *Leave type:* {{ leave_type }}
• *From:* {{ start_date }}
• *To:* {{ end_date }}
• *Days:* {{ total_days }}

🔗 {{ action_url }}

_FFI HR · الموارد البشرية_""",
    ),
    "leave_request_approved_v1": WhatsAppTemplateDefinition(
        key="leave_request_approved_v1",
        title="Leave Approved",
        description="Approval notification sent to the employee.",
        variables=("employee_name", "leave_type", "start_date", "end_date", "total_days", "action_url"),
        sample_variables={"employee_name": "Sara", **_LEAVE_SAMPLE, "action_url": ""},
        default_body="""✅ *تمت الموافقة على إجازتك*

مرحباً {{ employee_name }}،
يسعدنا إبلاغك بأنه تمت الموافقة على طلب إجازتك.

• *نوع الإجازة:* {{ leave_type }}
• *من:* {{ start_date }}
• *إلى:* {{ end_date }}
• *عدد الأيام:* {{ total_days }}

━━━━━━━━━━━━

✅ *Your leave is approved*

Hi {{ employee_name }},
Good news — your leave request has been approved.

• *Leave type:* {{ leave_type }}
• *From:* {{ start_date }}
• *To:* {{ end_date }}
• *Days:* {{ total_days }}

🔗 {{ action_url }}

_FFI HR · الموارد البشرية_""",
    ),
    "leave_request_rejected_v1": WhatsAppTemplateDefinition(
        key="leave_request_rejected_v1",
        title="Leave Rejected",
        description="Rejection notification sent to the employee.",
        variables=("employee_name", "leave_type", "start_date", "end_date", "rejection_reason", "action_url"),
        sample_variables={
            "employee_name": "Sara",
            "leave_type": "Annual Leave",
            "start_date": "2026-07-20",
            "end_date": "2026-07-24",
            "rejection_reason": "Insufficient balance",
            "action_url": "",
        },
        default_body="""❌ *لم تتم الموافقة على إجازتك*

مرحباً {{ employee_name }}،
نأسف لإبلاغك بأنه تم رفض طلب إجازتك. للاستفسار يُرجى التواصل مع مديرك أو الموارد البشرية.

• *نوع الإجازة:* {{ leave_type }}
• *من:* {{ start_date }}
• *إلى:* {{ end_date }}
• *السبب:* {{ rejection_reason }}

━━━━━━━━━━━━

❌ *Your leave was not approved*

Hi {{ employee_name }},
Unfortunately, your leave request has been rejected. If you have questions, please contact your manager or HR.

• *Leave type:* {{ leave_type }}
• *From:* {{ start_date }}
• *To:* {{ end_date }}
• *Reason:* {{ rejection_reason }}

🔗 {{ action_url }}

_FFI HR · الموارد البشرية_""",
    ),
    "leave_delegation_assigned_v1": WhatsAppTemplateDefinition(
        key="leave_delegation_assigned_v1",
        title="Leave Delegation Assigned",
        description="Notification sent to an assigned leave delegate.",
        variables=(
            "delegate_name",
            "employee_name",
            "leave_type",
            "start_date",
            "end_date",
            "total_days",
            "action_url",
        ),
        sample_variables={"delegate_name": "Ahmed", "employee_name": "Sara", **_LEAVE_SAMPLE, "action_url": ""},
        default_body="""🤝 *تم تعيينك مفوّضاً*

مرحباً {{ delegate_name }}،
تم تعيينك مفوّضاً عن {{ employee_name }} خلال فترة الإجازة.

• *نوع الإجازة:* {{ leave_type }}
• *من:* {{ start_date }}
• *إلى:* {{ end_date }}
• *عدد الأيام:* {{ total_days }}

━━━━━━━━━━━━

🤝 *You've been assigned as a delegate*

Hi {{ delegate_name }},
You'll be covering for {{ employee_name }} during their leave.

• *Leave type:* {{ leave_type }}
• *From:* {{ start_date }}
• *To:* {{ end_date }}
• *Days:* {{ total_days }}

🔗 {{ action_url }}

_FFI HR · الموارد البشرية_""",
    ),
    "document_expiry_reminder": WhatsAppTemplateDefinition(
        key="document_expiry_reminder",
        title="Document Expiry Reminder",
        description="Reminder sent to an employee whose document is about to expire.",
        variables=("employee_name", "document_type", "expiry_date", "action_url"),
        sample_variables={
            "employee_name": "Sara",
            "document_type": "Passport",
            "expiry_date": "31-07-2026",
            "action_url": "https://app.asecopro.com/employee/profile",
        },
        default_body="""⏰ *تذكير بتجديد مستند*

مرحباً {{ employee_name }}،
يقترب موعد انتهاء أحد مستنداتك، يُرجى تجديده في أقرب وقت.

• *المستند:* {{ document_type }}
• *تاريخ الانتهاء:* {{ expiry_date }}

━━━━━━━━━━━━

⏰ *Document renewal reminder*

Hi {{ employee_name }},
One of your documents is about to expire. Please renew it as soon as possible.

• *Document:* {{ document_type }}
• *Expiry date:* {{ expiry_date }}

🔗 {{ action_url }}

_FFI HR · الموارد البشرية_""",
    ),
    "work_license_expiry_hr_v1": WhatsAppTemplateDefinition(
        key="work_license_expiry_hr_v1",
        title="Work License Expiry (HR)",
        description="Reminder sent to HR when an employee's work license is about to expire.",
        variables=("recipient_name", "employee_name", "employee_name_ar", "employee_id", "expiry_date", "action_url"),
        sample_variables={
            "recipient_name": "HR Manager",
            "employee_name": "Sara Ali",
            "employee_name_ar": "سارة علي",
            "employee_id": "EMP-1042",
            "expiry_date": "31-07-2026",
            "action_url": "https://app.asecopro.com/hr/employees/expiries",
        },
        default_body="""⏰ *رخصة عمل على وشك الانتهاء*

مرحباً {{ recipient_name }}،
تقترب رخصة عمل {{ employee_name_ar }} من الانتهاء، يُرجى متابعة التجديد.

• *الرقم الوظيفي:* {{ employee_id }}
• *تاريخ الانتهاء:* {{ expiry_date }}

━━━━━━━━━━━━

⏰ *Work license expiring soon*

Hi {{ recipient_name }},
{{ employee_name }}'s work license is about to expire. Please follow up on the renewal.

• *Employee ID:* {{ employee_id }}
• *Expiry date:* {{ expiry_date }}

🔗 {{ action_url }}

_FFI HR · الموارد البشرية_""",
    ),
    "starting_work_acknowledgment_v1": WhatsAppTemplateDefinition(
        key="starting_work_acknowledgment_v1",
        title="Starting Work Verification (HR)",
        description="Sent to HR with the Starting Work Acknowledgment PDF attached as a WhatsApp document.",
        variables=(
            "recipient_name",
            "employee_name",
            "employee_name_ar",
            "employee_id",
            "start_date",
            "reference_number",
            "action_url",
        ),
        sample_variables={
            "recipient_name": "HR Manager",
            "employee_name": "Sara Ali",
            "employee_name_ar": "سارة علي",
            "employee_id": "EMP-1042",
            "start_date": "2026-07-01",
            "reference_number": "SWA-2026-001",
            "action_url": "https://app.asecopro.com/hr/starting-work-acknowledgments/1",
        },
        default_body="""🧾 *إثبات مباشرة عمل بانتظار التحقق*

مرحباً {{ recipient_name }}،
إثبات مباشرة العمل لـ {{ employee_name_ar }} بانتظار التحقق عبر BioTime.

• *الرقم الوظيفي:* {{ employee_id }}
• *تاريخ المباشرة:* {{ start_date }}
• *الرقم المرجعي:* {{ reference_number }}

━━━━━━━━━━━━

🧾 *Starting work acknowledgment to verify*

Hi {{ recipient_name }},
The starting work acknowledgment for {{ employee_name }} is waiting for BioTime verification.

• *Employee ID:* {{ employee_id }}
• *Start date:* {{ start_date }}
• *Reference:* {{ reference_number }}

🔗 {{ action_url }}

_FFI HR · الموارد البشرية_""",
    ),
    "late_attendance_notice_v1": WhatsAppTemplateDefinition(
        key="late_attendance_notice_v1",
        title="Late Attendance Notice (Employee)",
        description="Sent to the employee with their private late-attendance notice PDF attached as a WhatsApp document.",
        variables=(
            "employee_name",
            "notice_level",
            "notice_level_ar",
            "violation_date",
            "occurrence_number",
            "reference_number",
            "policy_result",
            "policy_result_ar",
            "action_url",
        ),
        sample_variables={
            "employee_name": "Sara Ali",
            "notice_level": "Formal Caution",
            "notice_level_ar": "تنبيه رسمي",
            "violation_date": "2026-09-14",
            "occurrence_number": "2",
            "reference_number": "LAN-FFI-000041",
            "policy_result": "Formal caution - 5% daily-rate deduction.",
            "policy_result_ar": "تنبيه رسمي - خصم بنسبة ٥٪ من الأجر اليومي.",
            "action_url": "https://app.asecopro.com/employee/attendance",
        },
        default_body="""⚠️ *إنذار التأخر في الحضور*

مرحباً {{ employee_name }}،
صدر لك إنذار تأخر في الحضور. نسختك الخاصة من الإنذار بصيغة PDF مرفقة بهذه الرسالة.

• *نوع الإنذار:* {{ notice_level_ar }}
• *تاريخ المخالفة:* {{ violation_date }}
• *رقم التكرار:* {{ occurrence_number }}
• *الرقم المرجعي:* {{ reference_number }}
• *نتيجة السياسة:* {{ policy_result_ar }}

━━━━━━━━━━━━

⚠️ *Late attendance notice*

Hi {{ employee_name }},
A late attendance notice has been issued to you. Your private PDF copy of the notice is attached to this message.

• *Notice type:* {{ notice_level }}
• *Violation date:* {{ violation_date }}
• *Occurrence:* {{ occurrence_number }}
• *Reference:* {{ reference_number }}
• *Policy result:* {{ policy_result }}

🔗 {{ action_url }}

_FFI HR · الموارد البشرية_""",
    ),
    "whatsapp_provider_test": WhatsAppTemplateDefinition(
        key="whatsapp_provider_test",
        title="WhatsApp Provider Test",
        description="Short test message used to verify the WhatsApp configuration.",
        variables=("provider_name",),
        sample_variables={"provider_name": "Evolution"},
        default_body="""✅ *اختبار واتساب ناجح*

وصلتك هذه الرسالة لأن إعدادات واتساب في نظام الموارد البشرية تعمل بشكل صحيح.
• *مزود واتساب:* {{ provider_name }}

━━━━━━━━━━━━

✅ *WhatsApp test successful*

You're receiving this because WhatsApp is configured correctly in the HR system.
• *WhatsApp provider:* {{ provider_name }}

_FFI HR · الموارد البشرية_""",
    ),
}

# Older keys still found in queued payloads and code paths.
TEMPLATE_ALIASES: dict[str, str] = {
    "meeting_notification": "meeting_notification_v1",
    "document_expiry_reminder_v1": "document_expiry_reminder",
    "hr_leave_notifications_manager": "leave_request_submitted_v1",
    "leave_request_approved": "leave_request_approved_v1",
    "leave_request_rejected": "leave_request_rejected_v1",
    "leave_delegation_assigned": "leave_delegation_assigned_v1",
}


def list_template_definitions() -> list[WhatsAppTemplateDefinition]:
    ordered_keys = [
        "job_offer",
        "employee_invitation",
        "announcement_notification_v2",
        "new_announcement_notification",
        "meeting_notification_v1",
        "pending_approval",
        "request_status_update",
        "leave_request_submitted_v1",
        "leave_request_received_v1",
        "leave_request_approved_v1",
        "leave_request_rejected_v1",
        "leave_delegation_assigned_v1",
        "document_expiry_reminder",
        "work_license_expiry_hr_v1",
        "starting_work_acknowledgment_v1",
        "late_attendance_notice_v1",
        "whatsapp_provider_test",
    ]
    return [DEFAULT_WHATSAPP_TEMPLATES[key] for key in ordered_keys if key in DEFAULT_WHATSAPP_TEMPLATES]


def canonical_template_key(key: str) -> str:
    return TEMPLATE_ALIASES.get(key, key)


def get_template_definition(key: str) -> WhatsAppTemplateDefinition | None:
    return DEFAULT_WHATSAPP_TEMPLATES.get(canonical_template_key(key))


def absolute_app_url(value: Any) -> str:
    """Resolve application paths against the frontend; a bare path is useless in WhatsApp."""
    text = str(value or "").strip()
    if text.startswith("/") and not text.startswith("//"):
        base_url = (getattr(settings, "FRONTEND_URL", "") or "").rstrip("/")
        return f"{base_url}{text}" if base_url else ""
    return text


def status_icon(status: Any) -> str:
    text = str(status or "").lower()
    if "reject" in text or "declin" in text:
        return "❌"
    if "cancel" in text or "withdr" in text:
        return "🚫"
    if "pending" in text or "review" in text or "submit" in text:
        return "⏳"
    if "approv" in text or "complete" in text or "accept" in text:
        return "✅"
    return "🔔"


def prepare_template_variables(variables: dict[str, Any] | None) -> dict[str, Any]:
    """Derive Arabic labels and display helpers that older payloads never carried."""
    from in_app_notifications.i18n import role_label, with_arabic_request_labels

    prepared = with_arabic_request_labels(variables or {})
    if prepared.get("role") and not prepared.get("role_ar"):
        prepared["role_ar"] = role_label(prepared["role"])["ar"]
    if prepared.get("employee_name") and not prepared.get("employee_name_ar"):
        prepared["employee_name_ar"] = prepared["employee_name"]
    if "status_label" in prepared and not prepared.get("status_icon"):
        prepared["status_icon"] = status_icon(prepared.get("status_label"))
    return prepared


def _format_value(name: str, value: Any) -> str:
    if isinstance(value, (list, tuple)):
        items = (str(item or "").strip() for item in value)
        return "\n".join(f"• {item.lstrip('-• ').strip()}" for item in items if item)
    text = "" if value is None else str(value).strip()
    # Callers historically passed "there" when a name was unknown.
    if name.endswith("_name") and text.lower() == "there":
        return ""
    if name.endswith(("_url", "_link")):
        return absolute_app_url(text)
    return text


def render_body_template(body: str, variables: dict[str, Any]) -> str:
    """Fill placeholders, dropping any line whose placeholders are all empty."""
    values = prepare_template_variables(variables)
    lines = []
    for line in str(body or "").splitlines():
        names = [match.group(1) or match.group(2) for match in PLACEHOLDER_RE.finditer(line)]
        rendered = {name: _format_value(name, values.get(name)) for name in names}
        if names and not any(rendered.values()):
            continue
        lines.append(PLACEHOLDER_RE.sub(lambda match: rendered[match.group(1) or match.group(2)], line).rstrip())
    return _EXTRA_BLANK_LINES_RE.sub("\n\n", "\n".join(lines)).strip()


def get_custom_template_body(key: str) -> str | None:
    try:
        template = WhatsAppMessageTemplate.objects.filter(key=key).only("body").first()
    except DatabaseError:
        return None
    return template.body if template else None


def render_fallback_message(template_name: str, variables: dict[str, Any]) -> str:
    title = template_name.replace("_", " ").strip().title() or "HR Notification"
    lines = [f"🔔 *{title}*", ""]
    for key, value in prepare_template_variables(variables).items():
        text = _format_value(key, value)
        if text:
            lines.append(f"• *{key.replace('_', ' ').strip().capitalize()}:* {text}")
    lines.extend(["", SIGNATURE])
    return "\n".join(lines)


def render_configured_template_message(template_name: str, variables: dict[str, Any]) -> str:
    key = canonical_template_key(template_name)
    body = get_custom_template_body(key)
    if body:
        return render_body_template(body, variables)

    definition = DEFAULT_WHATSAPP_TEMPLATES.get(key)
    if definition:
        return render_body_template(definition.default_body, variables)

    return render_fallback_message(template_name, variables)


def render_generic_notification(
    *, title: str, message: str, action_url: str = "", title_ar: str = "", message_ar: str = ""
) -> str:
    """WhatsApp text for notifications without a dedicated template: Arabic first, English second."""
    title, message = str(title or "").strip(), str(message or "").strip()
    title_ar = str(title_ar or "").strip() or title
    message_ar = str(message_ar or "").strip() or message

    def block(heading: str, text: str) -> str:
        return "\n".join(part for part in (f"🔔 *{heading}*" if heading else "", text) if part)

    blocks = [block(title_ar, message_ar)]
    if (title_ar, message_ar) != (title, message):
        blocks.append(block(title, message))
    link = absolute_app_url(action_url)
    parts = [f"\n\n{DIVIDER}\n\n".join(item for item in blocks if item), f"🔗 {link}" if link else "", SIGNATURE]
    return "\n\n".join(part for part in parts if part)


def ensure_known_template_key(key: str) -> bool:
    return key in DEFAULT_WHATSAPP_TEMPLATES
