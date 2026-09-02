from __future__ import annotations

import logging

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db.models import Q

from core.permissions import CEO_APPROVER_DEPARTMENT_ID
from core.services.bird_email_service import send_generic_notification_email
from employees.models import EmployeeProfile
from in_app_notifications.dispatcher import dispatch_notification_channels
from in_app_notifications.models import Notification
from organization.services import get_user_accessible_company_ids

from .models import JobOffer, StartingWorkAcknowledgment

logger = logging.getLogger(__name__)
User = get_user_model()


def get_company_ceo_recipients(company):
    return (
        User.objects.filter(
            Q(groups__name__in=["CEO", "SystemAdmin"])
            | Q(
                employee_profile__employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
                employee_profile__department_ref_id=CEO_APPROVER_DEPARTMENT_ID,
            )
        )
        .filter(is_active=True)
        .filter(
            Q(groups__name="SystemAdmin")
            | Q(employee_profile__company=company)
            | Q(organization_access_entries__organization=company)
        )
        .distinct()
    )


def _frontend_url(path: str) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}/{path.lstrip('/')}"


def _safe_email(**kwargs) -> dict:
    """Send a branded bilingual job-offer email, swallowing delivery errors."""
    if not kwargs.get("to_email"):
        return {"success": False, "skipped": True, "error": "Recipient email is missing."}
    try:
        return send_generic_notification_email(**kwargs)
    except Exception:
        logger.exception("job_offer_email_failed")
        return {"success": False, "error": "Email delivery failed."}


def _link(url: str, label: str) -> str:
    return (
        f'<a href="{url}" style="display:inline-block;margin:6px 8px 0 0;padding:9px 16px;'
        f'border-radius:4px;background-color:#1c1f24;color:#ffffff;text-decoration:none;'
        f'font-weight:600;font-size:13px;">{label}</a>'
    )


def _approval_event_key(offer: JobOffer) -> str:
    event = (offer.approval_events or [{}])[-1]
    return str(event.get("id") or len(offer.approval_events or []))


def notify_job_offer_submitted(offer: JobOffer) -> list[dict]:
    requester_name = offer.created_by.full_name or offer.created_by.email
    review_path = f"/ceo/job-offers/{offer.id}"
    review_url = _frontend_url(review_path)
    backend_url = (getattr(settings, "BACKEND_PUBLIC_URL", "") or "").rstrip("/")
    cv_url = f"{backend_url}/job-offers/{offer.id}/cv/" if backend_url else f"{review_url}?open_cv=1"
    details = [
        f"Candidate: {offer.candidate_full_name}",
        f"Company: {offer.company.name}",
        f"Reference: {offer.reference_number}",
        f"Salary package: {offer.total_salary_package}",
    ]
    message = "; ".join(details)
    results = []
    event_key = _approval_event_key(offer)
    for recipient in get_company_ceo_recipients(offer.company):
        dispatch = dispatch_notification_channels(
            recipient=recipient,
            event_key="job_offer.submitted",
            title=f"Job offer {offer.reference_number} requires CEO review",
            message=message,
            category=Notification.Category.APPROVAL,
            action_url=review_url,
            related_object=offer,
            metadata={
                "reference_number": offer.reference_number,
                "requester_id": offer.created_by_id,
                "approval_status": offer.approval_status,
            },
            deduplication_key=f"job_offer.submitted:{offer.id}:{event_key}",
            company=offer.company,
            whatsapp_enabled=True,
            email_enabled=False,
        )

        recipient_name = recipient.full_name or recipient.email
        email = _safe_email(
            to_email=recipient.email,
            subject=f"Job Offer {offer.reference_number} requires CEO review",
            title="Job offer requires your review",
            title_ar="عرض عمل يتطلب مراجعتك",
            employee_name=recipient_name,
            message=f"Job offer {offer.reference_number}, submitted by {requester_name}, is awaiting your review.",
            message_ar=(
                f"عرض العمل {offer.reference_number} المقدَّم من {requester_name} بانتظار مراجعتك."
            ),
            status="Action required",
            status_ar="إجراء مطلوب",
            status_tone="action",
            details_title="Job offer details",
            details_title_ar="تفاصيل عرض العمل",
            rows=[
                {"label": "Candidate", "label_ar": "المرشّح", "value": offer.candidate_full_name},
                {"label": "Company", "label_ar": "الشركة", "value": offer.company.name},
                {"label": "Reference", "label_ar": "الرقم المرجعي", "value": offer.reference_number},
                {"label": "Salary package", "label_ar": "إجمالي الراتب", "value": offer.total_salary_package},
                {"label": "Requested by", "label_ar": "مقدّم الطلب", "value": requester_name},
            ],
            next_steps_html=_link(cv_url, "Open candidate CV"),
            next_steps_html_ar=_link(cv_url, "فتح السيرة الذاتية للمرشّح"),
            action_url=review_url,
            action_text="Review job offer",
            action_text_ar="مراجعة عرض العمل",
        )
        results.append(
            {
                "recipient_id": recipient.id,
                "in_app_created": dispatch.get("notification") is not None,
                "whatsapp_status": (dispatch.get("whatsapp") or {}).get("status"),
                "email_sent": bool(email.get("success")),
            }
        )
    return results


