"""Bilingual (English/Arabic) wording for notifications.

In-app notification text is rendered when it is *read*, in the reader's UI
language, from a catalog key plus parameters stored in
``Notification.metadata["i18n"]``. The English rendering is still saved to
``title``/``message`` so emails, logs, admin screens and clients that do not send
``Accept-Language`` keep working, and rows created before this catalog existed
simply keep their stored text.

Parameters are either plain values (IDs, dates, reference numbers) inserted
verbatim, or localized pairs ``{"en": ..., "ar": ...}`` built with :func:`pair`
or the label helpers below. Raw workflow codes such as ``pending_hr_completion``
must never reach people, so status values always go through :func:`status_label`.
"""

from __future__ import annotations

import logging
import re
import string
from datetime import date, datetime
from decimal import Decimal
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_LANGUAGE = "en"

Localized = dict[str, str]


def normalize_language(language: Any) -> str:
    return "ar" if str(language or "").strip().lower().startswith("ar") else DEFAULT_LANGUAGE


def pair(en: Any, ar: Any = None) -> Localized:
    en_text = "" if en is None else str(en)
    ar_text = "" if ar is None else str(ar)
    return {"en": en_text, "ar": ar_text or en_text}


def _first_text(*values: Any) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def _code_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")


# ---------------------------------------------------------------------------
# Labels
# ---------------------------------------------------------------------------

#: English request type (as passed by the workflows) -> Arabic.
REQUEST_TYPE_LABELS: dict[str, str] = {
    "Leave Request": "طلب إجازة",
    "Manual Leave Record": "سجل إجازة يدوي",
    "Loan Request": "طلب سلفة",
    "Loan Disbursement": "صرف سلفة",
    "Permission Request": "طلب إذن خروج",
    "Exit Permission": "طلب إذن خروج",
    "Late Permission": "طلب إذن تأخير",
    "During Shift Permission": "طلب إذن أثناء الدوام",
    "Asset Damage Report": "تقرير ضرر أصل",
    "Asset Return Request": "طلب إعادة أصل",
    "Attendance Request": "طلب حضور",
    "Attendance Correction": "طلب تصحيح حضور",
    "Employee Archive": "أرشفة موظف",
    "Employee Deletion": "حذف موظف",
    "Annual Leave Payment Request": "طلب صرف رصيد الإجازة السنوية",
    "Annual Leave Settlement": "تسوية الإجازة السنوية",
}

_REQUEST_TYPE_BY_CODE = {_code_key(en): (en, ar) for en, ar in REQUEST_TYPE_LABELS.items()}

_PENDING_MANAGER = ("Pending Manager", "بانتظار المدير المباشر")
_PENDING_FINANCE = ("Pending Finance", "بانتظار المالية")
_PENDING = ("Pending", "قيد الانتظار")

