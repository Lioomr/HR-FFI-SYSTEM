from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from employees.models import EmployeeProfile
from organization.models import OrganizationNode, UserOrganizationAccess

from .models import Announcement

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
        with patch("announcements.views.send_announcement_email") as email, patch(
            "announcements.views.send_announcement_whatsapp"
        ) as whatsapp:
            response = self.client.post(
                self.url,
                self._meeting_payload(),
                format="json",
                HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
            )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        self.assertEqual(response.data["data"]["created_count"], 2)
        self.assertEqual(email.call_count, 2)
        self.assertEqual(whatsapp.call_count, 2)
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
        with patch("announcements.views.send_announcement_email") as email, patch(
            "announcements.views.send_announcement_whatsapp"
        ) as whatsapp:
            response = self.client.post(
                self.url,
                self._meeting_payload(publish_to_email=True, publish_to_sms=False),
                format="json",
                HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
            )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.content)
        self.assertEqual(email.call_count, 2)
        whatsapp.assert_not_called()

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
