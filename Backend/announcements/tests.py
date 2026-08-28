from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core import signing
from django.core.files.uploadedfile import SimpleUploadedFile
from django.template.loader import render_to_string
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from audit.models import AuditLog
from employees.models import EmployeeProfile
from organization.models import OrganizationNode, UserOrganizationAccess

from .models import Announcement
from .utils import (
    ANNOUNCEMENT_ATTACHMENT_SALT,
    _announcement_attachment_url,
    _format_announcement_published_at,
    send_announcement_email,
)

User = get_user_model()


@override_settings(ALLOWED_HOSTS=["testserver", "localhost"])
class MeetingAnnouncementTests(APITestCase):
    def setUp(self):
        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.employee_group, _ = Group.objects.get_or_create(name="Employee")

        self.company = OrganizationNode.objects.create(
            code="MEETCO",
            name="Meeting Co",
            node_type=OrganizationNode.NodeType.COMPANY,
            employee_id_prefix="MCO",
        )
        self.other_company = OrganizationNode.objects.create(
            code="OTHERMEET",
            name="Other Meeting Co",
            node_type=OrganizationNode.NodeType.COMPANY,
            employee_id_prefix="OMC",
        )

        self.hr = User.objects.create_user(email="hr-meeting@ffi.test", password="password")
        self.hr.groups.add(self.hr_group)
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.company)

        self.employee_one = User.objects.create_user(email="employee-one@ffi.test", password="password")
        self.employee_one.groups.add(self.employee_group)
        EmployeeProfile.objects.create(
            user=self.employee_one,
            company=self.company,
            employee_id="MCO-001",
            full_name="Employee One",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )

        self.employee_two = User.objects.create_user(email="employee-two@ffi.test", password="password")
        self.employee_two.groups.add(self.employee_group)
        EmployeeProfile.objects.create(
            user=self.employee_two,
            company=self.company,
            employee_id="MCO-002",
            full_name="Employee Two",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )

        self.outsider = User.objects.create_user(email="outsider@ffi.test", password="password")
        self.outsider.groups.add(self.employee_group)
        EmployeeProfile.objects.create(
            user=self.outsider,
            company=self.other_company,
            employee_id="OMC-001",
            full_name="Outsider",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )

        self.url = "/api/announcements"

    def _meeting_payload(self, **overrides):
        payload = {
            "announcement_type": Announcement.AnnouncementType.MEETING,
            "title": "Monthly HR Meeting",
            "content": "Please join the monthly HR meeting.",
            "target_roles": [],
            "target_user_ids": [self.employee_one.id, self.employee_two.id],
            "publish_to_dashboard": True,
            "publish_to_email": True,
            "publish_to_sms": True,
            "meeting_starts_at": (timezone.now() + timedelta(days=2)).isoformat(),
            "meeting_duration_minutes": 45,
            "meeting_location": "Online",
            "meeting_agenda": "Policy updates\nOpen questions",
            "google_meet_url": "https://meet.google.com/abc-defg-hij",
            "microsoft_teams_url": "https://teams.microsoft.com/l/meetup-join/example",
            "zoom_url": "https://zoom.us/j/123456789",
        }
        payload.update(overrides)
        return payload

    def test_hr_can_create_meeting_for_selected_active_employees(self):
        self.client.force_authenticate(self.hr)
        with patch("announcements.views.send_announcement_in_app") as dispatch:
            response = self.client.post(
                self.url,
                self._meeting_payload(),
                format="json",
                HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
            )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        self.assertEqual(response.data["data"]["created_count"], 2)
        self.assertEqual(dispatch.call_count, 2)
        self.assertEqual(
            set(Announcement.objects.values_list("target_user_id", flat=True)),
            {self.employee_one.id, self.employee_two.id},
        )

    def test_non_hr_cannot_create_selected_employee_meeting(self):
        self.client.force_authenticate(self.employee_one)
        response = self.client.post(
            self.url,
            self._meeting_payload(target_user_ids=[self.employee_two.id]),
            format="json",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_company_scope_blocks_selected_employee_outside_active_company(self):
        self.client.force_authenticate(self.hr)
        response = self.client.post(
            self.url,
            self._meeting_payload(target_user_ids=[self.employee_one.id, self.outsider.id]),
            format="json",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(Announcement.objects.count(), 0)

    def test_delivery_helpers_respect_selected_channels(self):
        self.client.force_authenticate(self.hr)
        with patch("announcements.views.send_announcement_in_app") as dispatch:
            response = self.client.post(
                self.url,
                self._meeting_payload(publish_to_email=True, publish_to_sms=False),
                format="json",
                HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
            )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        self.assertEqual(dispatch.call_count, 2)

    def test_publish_to_whatsapp_alias_triggers_whatsapp_delivery(self):
        self.client.force_authenticate(self.hr)
        payload = {
            "title": "Policy Update",
            "content": "Please review the policy update.",
            "target_roles": ["EMPLOYEE"],
            "publish_to_dashboard": True,
            "publish_to_email": False,
            "publish_to_whatsapp": True,
        }

        with patch("announcements.views.send_announcement_in_app") as dispatch:
            response = self.client.post(
                self.url,
                payload,
                format="json",
                HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
            )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        announcement = Announcement.objects.get(title="Policy Update")
        self.assertTrue(announcement.publish_to_sms)
        self.assertTrue(response.data["data"]["announcement"]["publish_to_whatsapp"])
        self.assertTrue(response.data["data"]["announcement"]["publish_to_sms"])
        dispatch.assert_called_once()

    def test_conflicting_whatsapp_and_deprecated_sms_aliases_are_rejected(self):
        self.client.force_authenticate(self.hr)
        payload = {
            "title": "Policy Update",
            "content": "Please review the policy update.",
            "target_roles": ["EMPLOYEE"],
            "publish_to_sms": False,
            "publish_to_whatsapp": True,
        }

        response = self.client.post(
            self.url,
            payload,
            format="json",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_meeting_requires_selected_recipients(self):
        self.client.force_authenticate(self.hr)
        response = self.client.post(
            self.url,
            self._meeting_payload(target_user_ids=[]),
            format="json",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_meeting_links_serialize(self):
        self.client.force_authenticate(self.hr)
        response = self.client.post(
            self.url,
            self._meeting_payload(target_user_ids=[self.employee_one.id]),
            format="json",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        announcement = Announcement.objects.get()
        detail = self.client.get(
            f"{self.url}/{announcement.id}",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(detail.status_code, status.HTTP_200_OK)
        data = detail.data["data"]["announcement"]
        self.assertEqual(data["announcement_type"], Announcement.AnnouncementType.MEETING)
        self.assertEqual(data["google_meet_url"], "https://meet.google.com/abc-defg-hij")
        self.assertEqual(data["microsoft_teams_url"], "https://teams.microsoft.com/l/meetup-join/example")
        self.assertEqual(data["zoom_url"], "https://zoom.us/j/123456789")

    def test_public_attachment_link_downloads_pdf(self):
        attachment = SimpleUploadedFile("notice.pdf", b"%PDF-1.4 test pdf", content_type="application/pdf")
        announcement = Announcement.objects.create(
            company=self.company,
            title="Policy Notice",
            content="Please download the attached notice.",
            target_roles=["EMPLOYEE"],
            publish_to_dashboard=True,
            publish_to_email=True,
            created_by=self.hr,
            attachment=attachment,
        )
        token = signing.dumps({"announcement_id": announcement.id}, salt=ANNOUNCEMENT_ATTACHMENT_SALT)

        anonymous_response = self.client.get(
            f"/api/announcements/{announcement.id}/attachment-public",
            {"token": token, "download": 1},
        )
        self.assertEqual(anonymous_response.status_code, status.HTTP_401_UNAUTHORIZED)

        self.client.force_authenticate(self.employee_one)
        response = self.client.get(
            f"/api/announcements/{announcement.id}/attachment-public",
            {"token": token, "download": 1},
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "application/octet-stream")
        self.assertIn('attachment; filename="notice.pdf"', response["Content-Disposition"])
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        self.assertEqual(response["Deprecation"], "true")
        self.assertTrue(
            AuditLog.objects.filter(
                action="announcement_attachment_downloaded",
                entity_id=str(announcement.id),
                actor=self.employee_one,
            ).exists()
        )

    def test_employee_list_detail_and_attachment_are_active_company_scoped(self):
        own = Announcement.objects.create(
            company=self.company,
            title="Own company notice",
            content="Visible",
            target_roles=["EMPLOYEE"],
            publish_to_dashboard=True,
            created_by=self.hr,
            attachment=SimpleUploadedFile("own.pdf", b"%PDF-1.4 own", content_type="application/pdf"),
        )
        foreign = Announcement.objects.create(
            company=self.other_company,
            title="Other company notice",
            content="Hidden",
            target_roles=["EMPLOYEE"],
            publish_to_dashboard=True,
            created_by=self.hr,
            attachment=SimpleUploadedFile("foreign.pdf", b"%PDF-1.4 foreign", content_type="application/pdf"),
        )
        self.client.force_authenticate(self.employee_one)

        list_response = self.client.get(self.url, HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id))
        own_detail = self.client.get(f"{self.url}/{own.id}", HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id))
        foreign_detail = self.client.get(f"{self.url}/{foreign.id}", HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id))
        foreign_attachment = self.client.get(
            f"{self.url}/{foreign.id}/attachment/", HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id)
        )

        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        serialized = str(list_response.data)
        self.assertIn("Own company notice", serialized)
        self.assertNotIn("Other company notice", serialized)
        self.assertEqual(own_detail.status_code, status.HTTP_200_OK)
        self.assertEqual(foreign_detail.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(foreign_attachment.status_code, status.HTTP_404_NOT_FOUND)

    def test_authenticated_attachment_is_forced_download_with_security_headers(self):
        announcement = Announcement.objects.create(
            company=self.company,
            title="Attachment",
            content="Visible",
            target_roles=["EMPLOYEE"],
            publish_to_dashboard=True,
            created_by=self.hr,
            attachment=SimpleUploadedFile("notice.pdf", b"%PDF-1.4 test", content_type="application/pdf"),
        )
        self.client.force_authenticate(self.employee_one)

        response = self.client.get(
            f"{self.url}/{announcement.id}/attachment/",
            {"download": 0},
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "application/octet-stream")
        self.assertIn("attachment", response["Content-Disposition"].lower())
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        self.assertEqual(response["Cache-Control"], "private, no-store")

    def test_attachment_rejects_pdf_extension_with_invalid_content(self):
        self.client.force_authenticate(self.hr)
        response = self.client.post(
            self.url,
            {
                "title": "Invalid PDF",
                "content": "Invalid",
                "target_roles": ["EMPLOYEE"],
                "attachment": SimpleUploadedFile("notice.pdf", b"not a pdf", content_type="application/pdf"),
            },
            format="multipart",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    @override_settings(BACKEND_PUBLIC_URL="http://localhost:8000", FRONTEND_URL="http://localhost:5173")
    def test_attachment_email_link_uses_backend_public_url(self):
        attachment = SimpleUploadedFile("notice.pdf", b"%PDF-1.4 test pdf", content_type="application/pdf")
        announcement = Announcement.objects.create(
            company=self.company,
            title="Policy Notice",
            content="Please download the attached notice.",
            target_roles=["EMPLOYEE"],
            publish_to_dashboard=True,
            publish_to_email=True,
            created_by=self.hr,
            attachment=attachment,
        )

        attachment_url = _announcement_attachment_url(announcement)

        self.assertTrue(attachment_url.startswith("http://localhost:8000/api/announcements/"))
        self.assertIn("attachment-public?token=", attachment_url)
        self.assertTrue(attachment_url.endswith("&download=1"))

    @override_settings(BACKEND_PUBLIC_URL="", ALLOWED_HOSTS=["api.asecopro.com"], DEBUG=False)
    def test_attachment_email_link_falls_back_to_allowed_host(self):
        attachment = SimpleUploadedFile("notice.pdf", b"%PDF-1.4 test pdf", content_type="application/pdf")
        announcement = Announcement.objects.create(
            company=self.company,
            title="Policy Notice",
            content="Please download the attached notice.",
            target_roles=["EMPLOYEE"],
            publish_to_dashboard=True,
            publish_to_email=True,
            created_by=self.hr,
            attachment=attachment,
        )

        attachment_url = _announcement_attachment_url(announcement)

        self.assertTrue(attachment_url.startswith("https://api.asecopro.com/api/announcements/"))
        self.assertIn("attachment-public?token=", attachment_url)
        self.assertTrue(attachment_url.endswith("&download=1"))

    def test_announcement_email_template_renders_attachment_download_button(self):
        html = render_to_string(
            "emails/announcement_notification.html",
            {
                "logo_url": "",
                "contact_email": "hr@ffi.test",
                "title": "New Company Announcement",
                "title_ar": "New Company Announcement",
                "employee_name": "Employee One",
                "message": "Please download the attachment.",
                "message_ar": "Please download the attachment.",
                "announcement_title": "Policy Notice",
                "publisher_name": "HR",
                "published_at": "2026-05-04 11:45 AM UTC",
                "attachment_name": "notice.pdf",
                "attachment_url": "https://api.asecopro.com/api/announcements/1/attachment-public?token=abc&download=1",
            },
        )

        self.assertIn("Download Attachment", html)
        self.assertIn("https://api.asecopro.com/api/announcements/1/attachment-public", html)

    def test_send_announcement_email_calls_provider_for_target_user(self):
        announcement = Announcement.objects.create(
            company=self.company,
            title="Policy Notice",
            content="Please review the policy notice.",
            target_roles=[],
            target_user=self.employee_one,
            publish_to_dashboard=True,
            publish_to_email=True,
            created_by=self.hr,
        )

        with patch("announcements.utils.send_announcement_notification_email") as send_email:
            send_email.return_value = {"success": True, "status_code": 202}
            result = send_announcement_email(announcement)

        self.assertEqual(result["sent"], 1)
        self.assertEqual(result["failed"], 0)
        send_email.assert_called_once()
        self.assertEqual(send_email.call_args.kwargs["to_email"], "employee-one@ffi.test")

    def test_send_announcement_email_excludes_same_role_users_from_other_companies(self):
        announcement = Announcement.objects.create(
            company=self.company,
            title="Company Policy Notice",
            content="This notice belongs to one company.",
            target_roles=["EMPLOYEE"],
            publish_to_dashboard=True,
            publish_to_email=True,
            created_by=self.hr,
        )

        with patch("announcements.utils.send_announcement_notification_email") as send_email:
            send_email.return_value = {"success": True, "status_code": 202}
            result = send_announcement_email(announcement)

        self.assertEqual(result["sent"], 2)
        delivered_to = {call.kwargs["to_email"] for call in send_email.call_args_list}
        self.assertEqual(delivered_to, {"employee-one@ffi.test", "employee-two@ffi.test"})
        self.assertNotIn("outsider@ffi.test", delivered_to)

    def test_send_announcement_email_reports_no_recipients(self):
        announcement = Announcement.objects.create(
            company=self.company,
            title="Policy Notice",
            content="Please review the policy notice.",
            target_roles=["EMPLOYEE"],
            publish_to_dashboard=True,
            publish_to_email=True,
            created_by=self.hr,
        )
        User.objects.filter(groups=self.employee_group).update(is_active=False)

        with self.assertLogs("announcements.utils", level="WARNING") as logs:
            result = send_announcement_email(announcement)

        self.assertEqual(result["reason"], "no_recipients")
        self.assertIn("announcement_email_skipped_no_recipients", "\n".join(logs.output))

    def test_send_announcement_email_logs_provider_failure_without_hiding_it(self):
        announcement = Announcement.objects.create(
            company=self.company,
            title="Provider Failure Notice",
            content="The delivery provider is unavailable.",
            target_roles=[],
            target_user=self.employee_one,
            publish_to_dashboard=True,
            publish_to_email=True,
            created_by=self.hr,
        )

        with patch("announcements.utils.send_announcement_notification_email") as send_email:
            send_email.return_value = {"success": False, "status_code": 503}
            with self.assertLogs("announcements.utils", level="ERROR") as logs:
                result = send_announcement_email(announcement)

        self.assertEqual(result, {"sent": 0, "failed": 1, "reason": None})
        self.assertIn("announcement_email_failed", "\n".join(logs.output))

    @override_settings(EMAIL_DISPLAY_TIME_ZONE="Asia/Riyadh")
    def test_announcement_email_timestamp_uses_configured_display_timezone(self):
        published_at = timezone.make_aware(timezone.datetime(2026, 5, 1, 11, 54))

        formatted = _format_announcement_published_at(published_at)

        self.assertEqual(formatted, "2026-05-01 02:54 PM +03")