#: Normalized status code or English label -> (English, Arabic). Covers every
#: status enum that workflows pass into notifications.
STATUS_LABELS: dict[str, tuple[str, str]] = {
    "draft": ("Draft", "مسودة"),
    "submitted": ("Submitted", "مُقدَّم"),
    "pending": _PENDING,
    "pending_legacy": _PENDING,
    "pending_delegate": ("Pending Alternative Employee", "بانتظار الموظف البديل"),
    "pending_alternative_employee": ("Pending Alternative Employee", "بانتظار الموظف البديل"),
    "pending_manager": _PENDING_MANAGER,
    "pending_mgr": _PENDING_MANAGER,
    "pending_manager_approval": ("Pending Manager Approval", "بانتظار موافقة المدير المباشر"),
    "pending_hr": ("Pending HR", "بانتظار الموارد البشرية"),
    "pending_hr_verification": ("Pending HR Verification", "بانتظار تحقق الموارد البشرية"),
    "pending_hr_completion": ("Pending HR Completion", "بانتظار استكمال الموارد البشرية"),
    "pending_finance": _PENDING_FINANCE,
    "pending_finance_legacy": _PENDING_FINANCE,
    "pending_cfo": ("Pending CFO", "بانتظار المدير المالي"),
    "pending_ceo": ("Pending CEO", "بانتظار الرئيس التنفيذي"),
    "pending_disbursement": ("Pending Disbursement", "بانتظار الصرف"),
    "in_review": ("In Review", "قيد المراجعة"),
    "approved": ("Approved", "معتمد"),
    "approved_and_disbursed": ("Approved and disbursed", "معتمد وتم الصرف"),
    "auto_approved": ("Automatically approved", "معتمد تلقائياً"),
    "automatically_approved": ("Automatically approved", "معتمد تلقائياً"),
    "auto_renewed": ("Automatically renewed", "تم التجديد تلقائياً"),
    "automatically_renewed": ("Automatically renewed", "تم التجديد تلقائياً"),
    "auto_renewal_failed": ("Automatic renewal failed", "فشل التجديد التلقائي"),
    "automatic_renewal_failed": ("Automatic renewal failed", "فشل التجديد التلقائي"),
    "manual_resolution_required": ("Manual resolution required", "يتطلب معالجة يدوية"),
    "changes_requested": ("Changes Requested", "مطلوب تعديلات"),
    "rejected": ("Rejected", "مرفوض"),
    "cancelled": ("Cancelled", "ملغى"),
    "canceled": ("Cancelled", "ملغى"),
    "processed": ("Processed", "تمت المعالجة"),
    "executed": ("Executed", "تم التنفيذ"),
    "archived": ("Archived", "مؤرشف"),
    "carried_forward": ("Carried Forward", "مُرحَّل"),
    "deducted": ("Deducted", "مخصوم"),
    "present": ("Present", "حاضر"),
    "absent": ("Absent", "غائب"),
    "late": ("Late", "متأخر"),
}

DECISION_TYPE_LABELS: dict[str, tuple[str, str]] = {
    "renew": ("Renew", "تجديد"),
    "renew_with_changes": ("Renew with changes", "تجديد مع تعديلات"),
    "terminate": ("Terminate", "إنهاء"),
}

DOCUMENT_TYPE_LABELS: dict[str, tuple[str, str]] = {
    "iqama": ("Iqama", "الإقامة"),
    "passport": ("Passport", "جواز السفر"),
    "visa": ("Visa", "التأشيرة"),
    "saudi_id": ("Saudi ID", "الهوية الوطنية"),
    "work_license": ("Work License", "رخصة العمل"),
}

ROLE_LABELS: dict[str, tuple[str, str]] = {
    "employee": ("Employee", "موظف"),
    "manager": ("Manager", "مدير"),
    "hrmanager": ("HR Manager", "مدير الموارد البشرية"),
    "ceo": ("CEO", "الرئيس التنفيذي"),
    "cfo": ("CFO", "المدير المالي"),
    "accountant": ("Accountant", "محاسب"),
    "systemadmin": ("System Administrator", "مسؤول النظام"),
}

CONTRACT_RATING_EVENT_LABELS: dict[str, tuple[str, str]] = {
    "opened": ("Opened", "تم فتحه"),
    "missing_rater": ("Rater missing", "المُقيِّم غير متوفر"),
    "both_submitted": ("Ready for HR review", "جاهز لمراجعة الموارد البشرية"),
    "hr_approved": ("Ready for CEO decision", "جاهز لقرار الرئيس التنفيذي"),
    "hr_returned": ("Returned for changes", "أُعيد لإجراء التعديلات"),
    "incomplete": ("Responses incomplete", "التقييمات غير مكتملة"),
    "reminder": ("Reminder", "تذكير"),
    "awaiting_hr_review": ("Awaiting HR review", "بانتظار مراجعة الموارد البشرية"),
    "ceo_reminder": ("CEO reminder", "تذكير للرئيس التنفيذي"),
    "termination_finalized": ("Termination finalized", "تم اعتماد الإنهاء"),
}

_CONTRACT_RATING_DEFAULT_MESSAGE = "Please review the employee contract rating."


