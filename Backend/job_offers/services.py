import base64
import logging
import secrets
import string
from datetime import timedelta
from html import escape
from typing import Any

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.utils import timezone

from admin_portal.models import SystemSettings
from attendance.models import BioTimeEmployeeMap
from core.services import EmailService, WhatsAppService, send_user_invite_email, send_user_invite_whatsapp
from core.services.whatsapp_notifications import get_user_whatsapp_number
from employees.models import EmployeeProfile
from invites.models import Invite

from .models import JobOffer
from .notifications import get_company_ceo_recipients
from .pdf import build_job_offer_pdf
from .starting_work_pdf import StartingWorkAcknowledgmentData, build_starting_work_acknowledgment_pdf

logger = logging.getLogger(__name__)
User = get_user_model()


def build_response_link(token: str) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}/job-offers/respond?token={token}"


def _safe_delivery_result(result: dict[str, Any] | None, *, provider: str) -> dict[str, Any]:
    result = result or {}
    sent = bool(result.get("success") or result.get("sent"))
    return {
        "sent": sent,
        "provider": str(result.get("provider") or provider)[:64],
        "status_code": result.get("status_code"),
        "message_id": str(result.get("message_id") or "")[:255] or None,
        "error": None if sent else "Delivery failed.",
        "attempted_at": timezone.now().isoformat(),
    }


def _skipped_delivery(*, provider: str, reason: str) -> dict[str, Any]:
    return {
        "sent": False,
        "skipped": True,
        "provider": provider,
        "status_code": None,
        "message_id": None,
        "error": reason,
        "attempted_at": timezone.now().isoformat(),
    }


def _send_offer_email(
    *,
    email_service: EmailService,
    to_email: str,
    recipient_name: str,
    offer: JobOffer,
    response_link: str,
    attachments: list[dict[str, Any]],
) -> dict[str, Any]:
    if not to_email:
        return _skipped_delivery(provider="bird", reason="Recipient email is missing.")
    try:
        result = email_service.send_html_email(
            to_email=to_email,
            subject=f"Job Offer {offer.reference_number}",
            html_content=(
                f"<p>Dear {escape(recipient_name)},</p>"
                f"<p>Please find the job offer for {escape(offer.candidate_full_name)} "
                f"({escape(offer.position_title)}) attached.</p>"
                f'<p><a href="{escape(response_link)}">Open job offer response page</a></p>'
            ),
            fallback_text=(
                f"Job offer {offer.reference_number} for {offer.candidate_full_name}. Response page: {response_link}"
            ),
            attachments=attachments,
        )
    except Exception:
        logger.exception("job_offer_email_delivery_failed", extra={"job_offer_id": offer.id})
        result = None
    delivery = _safe_delivery_result(result, provider="bird")
    delivery["attachment"] = "attached" if attachments else "link_only"
    return delivery


