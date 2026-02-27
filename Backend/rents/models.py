from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils.translation import gettext_lazy as _

from assets.models import Asset


class RentType(models.Model):
    code = models.CharField(max_length=30, unique=True)
    name_en = models.CharField(max_length=120)
    name_ar = models.CharField(max_length=120, blank=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["code"]

    def __str__(self):
        return f"{self.code} - {self.name_en}"

class Rent(models.Model):
    class Recurrence(models.TextChoices):
        ONE_TIME = "ONE_TIME", _("One Time")
        MONTHLY = "MONTHLY", _("Monthly")

    rent_type = models.ForeignKey(RentType, on_delete=models.PROTECT, related_name="rents")
    asset = models.ForeignKey(Asset, on_delete=models.SET_NULL, null=True, blank=True, related_name="rents")
    property_name_en = models.CharField(max_length=180, blank=True)
    property_name_ar = models.CharField(max_length=180, blank=True)
    property_address = models.CharField(max_length=255, blank=True)

    recurrence = models.CharField(max_length=20, choices=Recurrence.choices)
    one_time_due_date = models.DateField(null=True, blank=True)
    start_date = models.DateField(null=True, blank=True)
    due_day = models.PositiveSmallIntegerField(null=True, blank=True)

    reminder_days = models.PositiveIntegerField(default=30)
    amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="rents_created",
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="rents_updated",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]
        indexes = [
            models.Index(fields=["is_active", "recurrence"], name="rents_rent_active_rec_idx"),
            models.Index(fields=["reminder_days"], name="rents_rent_reminder_idx"),
        ]

    def clean(self):
        errors = {}
        if not self.asset and not self.property_name_en.strip() and not self.property_name_ar.strip():
            errors["property_name_en"] = "Property name (EN or AR) is required when asset is not selected."

        if self.reminder_days < 1 or self.reminder_days > 365:
            errors["reminder_days"] = "Reminder days must be between 1 and 365."

        if self.recurrence == self.Recurrence.ONE_TIME:
            if not self.one_time_due_date:
                errors["one_time_due_date"] = "One-time due date is required for one-time rent."
            if self.start_date is not None:
                errors["start_date"] = "Start date must be empty for one-time rent."
            if self.due_day is not None:
                errors["due_day"] = "Due day must be empty for one-time rent."

        if self.recurrence == self.Recurrence.MONTHLY:
            if not self.start_date:
                errors["start_date"] = "Start date is required for monthly rent."
            if self.due_day is None:
                errors["due_day"] = "Due day is required for monthly rent."
            elif self.due_day < 1 or self.due_day > 28:
                errors["due_day"] = "Due day must be between 1 and 28."
            if self.one_time_due_date is not None:
                errors["one_time_due_date"] = "One-time due date must be empty for monthly rent."

        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)


class RentReminderLog(models.Model):
    class Channel(models.TextChoices):
        ANNOUNCEMENT = "announcement", _("Announcement")
        EMAIL = "email", _("Email")

    rent = models.ForeignKey(Rent, on_delete=models.CASCADE, related_name="reminder_logs")
    due_date = models.DateField()
    channel = models.CharField(max_length=32, choices=Channel.choices)
    sent_at = models.DateTimeField(auto_now_add=True)
    status = models.CharField(max_length=20, default="sent")
    error_message = models.TextField(blank=True)

    class Meta:
        ordering = ["-sent_at"]
        constraints = [
            models.UniqueConstraint(fields=["rent", "due_date", "channel"], name="rents_reminder_unique_once"),
        ]
        indexes = [models.Index(fields=["rent", "due_date"], name="rents_reminder_lookup_idx")]

    def __str__(self):
        return f"Rent {self.rent_id} | {self.channel} | {self.due_date}"