def _looks_like_code(text: str) -> bool:
    return " " not in text and ("_" in text or text.isupper() or text.islower())


def status_label(value: Any) -> Localized:
    """Human English/Arabic label for a workflow status code or English label."""
    text = str(value or "").strip()
    if not text:
        return pair("")
    known = STATUS_LABELS.get(_code_key(text))
    if known:
        return pair(*known)
    if _looks_like_code(text):
        return pair(_code_key(text).replace("_", " ").capitalize())
    return pair(text)


def request_type_label(value: Any) -> Localized:
    text = str(value or "").strip()
    known = _REQUEST_TYPE_BY_CODE.get(_code_key(text))
    if known:
        return pair(*known)
    if text and _looks_like_code(text):
        return pair(_code_key(text).replace("_", " ").capitalize())
    return pair(text)


def decision_type_label(value: Any, fallback: str = "") -> Localized:
    known = DECISION_TYPE_LABELS.get(_code_key(value))
    return pair(*known) if known else pair(fallback or value)


def document_label(label: Any, document_type: Any = None) -> Localized:
    """Keep the English document name; use the Arabic type name when the type is known."""
    known = DOCUMENT_TYPE_LABELS.get(_code_key(document_type))
    en = _first_text(label, known[0] if known else "", "Document")
    return pair(en, known[1] if known else ("مستند" if en == "Document" else en))


def role_label(value: Any) -> Localized:
    known = ROLE_LABELS.get(_code_key(value).replace("_", ""))
    return pair(*known) if known else pair(value)


def contract_rating_event_label(value: Any) -> Localized:
    """Human bilingual label for a contract-rating notification event."""
    text = str(value or "").strip()
    known = CONTRACT_RATING_EVENT_LABELS.get(_code_key(text))
    return pair(*known) if known else pair(_code_key(text).replace("_", " ").capitalize() or text)


def contract_rating_message(value: Any) -> Localized:
    """Translate the standard rating prompt while preserving entered free text."""
    text = str(value or "").strip() or _CONTRACT_RATING_DEFAULT_MESSAGE
    if text == _CONTRACT_RATING_DEFAULT_MESSAGE:
        return pair(text, "يرجى مراجعة تقييم عقد الموظف.")
    return pair(text)


def profile_name(profile: Any, fallback: Any = "") -> Localized:
    """Employee display name, preferring the Arabic name for Arabic readers."""
    en = _first_text(
        getattr(profile, "full_name", ""),
        getattr(profile, "full_name_en", ""),
        getattr(profile, "employee_id", ""),
        fallback,
    )
    return pair(en, _first_text(getattr(profile, "full_name_ar", ""), en))


def user_name(user: Any, fallback: str = "") -> Localized:
    profile = getattr(user, "employee_profile", None) if user is not None else None
    en = _first_text(getattr(user, "full_name", ""), getattr(profile, "full_name", ""), getattr(user, "email", ""), fallback)
    return pair(en, _first_text(getattr(profile, "full_name_ar", ""), en))


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------

_CONTRACT_CEO_MESSAGE = (
    "HR selected {decision} for {employee_name}. Review before {deadline}.",
    "اختارت الموارد البشرية «{decision}» للموظف {employee_name}. يرجى المراجعة قبل {deadline}.",
)

