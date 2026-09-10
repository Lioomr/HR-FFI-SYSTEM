from types import SimpleNamespace
from unittest.mock import Mock, patch

import requests
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APITestCase

from . import tests as announcement_tests
from .models import Announcement, AnnouncementWhatsAppGroupDelivery
from .tasks import send_announcement_group
from .whatsapp_groups import AnnouncementGroupProvider, available_groups, configured_groups

CONFIG = {
    "EVOLUTION_API_BASE_URL": "https://evolution.example.test",
    "EVOLUTION_API_KEY": "test-only-provider-key",
    "EVOLUTION_INSTANCE_NAME": "test-instance",
    "ANNOUNCEMENT_WHATSAPP_GROUP_ALLOWLIST": {
        "MEETCO": [{"jid": "120000000000001@g.us", "label": "Company team"}],
        "OTHERMEET": [{"jid": "120000000000002@g.us", "label": "Other team"}],
    },
    "ALLOWED_HOSTS": ["testserver", "localhost"],
    "NOTIFICATION_WHATSAPP_DELIVERY_ENABLED": True,
}


def response(data, status=200):
    result = Mock(status_code=status)
    result.json.return_value = data
    return result


@override_settings(**CONFIG)
class GroupProviderTests(SimpleTestCase):
    def setUp(self):
        self.company = SimpleNamespace(pk=1, code="MEETCO")
        self.key = next(iter(configured_groups(self.company)))

    @patch("announcements.whatsapp_groups.requests.request")
    def test_group_directory_uses_group_endpoint_and_never_exposes_jids_or_participants(self, request):
        request.side_effect = [
            response({"instance": {"state": "open"}}),
            response(
                [
                    {"id": "120000000000001@g.us", "subject": "+966555555555", "participants": [{"id": "private"}]},
                    {"id": "120000000000002@g.us", "subject": "Other company"},
                ]
            ),
        ]
        result = available_groups(self.company)
        self.assertEqual(result, {"state": "connected", "groups": [{"id": self.key, "name": "Company team"}]})
        self.assertNotIn("@g.us", str(result))
        self.assertNotIn("966555555555", str(result))
        self.assertEqual(request.call_args.args[1], "https://evolution.example.test/group/fetchAllGroups/test-instance")
        self.assertEqual(request.call_args.kwargs["params"], {"getParticipants": "false"})
        self.assertFalse(request.call_args.kwargs["allow_redirects"])

    @patch("announcements.whatsapp_groups.requests.request")
    def test_group_message_preserves_jid_and_uses_group_transport(self, request):
        request.side_effect = [
            response({"instance": {"state": "open"}}),
            response([{"id": "120000000000001@g.us"}]),
            response({}, 201),
        ]
        result = AnnouncementGroupProvider().send_group(company=self.company, group_id=self.key, text="Announcement")
        self.assertEqual(result, ("SUBMITTED", ""))
        self.assertEqual(
            request.call_args.args[:2], ("POST", "https://evolution.example.test/message/sendText/test-instance")
        )
        self.assertEqual(request.call_args.kwargs["json"], {"number": "120000000000001@g.us", "text": "Announcement"})

    @patch("announcements.whatsapp_groups.requests.request")
    def test_missing_disconnected_and_provider_errors_are_safe(self, request):
        cases = [
            ([response({"instance": {"state": "close"}})], ("SKIPPED", "disconnected")),
            ([response({"state": "open"}), response([])], ("SKIPPED", "group_missing")),
            ([requests.ConnectionError("sensitive provider details")], ("SKIPPED", "unavailable")),
            (
                [
                    response({"state": "open"}),
                    response([{"id": "120000000000001@g.us"}]),
                    requests.Timeout("sensitive details"),
                ],
                ("UNKNOWN", "provider_outcome_unknown"),
            ),
            (
                [
                    response({"state": "open"}),
                    response([{"id": "120000000000001@g.us"}]),
                    response({"secret": "private"}, 403),
                ],
                ("FAILED", "provider_rejected"),
            ),
        ]
        for effects, expected in cases:
            with self.subTest(expected=expected):
                request.reset_mock()
                request.side_effect = effects
                self.assertEqual(
                    AnnouncementGroupProvider().send_group(company=self.company, group_id=self.key, text="Notice"),
                    expected,
                )

    @patch("announcements.whatsapp_groups.requests.request")
    def test_invalid_foreign_and_disabled_groups_never_send(self, request):
        foreign = next(iter(configured_groups(SimpleNamespace(pk=2, code="OTHERMEET"))))
        for key in ["120000000000001@g.us", foreign]:
            self.assertEqual(
                AnnouncementGroupProvider().send_group(company=self.company, group_id=key, text="Notice"),
                ("SKIPPED", "group_not_allowed"),
            )
        with override_settings(NOTIFICATION_WHATSAPP_DELIVERY_ENABLED=False):
            self.assertEqual(
                AnnouncementGroupProvider().send_group(company=self.company, group_id=self.key, text="Notice"),
                ("SKIPPED", "disabled"),
            )
        request.assert_not_called()


