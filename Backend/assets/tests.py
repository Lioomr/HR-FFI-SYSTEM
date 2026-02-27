from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from employees.models import EmployeeProfile

from .models import Asset, AssetAssignment

User = get_user_model()


class AssetsTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.admin_group, _ = Group.objects.get_or_create(name="SystemAdmin")
        self.employee_group, _ = Group.objects.get_or_create(name="Employee")
        self.manager_group, _ = Group.objects.get_or_create(name="Manager")

        self.hr_user = User.objects.create_user(email="hr-assets@ffi.com", password="password")
        self.hr_user.groups.add(self.hr_group)

        self.employee_user = User.objects.create_user(email="emp-assets@ffi.com", password="password")
        self.employee_user.groups.add(self.employee_group)

        self.manager_user = User.objects.create_user(email="mgr-assets@ffi.com", password="password")
        self.manager_user.groups.add(self.manager_group)

        self.employee_profile = EmployeeProfile.objects.create(
            user=self.employee_user,
            employee_id="EMP-ASSET-001",
            full_name="Asset Employee",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )

        self.manager_profile = EmployeeProfile.objects.create(
            user=self.manager_user,
            employee_id="EMP-ASSET-002",
            full_name="Asset Manager",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )

    def test_vehicle_validation_requires_vehicle_fields(self):
        self.client.force_authenticate(user=self.hr_user)
        payload = {
            "name_en": "Company Car",
            "type": "VEHICLE",
            "asset_value": "100000.00",
        }
        response = self.client.post("/api/assets/", payload)
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_laptop_validation_requires_laptop_fields(self):
        self.client.force_authenticate(user=self.hr_user)
        payload = {
            "name_en": "Work Laptop",
            "type": "LAPTOP",
            "asset_value": "5000.00",
        }
        response = self.client.post("/api/assets/", payload)
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_other_validation_requires_flexible_attributes(self):
        self.client.force_authenticate(user=self.hr_user)
        payload = {
            "name_en": "Other Asset",
            "type": "OTHER",
        }
        response = self.client.post("/api/assets/", payload)
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_asset_code_generation_by_type(self):
        vehicle = Asset.objects.create(
            name_en="Vehicle 1",
            type=Asset.AssetType.VEHICLE,
            plate_number="A123",
            chassis_number="CH123",
            engine_number="EN123",
            fuel_type="Petrol",
        )
        laptop = Asset.objects.create(
            name_en="Laptop 1",
            type=Asset.AssetType.LAPTOP,
            cpu="i7",
            ram="16GB",
            storage="512GB",
            mac_address="AA:BB:CC:DD:EE:01",
            operating_system="Windows",
        )
        other = Asset.objects.create(
            name_en="Other 1",
            type=Asset.AssetType.OTHER,
            flexible_attributes={"k": "v"},
        )

        self.assertTrue(vehicle.asset_code.startswith("VEH-"))
        self.assertTrue(laptop.asset_code.startswith("LAP-"))
        self.assertTrue(other.asset_code.startswith("AST-"))

    def test_assign_and_return_flow(self):
        self.client.force_authenticate(user=self.hr_user)

        create_response = self.client.post(
            "/api/assets/",
            {
                "name_en": "Lenovo ThinkPad",
                "type": "LAPTOP",
                "cpu": "i7",
                "ram": "16GB",
                "storage": "512GB",
                "mac_address": "AA:BB:CC:DD:EE:02",
                "operating_system": "Windows",
            },
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        asset_id = create_response.data["data"]["id"]

        assign_response = self.client.post(
            f"/api/assets/{asset_id}/assign/",
            {"employee_id": self.employee_profile.id},
        )
        self.assertEqual(assign_response.status_code, status.HTTP_200_OK)

        asset = Asset.objects.get(id=asset_id)
        self.assertEqual(asset.status, Asset.AssetStatus.ASSIGNED)
        self.assertTrue(AssetAssignment.objects.filter(asset=asset, is_active=True).exists())

        duplicate_assign = self.client.post(
            f"/api/assets/{asset_id}/assign/",
            {"employee_id": self.manager_profile.id},
        )
        self.assertEqual(duplicate_assign.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

        return_response = self.client.post(
            f"/api/assets/{asset_id}/return/",
            {"return_note": "Returned", "condition_on_return": "Good"},
        )
        self.assertEqual(return_response.status_code, status.HTTP_200_OK)

        asset.refresh_from_db()
        self.assertEqual(asset.status, Asset.AssetStatus.AVAILABLE)
        self.assertFalse(AssetAssignment.objects.filter(asset=asset, is_active=True).exists())

    def test_delete_forbidden_while_assigned(self):
        self.client.force_authenticate(user=self.hr_user)

        asset = Asset.objects.create(
            name_en="Laptop Delete",
            type=Asset.AssetType.LAPTOP,
            cpu="i5",
            ram="8GB",
            storage="256GB",
            mac_address="AA:BB:CC:DD:EE:03",
            operating_system="Linux",
            status=Asset.AssetStatus.ASSIGNED,
        )
        AssetAssignment.objects.create(
            asset=asset,
            employee=self.employee_profile,
            assigned_by=self.hr_user,
            is_active=True,
        )

        delete_response = self.client.delete(f"/api/assets/{asset.id}/")
        self.assertEqual(delete_response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_employee_manager_can_view_only_my_assets(self):
        asset = Asset.objects.create(
            name_en="Laptop Mine",
            type=Asset.AssetType.LAPTOP,
            cpu="i5",
            ram="8GB",
            storage="256GB",
            mac_address="AA:BB:CC:DD:EE:04",
            operating_system="Linux",
            status=Asset.AssetStatus.ASSIGNED,
        )
        AssetAssignment.objects.create(
            asset=asset, employee=self.employee_profile, assigned_by=self.hr_user, is_active=True
        )

        self.client.force_authenticate(user=self.employee_user)
        employee_response = self.client.get("/api/assets/my-assets/")
        self.assertEqual(employee_response.status_code, status.HTTP_200_OK)
        self.assertEqual(employee_response.data["data"]["count"], 1)

        self.client.force_authenticate(user=self.manager_user)
        manager_response = self.client.get("/api/assets/")
        self.assertEqual(manager_response.status_code, status.HTTP_403_FORBIDDEN)

    def test_employee_can_create_damage_report_and_return_request_for_own_asset(self):
        asset = Asset.objects.create(
            name_en="Laptop Own",
            type=Asset.AssetType.LAPTOP,
            cpu="i5",
            ram="8GB",
            storage="256GB",
            mac_address="AA:BB:CC:DD:EE:05",
            operating_system="Linux",
            status=Asset.AssetStatus.ASSIGNED,
        )
        AssetAssignment.objects.create(
            asset=asset, employee=self.employee_profile, assigned_by=self.hr_user, is_active=True
        )

        self.client.force_authenticate(user=self.employee_user)
        damage_response = self.client.post(f"/api/assets/{asset.id}/damage-report/", {"description": "Screen cracked"})
        self.assertEqual(damage_response.status_code, status.HTTP_201_CREATED)

        return_request_response = self.client.post(
            f"/api/assets/{asset.id}/return-request/",
            {"note": "Leaving project"},
        )
        self.assertEqual(return_request_response.status_code, status.HTTP_201_CREATED)

    def test_dashboard_summary_and_warranty_window(self):
        today = timezone.localdate()
        Asset.objects.create(
            name_en="Asset Available",
            type=Asset.AssetType.OTHER,
            flexible_attributes={"x": 1},
            status=Asset.AssetStatus.AVAILABLE,
            warranty_expiry=today + timedelta(days=10),
        )
        Asset.objects.create(
            name_en="Asset Lost",
            type=Asset.AssetType.OTHER,
            flexible_attributes={"x": 2},
            status=Asset.AssetStatus.LOST,
            warranty_expiry=today + timedelta(days=60),
        )

        self.client.force_authenticate(user=self.hr_user)
        response = self.client.get("/api/assets/dashboard-summary/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["total"], 2)
        self.assertEqual(response.data["data"]["lost"], 1)
        self.assertEqual(response.data["data"]["warranty_expiring_soon"], 1)

    def test_termination_auto_closes_assignments(self):
        asset = Asset.objects.create(
            name_en="Laptop Termination",
            type=Asset.AssetType.LAPTOP,
            cpu="i5",
            ram="8GB",
            storage="256GB",
            mac_address="AA:BB:CC:DD:EE:06",
            operating_system="Linux",
            status=Asset.AssetStatus.ASSIGNED,
        )
        assignment = AssetAssignment.objects.create(
            asset=asset,
            employee=self.employee_profile,
            assigned_by=self.hr_user,
            is_active=True,
        )

        self.employee_profile.employment_status = EmployeeProfile.EmploymentStatus.TERMINATED
        self.employee_profile.save()

        assignment.refresh_from_db()
        asset.refresh_from_db()

        self.assertFalse(assignment.is_active)
        self.assertIsNotNone(assignment.returned_at)
        self.assertEqual(asset.status, Asset.AssetStatus.AVAILABLE)
