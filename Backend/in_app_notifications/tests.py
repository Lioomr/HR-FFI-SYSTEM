from datetime import timedelta
from unittest.mock import AsyncMock, patch

from asgiref.sync import async_to_sync
from celery.exceptions import Retry
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.db import connection
from django.test import SimpleTestCase, TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.urls import resolve
from django.utils import timezone
from rest_framework.test import APIClient

from announcements.models import Announcement
from announcements.utils import send_announcement_in_app
from config.asgi import application
from core.services.pending_approval_email import notify_users_for_pending_status
from employees.models import EmployeeProfile
from employees.notifications import notify_document_expiry_in_app
from leaves.models import LeaveRequest, LeaveType
from leaves.notifications import notify_leave_approved
from organization.models import OrganizationNode, UserOrganizationAccess

from .dispatcher import dispatch_notification_channels
from .models import Notification, NotificationDelivery
from .serializers import NotificationSerializer
from .services import create_notification, with_delivery_details
from .tasks import deliver_email_notification, deliver_whatsapp_notification

User = get_user_model()
IN_MEMORY_CHANNELS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}


def make_company(code):
    return OrganizationNode.objects.create(code=code, name=code, node_type=OrganizationNode.NodeType.COMPANY)


def make_user(email, company):
    user = User.objects.create_user(email=email, password="StrongPassword123!", is_active=True)
    user.groups.add(Group.objects.get_or_create(name="HRManager")[0])
    UserOrganizationAccess.objects.create(user=user, organization=company)
    return user


@override_settings(CHANNEL_LAYERS=IN_MEMORY_CHANNELS)
class NotificationModelServiceTests(TestCase):
    def setUp(self):
        self.company = make_company("COMP-A")
        self.user = make_user("one@example.com", self.company)

    def test_create_sets_unread_fields_and_related_metadata(self):
        notification, created = create_notification(
            recipient=self.user,
            company=self.company,
            event_key="leave.submitted",
            title="Leave submitted",
            category=Notification.Category.LEAVE,
            action_url="/employee/leave/requests",
            related_object_type="leaves.leaverequest",
            related_object_id=17,
            metadata={"status": "PENDING_MANAGER"},
            deduplication_key="leave:17:submitted",
        )
        self.assertTrue(created)
        self.assertFalse(notification.is_read)
        self.assertIsNone(notification.read_at)
        self.assertEqual(notification.related_object_id, "17")
        self.assertEqual(notification.metadata["status"], "PENDING_MANAGER")

    def test_deduplication_is_per_recipient(self):
        first, first_created = create_notification(
            recipient=self.user, event_key="test", title="First", deduplication_key="same-key"
        )
        second, second_created = create_notification(
            recipient=self.user, event_key="test", title="Second", deduplication_key="same-key"
        )
        other = make_user("two@example.com", self.company)
        third, third_created = create_notification(
            recipient=other, event_key="test", title="Third", deduplication_key="same-key"
        )
        self.assertTrue(first_created)
        self.assertFalse(second_created)
        self.assertEqual(first.id, second.id)
        self.assertTrue(third_created)
        self.assertNotEqual(first.id, third.id)

    def test_websocket_delivery_failure_does_not_rollback_persistence(self):
        layer = type("FailingLayer", (), {"group_send": AsyncMock(side_effect=OSError("redis unavailable"))})()
        with (
            patch("in_app_notifications.services.get_channel_layer", return_value=layer),
            self.assertLogs("in_app_notifications.services", level="ERROR"),
        ):
            with self.captureOnCommitCallbacks(execute=True):
                notification, created = create_notification(
                    recipient=self.user, event_key="test", title="Persistent despite Redis failure"
                )
        self.assertTrue(created)
        self.assertTrue(Notification.objects.filter(pk=notification.id).exists())


