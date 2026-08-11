from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from audit.models import AuditLog
from in_app_notifications.models import Notification
from organization.models import OrganizationNode, UserOrganizationAccess

from .models import EmployeeProfile
from .notifications import notify_expiring_work_licenses
from .serializers import EmployeeProfileReadSerializer, EmployeeProfileWriteSerializer

User = get_user_model()


class WorkLicenseExpiryTests(TestCase):
    def setUp(self):
        self.today = timezone.localdate()
        self.company = OrganizationNode.objects.create(
            code="WORK-LICENSE-CO",
            name="Work License Company",
            node_type=OrganizationNode.NodeType.COMPANY,
        )
        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.admin_group, _ = Group.objects.get_or_create(name="SystemAdmin")
        self.employee_group, _ = Group.objects.get_or_create(name="Employee")

        self.hr = User.objects.create_user(email="work-license-hr@example.com", password="password")
        self.hr.groups.add(self.hr_group)
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.company)
        EmployeeProfile.objects.create(
            user=self.hr,
            company=self.company,
            employee_id="WL-HR-001",
            full_name="HR Recipient",
            mobile="+201001234567",
        )

        self.employee_user = User.objects.create_user(email="licensed@example.com", password="password")
        self.employee_user.groups.add(self.employee_group)
        self.profile = EmployeeProfile.objects.create(
            user=self.employee_user,
            company=self.company,
            employee_id="WL-EMP-001",
            full_name="Licensed Employee",
            work_license_expiry=self.today + timedelta(days=5),
        )

    def test_model_and_serializers_support_nullable_work_license_expiry(self):
        field = EmployeeProfile._meta.get_field("work_license_expiry")
        self.assertTrue(field.null)
        self.assertTrue(field.blank)
        self.assertEqual(
            EmployeeProfileReadSerializer(self.profile).data["work_license_expiry"],
            self.profile.work_license_expiry.isoformat(),
        )

        serializer = EmployeeProfileWriteSerializer(
            self.profile,
            data={"work_license_expiry": None},
            partial=True,
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        serializer.save()
        self.assertIsNone(self.profile.work_license_expiry)

    def test_expiry_endpoint_returns_work_license_contract_and_excludes_archived(self):
        archived = EmployeeProfile.objects.create(
            company=self.company,
            employee_id="WL-ARCHIVED-001",
            full_name="Archived Employee",
            work_license_expiry=self.today + timedelta(days=3),
            is_archived=True,
        )
        client = APIClient()
        client.force_authenticate(self.hr)

        response = client.get(
            "/api/employees/expiries/?days=10",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(response.status_code, 200, response.data)
        items = response.data["data"]["items"]
        self.assertNotIn(archived.id, [item["id"] for item in items])
        item = next(item for item in items if item["id"] == self.profile.id)
        document = next(doc for doc in item["documents"] if doc["document_type"] == "WORK_LICENSE")
        self.assertEqual(document["doc_type"], "work_license")
        self.assertEqual(document["expiry_date"], self.profile.work_license_expiry.isoformat())
        self.assertEqual(document["days_left"], 5)
        self.assertEqual(item["employee_id"], self.profile.employee_id)
        self.assertEqual(item["full_name"], self.profile.full_name)

    @patch("in_app_notifications.tasks.deliver_whatsapp_notification.delay")
    def test_automatic_notification_is_hr_only_and_deduplicated(self, delay):
        admin = User.objects.create_user(email="work-license-admin@example.com", password="password")
        admin.groups.add(self.admin_group)
        UserOrganizationAccess.objects.create(user=admin, organization=self.company)
        EmployeeProfile.objects.create(
            user=admin,
            company=self.company,
            employee_id="WL-ADMIN-001",
            mobile="+201001234568",
        )

        with self.captureOnCommitCallbacks(execute=True):
            first = notify_expiring_work_licenses(today=self.today)
        with self.captureOnCommitCallbacks(execute=True):
            second = notify_expiring_work_licenses(today=self.today)

        notifications = Notification.objects.filter(
            event_key="document.expiring",
            metadata__document_type="WORK_LICENSE",
        )
        self.assertEqual(first["queued"], 1)
        self.assertEqual(second["queued"], 0)
        self.assertEqual(second["duplicates"], 1)
        self.assertEqual(notifications.count(), 1)
        self.assertEqual(notifications.get().recipient, self.hr)
        delay.assert_called_once()
        self.assertEqual(
            AuditLog.objects.filter(action="employee_work_license_expiry_whatsapp_queued").count(),
            1,
        )

    @patch("in_app_notifications.tasks.deliver_whatsapp_notification.delay")
    def test_automatic_notification_uses_inclusive_ten_day_threshold(self, delay):
        self.profile.work_license_expiry = self.today + timedelta(days=11)
        self.profile.save(update_fields=["work_license_expiry"])
        outside = notify_expiring_work_licenses(today=self.today)
        self.assertEqual(outside["queued"], 0)

        self.profile.work_license_expiry = self.today + timedelta(days=10)
        self.profile.save(update_fields=["work_license_expiry"])
        with self.captureOnCommitCallbacks(execute=True):
            at_threshold = notify_expiring_work_licenses(today=self.today)
        self.assertEqual(at_threshold["queued"], 1)
        delay.assert_called_once()

    @patch("in_app_notifications.tasks.deliver_whatsapp_notification.delay")
    def test_archived_employee_does_not_trigger_notification(self, delay):
        self.profile.is_archived = True
        self.profile.save(update_fields=["is_archived"])
        result = notify_expiring_work_licenses(today=self.today)
        self.assertEqual(result["employees"], 0)
        self.assertEqual(result["queued"], 0)
        self.assertFalse(Notification.objects.filter(metadata__document_type="WORK_LICENSE").exists())
        delay.assert_not_called()
