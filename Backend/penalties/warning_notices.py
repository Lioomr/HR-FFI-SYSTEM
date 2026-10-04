"""Private letters for automatically issued late warnings (W01/W02/W07, occurrences 1-3).

Every letter is rendered on the approved level 1 late-notice template pair, so all
automatic warnings look identical. The occurrence and percentage fields stay blank
and no message states a count: the employee is never told how many warnings
preceded this one. Rendering reuses ``attendance.late_notices``.
"""

import logging
from pathlib import Path

from django.core.files.base import ContentFile
from django.db import transaction

from attendance.late_notices import (
    LATE_PERMISSION_FORM_URL,
    TEMPLATE_VERSION,
    WHATSAPP_TEMPLATE,
    WHATSAPP_VARIABLES,
    _local,
    format_amount,
    level_labels,
    load_company_logo,
    load_notice_assets,
    policy_result,
    render_notice_pdf,
)
from audit.utils import audit
from core.pdf_signers import display_name, signature_for_profile
from in_app_notifications.dispatcher import dispatch_notification_channels
from in_app_notifications.i18n import notification_text
from in_app_notifications.models import Notification

from .models import PenaltyWarningNotice

logger = logging.getLogger(__name__)

NOTICE_LEVEL = 1
EVENT_KEY = "penalty.auto_warning"
WITHDRAWN_EVENT_KEY = "penalty.warning_withdrawn"
#: Arabic only: mixed-direction text breaks the field's punctuation.
AUTOMATED_REASON = "إشعار آلي صادر من النظام بناءً على سجل الحضور المسجل."
#: The WhatsApp template requires every variable; the count itself is never sent.
HIDDEN_OCCURRENCE = "-"
Status = PenaltyWarningNotice.DeliveryStatus


def notice_filename(notice):
    return f"penalty_warning_notice_{notice.reference_number}.pdf"


def download_path(record):
    return f"/api/penalties/{record.pk}/warning-notice/"


def build_notice_values(notice):
    """Values for the approved level 1 map's text fields only, from real system data."""
    from permission_requests.labels import profile_department, profile_job_title

    record = notice.penalty
    result = record.attendance_result
    profile = notice.employee_profile
    company = notice.company
    return {
        "company_name": company.name,
        "company_name_ar": company.name,
        "notice_reference": notice.reference_number,
        "issue_timestamp": _local(notice.issued_at, "%Y-%m-%d %H:%M"),
        "employee_name": display_name(profile=profile),
        "employee_code": profile.employee_id or "",
        "department": profile_department(profile),
        "position": profile_job_title(profile),
        "violation_date": record.occurred_on.isoformat(),
        "scheduled_shift_start": _local(getattr(result, "shift_start_at", None), "%H:%M"),
        "actual_first_check_in": _local(getattr(result, "first_check_in_at", None), "%H:%M"),
        "minutes_late": str((record.evidence or {}).get("minutes", "")),
        "occurrence_number": "",
        "penalty_percentage": "",
        "policy_result": policy_result(NOTICE_LEVEL)[0],
        "penalty_amount": format_amount(record.amount),
        "reason": AUTOMATED_REASON,
        "company_phone": company.phone,
        "company_address": company.address,
        "company_website": company.website,
        "company_email": company.email,
        "hr_signer_name": display_name(profile=getattr(company, "late_notice_signer", None)),
    }


def create_notice(record):
    """Create and render the letter. Errors propagate so the caller's issuance rolls back."""
    company = record.company
    assets = load_notice_assets(NOTICE_LEVEL)
    logo, logo_state = load_company_logo(company)
    notice = PenaltyWarningNotice.objects.create(
        penalty=record,
        company=company,
        employee_profile=record.employee_profile,
        reference_number=f"PWN-{company.code}-{record.pk:06d}",
        template_name=Path(assets.template_path).name,
        template_version=TEMPLATE_VERSION,
    )
    pdf_bytes, rendered_logo_state = render_notice_pdf(
        NOTICE_LEVEL,
        build_notice_values(notice),
        assets=assets,
        company_logo=logo,
        hr_signature=signature_for_profile(getattr(company, "late_notice_signer", None)),
    )
    notice.document.save(notice_filename(notice), ContentFile(pdf_bytes), save=False)
    notice.save(update_fields=["document"])
    audit(
        None,
        "penalty_warning_notice_generated",
        "PenaltyWarningNotice",
        notice.pk,
        {
            "penalty_id": record.pk,
            "reference_number": notice.reference_number,
            "template": notice.template_name,
            "template_version": notice.template_version,
            "company_logo_state": logo_state or rendered_logo_state,
        },
    )
    return notice