@override_settings(CHANNEL_LAYERS=IN_MEMORY_CHANNELS)
class NotificationDispatcherTests(TestCase):
    def setUp(self):
        self.company = make_company("DISPATCH")
        self.user = make_user("dispatch@example.com", self.company)
        EmployeeProfile.objects.create(
            user=self.user,
            company=self.company,
            employee_id="DISPATCH-1",
            full_name="Dispatch User",
            mobile="+201001234567",
        )
        self.kwargs = {
            "recipient": self.user,
            "event_key": "test.dispatched",
            "title": "Test notification",
            "message": "Test message",
            "category": Notification.Category.SYSTEM,
            "deduplication_key": "test.dispatched:1",
        }

    @patch("in_app_notifications.tasks.deliver_whatsapp_notification.delay")
    @patch("in_app_notifications.dispatcher._send_email")
    @patch("in_app_notifications.dispatcher._send_whatsapp")
    def test_dispatch_creates_pending_delivery_and_queues_after_commit(self, whatsapp, email, delay):
        with self.captureOnCommitCallbacks(execute=True):
            result = dispatch_notification_channels(**self.kwargs)
        whatsapp.assert_not_called()
        email.assert_not_called()
        delay.assert_called_once()
        self.assertEqual(result["whatsapp"]["status"], NotificationDelivery.Status.PENDING)
        self.assertIsNone(result["email"])
        self.assertEqual(Notification.objects.count(), 1)

    @patch("in_app_notifications.tasks.deliver_whatsapp_notification.delay")
    def test_duplicate_dispatch_reuses_notification_and_delivery(self, delay):
        with self.captureOnCommitCallbacks(execute=True):
            first = dispatch_notification_channels(**self.kwargs)
            second = dispatch_notification_channels(**self.kwargs)
        self.assertTrue(first["created"])
        self.assertFalse(second["created"])
        self.assertEqual(Notification.objects.count(), 1)
        self.assertEqual(NotificationDelivery.objects.count(), 1)
        self.assertEqual(delay.call_count, 2)

    @patch("in_app_notifications.tasks.deliver_whatsapp_notification.delay", side_effect=OSError("redis unavailable"))
    def test_queue_failure_does_not_break_persistence(self, _delay):
        with self.assertLogs("in_app_notifications.dispatcher", level="ERROR"):
            with self.captureOnCommitCallbacks(execute=True):
                result = dispatch_notification_channels(**self.kwargs)
        self.assertIsNotNone(result["notification"])
        self.assertTrue(Notification.objects.filter(pk=result["notification"].pk).exists())

    @patch("in_app_notifications.tasks.deliver_whatsapp_notification.delay")
    def test_delivery_rows_follow_recipient_and_company_isolation(self, delay):
        other_company = make_company("DISPATCH-OTHER")
        other_user = make_user("dispatch-other@example.com", other_company)
        EmployeeProfile.objects.create(
            user=other_user,
            company=other_company,
            employee_id="DISPATCH-2",
            full_name="Other User",
            mobile="+201001234568",
        )
        other_kwargs = {**self.kwargs, "recipient": other_user}
        with self.captureOnCommitCallbacks(execute=True):
            dispatch_notification_channels(**self.kwargs)
            dispatch_notification_channels(**other_kwargs)
        self.assertEqual(NotificationDelivery.objects.filter(recipient=self.user).count(), 1)
        self.assertEqual(NotificationDelivery.objects.filter(recipient=other_user).count(), 1)
        self.assertEqual(
            NotificationDelivery.objects.get(recipient=other_user).notification.company_id,
            other_company.id,
        )
        self.assertEqual(delay.call_count, 2)

    @patch("in_app_notifications.tasks.deliver_whatsapp_notification.delay")
    def test_pending_approval_flow_remains_non_blocking(self, delay):
        with self.captureOnCommitCallbacks(execute=True):
            result = notify_users_for_pending_status(
                users=[self.user],
                request_type="Test Approval",
                request_id=10,
                requester_name="Requester",
                status_label="Pending HR",
                action_path="/hr/requests/10",
            )
        self.assertEqual(result["sent"], 0)
        self.assertEqual(result["whatsapp_pending"], 1)
        self.assertEqual(result["whatsapp_failed"], 0)
        self.assertTrue(Notification.objects.filter(event_key="approval.pending").exists())
        delay.assert_called_once()

    @patch("in_app_notifications.tasks.deliver_whatsapp_notification.delay")
    def test_leave_approval_flow_queues_importable_email_helper(self, delay):
        leave_type = LeaveType.objects.create(company=self.company, name="Annual", code="ANNUAL")
        leave = LeaveRequest(
            pk=999,
            employee=self.user,
            company=self.company,
            leave_type=leave_type,
            start_date=timezone.localdate() + timedelta(days=1),
            end_date=timezone.localdate() + timedelta(days=2),
            status=LeaveRequest.RequestStatus.APPROVED,
        )
        with self.captureOnCommitCallbacks(execute=True):
            notify_leave_approved(leave)
        payload = delay.call_args.kwargs
        self.assertEqual(
            payload["email_payload"]["template"], "core.services.bird_email_service.send_leave_approved_email"
        )
        self.assertEqual(
            NotificationDelivery.objects.get(notification__deduplication_key=f"leave.approved:{leave.id}").status,
            NotificationDelivery.Status.PENDING,
        )

    @patch("in_app_notifications.tasks.deliver_whatsapp_notification.delay")
    def test_announcement_and_document_flows_are_queued(self, delay):
        announcement = Announcement.objects.create(
            company=self.company,
            title="Policy",
            content="Updated policy",
            target_user=self.user,
            target_roles=[],
            publish_to_dashboard=True,
            publish_to_email=True,
            publish_to_whatsapp=True,
            created_by=self.user,
        )
        with self.captureOnCommitCallbacks(execute=True):
            send_announcement_in_app(announcement)
            notify_document_expiry_in_app(
                self.user.employee_profile,
                [{"doc_type": "passport", "label": "Passport", "expiry_date": "2026-08-01", "days_left": 21}],
            )
        self.assertEqual(delay.call_count, 2)
        self.assertTrue(Notification.objects.filter(event_key="announcement.created").exists())
        self.assertTrue(Notification.objects.filter(event_key="document.expiring").exists())