@override_settings(**CONFIG)
class AnnouncementGroupTests(APITestCase):
    def setUp(self):
        announcement_tests.MeetingAnnouncementTests.setUp(self)
        self.key = next(iter(configured_groups(self.company)))
        self.client.force_authenticate(self.hr)
        self.dispatch = patch("announcements.views.send_announcement_in_app").start()
        self.addCleanup(patch.stopall)

    def create(self, **overrides):
        return self.client.post(
            self.url,
            {
                "title": "Group notice",
                "content": "Policy text",
                "whole_company": True,
                "publish_to_whatsapp": True,
                "whatsapp_group_id": self.key,
                **overrides,
            },
            format="json",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

    @patch("announcements.views.available_groups", return_value={"state": "connected", "groups": []})
    def test_group_directory_is_hr_only_and_active_company_scoped(self, groups):
        result = self.client.get(f"{self.url}/whatsapp-groups", HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id))
        self.assertEqual(result.status_code, 200)
        self.assertEqual(groups.call_args.args[0].pk, self.company.pk)
        self.client.force_authenticate(self.employee_one)
        self.assertEqual(
            self.client.get(f"{self.url}/whatsapp-groups", HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id)).status_code,
            403,
        )
        self.assertEqual(groups.call_count, 1)

    def test_group_selection_rejects_raw_foreign_and_disabled_channel(self):
        foreign = next(iter(configured_groups(self.other_company)))
        for fields in [
            {"whatsapp_group_id": "120000000000001@g.us"},
            {"whatsapp_group_id": foreign},
            {"publish_to_whatsapp": False},
        ]:
            self.assertEqual(self.create(**fields).status_code, 422)
        self.assertFalse(Announcement.objects.exists())
        self.client.force_authenticate(self.employee_one)
        self.assertEqual(self.create().status_code, 422)

    @patch("announcements.tasks.send_announcement_group.apply_async")
    def test_selected_fanout_schedules_one_group_message_and_preserves_individuals(self, enqueue):
        with self.captureOnCommitCallbacks(execute=True):
            result = self.create(whole_company=False, target_user_ids=[self.employee_one.id, self.employee_two.id])
        self.assertEqual(result.status_code, 201, result.content)
        self.assertEqual(Announcement.objects.count(), 2)
        self.assertEqual(self.dispatch.call_count, 2)
        self.assertEqual(AnnouncementWhatsAppGroupDelivery.objects.count(), 1)
        enqueue.assert_called_once()
        for call in self.dispatch.call_args_list:
            self.assertTrue(call.args[0].publish_to_whatsapp)
        item = Announcement.objects.first()
        result = self.client.patch(
            f"{self.url}/{item.id}", {"content": "Edited"}, format="json", HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id)
        )
        self.assertEqual(result.status_code, 200)
        enqueue.assert_called_once()

    @patch(
        "announcements.tasks.send_announcement_group.apply_async",
        side_effect=RuntimeError("secret-like provider output"),
    )
    def test_broker_failure_does_not_block_creation_or_leak_exception(self, enqueue):
        with self.assertLogs("announcements.tasks", level="WARNING") as logs:
            with self.captureOnCommitCallbacks(execute=True):
                result = self.create()
        self.assertEqual(result.status_code, 201)
        self.assertNotIn("secret-like", str(result.data) + str(logs.output))
        self.assertEqual(AnnouncementWhatsAppGroupDelivery.objects.get().reason, "queue_unavailable")
        self.dispatch.assert_called_once()

    @patch("announcements.tasks.AnnouncementGroupProvider.send_group", return_value=("SUBMITTED", ""))
    def test_worker_is_idempotent_and_snapshots_text_without_private_attachments(self, send):
        self.create()
        delivery = AnnouncementWhatsAppGroupDelivery.objects.get()
        send_announcement_group(delivery.pk)
        send_announcement_group(delivery.pk)
        send.assert_called_once()
        self.assertIn("Policy text", send.call_args.kwargs["text"])
        self.assertNotIn("attachment-public", send.call_args.kwargs["text"])
        delivery.refresh_from_db()
        self.assertEqual(delivery.status, "SUBMITTED")

    @patch(
        "announcements.tasks.AnnouncementGroupProvider.send_group",
        side_effect=RuntimeError("phone +966555555555 api key private"),
    )
    def test_worker_failure_is_safe_and_does_not_retry(self, send):
        self.create(target_roles=["CEO"], whole_company=False)
        delivery = AnnouncementWhatsAppGroupDelivery.objects.get()
        with self.assertLogs("announcements.tasks", level="INFO") as logs:
            send_announcement_group(delivery.pk)
        delivery.refresh_from_db()
        self.assertEqual(delivery.status, "UNKNOWN")
        self.assertNotIn("966555555555", str(logs.output))
        self.assertNotIn("private", str(logs.output))
        self.dispatch.assert_called_once()

    @patch("announcements.tasks.AnnouncementGroupProvider.send_group")
    def test_cleared_group_cancels_pending_send_and_employee_cannot_see_group_metadata(self, send):
        self.create()
        delivery = AnnouncementWhatsAppGroupDelivery.objects.get()
        result = self.client.patch(
            f"{self.url}/{delivery.announcement_id}",
            {"publish_to_whatsapp": False},
            format="json",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )
        self.assertEqual(result.status_code, 200)
        send_announcement_group(delivery.pk)
        send.assert_not_called()
        self.client.force_authenticate(self.employee_one)
        result = self.client.get(
            f"{self.url}/{delivery.announcement_id}", HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id)
        )
        self.assertEqual(result.status_code, 200)
        self.assertNotIn("whatsapp_group_id", result.data["data"]["announcement"])

    @patch("announcements.tasks.send_announcement_group.apply_async")
    def test_no_selected_group_does_not_queue_group_delivery(self, enqueue):
        with self.captureOnCommitCallbacks(execute=True):
            result = self.create(whatsapp_group_id="")
        self.assertEqual(result.status_code, 201)
        enqueue.assert_not_called()
        self.dispatch.assert_called_once()
        self.assertFalse(AnnouncementWhatsAppGroupDelivery.objects.exists())

    def test_meeting_group_snapshot_contains_details_but_not_private_pdf_link(self):
        from datetime import timedelta

        from django.utils import timezone

        result = self.create(
            announcement_type="MEETING",
            meeting_starts_at=(timezone.now() + timedelta(days=1)).isoformat(),
            meeting_location="Meeting room",
            meeting_agenda="Team updates",
            google_meet_url="https://meet.google.com/test",
        )
        self.assertEqual(result.status_code, 201, result.content)
        delivery = AnnouncementWhatsAppGroupDelivery.objects.get()
        self.assertIn("Meeting room", delivery.message)
        self.assertIn("Team updates", delivery.message)
        self.assertIn("https://meet.google.com/test", delivery.message)
        self.assertNotIn("attachment-public", delivery.message)