def notify_job_offer_decided(offer: JobOffer) -> list[dict]:
    detail_path = f"/hr/job-offers/{offer.id}"
    detail_url = _frontend_url(detail_path)
    decision = offer.get_approval_status_display()
    reason_text = f" Reason: {offer.ceo_decision_reason}" if offer.ceo_decision_reason else ""
    recommendation_text = f" Recommendation: {offer.ceo_recommendation}" if offer.ceo_recommendation else ""
    message = f"Job offer {offer.reference_number} is {decision.lower()}.{reason_text}{recommendation_text}"
    approved = "approv" in str(offer.approval_status).lower()
    rejected = "reject" in str(offer.approval_status).lower()
    results = []
    event_key = _approval_event_key(offer)
    for recipient in get_company_hr_recipients(offer.company):
        dispatch = dispatch_notification_channels(
            recipient=recipient,
            event_key=f"job_offer.{offer.approval_status}",
            title=f"Job offer {decision.lower()}",
            message=message,
            category=Notification.Category.REQUEST,
            action_url=detail_url,
            related_object=offer,
            metadata={
                "reference_number": offer.reference_number,
                "approval_status": offer.approval_status,
                "ceo_decision_by_id": offer.ceo_decision_by_id,
            },
            deduplication_key=f"job_offer.{offer.approval_status}:{offer.id}:{event_key}",
            company=offer.company,
            whatsapp_enabled=True,
            email_enabled=False,
        )
        rows = [
            {"label": "Reference", "label_ar": "الرقم المرجعي", "value": offer.reference_number},
            {"label": "Candidate", "label_ar": "المرشّح", "value": offer.candidate_full_name},
            {"label": "Decision", "label_ar": "القرار", "value": decision,
             "value_color": "#15803d" if approved else "#b42318" if rejected else None},
        ]
        if offer.ceo_decision_reason:
            rows.append({"label": "Reason", "label_ar": "السبب", "value": offer.ceo_decision_reason})
        if offer.ceo_recommendation:
            rows.append({"label": "Recommendation", "label_ar": "التوصية", "value": offer.ceo_recommendation})
        email = _safe_email(
            to_email=recipient.email,
            subject=f"Job Offer {offer.reference_number}: {decision}",
            title=f"Job offer {decision.lower()}",
            title_ar="تم البتّ في عرض العمل",
            employee_name=recipient.full_name or recipient.email,
            message=f"Job offer {offer.reference_number} has been {decision.lower()} by the CEO.",
            message_ar=f"تم {'اعتماد' if approved else 'رفض' if rejected else 'تحديث'} عرض العمل {offer.reference_number} من قِبل الرئيس التنفيذي.",
            status=decision,
            status_ar="معتمد" if approved else "مرفوض" if rejected else decision,
            status_tone="success" if approved else "danger" if rejected else "info",
            details_title="Decision details",
            details_title_ar="تفاصيل القرار",
            rows=rows,
            action_url=detail_url,
            action_text="View job offer",
            action_text_ar="عرض تفاصيل العرض",
        )
        results.append(
            {
                "recipient_id": recipient.id,
                "in_app_created": dispatch.get("notification") is not None,
                "whatsapp_status": (dispatch.get("whatsapp") or {}).get("status"),
                "email_sent": bool(email.get("success")),
            }
        )
    return results


def get_company_hr_recipients(company):
    candidates = User.objects.filter(is_active=True, groups__name__in=["HRManager", "SystemAdmin"]).distinct()
    return [
        user
        for user in candidates
        if user.groups.filter(name="SystemAdmin").exists() or company.id in get_user_accessible_company_ids(user)
    ]