def deliver_job_offer(offer: JobOffer) -> dict[str, Any]:
    response_link = build_response_link(offer.response_token or "")
    filename = f"job-offer-{offer.reference_number}.pdf"
    warning_details: dict[str, list[str]] = {
        "candidate_text": [],
        "candidate_whatsapp_pdf": [],
        "candidate_email_pdf": [],
        "ceo_whatsapp_pdf": [],
        "ceo_email_pdf": [],
    }
    candidate: dict[str, Any] = {
        "text": _skipped_delivery(provider="evolution_whatsapp", reason="Candidate phone number is missing."),
        "whatsapp_pdf": _skipped_delivery(provider="evolution_whatsapp", reason="Candidate phone number is missing."),
        "email_pdf": _skipped_delivery(provider="bird", reason="Candidate email is missing."),
    }
    ceo_recipients = list(get_company_ceo_recipients(offer.company))

    if offer.candidate_phone_number:
        try:
            result = WhatsAppService().send_template_message(
                phone_number=offer.candidate_phone_number,
                template_name="job_offer",
                template_variables={
                    "candidate_name": offer.candidate_full_name,
                    "position_title": offer.position_title,
                    "reference_number": offer.reference_number,
                    "expiry_date": offer.expiry_date.isoformat(),
                    "response_link": response_link,
                },
            )
        except Exception:
            logger.exception("job_offer_whatsapp_delivery_failed", extra={"job_offer_id": offer.id})
            result = None
        candidate["text"] = _safe_delivery_result(result, provider="evolution_whatsapp")
        if not candidate["text"]["sent"]:
            warning_details["candidate_text"].append("Candidate WhatsApp text delivery failed.")

    email_service = EmailService()
    pdf_bytes = b""
    pdf_base64 = ""
    media_url = ""
    attachments: list[dict[str, Any]] = []
    needs_pdf_delivery = bool(
        offer.candidate_phone_number
        or offer.candidate_email
        or any(get_user_whatsapp_number(user) or user.email for user in ceo_recipients)
    )
    if needs_pdf_delivery:
        try:
            pdf_bytes = build_job_offer_pdf(offer)
            pdf_base64 = base64.b64encode(pdf_bytes).decode("ascii")
            upload = email_service.upload_media(filename=filename, content=pdf_bytes, content_type="application/pdf")
            if upload.get("success") and upload.get("media_url"):
                media_url = str(upload["media_url"])
                attachments = [{"mediaUrl": media_url, "filename": filename}]
        except Exception:
            logger.exception("job_offer_pdf_media_upload_failed", extra={"job_offer_id": offer.id})

    if offer.candidate_phone_number:
        if pdf_base64:
            try:
                result = WhatsAppService().send_document_message(
                    phone_number=offer.candidate_phone_number,
                    document_base64=pdf_base64,
                    file_name=filename,
                    caption=f"Job Offer {offer.reference_number}",
                )
            except Exception:
                logger.exception("job_offer_candidate_whatsapp_pdf_failed", extra={"job_offer_id": offer.id})
                result = None
            candidate["whatsapp_pdf"] = _safe_delivery_result(result, provider="evolution_whatsapp")
        else:
            candidate["whatsapp_pdf"] = _skipped_delivery(
                provider="evolution_whatsapp", reason="PDF generation failed."
            )
        if not candidate["whatsapp_pdf"]["sent"]:
            warning_details["candidate_whatsapp_pdf"].append("Candidate WhatsApp PDF delivery failed.")

    if offer.candidate_email:
        candidate["email_pdf"] = _send_offer_email(
            email_service=email_service,
            to_email=offer.candidate_email,
            recipient_name=offer.candidate_full_name,
            offer=offer,
            response_link=response_link,
            attachments=attachments,
        )
        if not attachments:
            warning_details["candidate_email_pdf"].append(
                "Candidate email PDF attachment upload failed; email used the response link only."
            )
        if not candidate["email_pdf"]["sent"]:
            warning_details["candidate_email_pdf"].append("Candidate email delivery failed.")

    ceo_deliveries = []
    for user in ceo_recipients:
        phone = get_user_whatsapp_number(user)
        if phone and pdf_base64:
            try:
                whatsapp_result = WhatsAppService().send_document_message(
                    phone_number=phone,
                    document_base64=pdf_base64,
                    file_name=filename,
                    caption=f"CEO copy: Job Offer {offer.reference_number}",
                )
            except Exception:
                logger.exception(
                    "job_offer_ceo_whatsapp_pdf_failed", extra={"job_offer_id": offer.id, "recipient_id": user.id}
                )
                whatsapp_result = None
            whatsapp_pdf = _safe_delivery_result(whatsapp_result, provider="evolution_whatsapp")
        else:
            whatsapp_pdf = _skipped_delivery(
                provider="evolution_whatsapp",
                reason="Recipient WhatsApp number is missing." if not phone else "PDF generation failed.",
            )
        if phone and not whatsapp_pdf["sent"]:
            warning_details["ceo_whatsapp_pdf"].append(f"CEO WhatsApp PDF delivery failed for user {user.id}.")

        email_pdf = _send_offer_email(
            email_service=email_service,
            to_email=user.email,
            recipient_name=user.full_name or user.email,
            offer=offer,
            response_link=response_link,
            attachments=attachments,
        )
        if user.email and (not email_pdf["sent"] or not attachments):
            warning_details["ceo_email_pdf"].append(f"CEO email PDF delivery failed for user {user.id}.")
        ceo_deliveries.append(
            {
                "user_id": user.id,
                "display_name": user.full_name or user.email,
                "whatsapp_pdf": whatsapp_pdf,
                "email_pdf": email_pdf,
            }
        )

    warnings = [message for category in warning_details.values() for message in category]
    return {
        "channels": {"whatsapp": candidate["text"], "email": candidate["email_pdf"]},
        "candidate": candidate,
        "ceo": {"recipients": ceo_deliveries},
        "warning_details": warning_details,
        "warnings": warnings,
    }