#: key -> {"title": (en, ar), "message": (en, ar)}
MESSAGES: dict[str, dict[str, tuple[str, str]]] = {
    "approval.pending": {
        "title": ("{request_type} requires your review", "{request_type} بانتظار مراجعتك"),
        "message": (
            "{requester_name}'s request #{request_id} is {status}.",
            "الطلب رقم {request_id} من {requester_name}: {status}.",
        ),
    },
    "request.status_changed": {
        "title": ("{request_type} {status}", "{request_type}: {status}"),
        "message": ("Request #{request_id} is now {status}.", "حالة الطلب رقم {request_id} الآن: {status}."),
    },
    "request.status_changed_reason": {
        "title": ("{request_type} {status}", "{request_type}: {status}"),
        "message": ("{reason}", "{reason}"),
    },
    "request.submitted": {
        "title": ("{request_type} submitted", "تم تقديم {request_type}"),
        "message": (
            "Request #{request_id} was submitted and is {status}.",
            "تم تقديم الطلب رقم {request_id} وحالته الآن: {status}.",
        ),
    },
    "leave.submitted_manager": {
        "title": ("Leave request requires your review", "طلب إجازة بانتظار مراجعتك"),
        "message": (
            "{employee_name} submitted leave request #{request_id}.",
            "قدّم {employee_name} طلب الإجازة رقم {request_id}.",
        ),
    },
    "leave.submitted_employee": {
        "title": ("Leave request submitted", "تم تقديم طلب الإجازة"),
        "message": ("Your leave request #{request_id} was submitted.", "تم تقديم طلب الإجازة رقم {request_id}."),
    },
    "leave.approved": {
        "title": ("Leave request approved", "تمت الموافقة على طلب الإجازة"),
        "message": ("Your leave request #{request_id} was approved.", "تمت الموافقة على طلب الإجازة رقم {request_id}."),
    },
    "leave.rejected": {
        "title": ("Leave request rejected", "تم رفض طلب الإجازة"),
        "message": ("{reason}", "{reason}"),
    },
    "leave.cancelled": {
        "title": ("Leave request cancelled", "تم إلغاء طلب الإجازة"),
        "message": ("Your leave request #{request_id} was cancelled.", "تم إلغاء طلب الإجازة رقم {request_id}."),
    },
    "leave.delegation_assigned": {
        "title": ("Leave delegation assigned", "تم تعيينك موظفاً بديلاً"),
        "message": ("You were assigned as delegate for {employee_name}.", "تم تعيينك موظفاً بديلاً عن {employee_name}."),
    },
    "annual_leave.payment_approved": {
        "title": ("Annual Leave settlement approved", "تمت الموافقة على تسوية الإجازة السنوية"),
        "message": (
            "Your Annual Leave settlement request #{request_id} was approved.",
            "تمت الموافقة على طلب تسوية الإجازة السنوية رقم {request_id}.",
        ),
    },
    "annual_leave.payment_rejected": {
        "title": ("Annual Leave settlement rejected", "تم رفض تسوية الإجازة السنوية"),
        "message": (
            "Your Annual Leave settlement request #{request_id} was rejected.",
            "تم رفض طلب تسوية الإجازة السنوية رقم {request_id}.",
        ),
    },
    "annual_leave.year_end_reminder": {
        "title": ("Annual Leave year-end is approaching", "اقتراب نهاية سنة الإجازة السنوية"),
        "message": (
            "{employee_name}'s contract year ends on {date}. Review unused Annual Leave during the final 5 days.",
            "تنتهي سنة العقد للموظف {employee_name} في {date}. راجِع رصيد الإجازة السنوية غير المستخدم خلال الأيام الخمسة الأخيرة.",
        ),
    },
    "annual_leave.year_end_decision_required": {
        "title": ("Annual Leave settlement decision required", "مطلوب قرار بشأن تسوية الإجازة السنوية"),
        "message": (
            "{employee_name}'s Annual Leave year ended on {date}. "
            "Decide whether to carry forward or pay the unused balance.",
            "انتهت سنة الإجازة السنوية للموظف {employee_name} في {date}. حدِّد ترحيل الرصيد غير المستخدم أو صرفه.",
        ),
    },
    "contract.expiry_milestone": {
        "title": ("Contract expiry: {employee_name}", "انتهاء العقد: {employee_name}"),
        "message": (
            "{employee_name}'s contract expires on {date} ({days_left} days remaining).",
            "ينتهي عقد {employee_name} في {date} (الأيام المتبقية: {days_left}).",
        ),
    },
    "contract.expiry_action_required": {
        "title": ("Action required: contract expiry for {employee_name}", "مطلوب إجراء: انتهاء عقد {employee_name}"),
        "message": (
            "{employee_name}'s contract expires on {date} ({days_left} days remaining). Submit a renewal or "
            "termination decision before {deadline}, or the contract will be renewed automatically.",
            "ينتهي عقد {employee_name} في {date} (الأيام المتبقية: {days_left}). يرجى تقديم قرار التجديد أو "
            "الإنهاء قبل {deadline}، وإلا سيتم تجديد العقد تلقائياً.",
        ),
    },
    "contract.ceo_pending": {
        "title": ("Contract decision requires CEO approval", "قرار العقد بانتظار موافقة الرئيس التنفيذي"),
        "message": _CONTRACT_CEO_MESSAGE,
    },
    "contract.ceo_reminder": {
        "title": ("CEO reminder: contract decision", "تذكير للرئيس التنفيذي: قرار عقد"),
        "message": _CONTRACT_CEO_MESSAGE,
    },
    "contract.decision_completed": {
        "title": ("Contract decision completed", "اكتمل قرار العقد"),
        "message": (
            "Contract decision for {employee_name}: {status}. New expiry: {expiry}.",
            "قرار العقد للموظف {employee_name}: {status}. تاريخ الانتهاء الجديد: {expiry}.",
        ),
    },
    "contract.manual_resolution": {
        "title": ("Contract processing requires manual resolution", "معالجة العقد تتطلب إجراءً يدوياً"),
        "message": (
            "Contract processing requires manual resolution for {employee_name}. Manual resolution is required: {reason}",
            "معالجة عقد {employee_name} تتطلب إجراءً يدوياً. السبب: {reason}",
        ),
    },
    "contract.termination_settlement_required": {
        "title": (
            "Termination settlement required: {employee_name}",
            "مطلوب تسوية نهاية الخدمة: {employee_name}",
        ),
        "message": (
            "{employee_name}'s contract was terminated on {date}. Create a termination settlement "
            "(annual leave payment) for this employee.",
            "تم إنهاء عقد {employee_name} بتاريخ {date}. يرجى إنشاء تسوية نهاية الخدمة "
            "(بدل الإجازة السنوية) لهذا الموظف.",
        ),
    },
    "contract.rating": {
        "title": ("Contract Rating: {event}", "تقييم العقد: {event}"),
        "message": ("{message}", "{message}"),
    },
    "document.expiring": {
        "title": ("Document expiry reminder", "تذكير بانتهاء مستند"),
        "message": ("{document} expires on {date}.", "تاريخ انتهاء {document}: {date}."),
    },
    "document.work_license_expiring": {
        "title": ("Work license expiry reminder", "تذكير بانتهاء رخصة العمل"),
        "message": (
            "{employee_name}'s work license expires on {date}.",
            "تنتهي رخصة عمل {employee_name} في {date}.",
        ),
    },
    # Late-attendance notice titles use the canonical v3 PDF/UI severity taxonomy, and the
    # messages mirror each approved template map's preprinted policy copy
    # (attendance/test_late_notice_delivery.py keeps them identical).
    "attendance.late_notice_level_1": {
        "title": (
            "Late Attendance Notice - Informational Warning",
            "إنذار التأخر في الحضور - إنذار توعوي",
        ),
        "message": ("Warning only - no payroll deduction.", "تحذير فقط - لا يوجد خصم من الراتب."),
    },
    "attendance.late_notice_level_2": {
        "title": (
            "Late Attendance Notice - Formal Caution",
            "إنذار التأخر في الحضور - تنبيه رسمي",
        ),
        "message": ("Formal caution - 5% daily-rate deduction.", "تنبيه رسمي - خصم بنسبة ٥٪ من الأجر اليومي."),
    },
    "attendance.late_notice_level_3": {
        "title": (
            "Late Attendance Notice - Serious Warning",
            "إنذار التأخر في الحضور - تحذير جاد",
        ),
        "message": ("Serious warning - 10% daily-rate deduction.", "تحذير جاد - خصم بنسبة ١٠٪ من الأجر اليومي."),
    },
    "attendance.late_notice_level_4": {
        "title": (
            "Late Attendance Notice - Critical Final Warning",
            "إنذار التأخر في الحضور - إنذار نهائي حرج",
        ),
        "message": (
            "Critical final warning - 50% daily-rate deduction.",
            "إنذار نهائي حرج - خصم بنسبة ٥٠٪ من الأجر اليومي.",
        ),
    },
    "job_offer.submitted": {
        "title": ("Job offer {reference} requires CEO review", "عرض العمل {reference} بانتظار مراجعة الرئيس التنفيذي"),
        "message": (
            "Candidate: {candidate}; Company: {company}; Reference: {reference}; Salary package: {salary}",
            "المرشّح: {candidate}؛ الشركة: {company}؛ الرقم المرجعي: {reference}؛ إجمالي الراتب: {salary}",
        ),
    },
    "job_offer.decided": {
        "title": ("Job offer {decision}", "عرض العمل: {decision}"),
        "message": (
            "Job offer {reference} is {decision}.{reason}{recommendation}",
            "عرض العمل {reference}: {decision}.{reason}{recommendation}",
        ),
    },
    "job_offer.biotime_mapping_missing": {
        "title": ("BioTime mapping required for {employee_name}", "مطلوب ربط BioTime للموظف {employee_name}"),
        "message": (
            "BioTime mapping is missing for {employee_name} ({employee_id}) after accepting job offer {reference}. "
            "Add the employee mapping before attendance synchronization.",
            "لا يوجد ربط BioTime للموظف {employee_name} ({employee_id}) بعد قبول عرض العمل {reference}. "
            "أضِف ربط الموظف قبل مزامنة الحضور.",
        ),
    },
    "starting_work_acknowledgment.pending_hr": {
        "title": (
            "Verify starting work attendance for {employee_name}",
            "تحقّق من مباشرة العمل للموظف {employee_name}",
        ),
        "message": (
            "Starting Work Acknowledgment requires HR BioTime verification. Employee: {employee_name}; "
            "Employee ID: {employee_id}; Start date: {start_date}; Profile: {profile_url}; Document: {document_url}",
            "إثبات مباشرة العمل يتطلب تحقق الموارد البشرية عبر BioTime. الموظف: {employee_name}؛ "
            "الرقم الوظيفي: {employee_id}؛ تاريخ المباشرة: {start_date}؛ الملف: {profile_url}؛ المستند: {document_url}",
        ),
    },
    "payroll.payslip_available": {
        "title": ("Payslip available", "كشف الراتب متاح"),
        "message": ("Your payslip for {period} is available.", "كشف راتبك لفترة {period} متاح الآن."),
    },
    "asset.assigned": {
        "title": ("Asset assigned", "تم تسليم أصل"),
        "message": ("{asset} ({asset_code}) was assigned to you.", "تم تسليمك {asset} ({asset_code})."),
    },
    "asset.returned": {
        "title": ("Asset returned", "تمت إعادة أصل"),
        "message": ("{asset} ({asset_code}) was marked as returned.", "تم تسجيل إعادة {asset} ({asset_code})."),
    },
    "invite.accepted": {
        "title": ("Welcome to the FFI HR System", "مرحباً بك في نظام الموارد البشرية FFI"),
        "message": ("Your {role} account is ready.", "حسابك ({role}) جاهز."),
    },
    "delegation.assigned": {
        "title": ("Workflow delegation updated", "تم تحديث تفويض سير العمل"),
        "message": ("Delegation from {from_user} to {to_user} is active.", "التفويض من {from_user} إلى {to_user} مفعّل."),
    },
}


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------