def notify_job_offer_biotime_mapping_missing(offer: JobOffer) -> list[dict]:
    profile = offer.employee_profile
    if profile is None:
        return []

    employee_name = profile.full_name_en or profile.full_name or offer.candidate_full_name or profile.employee_id
    action_url = f"/hr/job-offers/{offer.id}"
    message = (
        f"BioTime mapping is missing for {employee_name} ({profile.employee_id}) after accepting "
        f"job offer {offer.reference_number}. Add the employee mapping before attendance synchronization."
    )
    results = []
    for recipient in get_company_hr_recipients(profile.company):
        dispatch = dispatch_notification_channels(
            recipient=recipient,
            event_key="job_offer.biotime_mapping_missing",
            title=f"BioTime mapping required for {employee_name}",
            message=message,
            category=Notification.Category.ATTENDANCE,
            action_url=action_url,
            related_object=offer,
            metadata={
                "job_offer_id": offer.id,
                "employee_profile_id": profile.id,
                "employee_id": profile.employee_id,
            },
            deduplication_key=f"job_offer.biotime_mapping_missing:{offer.id}",
            company=profile.company,
            whatsapp_enabled=True,
            email_enabled=True,
            redeliver_existing=False,
        )
        results.append(
            {
                "recipient_id": recipient.id,
                "in_app_created": dispatch.get("notification") is not None,
                "whatsapp_status": (dispatch.get("whatsapp") or {}).get("status"),
                "email_status": (dispatch.get("email") or {}).get("status"),
            }
        )
    return results


def notify_starting_work_acknowledgment_ready(
    acknowledgment: StartingWorkAcknowledgment,
) -> list[dict]:
    profile = acknowledgment.employee_profile
    employee_name = (
        profile.full_name_en
        or profile.full_name
        or profile.full_name_ar
        or getattr(profile.user, "full_name", "")
        or profile.employee_id
    )
    profile_path = f"/hr/starting-work-acknowledgments/{acknowledgment.id}"
    profile_url = _frontend_url(profile_path)
    backend_url = (getattr(settings, "BACKEND_PUBLIC_URL", "") or "").rstrip("/")
    download_path = f"/starting-work-acknowledgments/{acknowledgment.id}/pdf/"
    download_url = f"{backend_url}{download_path}" if backend_url else download_path
    start_date = acknowledgment.attendance_record.date.isoformat()
    message = (
        f"Starting Work Acknowledgment requires HR BioTime verification. Employee: {employee_name}; "
        f"Employee ID: {profile.employee_id}; Start date: {start_date}; "
        f"Profile: {profile_url}; Document: {download_url}"
    )

    results = []
    for recipient in get_company_hr_recipients(acknowledgment.company):
        dispatch = dispatch_notification_channels(
            recipient=recipient,
            event_key="starting_work_acknowledgment.pending_hr",
            title=f"Verify starting work attendance for {employee_name}",
            message=message,
            category=Notification.Category.DOCUMENT,
            action_url=profile_path,
            related_object=acknowledgment,
            metadata={
                "reference_number": acknowledgment.reference_number,
                "employee_profile_id": profile.id,
                "employee_id": profile.employee_id,
                "document_id": acknowledgment.document_id,
                "start_date": start_date,
            },
            deduplication_key=f"starting_work_acknowledgment.pending_hr:{acknowledgment.id}",
            company=acknowledgment.company,
            whatsapp_enabled=True,
            email_enabled=False,
        )
        recipient_name = recipient.full_name or recipient.email
        email = _safe_email(
            to_email=recipient.email,
            subject=f"Verify starting work attendance for {employee_name}",
            title="Starting work attendance needs verification",
            title_ar="إثبات مباشرة العمل يحتاج إلى تحقّق",
            employee_name=recipient_name,
            message=f"The Starting Work Acknowledgment for {employee_name} requires HR BioTime verification.",
            message_ar=f"إثبات مباشرة العمل للموظف {employee_name} يتطلب التحقق من قِبل الموارد البشرية عبر نظام البصمة.",
            status="Action required",
            status_ar="إجراء مطلوب",
            status_tone="action",
            details_title="Acknowledgment details",
            details_title_ar="تفاصيل الإثبات",
            rows=[
                {"label": "Employee", "label_ar": "الموظف", "value": employee_name},
                {"label": "Employee ID", "label_ar": "الرقم الوظيفي", "value": profile.employee_id},
                {"label": "Start date", "label_ar": "تاريخ المباشرة", "value": start_date},
                {"label": "Reference", "label_ar": "الرقم المرجعي", "value": acknowledgment.reference_number},
            ],
            next_steps_html=_link(download_url, "Download acknowledgment"),
            next_steps_html_ar=_link(download_url, "تنزيل الإثبات"),
            action_url=profile_url,
            action_text="Open HR verification",
            action_text_ar="فتح شاشة التحقق",
        )
        results.append(
            {
                "recipient_id": recipient.id,
                "in_app_created": dispatch.get("notification") is not None,
                "whatsapp_status": (dispatch.get("whatsapp") or {}).get("status"),
                "email_sent": bool(email.get("success")),
            }
        )
    return results