@override_settings(CHANNEL_LAYERS=IN_MEMORY_CHANNELS, NOTIFICATION_DELIVERY_MAX_RETRIES=3)
class NotificationDeliveryTaskTests(TestCase):
    def setUp(self):
        self.company = make_company("TASKS")
        self.user = make_user("tasks@example.com", self.company)
        EmployeeProfile.objects.create(
            user=self.user,
            company=self.company,
            employee_id="TASK-1",
            full_name="Task User",
            mobile="+201001234567",
        )
        self.notification = Notification.objects.create(
            recipient=self.user,
            company=self.company,
            event_key="task.test",
            title="Task test",
            message="Task message",
            category=Notification.Category.SYSTEM,
        )
        self.whatsapp = NotificationDelivery.objects.create(
            notification=self.notification,
            recipient=self.user,
            channel=NotificationDelivery.Channel.WHATSAPP,
        )
        self.email_payload = {"template_kind": "template", "template": "", "context": {}}

    @patch("in_app_notifications.tasks.deliver_email_notification.delay")
    @patch("in_app_notifications.dispatcher._send_whatsapp")
    def test_whatsapp_success_marks_sent_and_never_queues_email(self, send, email_delay):
        send.return_value = {
            "success": True,
            "provider": "evolution_whatsapp",
            "message_id": "wa-task-1",
            "status_code": 201,
        }
        result = deliver_whatsapp_notification.run(self.notification.id, email_payload=self.email_payload)
        self.whatsapp.refresh_from_db()
        self.assertEqual(result["status"], NotificationDelivery.Status.SENT)
        self.assertEqual(self.whatsapp.provider_message_id, "wa-task-1")
        self.assertEqual(self.whatsapp.attempt_count, 1)
        email_delay.assert_not_called()

    @patch("in_app_notifications.dispatcher._send_whatsapp")
    def test_temporary_whatsapp_failure_stays_pending_and_retries(self, send):
        send.return_value = {
            "success": False,
            "provider": "evolution_whatsapp",
            "status_code": 503,
            "error": "provider unavailable",
        }
        with patch.object(deliver_whatsapp_notification, "retry", side_effect=Retry("retry")) as retry:
            with self.assertRaises(Retry):
                deliver_whatsapp_notification.run(self.notification.id, email_payload=self.email_payload)
        self.whatsapp.refresh_from_db()
        self.assertEqual(self.whatsapp.status, NotificationDelivery.Status.PENDING)
        self.assertEqual(self.whatsapp.attempt_count, 1)
        retry.assert_called_once()

    @patch("in_app_notifications.tasks.deliver_email_notification.delay")
    @patch("in_app_notifications.dispatcher._send_whatsapp")
    def test_whatsapp_retry_count_is_bounded(self, send, email_delay):
        send.return_value = {
            "success": False,
            "provider": "evolution_whatsapp",
            "status_code": 503,
            "error": "provider unavailable",
        }
        self.whatsapp.attempt_count = 3
        self.whatsapp.save(update_fields=["attempt_count"])
        deliver_whatsapp_notification.push_request(retries=3)
        try:
            deliver_whatsapp_notification.run(self.notification.id, email_payload=self.email_payload)
        finally:
            deliver_whatsapp_notification.pop_request()
        self.whatsapp.refresh_from_db()
        self.assertEqual(self.whatsapp.status, NotificationDelivery.Status.FAILED)
        self.assertEqual(self.whatsapp.attempt_count, 4)
        email_delay.assert_called_once()

    @patch("in_app_notifications.tasks.deliver_email_notification.delay")
    @patch("in_app_notifications.dispatcher._send_whatsapp")
    def test_permanent_whatsapp_failure_marks_failed_and_queues_fallback(self, send, email_delay):
        send.return_value = {
            "success": False,
            "provider": "evolution_whatsapp",
            "status_code": 400,
            "error": "invalid request",
        }
        deliver_whatsapp_notification.run(self.notification.id, email_payload=self.email_payload)
        deliver_whatsapp_notification.run(self.notification.id, email_payload=self.email_payload)
        self.whatsapp.refresh_from_db()
        self.assertEqual(self.whatsapp.status, NotificationDelivery.Status.FAILED)
        email_delay.assert_called_once_with(self.notification.id, self.email_payload, True)

    @patch("in_app_notifications.tasks.deliver_email_notification.delay")
    def test_invalid_phone_is_skipped_and_queues_fallback(self, email_delay):
        self.user.employee_profile.mobile = "invalid"
        self.user.employee_profile.save(update_fields=["mobile"])
        deliver_whatsapp_notification.run(self.notification.id, email_payload=self.email_payload)
        self.whatsapp.refresh_from_db()
        self.assertEqual(self.whatsapp.status, NotificationDelivery.Status.SKIPPED)
        email_delay.assert_called_once()

    @patch("in_app_notifications.dispatcher._send_whatsapp")
    def test_sent_and_stale_duplicate_tasks_never_resend(self, send):
        self.whatsapp.status = NotificationDelivery.Status.SENT
        self.whatsapp.attempt_count = 1
        self.whatsapp.save(update_fields=["status", "attempt_count"])
        deliver_whatsapp_notification.run(self.notification.id, email_payload=self.email_payload)
        send.assert_not_called()

        self.whatsapp.status = NotificationDelivery.Status.PENDING
        self.whatsapp.save(update_fields=["status"])
        result = deliver_whatsapp_notification.run(self.notification.id, email_payload=self.email_payload)
        self.assertTrue(result["duplicate"])
        send.assert_not_called()

    @patch("in_app_notifications.dispatcher._send_email")
    def test_email_fallback_reloads_recipient_and_is_sent_at_most_once(self, send):
        self.whatsapp.status = NotificationDelivery.Status.FAILED
        self.whatsapp.attempt_count = 1
        self.whatsapp.save(update_fields=["status", "attempt_count"])
        self.user.email = "reloaded@example.com"
        self.user.save(update_fields=["email"])
        send.return_value = {
            "success": True,
            "provider": "bird",
            "message_id": "email-task-1",
            "status_code": 202,
        }
        deliver_email_notification.run(self.notification.id, self.email_payload)
        deliver_email_notification.run(self.notification.id, self.email_payload)

        delivery = NotificationDelivery.objects.get(
            notification=self.notification, channel=NotificationDelivery.Channel.EMAIL
        )
        self.assertEqual(delivery.status, NotificationDelivery.Status.SENT)
        self.assertEqual(delivery.attempt_count, 1)
        self.assertEqual(send.call_count, 1)
        self.assertEqual(send.call_args.kwargs["recipient"].email, "reloaded@example.com")

    @patch("in_app_notifications.dispatcher._send_email")
    def test_email_failure_records_redacted_bounded_error(self, send):
        self.whatsapp.status = NotificationDelivery.Status.FAILED
        self.whatsapp.save(update_fields=["status"])
        send.return_value = {
            "success": False,
            "provider": "bird",
            "status_code": 400,
            "error": "Authorization: Bearer secret-token recipient +201001234567 invalid",
        }
        deliver_email_notification.run(self.notification.id, self.email_payload)
        delivery = NotificationDelivery.objects.get(
            notification=self.notification, channel=NotificationDelivery.Channel.EMAIL
        )
        self.assertEqual(delivery.status, NotificationDelivery.Status.FAILED)
        self.assertNotIn("secret-token", delivery.error_message)
        self.assertNotIn("+201001234567", delivery.error_message)

    @patch("in_app_notifications.dispatcher.EmailService")
    def test_missing_email_marks_fallback_skipped_without_provider_call(self, email_service):
        self.whatsapp.status = NotificationDelivery.Status.SKIPPED
        self.whatsapp.save(update_fields=["status"])
        self.user.email = ""
        self.user.save(update_fields=["email"])
        deliver_email_notification.run(self.notification.id, self.email_payload)
        delivery = NotificationDelivery.objects.get(
            notification=self.notification, channel=NotificationDelivery.Channel.EMAIL
        )
        self.assertEqual(delivery.status, NotificationDelivery.Status.SKIPPED)
        self.assertEqual(delivery.attempt_count, 1)
        email_service.assert_not_called()


