from __future__ import annotations

import logging
from html import escape

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db.models import Q

from core.permissions import CEO_APPROVER_DEPARTMENT_ID
from core.services import EmailService
from employees.models import EmployeeProfile
from in_app_notifications.dispatcher import dispatch_notification_channels
from in_app_notifications.models import Notification
from organization.services import get_user_accessible_company_ids

from .models import HiringRequest, JobOffer, StartingWorkAcknowledgment

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


def _safe_email(*, to_email: str, subject: str, html: str, text: str) -> dict:
    if not to_email:
        return {"success": False, "skipped": True, "error": "Recipient email is missing."}
    try:
        return EmailService().send_html_email(
            to_email=to_email,
            subject=subject,
            html_content=html,
            fallback_text=text,
        )
    except Exception:
        logger.exception("hiring_request_email_failed")
        return {"success": False, "error": "Email delivery failed."}


def notify_hiring_request_submitted(hiring_request: HiringRequest) -> list[dict]:
    requester_name = hiring_request.requested_by.full_name or hiring_request.requested_by.email
    review_path = f"/ceo/hiring-requests/{hiring_request.id}"
    review_url = _frontend_url(review_path)
    backend_url = (getattr(settings, "BACKEND_PUBLIC_URL", "") or "").rstrip("/")
    cv_url = f"{backend_url}/hiring-requests/{hiring_request.id}/cv/" if backend_url else f"{review_url}?open_cv=1"
    details = [
        f"Candidate: {hiring_request.candidate_full_name}",
        f"Company: {hiring_request.company.name}",
        f"Reference: {hiring_request.reference_number}",
        f"Proposed salary: {hiring_request.proposed_salary}",
    ]
    message = "; ".join(details)
    results = []
    for recipient in get_company_ceo_recipients(hiring_request.company):
        dispatch = dispatch_notification_channels(
            recipient=recipient,
            event_key="hiring_request.submitted",
            title=f"Hiring request {hiring_request.reference_number} requires review",
            message=message,
            category=Notification.Category.APPROVAL,
            action_url=review_url,
            related_object=hiring_request,
            metadata={
                "reference_number": hiring_request.reference_number,
                "requester_id": hiring_request.requested_by_id,
            },
            deduplication_key=f"hiring_request.submitted:{hiring_request.id}",
            company=hiring_request.company,
            whatsapp_enabled=True,
            email_enabled=False,
        )

        recipient_name = recipient.full_name or recipient.email
        email = _safe_email(
            to_email=recipient.email,
            subject=f"Hiring Request {hiring_request.reference_number} requires review",
            html=(
                f"<p>Dear {escape(recipient_name)},</p><p>{escape(message)}</p>"
                f"<p>Requested by: {escape(requester_name)}</p>"
                f'<p><a href="{escape(review_url)}">Review hiring request</a></p>'
                f'<p><a href="{escape(cv_url)}">Open CV through the authenticated CV endpoint</a></p>'
            ),
            text=(f"{message}\nRequested by: {requester_name}\nReview: {review_url}\nProtected CV: {cv_url}"),
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


def notify_hiring_request_decided(hiring_request: HiringRequest) -> dict:
    recipient = hiring_request.requested_by
    detail_path = f"/hr/hiring-requests/{hiring_request.id}"
    detail_url = _frontend_url(detail_path)
    decision = hiring_request.get_status_display()
    note_text = f" CEO note: {hiring_request.ceo_decision_note}" if hiring_request.ceo_decision_note else ""
    message = f"Hiring request {hiring_request.reference_number} was {decision.lower()}.{note_text}"
    dispatch = dispatch_notification_channels(
        recipient=recipient,
        event_key=f"hiring_request.{hiring_request.status}",
        title=f"Hiring request {decision.lower()}",
        message=message,
        category=Notification.Category.REQUEST,
        action_url=detail_url,
        related_object=hiring_request,
        metadata={
            "reference_number": hiring_request.reference_number,
            "status": hiring_request.status,
            "ceo_decision_by_id": hiring_request.ceo_decision_by_id,
        },
        deduplication_key=f"hiring_request.{hiring_request.status}:{hiring_request.id}",
        company=hiring_request.company,
        whatsapp_enabled=True,
        email_enabled=False,
    )
    email = _safe_email(
        to_email=recipient.email,
        subject=f"Hiring Request {hiring_request.reference_number}: {decision}",
        html=f'<p>{escape(message)}</p><p><a href="{escape(detail_url)}">View request</a></p>',
        text=f"{message}\n{detail_url}",
    )
    return {
        "recipient_id": recipient.id,
        "in_app_created": dispatch.get("notification") is not None,
        "whatsapp_status": (dispatch.get("whatsapp") or {}).get("status"),
        "email_sent": bool(email.get("success")),
    }


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
    profile_path = f"/hr/employees/{profile.id}"
    profile_url = _frontend_url(profile_path)
    backend_url = (getattr(settings, "BACKEND_PUBLIC_URL", "") or "").rstrip("/")
    download_path = f"/api/employees/{profile.id}/documents/{acknowledgment.document_id}/download/"
    download_url = f"{backend_url}{download_path}" if backend_url else download_path
    start_date = acknowledgment.attendance_record.date.isoformat()
    message = (
        f"Starting Work Acknowledgment is ready to download. Employee: {employee_name}; "
        f"Employee ID: {profile.employee_id}; Start date: {start_date}; "
        f"Profile: {profile_url}; Document: {download_url}"
    )

    results = []
    for recipient in get_company_hr_recipients(acknowledgment.company):
        dispatch = dispatch_notification_channels(
            recipient=recipient,
            event_key="starting_work_acknowledgment.ready",
            title=f"Starting Work Acknowledgment ready for {employee_name}",
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
            deduplication_key=f"starting_work_acknowledgment.ready:{acknowledgment.id}",
            company=acknowledgment.company,
            whatsapp_enabled=True,
            email_enabled=False,
        )
        recipient_name = recipient.full_name or recipient.email
        email = _safe_email(
            to_email=recipient.email,
            subject=f"Starting Work Acknowledgment ready for {employee_name}",
            html=(
                f"<p>Dear {escape(recipient_name)},</p><p>{escape(message)}</p>"
                f'<p><a href="{escape(profile_url)}">Open employee profile</a></p>'
                f'<p><a href="{escape(download_url)}">Download acknowledgment</a></p>'
            ),
            text=f"{message}\nProfile: {profile_url}\nDocument: {download_url}",
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
