from django.conf import settings
from django.db import models
from django.db.models import Q


class Notification(models.Model):
    class Category(models.TextChoices):
        APPROVAL = "approval", "Approval"
        REQUEST = "request", "Request"
        LEAVE = "leave", "Leave"
        LOAN = "loan", "Loan"
        ASSET = "asset", "Asset"
        ATTENDANCE = "attendance", "Attendance"
        DELEGATION = "delegation", "Delegation"
        ANNOUNCEMENT = "announcement", "Announcement"
        MEETING = "meeting", "Meeting"
        DOCUMENT = "document", "Document"
        INVITE = "invite", "Invite"
        PAYROLL = "payroll", "Payroll"
        SYSTEM = "system", "System"

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="in_app_notifications",
    )
    company = models.ForeignKey(
        "organization.OrganizationNode",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="notifications",
    )
    title = models.CharField(max_length=255)
    message = models.TextField(blank=True)
    event_key = models.CharField(max_length=120, db_index=True)
    category = models.CharField(max_length=32, choices=Category.choices, default=Category.SYSTEM, db_index=True)
    action_url = models.CharField(max_length=500, blank=True)
    related_object_type = models.CharField(max_length=100, blank=True)
    related_object_id = models.CharField(max_length=100, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    deduplication_key = models.CharField(max_length=255, blank=True)
    read_at = models.DateTimeField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["recipient", "company", "read_at", "-created_at"], name="notif_rec_comp_read_idx"),
            models.Index(fields=["related_object_type", "related_object_id"], name="notif_related_obj_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["recipient", "deduplication_key"],
                condition=~Q(deduplication_key=""),
                name="uniq_notification_recipient_dedupe",
            )
        ]

    @property
    def is_read(self) -> bool:
        return self.read_at is not None

    def __str__(self) -> str:
        return f"{self.recipient_id}:{self.event_key}:{self.id}"


class NotificationDelivery(models.Model):
    class Channel(models.TextChoices):
        WHATSAPP = "whatsapp", "WhatsApp"
        EMAIL = "email", "Email"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SENT = "sent", "Sent"
        FAILED = "failed", "Failed"
        SKIPPED = "skipped", "Skipped"

    notification = models.ForeignKey(Notification, on_delete=models.CASCADE, related_name="deliveries")
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notification_deliveries",
    )
    channel = models.CharField(max_length=20, choices=Channel.choices)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    provider = models.CharField(max_length=80, blank=True)
    provider_message_id = models.CharField(max_length=255, blank=True)
    error_message = models.TextField(blank=True)
    attempt_count = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["notification_id", "channel"]
        constraints = [
            models.UniqueConstraint(
                fields=["notification", "channel"],
                name="uniq_notification_delivery_channel",
            )
        ]
        indexes = [
            models.Index(fields=["recipient", "channel", "status"], name="notif_delivery_rec_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.notification_id}:{self.channel}:{self.status}"
