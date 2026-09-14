"""Private late-attendance notices rendered on the approved version 3 template/map pairs.

Each notice level is one HR-approved blank PDF plus the field map deployed beside
it (``static/pdf_templates``). Dynamic values are drawn only into the map's
declared fields through ``core.pdf_forms.render_mapped_form``; the approved
artwork and bilingual policy copy are never covered or extended.

Image slots: the shared renderer draws every ``kind: image`` field from its
``signatures`` mapping. The configured ``OrganizationNode.logo`` travels through
that mapping under ``company_logo`` purely as a transport; it is not a signature.
``hr_signature_image`` is manual-only and is never passed, so it always stays blank.

Version 1 and version 2 notices keep their stored PDF and template snapshot.
Nothing here re-renders, replaces, or redelivers an existing notice.
"""

from __future__ import annotations

import logging
from decimal import Decimal
from pathlib import Path
from typing import Any

from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone

from audit.utils import audit
from core.pdf_forms import (
    MAX_SIGNATURE_BYTES,
    SIGNATURE_PLACED,
    FormAssets,
    SignatureAsset,
    load_form_assets,
    render_mapped_form,
)
from in_app_notifications.dispatcher import dispatch_notification_channels
from in_app_notifications.i18n import MESSAGES, notification_text
from in_app_notifications.models import Notification, NotificationDelivery

from .models import AttendanceLateNotice, AttendanceLateViolation

logger = logging.getLogger(__name__)

TEMPLATE_VERSION = 3
ASSET_REVISION = 3
NOTICE_EVENT_KEY = "attendance.late_notice"
NOTICE_ACTION_URL = "/employee/attendance"
WHATSAPP_TEMPLATE = "late_attendance_notice_v1"
#: Payroll amounts carry no currency field; every salary in the system is in Saudi riyals.
CURRENCY = "SAR"

LOGO_FIELD = "company_logo"
HR_SIGNATURE_FIELD = "hr_signature_image"
MAX_LOGO_BYTES = MAX_SIGNATURE_BYTES

#: Every text field the approved version 3 maps declare.
MAPPED_TEXT_FIELDS = (
    "company_name",
    "company_name_ar",
    "notice_reference",
    "issue_timestamp",
    "employee_name",
    "employee_code",
    "department",
    "position",
    "violation_date",
    "scheduled_shift_start",
    "actual_first_check_in",
    "minutes_late",
    "occurrence_number",
    "penalty_percentage",
    "policy_result",
    "penalty_amount",
    "reason",
    "company_phone",
    "company_address",
    "company_website",
    "company_email",
)
REQUIRED_FIELD_KEYS = frozenset({*MAPPED_TEXT_FIELDS, LOGO_FIELD, HR_SIGNATURE_FIELD})

#: Order is part of the ``late_attendance_notice_v1`` WhatsApp template contract.
WHATSAPP_VARIABLES = (
    "employee_name",
    "notice_level",
    "notice_level_ar",
    "violation_date",
    "occurrence_number",
    "reference_number",
    "policy_result",
    "policy_result_ar",
    "action_url",
)

#: Human-readable text for the reasons ``AttendancePolicyService.classify_arrival`` charges.
REASON_TEXT = {
    "outside_grace": "Checked in after the scheduled shift start, beyond the monthly grace window.",
    "post_grace_late": "Checked in after the scheduled shift start after the monthly grace allowance was used.",
}
DEFAULT_REASON_TEXT = "Checked in after the scheduled shift start."

# Safe, path-free outcomes of rendering the company logo.
LOGO_PLACED = "placed"
LOGO_NOT_CONFIGURED = "not_configured"
LOGO_UNREADABLE = "unreadable"
LOGO_OVERSIZED = "oversized"
LOGO_INVALID = "invalid"
LOGO_UNPLACEABLE = "unplaceable"

Status = AttendanceLateNotice.DeliveryStatus


class NoticeTemplateUnavailable(RuntimeError):
    """The approved pair for a level is missing or is not the approved version."""


def level_for_occurrence(occurrence: int) -> int:
    """Occurrences 1, 2, and 3 have their own level; every occurrence 4+ is level 4."""
    return min(max(int(occurrence), 1), 4)


def template_filename(level: int) -> str:
    return f"late_attendance_level_{level}_blank_v3.pdf"