def get_biotime_status(employee_profile: EmployeeProfile | None) -> dict[str, Any]:
    mapping = None
    if employee_profile is not None:
        mapping = (
            BioTimeEmployeeMap.objects.filter(employee_profile_id=employee_profile.id)
            .only("id", "biotime_emp_code")
            .first()
        )
    return {
        "is_mapped": mapping is not None,
        "biotime_emp_code": mapping.biotime_emp_code if mapping else None,
        "mapping_id": mapping.id if mapping else None,
    }


def _generate_prehire_employee_id(company) -> str:
    prefix = (company.employee_id_prefix or company.code or "EMP").strip().upper()
    prefix = "".join(character for character in prefix if character in string.ascii_uppercase + string.digits) or "EMP"
    suffix = "".join(secrets.choice(string.digits) for _ in range(6))
    return f"{prefix[:13]}-{suffix}"


def ensure_prehire_profile_for_offer(offer: JobOffer) -> tuple[EmployeeProfile, bool]:
    profile = offer.employee_profile
    if profile is not None:
        if (
            profile.company_id != offer.company_id
            or profile.employment_status != EmployeeProfile.EmploymentStatus.PREHIRE
        ):
            raise ValueError("The linked employee profile must be a PREHIRE profile in the job offer company.")
        update_employee_profile_from_offer(offer)
        return profile, False

    for _ in range(20):
        try:
            with transaction.atomic():
                profile = EmployeeProfile.objects.create(
                    company=offer.company,
                    employee_id=_generate_prehire_employee_id(offer.company),
                    employment_status=EmployeeProfile.EmploymentStatus.PREHIRE,
                )
            break
        except IntegrityError:
            profile = None
    if profile is None:
        raise IntegrityError("Failed to generate a unique employee ID for the PREHIRE profile.")

    offer.employee_profile = profile
    offer.save(update_fields=["employee_profile", "updated_at"])
    update_employee_profile_from_offer(offer)
    return profile, True


def update_employee_profile_from_offer(offer: JobOffer) -> EmployeeProfile | None:
    profile = offer.employee_profile
    if not profile or profile.company_id != offer.company_id:
        return None
    if profile.user_id and profile.employment_status != EmployeeProfile.EmploymentStatus.PREHIRE:
        return profile

    field_values = {
        "full_name": offer.candidate_full_name,
        "full_name_en": offer.candidate_full_name,
        "nationality": offer.nationality,
        "nationality_en": offer.nationality,
        "national_id": offer.id_passport_iqama_number,
        "mobile": offer.candidate_phone_number,
        "date_of_birth": offer.hiring_request.date_of_birth if offer.hiring_request_id else None,
        "department_ref": offer.department_ref,
        "department": offer.department_ref.name if offer.department_ref_id else offer.department,
        "department_name_en": offer.department_ref.name if offer.department_ref_id else offer.department,
        "position_ref": offer.position_ref,
        "job_title": offer.position_ref.name if offer.position_ref_id else offer.position_title,
        "job_title_en": offer.position_ref.name if offer.position_ref_id else offer.position_title,
        "basic_salary": offer.basic_salary,
        "accommodation_allowance": offer.housing_allowance,
        "transportation_allowance": offer.transportation_allowance,
        "other_allowance": offer.other_allowance,
        "total_salary": offer.total_salary_package,
    }
    update_fields = []
    for field, value in field_values.items():
        if value not in (None, ""):
            setattr(profile, field, value)
            update_fields.append(field)
    if update_fields:
        profile.save(update_fields=[*update_fields, "updated_at"])
    return profile