class _Params(dict):
    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


def _json_value(value: Any) -> Any:
    if isinstance(value, dict):
        return pair(value.get("en"), value.get("ar"))
    if value is None:
        return ""
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, (int, float, str)):
        return value
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return str(value)


def _resolve(value: Any, language: str) -> str:
    if isinstance(value, dict):
        return str(value.get(language) or value.get(DEFAULT_LANGUAGE) or "")
    return "" if value is None else str(value)


def render(i18n: Any, field: str, language: Any = DEFAULT_LANGUAGE) -> str | None:
    """Render ``title``/``message`` for a stored i18n block, or ``None`` if it can't be."""
    if not isinstance(i18n, dict):
        return None
    entry = MESSAGES.get(str(i18n.get("key") or ""))
    if not entry or field not in entry:
        return None
    lang = normalize_language(language)
    template = entry[field][1 if lang == "ar" else 0]
    raw_params = i18n.get("params")
    params = raw_params if isinstance(raw_params, dict) else {}
    try:
        return template.format_map(_Params({name: _resolve(value, lang) for name, value in params.items()}))
    except (ValueError, IndexError, AttributeError):
        logger.warning("notification_i18n_render_failed", extra={"key": i18n.get("key"), "field": field})
        return None


def notification_text(key: str, **params: Any) -> dict[str, Any]:
    """English ``title``/``message`` (stored as the fallback) plus the ``i18n`` block."""
    if key not in MESSAGES:
        raise KeyError(f"Unknown notification message key: {key}")
    i18n = {"key": key, "params": {name: _json_value(value) for name, value in params.items()}}
    return {
        "title": render(i18n, "title") or "",
        "message": render(i18n, "message") or "",
        "i18n": i18n,
    }