def field_map_filename(level: int) -> str:
    return f"late_attendance_level_{level}_field_map_v3.json"


def notice_filename(notice: AttendanceLateNotice) -> str:
    return f"late_attendance_notice_{notice.reference_number}.pdf"


def notice_notification_key(level: int) -> str:
    return f"attendance.late_notice_level_{level}"


def level_labels(level: int) -> tuple[str, str]:
    """``("Formal Caution", "تنبيه رسمي")``: the canonical v3 severity label from the level's catalog title."""
    english, arabic = MESSAGES[notice_notification_key(level)]["title"]
    return english.split(" - ", 1)[-1], arabic.split(" - ", 1)[-1]


def policy_result(level: int) -> tuple[str, str]:
    """The level's bilingual policy result, identical to the approved template's preprinted copy."""
    english, arabic = MESSAGES[notice_notification_key(level)]["message"]
    return english, arabic


def load_notice_assets(level: int) -> FormAssets:
    """Resolve one approved version 3 pair and confirm the map belongs to that level."""
    if level not in (1, 2, 3, 4):
        raise NoticeTemplateUnavailable(f"Late notice level {level} does not exist.")
    name = template_filename(level)
    assets = load_form_assets(name, field_map_filename(level), required_keys=REQUIRED_FIELD_KEYS)
    if assets is None:
        raise NoticeTemplateUnavailable(f"Late notice level {level} template pair is unavailable.")
    meta = assets.meta
    if (
        meta.get("template") != name
        or meta.get("version") != TEMPLATE_VERSION
        or meta.get("asset_revision") != ASSET_REVISION
        or (meta.get("style") or {}).get("level") != level
    ):
        raise NoticeTemplateUnavailable(f"Late notice level {level} map is not the approved version.")
    signature = assets.fields[HR_SIGNATURE_FIELD]
    if signature.get("kind") != "image" or signature.get("auto_sign") is not False or not signature.get("manual_only"):
        raise NoticeTemplateUnavailable(f"Late notice level {level} map must keep the HR signature manual.")
    if assets.fields[LOGO_FIELD].get("kind") != "image":
        raise NoticeTemplateUnavailable(f"Late notice level {level} map must declare the logo as an image.")
    return assets


def _local(value: Any, fmt: str) -> str:
    return timezone.localtime(value).strftime(fmt) if value else ""


