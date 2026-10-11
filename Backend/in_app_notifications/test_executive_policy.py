from datetime import datetime
from datetime import timezone as dt_timezone
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import SimpleTestCase, TestCase, override_settings

from employees.models import EmployeeProfile
from organization.models import OrganizationNode

from .dispatcher import dispatch_notification_channels
from .executive_policy import HELD_DIGESTED, HELD_FOR_DIGEST, is_executive_recipient, quiet_hours_active
from .models import Notification, NotificationDelivery
from .tasks import send_executive_digest

User = get_user_model()
DELAY = "in_app_notifications.tasks.deliver_whatsapp_notification.delay"
REMINDER = {"event": "ceo_reminder", "rating_id": 1}


def utc(hour):
    return datetime(2026, 10, 11, hour, 0, tzinfo=dt_timezone.utc)


class QuietHoursTests(SimpleTestCase):
    @override_settings(APP_TIME_ZONE="Asia/Riyadh", EXECUTIVE_QUIET_HOURS_START=22, EXECUTIVE_QUIET_HOURS_END=7)
    def test_window_is_evaluated_in_riyadh_time(self):
        self.assertTrue(quiet_hours_active(utc(19)))  # 22:00 Riyadh
        self.assertTrue(quiet_hours_active(utc(2)))  # 05:00 Riyadh
        self.assertFalse(quiet_hours_active(utc(4)))  # 07:00 Riyadh
        self.assertFalse(quiet_hours_active(utc(12)))  # 15:00 Riyadh


class ExecutivePolicyTestCase(TestCase):
    def setUp(self):
        self.company = OrganizationNode.objects.create(
            code="EXEC", name="EXEC", node_type=OrganizationNode.NodeType.COMPANY
        )

    def make_user(self, email, *, group=None, title="Employee", mobile="+966501234567"):
        user = User.objects.create_user(email=email, password="StrongPassword123!", is_active=True)
        if group:
            user.groups.add(Group.objects.get_or_create(name=group)[0])
        EmployeeProfile.objects.create(
            user=user,
            company=self.company,
            employee_id=email.split("@")[0],
            full_name=email.split("@")[0],
            job_title=title,
            mobile=mobile,
        )
        return user

    def dispatch(self, user, key, *, metadata=None, event_key="contract.rating", object_id="1"):
        with self.captureOnCommitCallbacks(execute=True):
            return dispatch_notification_channels(
                recipient=user,
                event_key=event_key,
                title="Title",
                message="Message",
                category=Notification.Category.APPROVAL,
                related_object_type="contract_ratings.contractrating",
                related_object_id=object_id,
                metadata=metadata or {},
                deduplication_key=key,
            )