def whatsapp_variables(notice):
    """Variables for ``late_attendance_notice_v1`` in the template's declared order."""
    level_en, level_ar = level_labels(NOTICE_LEVEL)
    result_en, result_ar = policy_result(NOTICE_LEVEL)
    values = {
        "employee_name": display_name(profile=notice.employee_profile),
        "notice_level": level_en,
        "notice_level_ar": level_ar,
        "violation_date": notice.penalty.occurred_on.isoformat(),
        "occurrence_number": HIDDEN_OCCURRENCE,
        "reference_number": notice.reference_number,
        "policy_result": result_en,
        "policy_result_ar": result_ar,
        "action_url": LATE_PERMISSION_FORM_URL,
    }
    return {name: values[name] for name in WHATSAPP_VARIABLES}


def deliver(notice):
    """In-app notification plus WhatsApp with the PDF attached; never raises."""
    record = notice.penalty
    text = notification_text(EVENT_KEY, date=record.occurred_on.isoformat())
    employee = notice.employee_profile.user
    notification = None
    if employee is None or not employee.is_active:
        status, message = Status.SKIPPED, "Employee has no active user account; the notice is available to HR."
    else:
        try:
            with transaction.atomic():
                result = dispatch_notification_channels(
                    recipient=employee,
                    event_key=EVENT_KEY,
                    title=text["title"],
                    message=text["message"],
                    category=Notification.Category.ATTENDANCE,
                    action_url=f"/employee/penalties/{record.pk}",
                    related_object=record,
                    company=notice.company,
                    metadata={"penalty_id": record.pk, "notice_id": notice.pk, "download_path": download_path(record)},
                    deduplication_key=f"{EVENT_KEY}:{record.pk}",
                    i18n=text["i18n"],
                    whatsapp_template=WHATSAPP_TEMPLATE,
                    whatsapp_variables=whatsapp_variables(notice),
                    # The PDF is read from private storage and uploaded directly; no URL is sent.
                    whatsapp_document={"penalty_warning_notice_id": notice.pk},
                    redeliver_existing=False,
                )
            notification = result.get("notification") if isinstance(result, dict) else None
        except Exception:
            logger.exception("penalty_warning_notice_delivery_failed", extra={"notice_id": notice.pk})
        if notification is None:
            status, message = Status.FAILED, "The in-app notification could not be created."
        else:
            status, message = Status.SCHEDULED, "In-app notification created; external delivery is scheduled."
    notice.notification = notification
    notice.delivery_status = status
    notice.delivery_message = message
    notice.save(update_fields=["notification", "delivery_status", "delivery_message"])
    audit(
        None,
        f"penalty_warning_notice_delivery_{status}",
        "PenaltyWarningNotice",
        notice.pk,
        {"penalty_id": record.pk, "notification_id": getattr(notification, "id", None)},
    )


def notify_warning_withdrawn(record):
    """Tell the employee an automatic warning was withdrawn (once per record)."""
    employee = record.employee_profile.user
    if employee is None or not employee.is_active:
        return
    action_url = f"/employee/penalties/{record.pk}"
    try:
        dispatch_notification_channels(
            recipient=employee,
            company=record.company,
            related_object=record,
            event_key=WITHDRAWN_EVENT_KEY,
            **notification_text(WITHDRAWN_EVENT_KEY, date=record.occurred_on.isoformat()),
            category=Notification.Category.ATTENDANCE,
            action_url=action_url,
            whatsapp_template="request_status_update",
            whatsapp_variables={
                "employee_name": getattr(employee, "full_name", "") or employee.email,
                "request_type": "Late attendance warning",
                "request_type_ar": "إنذار التأخر في الحضور",
                "request_id": str(record.pk),
                "status_label": "Withdrawn",
                "status_label_ar": "تم سحب الإنذار",
                "status_icon": "",
                "reason": "",
                "details": "No action is needed.",
                "action_url": action_url,
            },
            deduplication_key=f"{WITHDRAWN_EVENT_KEY}:{record.pk}",
        )
    except Exception:
        logger.exception("penalty_notification_failed", extra={"penalty_id": record.pk, "event": "warning_withdrawn"})