# ---------------------------------------------------------------------------
# Legacy rows
# ---------------------------------------------------------------------------
# Notifications stored before the catalog existed (or created by a worker still
# running older code) only have English text. Their text was produced by the same
# English templates, so each template doubles as a parser: the stored title and
# message are matched against it to recover the parameters, which are then
# rendered in the reader's language. Anything that does not match is shown as stored.

#: event_key -> catalog keys worth trying, most specific first.
LEGACY_EVENT_KEYS: dict[str, tuple[str, ...]] = {
    "leave.submitted": ("leave.submitted_manager", "leave.submitted_employee"),
    "request.status_changed": ("request.status_changed", "request.status_changed_reason"),
    "contract.expiry": (
        "contract.expiry_action_required",
        "contract.expiry_milestone",
        "contract.ceo_pending",
        "contract.ceo_reminder",
        "contract.decision_completed",
        "contract.manual_resolution",
    ),
    "document.expiring": ("document.expiring", "document.work_license_expiring"),
}

#: Keys whose request type and status were also stored in metadata, which removes
#: the ambiguity of titles such as "{request_type} {status}".
_METADATA_SEEDED_KEYS = {"approval.pending", "request.status_changed", "request.status_changed_reason", "request.submitted"}

#: Fixed English fallbacks the old code inserted as parameter values.
_LEGACY_LITERALS: dict[str, tuple[str, str]] = {
    "Not specified": ("Not specified", "غير محدد"),
    "the deadline": ("the deadline", "الموعد النهائي"),
    "none": ("none", "لا يوجد"),
    "An employee": ("An employee", "أحد الموظفين"),
}