def _minutes_late(result) -> str:
    if not result.first_check_in_at or not result.shift_start_at:
        return ""
    return str(max(0, int((result.first_check_in_at - result.shift_start_at).total_seconds() // 60)))


def format_percentage(fraction: Decimal) -> str:
    """``Decimal("0.05")`` -> ``"5%"``; the policy stores penalties as fractions of the daily rate."""
    percent = (Decimal(fraction) * 100).quantize(Decimal("0.01")).normalize()
    return f"{percent:f}%"


def format_amount(amount: Decimal) -> str:
    return f"{CURRENCY} {Decimal(amount).quantize(Decimal('0.01')):,.2f}"


def reason_text(code: str) -> str:
    return REASON_TEXT.get(code, DEFAULT_REASON_TEXT)


def build_notice_values(notice: AttendanceLateNotice) -> dict[str, str]:
    """Values for the approved map's text fields only, from real system data.

    ``OrganizationNode`` has a canonical name and logo but no Arabic name or
    contact details, so ``company_name_ar`` repeats the canonical name and the
    optional contact fields stay empty rather than holding invented data.
    """
    from core.pdf_signers import display_name
    from permission_requests.labels import profile_department, profile_job_title

    violation = notice.violation
    result = violation.result
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
        "violation_date": violation.date.isoformat(),
        "scheduled_shift_start": _local(result.shift_start_at, "%H:%M"),
        "actual_first_check_in": _local(result.first_check_in_at, "%H:%M"),
        "minutes_late": _minutes_late(result),
        "occurrence_number": str(notice.occurrence_number),
        "penalty_percentage": format_percentage(notice.penalty_percent),
        "policy_result": policy_result(notice.level)[0],
        "penalty_amount": format_amount(notice.penalty_amount),
        "reason": reason_text(violation.reason),
        "company_phone": "",
        "company_address": "",
        "company_website": "",
        "company_email": "",
    }


def load_company_logo(company) -> tuple[SignatureAsset | None, str]:
    """Read the configured private logo into memory. Returns ``(asset, "")`` or ``(None, outcome)``.

    Never raises and never logs the storage path or the file contents.
    """
    logo = getattr(company, "logo", None)
    if not logo:
        return None, LOGO_NOT_CONFIGURED
    try:
        logo.open("rb")
        try:
            data = logo.read(MAX_LOGO_BYTES + 1)
        finally:
            logo.close()
    except Exception as exc:
        logger.warning(
            "attendance_late_notice_logo_unreadable",
            extra={"company_id": company.id, "error_type": type(exc).__name__},
        )
        return None, LOGO_UNREADABLE
    if len(data) > MAX_LOGO_BYTES:
        return None, LOGO_OVERSIZED
    asset = SignatureAsset(data=data, signer_label="company_logo")
    if not asset.is_supported_image():
        return None, LOGO_INVALID
    return asset, ""


def render_notice_pdf(
    level: int,
    values: dict[str, Any],
    *,
    assets: FormAssets | None = None,
    company_logo: SignatureAsset | None = None,
) -> tuple[bytes, str]:
    """Overlay ``values`` and the optional logo onto the approved pair. Returns ``(pdf, logo_outcome)``.

    The HR signature slot is never passed to the renderer. A logo that cannot be
    drawn leaves the approved blank placeholder and never fails the notice.
    """
    unapproved = sorted(set(values) - set(MAPPED_TEXT_FIELDS))
    if unapproved:
        raise ValueError(f"Values outside the approved field map: {', '.join(unapproved)}")
    assets = assets or load_notice_assets(level)
    if company_logo is None:
        pdf_bytes, _ = render_mapped_form(assets, values, signatures={})
        return pdf_bytes, LOGO_NOT_CONFIGURED
    try:
        pdf_bytes, diagnostics = render_mapped_form(assets, values, signatures={LOGO_FIELD: company_logo})
    except Exception as exc:
        logger.warning(
            "attendance_late_notice_logo_render_failed", extra={"level": level, "error_type": type(exc).__name__}
        )
        pdf_bytes, _ = render_mapped_form(assets, values, signatures={})
        return pdf_bytes, LOGO_INVALID
    state = next((row["state"] for row in diagnostics if row.get("field") == LOGO_FIELD), LOGO_INVALID)
    if state == SIGNATURE_PLACED:
        return pdf_bytes, LOGO_PLACED
    return pdf_bytes, LOGO_UNPLACEABLE if state == "unplaceable" else LOGO_INVALID


def delivery_state(notice: AttendanceLateNotice) -> tuple[str, str]:
    """Current delivery state: the in-app notification plus configured external channels."""
    if notice.notification_id is None:
        return notice.delivery_status, notice.delivery_message
    statuses = {delivery.status for delivery in notice.notification.deliveries.all()}
    if NotificationDelivery.Status.SENT in statuses:
        return Status.SENT, "Delivered in-app and through a configured external channel."
    if not statuses or NotificationDelivery.Status.PENDING in statuses:
        return Status.SCHEDULED, "In-app notification created; external delivery is scheduled."
    if NotificationDelivery.Status.FAILED in statuses:
        return Status.FAILED, "In-app notification created; external delivery failed."
    return Status.SKIPPED, "In-app notification created; no configured external channel was available."


def issue_late_notice_for_new_violation(violation: AttendanceLateViolation) -> AttendanceLateNotice | None:
    """Create, render, and deliver exactly one notice for a violation created by the policy.

    Called only from the policy's new-violation path, so existing and legacy rows are
    never backfilled. Returns the existing notice (of any template version) untouched
    when one exists and ``None`` when nothing was issued. Rendering and delivery
    failures never reach the caller.
    """
    if violation.lifecycle != AttendanceLateViolation.Lifecycle.ACTIVE:
        return None
    existing = AttendanceLateNotice.objects.filter(violation=violation).first()
    if existing is not None:
        return existing

    level = level_for_occurrence(violation.occurrence_number)
    company = violation.company
    logo_asset, logo_state = load_company_logo(company)
    try:
        with transaction.atomic():
            assets = load_notice_assets(level)
            notice = AttendanceLateNotice.objects.create(
                violation=violation,
                employee_profile=violation.employee_profile,
                company=company,
                reference_number=f"LAN-{company.code}-{violation.id:06d}",
                level=level,
                occurrence_number=violation.occurrence_number,
                template_name=Path(assets.template_path).name,
                template_version=TEMPLATE_VERSION,
                penalty_percent=violation.penalty_percent,
                penalty_amount=violation.penalty_amount,
                company_logo_configured=bool(getattr(company, "logo", None)),
            )
            pdf_bytes, rendered_logo_state = render_notice_pdf(
                level, build_notice_values(notice), assets=assets, company_logo=logo_asset
            )
            logo_state = logo_state or rendered_logo_state
            notice.document.save(notice_filename(notice), ContentFile(pdf_bytes), save=False)
            notice.save(update_fields=["document"])
    except Exception as exc:
        # The exception text can name private storage locations, so only its type is logged.
        logger.error(
            "attendance_late_notice_generation_failed",
            extra={"violation_id": violation.id, "level": level, "error_type": type(exc).__name__},
        )
        audit(
            None,
            "attendance_late_notice_generation_failed",
            "AttendanceLateViolation",
            violation.id,
            {"level": level, "occurrence_number": violation.occurrence_number},
        )
        return None

    audit(
        None,
        "attendance_late_notice_generated",
        "AttendanceLateNotice",
        notice.id,
        {
            "violation_id": violation.id,
            "level": level,
            "occurrence_number": notice.occurrence_number,
            "reference_number": notice.reference_number,
            "template": notice.template_name,
            "template_version": notice.template_version,
            "company_logo_configured": notice.company_logo_configured,
            "company_logo_state": logo_state,
        },
    )
    _deliver(notice)
    return notice


def whatsapp_variables(notice: AttendanceLateNotice) -> dict[str, str]:
    """Variables for ``late_attendance_notice_v1``, in the template's declared order."""
    from core.pdf_signers import display_name

    level_en, level_ar = level_labels(notice.level)
    result_en, result_ar = policy_result(notice.level)
    values = {
        "employee_name": display_name(profile=notice.employee_profile),
        "notice_level": level_en,
        "notice_level_ar": level_ar,
        "violation_date": notice.violation.date.isoformat(),
        "occurrence_number": str(notice.occurrence_number),
        "reference_number": notice.reference_number,
        "policy_result": result_en,
        "policy_result_ar": result_ar,
        "action_url": NOTICE_ACTION_URL,
    }
    return {name: values[name] for name in WHATSAPP_VARIABLES}


def _deliver(notice: AttendanceLateNotice) -> None:
    # Bilingual catalog text identical to the approved template's preprinted level copy.
    text = notification_text(notice_notification_key(notice.level))

    employee = notice.employee_profile.user
    notification = None
    if employee is None or not employee.is_active:
        status, message = Status.SKIPPED, "Employee has no active user account; the notice is available to HR."
    else:
        try:
            # A delivery error must never abort the attendance transaction.
            with transaction.atomic():
                result = dispatch_notification_channels(
                    recipient=employee,
                    event_key=NOTICE_EVENT_KEY,
                    title=text["title"],
                    message=text["message"],
                    category=Notification.Category.ATTENDANCE,
                    action_url=NOTICE_ACTION_URL,
                    related_object=notice,
                    company=notice.company,
                    metadata={"notice_id": notice.id, "download_path": f"/api/attendance/notices/{notice.id}/download/"},
                    deduplication_key=f"{NOTICE_EVENT_KEY}:{notice.violation_id}",
                    i18n=text["i18n"],
                    whatsapp_template=WHATSAPP_TEMPLATE,
                    whatsapp_variables=whatsapp_variables(notice),
                    # The PDF is read from private storage and uploaded directly; no URL is sent.
                    whatsapp_document={"attendance_late_notice_id": notice.id},
                    redeliver_existing=False,
                )
            notification = result.get("notification") if isinstance(result, dict) else None
        except Exception:
            logger.exception("attendance_late_notice_delivery_failed", extra={"notice_id": notice.id})
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
        f"attendance_late_notice_delivery_{status}",
        "AttendanceLateNotice",
        notice.id,
        {
            "violation_id": notice.violation_id,
            "notification_id": getattr(notification, "id", None),
            "delivery_status": status,
        },
    )