@override_settings(EXECUTIVE_QUIET_HOURS_START=22, EXECUTIVE_QUIET_HOURS_END=7)
class ExecutiveDispatchTests(ExecutivePolicyTestCase):
    def test_who_counts_as_an_executive(self):
        self.assertTrue(is_executive_recipient(self.make_user("ceo@example.com", group="CEO")))
        self.assertTrue(
            is_executive_recipient(self.make_user("gm@example.com", group="Employee", title="General Manager"))
        )
        self.assertFalse(is_executive_recipient(self.make_user("admin@example.com", group="SystemAdmin")))
        self.assertFalse(is_executive_recipient(self.make_user("hr@example.com", group="HRManager")))

    @patch(DELAY)
    def test_ceo_reminder_stays_in_the_bell_and_is_held_for_the_digest(self, delay):
        ceo = self.make_user("ceo@example.com", group="CEO")
        with patch("in_app_notifications.executive_policy.quiet_hours_active", return_value=False):
            result = self.dispatch(ceo, "r:1", metadata=REMINDER)
        delay.assert_not_called()
        self.assertIsNotNone(result["notification"])
        delivery = NotificationDelivery.objects.get(notification=result["notification"], channel="whatsapp")
        self.assertEqual(delivery.status, NotificationDelivery.Status.SKIPPED)
        self.assertEqual(delivery.error_message, HELD_FOR_DIGEST)
        self.assertFalse(NotificationDelivery.objects.filter(channel="email").exists())

    @patch(DELAY)
    def test_general_manager_reminder_is_held_too(self, delay):
        gm = self.make_user("gm@example.com", title="General Manager")
        with patch("in_app_notifications.executive_policy.quiet_hours_active", return_value=False):
            self.dispatch(gm, "r:gm", metadata=REMINDER)
        delay.assert_not_called()

    @patch(DELAY)
    def test_first_time_item_is_sent_outside_quiet_hours_and_held_inside(self, delay):
        ceo = self.make_user("ceo@example.com", group="CEO")
        with patch("in_app_notifications.executive_policy.quiet_hours_active", return_value=False):
            self.dispatch(ceo, "n:1", metadata={"event": "both_submitted"})
        delay.assert_called_once()
        delay.reset_mock()
        with patch("in_app_notifications.executive_policy.quiet_hours_active", return_value=True):
            result = self.dispatch(ceo, "n:2", metadata={"event": "both_submitted"})
        delay.assert_not_called()
        delivery = NotificationDelivery.objects.get(notification=result["notification"], channel="whatsapp")
        self.assertEqual(delivery.error_message, HELD_FOR_DIGEST)

    @patch(DELAY)
    def test_everyone_else_is_unchanged(self, delay):
        for index, group in enumerate(("HRManager", "SystemAdmin", "Employee")):
            user = self.make_user(f"user{index}@example.com", group=group)
            with patch("in_app_notifications.executive_policy.quiet_hours_active", return_value=True):
                self.dispatch(user, f"u:{index}", metadata=REMINDER)
        self.assertEqual(delay.call_count, 3)

    @override_settings(EXECUTIVE_NOTIFICATION_POLICY_ENABLED=False)
    @patch(DELAY)
    def test_policy_can_be_switched_off(self, delay):
        ceo = self.make_user("ceo@example.com", group="CEO")
        self.dispatch(ceo, "r:off", metadata=REMINDER)
        delay.assert_called_once()


class ExecutiveDigestTests(ExecutivePolicyTestCase):
    def held_reminder(self, user, rating_id, round_number=1):
        with patch("in_app_notifications.executive_policy.quiet_hours_active", return_value=False), patch(DELAY):
            return self.dispatch(user, f"r:{rating_id}:{round_number}", metadata=REMINDER, object_id=str(rating_id))[
                "notification"
            ]

    @patch("in_app_notifications.tasks.deliver_whatsapp_notification.delay")
    def test_one_digest_replaces_many_reminders_and_is_not_repeated(self, delay):
        ceo = self.make_user("ceo@example.com", group="CEO")
        for rating_id in (3, 7, 8, 15):
            self.held_reminder(ceo, rating_id)
        # A second reminder for the same rating must not inflate the count.
        self.held_reminder(ceo, 3, round_number=2)
        delay.reset_mock()

        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(send_executive_digest()["recipients"], 1)
        digest = Notification.objects.get(recipient=ceo, event_key="executive.digest")
        self.assertIn("4", digest.message)
        self.assertIn("contract ratings", digest.message)
        delay.assert_called_once()
        self.assertFalse(NotificationDelivery.objects.filter(recipient=ceo, error_message=HELD_FOR_DIGEST).exists())
        self.assertEqual(NotificationDelivery.objects.filter(recipient=ceo, error_message=HELD_DIGESTED).count(), 5)

        delay.reset_mock()
        self.assertEqual(send_executive_digest()["recipients"], 0)
        delay.assert_not_called()

    @patch("in_app_notifications.tasks.deliver_whatsapp_notification.delay")
    def test_items_already_read_are_left_out(self, delay):
        ceo = self.make_user("ceo@example.com", group="CEO")
        notification = self.held_reminder(ceo, 3)
        from django.utils import timezone

        Notification.objects.filter(pk=notification.pk).update(read_at=timezone.now())
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(send_executive_digest()["recipients"], 0)
        self.assertFalse(Notification.objects.filter(event_key="executive.digest").exists())
        self.assertEqual(NotificationDelivery.objects.filter(error_message=HELD_DIGESTED).count(), 1)