@override_settings(CHANNEL_LAYERS=IN_MEMORY_CHANNELS)
class NotificationApiTests(TestCase):
    def setUp(self):
        self.company_a = make_company("COMP-A")
        self.company_b = make_company("COMP-B")
        self.user = make_user("owner@example.com", self.company_a)
        UserOrganizationAccess.objects.create(user=self.user, organization=self.company_b)
        self.other_user = make_user("other@example.com", self.company_a)
        self.client = APIClient()
        # Production enables SECURE_SSL_REDIRECT. Exercise API views using the
        # HTTPS scheme that the reverse proxy supplies instead of accepting a
        # middleware redirect as an API response.
        self.client.force_authenticate(self.user)
        self.client.credentials(
            HTTP_X_FORWARDED_PROTO="https",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company_a.id),
        )
        self.owned = Notification.objects.create(
            recipient=self.user, company=self.company_a, event_key="one", title="Owned", category="system"
        )
        self.other_company = Notification.objects.create(
            recipient=self.user, company=self.company_b, event_key="two", title="Other company", category="system"
        )
        self.other_owner = Notification.objects.create(
            recipient=self.other_user, company=self.company_a, event_key="three", title="Other owner", category="system"
        )
        self.whatsapp_delivery = NotificationDelivery.objects.create(
            notification=self.owned,
            recipient=self.user,
            channel=NotificationDelivery.Channel.WHATSAPP,
            status=NotificationDelivery.Status.FAILED,
            provider="evolution_whatsapp",
            provider_message_id="wa-message-id",
            error_message="Authorization: Bearer secret-token phone +201001234567\ninternal trace",
            attempt_count=1,
        )
        self.email_delivery = NotificationDelivery.objects.create(
            notification=self.owned,
            recipient=self.user,
            channel=NotificationDelivery.Channel.EMAIL,
            status=NotificationDelivery.Status.SENT,
            provider="bird",
            provider_message_id="email-message-id",
            attempt_count=1,
        )
        NotificationDelivery.objects.create(
            notification=self.other_owner,
            recipient=self.other_user,
            channel=NotificationDelivery.Channel.WHATSAPP,
            status=NotificationDelivery.Status.SENT,
            provider="evolution_whatsapp",
            provider_message_id="other-users-message-id",
            attempt_count=1,
        )

    def test_routes_resolve_to_notification_views(self):
        self.assertEqual(resolve("/api/notifications/").url_name, "list")
        self.assertEqual(resolve("/api/notifications/unread-count/").url_name, "unread-count")
        self.assertEqual(resolve(f"/api/notifications/{self.owned.id}/read/").url_name, "read")
        self.assertEqual(resolve("/api/notifications/read-all/").url_name, "read-all")

    @override_settings(
        SECURE_SSL_REDIRECT=True,
        SECURE_PROXY_SSL_HEADER=("HTTP_X_FORWARDED_PROTO", "https"),
    )
    def test_production_https_requests_are_not_redirected(self):
        response = self.client.get(
            "/api/notifications/",
            HTTP_X_FORWARDED_PROTO="https",
        )
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(response.status_code, {301, 302, 307, 308})

    def test_list_is_paginated_and_isolated_by_owner_and_active_company(self):
        response = self.client.get("/api/notifications/?page_size=10")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "success")
        self.assertEqual(response.data["data"]["count"], 1)
        self.assertEqual(response.data["data"]["items"][0]["id"], self.owned.id)

    def test_list_serializes_delivery_fields_in_whatsapp_first_order(self):
        mismatched_notification = Notification.objects.create(
            recipient=self.user,
            company=self.company_a,
            event_key="mismatched-delivery",
            title="Mismatched delivery",
        )
        NotificationDelivery.objects.create(
            notification=mismatched_notification,
            recipient=self.other_user,
            channel=NotificationDelivery.Channel.WHATSAPP,
            status=NotificationDelivery.Status.SENT,
            provider_message_id="mismatched-recipient-message-id",
        )
        response = self.client.get("/api/notifications/?page_size=10")
        owned_item = next(item for item in response.data["data"]["items"] if item["id"] == self.owned.id)
        deliveries = owned_item["deliveries"]
        self.assertEqual([item["channel"] for item in deliveries], ["whatsapp", "email"])
        self.assertEqual(deliveries[0]["status"], "failed")
        self.assertEqual(deliveries[0]["provider"], "evolution_whatsapp")
        self.assertEqual(deliveries[0]["provider_message_id"], "wa-message-id")
        self.assertEqual(deliveries[0]["attempt_count"], 1)
        self.assertIn("[redacted]", deliveries[0]["error"])
        self.assertIn("[redacted-phone]", deliveries[0]["error"])
        self.assertNotIn("secret-token", deliveries[0]["error"])
        self.assertNotIn("internal trace", deliveries[0]["error"])
        self.assertEqual(deliveries[1]["status"], "sent")
        self.assertEqual(deliveries[1]["provider_message_id"], "email-message-id")
        self.assertIsNone(deliveries[1]["error"])
        self.assertNotIn("other-users-message-id", str(response.data))
        self.assertNotIn("mismatched-recipient-message-id", str(response.data))

    def test_system_admin_can_see_technical_delivery_details(self):
        self.user.groups.clear()
        self.user.groups.add(Group.objects.get_or_create(name="SystemAdmin")[0])

        response = self.client.get("/api/notifications/?page_size=10")

        delivery = response.data["data"]["items"][0]["deliveries"][0]
        self.assertEqual(delivery["provider"], "evolution_whatsapp")
        self.assertEqual(delivery["provider_message_id"], "wa-message-id")
        self.assertEqual(delivery["attempt_count"], 1)
        self.assertIn("[redacted]", delivery["error"])

    def test_non_privileged_roles_only_see_public_delivery_fields_in_list_and_read(self):
        public_notification = Notification.objects.create(
            recipient=self.user, company=None, event_key="public-delivery-shape", title="Public delivery shape"
        )
        NotificationDelivery.objects.create(
            notification=public_notification,
            recipient=self.user,
            channel=NotificationDelivery.Channel.WHATSAPP,
            status=NotificationDelivery.Status.FAILED,
            provider="evolution_whatsapp",
            provider_message_id="public-shape-message-id",
            error_message="secret provider error",
            attempt_count=2,
        )
        for role in ("Employee", "Manager", "CEO", "CFO"):
            with self.subTest(role=role):
                self.user.groups.clear()
                self.user.groups.add(Group.objects.get_or_create(name=role)[0])

                list_response = self.client.get("/api/notifications/?page_size=10")
                owned_item = next(
                    item for item in list_response.data["data"]["items"] if item["id"] == public_notification.id
                )
                list_delivery = owned_item["deliveries"][0]
                self.assertEqual(set(list_delivery), {"channel", "status"})

                read_response = self.client.post(f"/api/notifications/{public_notification.id}/read/")
                read_delivery = read_response.data["data"]["notification"]["deliveries"][0]
                self.assertEqual(set(read_delivery), {"channel", "status"})
                serialized = str(read_response.data)
                self.assertNotIn("evolution_whatsapp", serialized)
                self.assertNotIn("wa-message-id", serialized)
                self.assertNotIn("public-shape-message-id", serialized)
                self.assertNotIn("secret-token", serialized)

    def test_whatsapp_success_pending_and_skipped_delivery_shapes(self):
        cases = [
            (NotificationDelivery.Status.SENT, False),
            (NotificationDelivery.Status.PENDING, False),
            (NotificationDelivery.Status.SKIPPED, True),
        ]
        for index, (whatsapp_status, include_email) in enumerate(cases, start=1):
            notification = Notification.objects.create(
                recipient=self.user,
                company=self.company_a,
                event_key=f"shape-{index}",
                title=f"Shape {index}",
            )
            NotificationDelivery.objects.create(
                notification=notification,
                recipient=self.user,
                channel=NotificationDelivery.Channel.WHATSAPP,
                status=whatsapp_status,
                provider="evolution_whatsapp",
                provider_message_id="sent-id" if whatsapp_status == NotificationDelivery.Status.SENT else "",
                attempt_count=1 if whatsapp_status != NotificationDelivery.Status.PENDING else 0,
            )
            if include_email:
                NotificationDelivery.objects.create(
                    notification=notification,
                    recipient=self.user,
                    channel=NotificationDelivery.Channel.EMAIL,
                    status=NotificationDelivery.Status.SENT,
                    provider="bird",
                    provider_message_id="fallback-id",
                    attempt_count=1,
                )
            data = NotificationSerializer(
                with_delivery_details(Notification.objects.filter(pk=notification.pk)).get()
            ).data
            self.assertEqual(data["deliveries"][0]["status"], whatsapp_status)
            self.assertEqual(len(data["deliveries"]), 2 if include_email else 1)

    def test_delivery_prefetch_avoids_n_plus_one_queries(self):
        for index in range(5):
            notification = Notification.objects.create(
                recipient=self.user,
                company=self.company_a,
                event_key=f"query-{index}",
                title=f"Query {index}",
            )
            NotificationDelivery.objects.create(
                notification=notification,
                recipient=self.user,
                channel=NotificationDelivery.Channel.WHATSAPP,
                status=NotificationDelivery.Status.SENT,
            )
        queryset = with_delivery_details(Notification.objects.filter(recipient=self.user, company=self.company_a))
        with CaptureQueriesContext(connection) as queries:
            data = NotificationSerializer(queryset, many=True).data
        self.assertEqual(len(data), 6)
        self.assertEqual(len(queries), 3)

    def test_pagination_remains_valid_with_deliveries(self):
        for index in range(3):
            Notification.objects.create(
                recipient=self.user,
                company=self.company_a,
                event_key=f"page-{index}",
                title=f"Page {index}",
            )
        response = self.client.get("/api/notifications/?page=1&page_size=2")
        self.assertEqual(response.data["data"]["count"], 4)
        self.assertEqual(response.data["data"]["page_size"], 2)
        self.assertEqual(len(response.data["data"]["items"]), 2)
        self.assertTrue(all("deliveries" in item for item in response.data["data"]["items"]))

    def test_unread_count_and_read_actions(self):
        response = self.client.get("/api/notifications/unread-count/")
        self.assertEqual(response.data["data"]["unread_count"], 1)

        response = self.client.post(f"/api/notifications/{self.owned.id}/read/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["data"]["unread_count"], 0)
        self.assertEqual(len(response.data["data"]["notification"]["deliveries"]), 2)
        self.owned.refresh_from_db()
        self.assertIsNotNone(self.owned.read_at)

    def test_cannot_read_another_users_or_another_company_notification(self):
        self.assertEqual(self.client.post(f"/api/notifications/{self.other_owner.id}/read/").status_code, 404)
        self.assertEqual(self.client.post(f"/api/notifications/{self.other_company.id}/read/").status_code, 404)

    def test_read_all_only_updates_active_company(self):
        response = self.client.post("/api/notifications/read-all/")
        self.assertEqual(response.data["data"], {"updated_count": 1, "unread_count": 0})
        self.owned.refresh_from_db()
        self.other_company.refresh_from_db()
        self.assertIsNotNone(self.owned.read_at)
        self.assertIsNone(self.other_company.read_at)

    def test_unauthenticated_requests_are_rejected(self):
        self.client.force_authenticate(user=None)
        self.client.credentials(
            HTTP_X_FORWARDED_PROTO="https",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company_a.id),
        )
        self.assertEqual(self.client.get("/api/notifications/").status_code, 401)