_UNSET = object()


def _legacy_candidates(event_key: str) -> tuple[str, ...]:
    if event_key in LEGACY_EVENT_KEYS:
        return LEGACY_EVENT_KEYS[event_key]
    if event_key in MESSAGES:
        return (event_key,)
    if event_key.startswith("job_offer."):
        return ("job_offer.decided",)
    return ()


def _template_regex(template: str, known: dict[str, str]) -> re.Pattern:
    parts: list[str] = []
    seen: set[str] = set()
    for literal, name, _spec, _conversion in string.Formatter().parse(template):
        parts.append(re.escape(literal))
        if name is None:
            continue
        if name in known:
            parts.append(re.escape(known[name]))
        elif name in seen:
            parts.append(f"(?P={name})")
        else:
            parts.append(f"(?P<{name}>.*?)")
            seen.add(name)
    return re.compile("".join(parts), re.DOTALL)


def _localize_legacy_param(name: str, value: str) -> Any:
    if value in _LEGACY_LITERALS:
        return pair(*_LEGACY_LITERALS[value])
    if name == "request_type":
        return request_type_label(value)
    if name == "status":
        return status_label(value)
    if name == "decision":
        if _code_key(value) in DECISION_TYPE_LABELS:
            return decision_type_label(value)
        return pair(value, status_label(value)["ar"])
    if name == "document":
        return document_label(value, value)
    if name == "role":
        return role_label(value)
    if name == "event":
        return contract_rating_event_label(value)
    if name == "message":
        return contract_rating_message(value)
    return value