def _record_invite_delivery(invite: Invite, result: dict[str, Any] | None) -> dict[str, Any]:
    delivery = _safe_delivery_result(
        result,
        provider="evolution_whatsapp" if invite.channel == Invite.Channel.WHATSAPP else "bird",
    )
    invite.last_delivery_channel = invite.channel
    invite.last_delivery_sent = delivery["sent"]
    invite.last_delivery_provider = delivery["provider"]
    invite.last_delivery_status_code = delivery["status_code"] if isinstance(delivery["status_code"], int) else None
    invite.last_delivery_message_id = delivery["message_id"] or ""
    invite.last_delivery_error = delivery["error"] or ""
    invite.last_delivery_at = timezone.now()
    invite.provider_submitted = delivery["sent"]
    invite.delivery_status = Invite.DeliveryStatus.SENT if delivery["sent"] else Invite.DeliveryStatus.FAILED
    invite.external_message_id = delivery["message_id"] or ""
    invite.save(
        update_fields=[
            "last_delivery_channel",
            "last_delivery_sent",
            "last_delivery_provider",
            "last_delivery_status_code",
            "last_delivery_message_id",
            "last_delivery_error",
            "last_delivery_at",
            "provider_submitted",
            "delivery_status",
            "external_message_id",
        ]
    )
    return delivery


def create_and_send_employee_invite(offer: JobOffer, *, created_by) -> tuple[Invite | None, dict[str, Any]]:
    profile = offer.employee_profile
    if profile and profile.user_id:
        return None, {"created": False, "reason": "account_exists"}
    if offer.candidate_email and User.objects.filter(email__iexact=offer.candidate_email).exists():
        return None, {"created": False, "reason": "account_exists"}

    existing = (
        Invite.objects.filter(
            employee_profile=profile,
            status=Invite.Status.SENT,
            expires_at__gt=timezone.now(),
        ).first()
        if profile
        else None
    )
    if existing:
        return existing, {"created": False, "reason": "active_invite_exists"}

    channel = Invite.Channel.WHATSAPP if offer.candidate_phone_number else Invite.Channel.EMAIL
    expiry_hours = SystemSettings.get_solo().default_invite_expiry_hours
    invite = Invite.objects.create(
        email=offer.candidate_email or None,
        phone_number=offer.candidate_phone_number or None,
        channel=channel,
        role="Employee",
        token=Invite.generate_token(),
        status=Invite.Status.SENT,
        sent_at=timezone.now(),
        expires_at=timezone.now() + timedelta(hours=expiry_hours),
        created_by=created_by,
        employee_profile=profile,
    )
    invite_link = f"{settings.FRONTEND_URL.rstrip('/')}/register?token={invite.token}"
    try:
        if channel == Invite.Channel.WHATSAPP:
            result = send_user_invite_whatsapp(
                phone_number=invite.phone_number or "",
                role=invite.role,
                invite_link=invite_link,
                expires_in_hours=expiry_hours,
                inviter_name=getattr(created_by, "full_name", "") or getattr(created_by, "email", ""),
            )
        else:
            result = send_user_invite_email(
                to_email=invite.email or "",
                role=invite.role,
                invite_link=invite_link,
                expires_in_hours=expiry_hours,
                inviter_name=getattr(created_by, "full_name", "") or getattr(created_by, "email", ""),
            )
    except Exception:
        logger.exception("job_offer_invite_delivery_failed", extra={"job_offer_id": offer.id, "invite_id": invite.id})
        result = None
    delivery = _record_invite_delivery(invite, result)
    return invite, {"created": True, "channel": channel, "delivery": delivery}


def generate_starting_work_acknowledgment_for_employee(
    employee_profile: EmployeeProfile,
    *,
    data: StartingWorkAcknowledgmentData | None = None,
) -> bytes:
    """Generate the Phase 2-ready starting-work PDF without triggering workflow side effects."""

    return build_starting_work_acknowledgment_pdf(employee_profile, data)
