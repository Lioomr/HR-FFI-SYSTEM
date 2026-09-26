from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import override_settings
from rest_framework.test import APITestCase

from employees.models import EmployeeProfile
from in_app_notifications.models import Notification
from organization.models import OrganizationNode, UserOrganizationAccess
from organization.services import get_default_organization_for_user, get_head_office_node

from .models import Announcement

User = get_user_model()
URL = "/api/announcements"


@override_settings(ALLOWED_HOSTS=["testserver", "localhost"])
class HeadOfficeBroadcastTests(APITestCase):
    def setUp(self):
        self.head_office = get_head_office_node()
        self.company_a = OrganizationNode.objects.create(
            code="BCA", name="Alpha Co", node_type=OrganizationNode.NodeType.COMPANY, employee_id_prefix="BCA"
        )
        self.company_b = OrganizationNode.objects.create(
            code="BCB", name="Beta Co", node_type=OrganizationNode.NodeType.COMPANY, employee_id_prefix="BCB"
        )
        # A company the HR user and CEO are not assigned to.
        self.company_c = OrganizationNode.objects.create(
            code="BCC", name="Gamma Co", node_type=OrganizationNode.NodeType.COMPANY, employee_id_prefix="BCC"
        )

        self.hr = self._user("hr-broadcast@ffi.test", "HRManager", [self.head_office, self.company_a, self.company_b])
        self.ceo = self._user("ceo-broadcast@ffi.test", "CEO", [self.head_office, self.company_a, self.company_b])
        self.employee_a = self._employee("emp-a@ffi.test", self.company_a, "BCA-001")
        self.employee_b = self._employee("emp-b@ffi.test", self.company_b, "BCB-001")
        self.employee_c = self._employee("emp-c@ffi.test", self.company_c, "BCC-001")

    def _user(self, email, role, organizations):
        user = User.objects.create_user(email=email, password="password")
        user.groups.add(Group.objects.get_or_create(name=role)[0])
        for organization in organizations:
            UserOrganizationAccess.objects.create(user=user, organization=organization)
        return user

    def _employee(self, email, company, employee_id):
        user = self._user(email, "Employee", [])
        EmployeeProfile.objects.create(
            user=user,
            company=company,
            employee_id=employee_id,
            full_name=email,
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        return user

    def _broadcast(self, user=None, **payload):
        self.client.force_authenticate(user or self.hr)
        return self.client.post(
            URL,
            {"title": "Eid holiday", "content": "Offices close on Monday.", "whole_company": True, **payload},
            format="json",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.head_office.id),
        )

    def test_head_office_broadcast_creates_one_copy_per_accessible_company(self):
        response = self._broadcast()

        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data["data"]["created_count"], 2)
        copies = Announcement.objects.filter(title="Eid holiday")
        self.assertEqual({copy.company_id for copy in copies}, {self.company_a.id, self.company_b.id})
        self.assertEqual(len({copy.broadcast_id for copy in copies}), 1)
        self.assertIsNotNone(copies[0].broadcast_id)
        self.assertTrue(all(copy.whole_company for copy in copies))

    def test_each_person_gets_one_notification_even_with_access_to_several_companies(self):
        self._broadcast()

        def count(user):
            return Notification.objects.filter(recipient=user, deduplication_key__startswith="announcement.").count()

        self.assertEqual(count(self.hr), 1)
        self.assertEqual(count(self.ceo), 1)
        self.assertEqual(count(self.employee_a), 1)
        self.assertEqual(count(self.employee_b), 1)
        self.assertEqual(count(self.employee_c), 0)

    def test_employees_see_only_their_own_company_copy(self):
        self._broadcast()
        self.client.force_authenticate(self.employee_a)

        response = self.client.get(URL, HTTP_X_ACTIVE_COMPANY_ID=str(self.company_a.id))

        self.assertEqual(response.status_code, 200, response.content)
        items = response.data["data"]["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["company_id"], self.company_a.id)

    def test_head_office_list_shows_each_broadcast_once_with_its_companies(self):
        self._broadcast()
        with patch("announcements.views.send_announcement_in_app"):
            self.client.post(
                URL,
                {"title": "Alpha only", "content": "Company notice.", "whole_company": True},
                format="json",
                HTTP_X_ACTIVE_COMPANY_ID=str(self.company_a.id),
            )

        response = self.client.get(URL, HTTP_X_ACTIVE_COMPANY_ID=str(self.head_office.id))

        self.assertEqual(response.status_code, 200, response.content)
        items = response.data["data"]["items"]
        self.assertEqual([item["title"] for item in items], ["Eid holiday"])
        self.assertEqual(items[0]["broadcast_company_names"], ["Alpha Co", "Beta Co"])

    def test_head_office_broadcast_rejects_company_only_audiences(self):
        for payload in (
            {"target_user_ids": [self.employee_a.id]},
            {"target_roles": ["CEO"]},
            {"whatsapp_group_id": "ops"},
            {"whole_company": False},
        ):
            with self.subTest(payload=payload):
                response = self._broadcast(**payload)
                self.assertEqual(response.status_code, 422, response.content)
        self.assertFalse(Announcement.objects.exists())

    def test_ceo_can_broadcast_from_head_office(self):
        response = self._broadcast(user=self.ceo)

        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(Announcement.objects.filter(created_by=self.ceo).count(), 2)

    def test_other_roles_cannot_broadcast_from_head_office(self):
        manager = self._user("manager-broadcast@ffi.test", "Manager", [self.head_office, self.company_a])

        response = self._broadcast(user=manager)

        self.assertEqual(response.status_code, 403, response.content)
        self.assertFalse(Announcement.objects.exists())

    def test_edit_and_delete_apply_to_every_copy_only_from_head_office(self):
        self._broadcast()
        copy_a = Announcement.objects.get(company=self.company_a)

        in_company = self.client.patch(
            f"{URL}/{copy_a.id}", {"title": "Changed"}, format="json", HTTP_X_ACTIVE_COMPANY_ID=str(self.company_a.id)
        )
        self.assertEqual(in_company.status_code, 422, in_company.content)

        in_head_office = self.client.patch(
            f"{URL}/{copy_a.id}",
            {"title": "Eid holiday (updated)"},
            format="json",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.head_office.id),
        )
        self.assertEqual(in_head_office.status_code, 200, in_head_office.content)
        self.assertEqual(
            set(Announcement.objects.values_list("title", flat=True)),
            {"Eid holiday (updated)"},
        )

        blocked_delete = self.client.delete(f"{URL}/{copy_a.id}", HTTP_X_ACTIVE_COMPANY_ID=str(self.company_a.id))
        self.assertEqual(blocked_delete.status_code, 422, blocked_delete.content)

        deleted = self.client.delete(f"{URL}/{copy_a.id}", HTTP_X_ACTIVE_COMPANY_ID=str(self.head_office.id))
        self.assertEqual(deleted.status_code, 200, deleted.content)
        self.assertFalse(Announcement.objects.filter(is_active=True).exists())


class DefaultOrganizationTests(APITestCase):
    def setUp(self):
        self.head_office = get_head_office_node()
        self.company = OrganizationNode.objects.create(
            code="DEFA", name="Aaa First Co", node_type=OrganizationNode.NodeType.COMPANY, employee_id_prefix="DEF"
        )

    def _user(self, role, organizations):
        user = User.objects.create_user(email=f"{role.lower()}-default@ffi.test", password="password")
        user.groups.add(Group.objects.get_or_create(name=role)[0])
        for organization in organizations:
            UserOrganizationAccess.objects.create(user=user, organization=organization)
        return user

    def test_hr_and_ceo_with_head_office_access_start_in_head_office(self):
        for role in ("HRManager", "CEO"):
            with self.subTest(role=role):
                user = self._user(role, [self.head_office, self.company])
                self.assertEqual(get_default_organization_for_user(user), self.head_office)

    def test_hr_without_head_office_access_starts_in_a_company(self):
        user = self._user("HRManager", [self.company])
        self.assertEqual(get_default_organization_for_user(user), self.company)

    def test_other_roles_keep_starting_in_a_company(self):
        user = self._user("Manager", [self.head_office, self.company])
        self.assertEqual(get_default_organization_for_user(user), self.company)
