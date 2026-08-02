"""Docker end-to-end reliability check for the notification delivery pipeline.

Runs against a live stack (real Postgres, Redis broker, and Celery worker) rather
than mocked unit tests. Intended usage:

    docker compose exec backend python manage.py e2e_notification_check

The dedicated test user has no WhatsApp number on file, so the WhatsApp leg is
expected to be skipped (invalid recipient) and the email fallback is expected to
be queued and picked up by the real notification-worker container. This proves
the queue -> worker -> DB transition path end to end without depending on a live
WhatsApp/Bird connection.
"""

from __future__ import annotations

import time
import uuid

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from in_app_notifications.dispatcher import dispatch_notification_channels
from in_app_notifications.models import Notification, NotificationDelivery
from organization.models import OrganizationNode

User = get_user_model()

TERMINAL_STATUSES = {
    NotificationDelivery.Status.SENT,
    NotificationDelivery.Status.FAILED,
    NotificationDelivery.Status.SKIPPED,
}


class Command(BaseCommand):
    help = "Exercise the real WhatsApp-fail -> email-fallback delivery path against a live Celery worker."

    def add_arguments(self, parser):
        parser.add_argument("--timeout", type=int, default=60, help="Seconds to wait for terminal delivery states.")
        parser.add_argument("--keep", action="store_true", help="Do not delete the test user/notification afterward.")

    def handle(self, *args, **options):
        timeout = options["timeout"]
        run_id = uuid.uuid4().hex[:8]
        company, _ = OrganizationNode.objects.get_or_create(
            code="E2E_NOTIF_TEST",
            defaults={"name": "E2E Notification Test", "node_type": OrganizationNode.NodeType.COMPANY},
        )
        user, created_user = User.objects.get_or_create(
            email=f"e2e-notification-check+{run_id}@internal.invalid",
            defaults={"is_active": True},
        )
        if created_user:
            user.set_unusable_password()
            user.save(update_fields=["password"])

        self.stdout.write(f"Dispatching e2e test notification (run_id={run_id})...")
        result = dispatch_notification_channels(
            recipient=user,
            event_key="e2e_delivery_check",
            title="E2E delivery check",
            message="Automated Docker end-to-end delivery reliability check.",
            category=Notification.Category.SYSTEM,
            deduplication_key=f"e2e-notification-check-{run_id}",
            company=company,
            email_context={},
        )
        notification = result.get("notification")
        if notification is None:
            self.stderr.write(self.style.ERROR("FAIL: dispatch_notification_channels did not create a notification."))
            raise SystemExit(1)

        try:
            whatsapp_status, email_status = self._wait_for_terminal_states(notification.id, timeout)
            self._report(whatsapp_status, email_status)
        finally:
            if not options["keep"]:
                notification.delete()
                if created_user:
                    user.delete()

    def _wait_for_terminal_states(self, notification_id: int, timeout: int) -> tuple[str | None, str | None]:
        deadline = time.monotonic() + timeout
        whatsapp_status = None
        email_status = None
        while time.monotonic() < deadline:
            deliveries = {
                d.channel: d.status
                for d in NotificationDelivery.objects.filter(notification_id=notification_id)
            }
            whatsapp_status = deliveries.get(NotificationDelivery.Channel.WHATSAPP)
            email_status = deliveries.get(NotificationDelivery.Channel.EMAIL)
            whatsapp_done = whatsapp_status in TERMINAL_STATUSES
            email_done = email_status is not None and email_status in TERMINAL_STATUSES
            if whatsapp_done and email_done:
                return whatsapp_status, email_status
            time.sleep(1)
        return whatsapp_status, email_status

    def _report(self, whatsapp_status: str | None, email_status: str | None) -> None:
        self.stdout.write(f"WhatsApp delivery status: {whatsapp_status}")
        self.stdout.write(f"Email delivery status:    {email_status}")

        failures = []
        if whatsapp_status != NotificationDelivery.Status.SKIPPED:
            failures.append(
                f"expected WhatsApp to be skipped (no phone on file), got '{whatsapp_status}'."
            )
        if email_status is None:
            failures.append("email fallback was never queued (no NotificationDelivery row created).")
        elif email_status not in TERMINAL_STATUSES:
            failures.append(f"email fallback did not reach a terminal state within timeout (status='{email_status}').")

        if failures:
            self.stderr.write(self.style.ERROR("FAIL: " + " ".join(failures)))
            raise SystemExit(1)

        self.stdout.write(
            self.style.SUCCESS(
                "PASS: WhatsApp skipped for invalid recipient and email fallback was queued and reached a terminal state."
            )
        )
