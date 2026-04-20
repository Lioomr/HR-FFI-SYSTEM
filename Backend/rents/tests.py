from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from assets.models import Asset
from organization.services import get_default_company
from rents.models import Rent, RentPayment, RentReminderLog, RentType
from rents.services import compute_rent_state

User = get_user_model()


class RentFeatureTestsMixin:
    def create_asset(self, name="Property A"):
        return Asset.objects.create(
            name_en=name,
            type=Asset.AssetType.OTHER,
            company=self.company,
            flexible_attributes={"note": {"type": "body", "body": "x"}},
        )


class RentApiTests(RentFeatureTestsMixin, TestCase):
    def setUp(self):
        self.client = APIClient()

        self.hr_group = Group.objects.create(name="HRManager")
        self.emp_group = Group.objects.create(name="Employee")

        self.hr_user = User.objects.create_user(email="hr@ffi.com", password="password", full_name="HR User")
        self.hr_user.groups.add(self.hr_group)

        self.emp_user = User.objects.create_user(email="emp@ffi.com", password="password", full_name="Emp User")
        self.emp_user.groups.add(self.emp_group)

        self.company = get_default_company()
        self.rent_type = RentType.objects.create(company=self.company, code="OFFICE", name_en="Office Rent")
        self.asset = self.create_asset()

    def test_non_hr_forbidden(self):
        self.client.force_authenticate(user=self.emp_user)
        response = self.client.get("/api/hr/rents/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_hr_can_create_list_filter_and_soft_delete(self):
        self.client.force_authenticate(user=self.hr_user)

        create_response = self.client.post(
            "/api/hr/rents/",
            {
                "rent_type_id": self.rent_type.id,
                "asset_id": self.asset.id,
                "property_name_en": "Main Office",
                "recurrence": "ONE_TIME",
                "one_time_due_date": (timezone.localdate() + timedelta(days=20)).isoformat(),
                "lease_start_date": timezone.localdate().isoformat(),
                "lease_end_date": (timezone.localdate() + timedelta(days=20)).isoformat(),
                "reminder_days": 30,
                "amount": "10000.00",
                "annual_rent_value": "120000.00",
                "security_deposit": "10000.00",
                "payment_schedule": "Quarterly bank transfer",
                "auto_renewal": True,
                "notice": "Notify finance before renewal.",
                "payments": "Q1 paid",
            },
            format="json",
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        rent_id = create_response.data["data"]["id"]

        list_response = self.client.get("/api/hr/rents/?status=upcoming&search=office")
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        items = list_response.data["data"]["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["status"], "UPCOMING")
        self.assertEqual(items[0]["remaining_lease_duration"], 20)
        self.assertEqual(items[0]["notification_date"], (timezone.localdate() - timedelta(days=10)).isoformat())
        self.assertEqual(items[0]["annual_rent_value"], "120000.00")
        self.assertEqual(items[0]["security_deposit"], "10000.00")
        self.assertEqual(items[0]["payment_schedule"], "Quarterly bank transfer")
        self.assertTrue(items[0]["auto_renewal"])
        self.assertEqual(items[0]["notice"], "Notify finance before renewal.")
        self.assertEqual(items[0]["payments"], "Q1 paid")

        update_response = self.client.patch(
            f"/api/hr/rents/{rent_id}/",
            {"payments": "Q1 paid; Q2 pending", "security_deposit": "15000.00"},
            format="json",
        )
        self.assertEqual(update_response.status_code, status.HTTP_200_OK)
        self.assertEqual(update_response.data["data"]["payments"], "Q1 paid; Q2 pending")
        self.assertEqual(update_response.data["data"]["security_deposit"], "15000.00")

        delete_response = self.client.delete(f"/api/hr/rents/{rent_id}/")
        self.assertEqual(delete_response.status_code, status.HTTP_200_OK)
        self.assertFalse(Rent.objects.get(id=rent_id).is_active)

    def test_manual_notify_ignores_client_target_override(self):
        self.client.force_authenticate(user=self.hr_user)

        rent = Rent.objects.create(
            rent_type=self.rent_type,
            company=self.company,
            asset=self.asset,
            property_name_en="Main Office",
            recurrence="ONE_TIME",
            one_time_due_date=timezone.localdate() + timedelta(days=5),
            reminder_days=30,
            created_by=self.hr_user,
            updated_by=self.hr_user,
        )

        response = self.client.post(
            f"/api/hr/rents/{rent.id}/notify/",
            {"targets": ["attacker@x.com"], "channels": ["email"]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("delivery", response.data["data"])

    def test_lease_end_date_drives_state_when_available(self):
        rent = Rent.objects.create(
            rent_type=self.rent_type,
            company=self.company,
            asset=self.asset,
            property_name_en="Main Office",
            recurrence="ONE_TIME",
            one_time_due_date=timezone.localdate() + timedelta(days=200),
            lease_end_date=timezone.localdate() + timedelta(days=5),
            reminder_days=30,
            created_by=self.hr_user,
            updated_by=self.hr_user,
        )

        computed = compute_rent_state(rent, today=timezone.localdate())
        self.assertEqual(computed.next_due_date, rent.lease_end_date)
        self.assertEqual(computed.remaining_lease_duration, 5)
        self.assertEqual(computed.notification_date, rent.lease_end_date - timedelta(days=30))
        self.assertEqual(computed.status, "UPCOMING")

    def test_hr_can_add_classified_payment_without_duplicates(self):
        self.client.force_authenticate(user=self.hr_user)
        rent = Rent.objects.create(
            rent_type=self.rent_type,
            company=self.company,
            asset=self.asset,
            property_name_en="Main Office",
            recurrence="ONE_TIME",
            one_time_due_date=timezone.localdate() + timedelta(days=20),
            reminder_days=30,
            created_by=self.hr_user,
            updated_by=self.hr_user,
        )

        response = self.client.post(
            f"/api/hr/rents/{rent.id}/payments/",
            {
                "payment_number": 1,
                "category": RentPayment.Category.RENT,
                "status": RentPayment.Status.PAID,
                "amount": "54250.00",
                "due_date": timezone.localdate().isoformat(),
                "paid_date": timezone.localdate().isoformat(),
                "notes": "First half payment",
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["data"]["payment_number"], 1)
        self.assertEqual(response.data["data"]["category"], RentPayment.Category.RENT)

        duplicate_response = self.client.post(
            f"/api/hr/rents/{rent.id}/payments/",
            {
                "payment_number": 1,
                "category": RentPayment.Category.SECURITY_DEPOSIT,
                "status": RentPayment.Status.PENDING,
                "amount": "1000.00",
            },
            format="json",
        )
        self.assertEqual(duplicate_response.status_code, 422)
        self.assertEqual(duplicate_response.data["errors"][0]["field"], "payment_number")

        detail_response = self.client.get(f"/api/hr/rents/{rent.id}/")
        self.assertEqual(detail_response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(detail_response.data["data"]["payment_records"]), 1)


class RentCommandTests(RentFeatureTestsMixin, TestCase):
    def setUp(self):
        self.hr_group = Group.objects.create(name="HRManager")
        self.hr_user = User.objects.create_user(email="hr2@ffi.com", password="password", full_name="HR User 2")
        self.hr_user.groups.add(self.hr_group)

        self.company = get_default_company()
        self.rent_type = RentType.objects.create(company=self.company, code="WARE", name_en="Warehouse Rent")
        self.asset = self.create_asset(name="Warehouse 1")

    def test_command_is_idempotent(self):
        rent = Rent.objects.create(
            rent_type=self.rent_type,
            company=self.company,
            asset=self.asset,
            property_name_en="Warehouse 1",
            recurrence="ONE_TIME",
            one_time_due_date=timezone.localdate() + timedelta(days=3),
            reminder_days=30,
            created_by=self.hr_user,
            updated_by=self.hr_user,
        )

        call_command("send_rent_reminders")
        first_count = RentReminderLog.objects.filter(rent=rent, channel=RentReminderLog.Channel.ANNOUNCEMENT).count()
        self.assertEqual(first_count, 1)

        call_command("send_rent_reminders")
        second_count = RentReminderLog.objects.filter(rent=rent, channel=RentReminderLog.Channel.ANNOUNCEMENT).count()
        self.assertEqual(second_count, 1)