def _split_job_offer_notes(params: dict[str, Any]) -> None:
    notes = f"{params.get('reason', '')}{params.get('recommendation', '')}"
    reason, _, recommendation = notes.partition(" Recommendation: ")
    reason = reason.removeprefix(" Reason: ")
    params["reason"] = pair(f" Reason: {reason}", f" السبب: {reason}") if reason else ""
    params["recommendation"] = (
        pair(f" Recommendation: {recommendation}", f" التوصية: {recommendation}") if recommendation else ""
    )


def legacy_i18n(notification: Any) -> dict[str, Any] | None:
    """Best-effort catalog block recovered from a row that only stored English text."""
    title = str(getattr(notification, "title", "") or "")
    message = str(getattr(notification, "message", "") or "")
    metadata = getattr(notification, "metadata", None)
    metadata = metadata if isinstance(metadata, dict) else {}
    for key in _legacy_candidates(str(getattr(notification, "event_key", "") or "")):
        entry = MESSAGES[key]
        known: dict[str, str] = {}
        if key in _METADATA_SEEDED_KEYS:
            for name in ("request_type", "status"):
                if metadata.get(name):
                    known[name] = str(metadata[name])
        title_match = _template_regex(entry["title"][0], known).fullmatch(title)
        if not title_match:
            continue
        known.update(title_match.groupdict())
        message_match = _template_regex(entry["message"][0], known).fullmatch(message)
        if not message_match:
            continue
        raw = {**known, **message_match.groupdict()}
        params: dict[str, Any] = {name: _localize_legacy_param(name, value) for name, value in raw.items()}
        if key == "job_offer.decided":
            _split_job_offer_notes(params)
        return {"key": key, "params": params}
    return None


def _cached_legacy_i18n(notification: Any) -> dict[str, Any] | None:
    cached = getattr(notification, "_legacy_i18n", _UNSET)
    if cached is _UNSET:
        try:
            cached = legacy_i18n(notification)
        except Exception:
            logger.warning("notification_legacy_i18n_failed", exc_info=True)
            cached = None
        try:
            notification._legacy_i18n = cached
        except AttributeError:
            pass
    return cached


def localized_notification_field(notification: Any, field: str, language: Any) -> str:
    metadata = getattr(notification, "metadata", None)
    i18n = metadata.get("i18n") if isinstance(metadata, dict) else None
    if not isinstance(i18n, dict):
        i18n = _cached_legacy_i18n(notification)
    rendered = render(i18n, field, language)
    return rendered if rendered is not None else str(getattr(notification, field, "") or "")


def template_placeholders(template: str) -> set[str]:
    return {name for _, name, _, _ in string.Formatter().parse(template) if name}


def with_arabic_request_labels(variables: dict[str, Any]) -> dict[str, Any]:
    """Add ``request_type_ar``/``status_label_ar`` and humanize raw status codes for WhatsApp/email.

    Payloads queued before these variables existed still render a fully Arabic
    Arabic section, and a raw code passed as ``status_label`` is never shown.
    """
    enriched = dict(variables or {})
    if "request_type" in enriched:
        request_type = request_type_label(enriched.get("request_type"))
        enriched.setdefault("request_type_ar", request_type["ar"])
        if not enriched.get("request_type_ar"):
            enriched["request_type_ar"] = request_type["ar"]
    if "status_label" in enriched:
        status = status_label(enriched.get("status_label"))
        enriched["status_label"] = status["en"]
        if not enriched.get("status_label_ar"):
            enriched["status_label_ar"] = status["ar"]
    return enriched