class NotificationCleanupTests(TestCase):
    def test_cleanup_defaults_to_90_days_and_supports_dry_run(self):
        company = make_company("COMP-A")
        user = make_user("cleanup@example.com", company)
        old = Notification.objects.create(recipient=user, company=company, event_key="old", title="Old")
        recent = Notification.objects.create(recipient=user, company=company, event_key="recent", title="Recent")
        Notification.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=91))

        call_command("cleanup_notifications", "--dry-run")
        self.assertTrue(Notification.objects.filter(pk=old.pk).exists())
        call_command("cleanup_notifications")
        self.assertFalse(Notification.objects.filter(pk=old.pk).exists())
        self.assertTrue(Notification.objects.filter(pk=recent.pk).exists())


class NotificationWebSocketDeferredTests(SimpleTestCase):
    def assert_realtime_deferred(self, path, headers=None):
        async def scenario():
            communicator = WebsocketCommunicator(application, path, headers=headers)
            connected, close_code = await communicator.connect()
            self.assertFalse(connected)
            self.assertEqual(close_code, 4403)

        async_to_sync(scenario)()

    def test_compatibility_path_is_preserved_but_unavailable(self):
        self.assert_realtime_deferred("/ws/notifications/")

    def test_access_and_refresh_query_tokens_are_never_accepted(self):
        self.assert_realtime_deferred("/ws/notifications/?access_token=header.payload.signature")
        self.assert_realtime_deferred("/ws/notifications/?token=header.payload.signature")
        self.assert_realtime_deferred("/ws/notifications/?refresh=header.payload.signature")

    def test_authorization_header_and_session_cookie_do_not_enable_realtime(self):
        self.assert_realtime_deferred(
            "/ws/notifications/",
            headers=[(b"authorization", b"Bearer header.payload.signature")],
        )
        self.assert_realtime_deferred(
            "/ws/notifications/",
            headers=[(b"cookie", b"sessionid=opaque-session")],
        )
