"""Isolated group delivery tasks. No phone-recipient fallback or automatic resubmission."""

import logging

from celery import shared_task
from django.db import transaction

from .models import AnnouncementWhatsAppGroupDelivery
from .whatsapp import load_announcement_attachment
from .whatsapp_groups import AnnouncementGroupProvider

logger = logging.getLogger(__name__)


@shared_task(ignore_result=True)
def send_announcement_group(delivery_id):
    # Claim once. Duplicate broker delivery must not resend a group announcement.
    if not AnnouncementWhatsAppGroupDelivery.objects.filter(pk=delivery_id, status="PENDING").update(
        status="PROCESSING"
    ):
        return
    delivery = AnnouncementWhatsAppGroupDelivery.objects.select_related("announcement__company").get(pk=delivery_id)
    announcement = delivery.announcement
    if (
        not announcement.is_active
        or not announcement.publish_to_whatsapp
        or announcement.whatsapp_group_id != delivery.group_id
    ):
        status, reason = "SKIPPED", "announcement_changed"
    else:
        try:
            provider = AnnouncementGroupProvider()
            attachment = load_announcement_attachment(announcement)
            if announcement.attachment and not attachment:
                status, reason = "FAILED", "attachment_unavailable"
            elif attachment:
                status, reason = provider.send_group_document(
                    company=announcement.company,
                    group_id=delivery.group_id,
                    document_base64=attachment["document_base64"],
                    file_name=attachment["file_name"],
                    caption=delivery.message,
                )
            else:
                status, reason = provider.send_group(
                    company=announcement.company, group_id=delivery.group_id, text=delivery.message
                )
        except Exception:
            status, reason = "UNKNOWN", "provider_outcome_unknown"
    delivery.status, delivery.reason = status, reason
    delivery.save(update_fields=["status", "reason", "updated_at"])
    logger.info(
        "announcement_group_delivery",
        extra={
            "announcement_id": announcement.pk,
            "delivery_id": delivery.pk,
            "delivery_status": status,
            "reason_code": reason,
        },
    )


def enqueue_announcement_group(announcement):
    if not announcement.publish_to_whatsapp or not announcement.whatsapp_group_id:
        return
    from .utils import _meeting_datetime_parts
    from .whatsapp import build_announcement_message

    message = build_announcement_message(
        employee_name="فريق الشركة / Company team",
        title=announcement.title,
        content=announcement.content,
        has_attachment=bool(announcement.attachment),
    )
    if announcement.announcement_type == "MEETING":
        date, time = _meeting_datetime_parts(announcement)
        message += f"\n\nاجتماع / Meeting: {date} {time}"
        for detail in (
            announcement.meeting_location,
            announcement.meeting_agenda,
            announcement.google_meet_url,
            announcement.microsoft_teams_url,
            announcement.zoom_url,
        ):
            if detail:
                message += f"\n{detail}"
    # Attachments and private download links never go to external group members.
    delivery, created = AnnouncementWhatsAppGroupDelivery.objects.get_or_create(
        announcement=announcement, defaults={"group_id": announcement.whatsapp_group_id, "message": message}
    )
    if not created:
        return

    def enqueue():
        try:
            send_announcement_group.apply_async(args=[delivery.pk], retry=False)
        except Exception:
            AnnouncementWhatsAppGroupDelivery.objects.filter(pk=delivery.pk, status="PENDING").update(
                status="FAILED", reason="queue_unavailable"
            )
            logger.warning(
                "announcement_group_queue_failed",
                extra={"announcement_id": announcement.pk, "delivery_id": delivery.pk},
            )

    transaction.on_commit(enqueue)
