"""Notification load policy for executive recipients (CEO and General Manager).

Executives are the people the whole approval chain ends with, so every stalled
item reaches them. For them only:

* reminders never go out on WhatsApp/email one by one; the bell keeps the entry,
* WhatsApp is held during quiet hours (default 22:00-07:00 in ``APP_TIME_ZONE``),
* held deliveries are folded into ONE daily digest message
  (``in_app_notifications.tasks.send_executive_digest``).

Every other recipient is unaffected.
"""

from __future__ import annotations

import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from core.executives import is_executive_user
from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)

DIGEST_EVENT_KEY = "executive.digest"
HELD_FOR_DIGEST = "Held for the executive daily digest."
HELD_DIGESTED = "Included in the executive daily digest."


def _policy_enabled() -> bool:
    return bool(getattr(settings, "EXECUTIVE_NOTIFICATION_POLICY_ENABLED", True))


def is_executive_recipient(user) -> bool:
    """CEO group member, or a profile whose title/position is an executive title (``core.executives``)."""
    return is_executive_user(user)


def quiet_hours_active(now: datetime | None = None) -> bool:
    start = int(getattr(settings, "EXECUTIVE_QUIET_HOURS_START", 22))
    end = int(getattr(settings, "EXECUTIVE_QUIET_HOURS_END", 7))
    if start == end:
        return False
    zone = ZoneInfo(getattr(settings, "APP_TIME_ZONE", "Asia/Riyadh"))
    hour = (now or timezone.now()).astimezone(zone).hour
    return (hour >= start or hour < end) if start > end else (start <= hour < end)


def is_reminder(event_key: str, metadata: dict | None) -> bool:
    metadata = metadata or {}
    return metadata.get("event") == "ceo_reminder" or metadata.get("reminder") is True


def should_hold_whatsapp(recipient, *, event_key: str, metadata: dict | None) -> bool:
    """True when this executive's external delivery must wait for the daily digest."""
    if not _policy_enabled() or event_key == DIGEST_EVENT_KEY:
        return False
    try:
        if not is_executive_recipient(recipient):
            return False
        return is_reminder(event_key, metadata) or quiet_hours_active()
    except Exception:
        logger.exception("executive_policy_check_failed", extra={"recipient_id": getattr(recipient, "id", None)})
        return False
