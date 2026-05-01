from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from employees.models import EmployeeProfile
from hr_reference.models import Department, Position
from organization.models import OrganizationNode, UserOrganizationAccess

from .models import Asset, AssetAssignment, AssetDamageReport, AssetReturnRequest, PrintedLabelJob

User = get_user_model()


class AssetsTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.admin_group, _ = Group.objects.get_or_create(name="SystemAdmin")
        self.employee_group, _ = Group.objects.get_or_create(name="Employee")
        self.manager_group, _ = Group.objects.get_or_create(name="Manager")

        self.company = OrganizationNode.objects.create(
            code="ASSET_TEST_CO",
            name="Asset Test Company",
            node_type=OrganizationNode.NodeType.COMPANY,
            employee_id_prefix="ATC",
        )
        self.hr_user = User.objects.create_user(email="hr-assets@ffi.com", password="password")
        self.hr_user.groups.add(self.hr_group)
        UserOrganizationAccess.objects.create(user=self.hr_user, organization=self.company)
        self.department_ceo = Department.objects.create(id=1, code="CEO", name="CEO Department")
        self.department_ops = Department.objects.create(id=12, code="OPS", name="Operations")
        self.position = Position.objects.create(id=501, code="GEN", name="General")
        self.hr_profile = EmployeeProfile.objects.create(
            user=self.hr_user,
            company=self.company,
            employee_id="EMP-ASSET-HR",
            full_name="Asset HR",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            department_ref=self.department_ops,
            position_ref=self.position,
        )

        self.employee_user = User.objects.create_user(email="emp-assets@ffi.com", password="password")
        self.employee_user.groups.add(self.employee_group)

        self.manager_user = User.objects.create_user(email="mgr-assets@ffi.com", password="password")
        self.manager_user.groups.add(self.manager_group)

        self.employee_profile = EmployeeProfile.objects.create(
            user=self.employee_user,
            company=self.company,
            employee_id="EMP-ASSET-001",
            full_name="Asset Employee",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            department_ref=self.department_ops,
            position_ref=self.position,
        )

        self.manager_profile = EmployeeProfile.objects.create(
            user=self.manager_user,
            company=self.company,
            employee_id="EMP-ASSET-002",
            full_name="Asset Manager",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            department_ref=self.department_ops,
            position_ref=self.position,
        )
        self.employee_profile.manager = self.manager_user
        self.employee_profile.manager_profile = self.manager_profile
        self.employee_profile.save(update_fields=["manager", "manager_profile", "updated_at"])

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
            company=self.company,
            name_en="Vehicle 1",
            type=Asset.AssetType.VEHICLE,
            plate_number="A123",
            chassis_number="CH123",
            engine_number="EN123",
            fuel_type="Petrol",
        )
        laptop = Asset.objects.create(
            company=self.company,
            name_en="Laptop 1",
            type=Asset.AssetType.LAPTOP,
            cpu="i7",
            ram="16GB",
            storage="512GB",
            mac_address="AA:BB:CC:DD:EE:01",
            operating_system="Windows",
        )
        other = Asset.objects.create(
            company=self.company,
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
            company=self.company,
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
            company=self.company,
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
            company=self.company,
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
        self.assertEqual(return_request_response.data["data"]["status"], AssetReturnRequest.RequestStatus.PENDING_MANAGER)

    def test_manager_can_use_employee_asset_self_service_for_own_asset(self):
        asset = Asset.objects.create(
            company=self.company,
            name_en="Manager Laptop",
            type=Asset.AssetType.LAPTOP,
            cpu="i5",
            ram="8GB",
            storage="256GB",
            mac_address="AA:BB:CC:DD:EE:07",
            operating_system="Linux",
            status=Asset.AssetStatus.ASSIGNED,
        )
        AssetAssignment.objects.create(
            asset=asset,
            employee=self.manager_profile,
            assigned_by=self.hr_user,
            is_active=True,
        )

        self.client.force_authenticate(user=self.manager_user)

        my_assets_response = self.client.get("/api/assets/my-assets/")
        self.assertEqual(my_assets_response.status_code, status.HTTP_200_OK)
        self.assertEqual(my_assets_response.data["data"]["count"], 1)

        damage_response = self.client.post(f"/api/assets/{asset.id}/damage-report/", {"description": "Broken hinge"})
        self.assertEqual(damage_response.status_code, status.HTTP_201_CREATED)

        return_request_response = self.client.post(
            f"/api/assets/{asset.id}/return-request/",
            {"note": "Returning assigned device"},
        )
        self.assertEqual(return_request_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(return_request_response.data["data"]["status"], AssetReturnRequest.RequestStatus.PENDING)

    def test_employee_can_view_own_asset_request_history(self):
        asset = Asset.objects.create(
            company=self.company,
            name_en="History Laptop",
            type=Asset.AssetType.LAPTOP,
            cpu="i5",
            ram="8GB",
            storage="256GB",
            mac_address="AA:BB:CC:DD:EE:08",
            operating_system="Linux",
            status=Asset.AssetStatus.ASSIGNED,
        )
        AssetAssignment.objects.create(
            asset=asset,
            employee=self.employee_profile,
            assigned_by=self.hr_user,
            is_active=True,
        )

        self.client.force_authenticate(user=self.employee_user)
        self.client.post(f"/api/assets/{asset.id}/damage-report/", {"description": "Battery issue"})
        self.client.post(f"/api/assets/{asset.id}/return-request/", {"note": "Need replacement"})

        damage_history_response = self.client.get("/api/assets/my-damage-reports/")
        self.assertEqual(damage_history_response.status_code, status.HTTP_200_OK)
        self.assertEqual(damage_history_response.data["data"]["count"], 1)
        self.assertEqual(damage_history_response.data["data"]["items"][0]["asset_code"], asset.asset_code)

        return_history_response = self.client.get("/api/assets/my-return-requests/")
        self.assertEqual(return_history_response.status_code, status.HTTP_200_OK)
        self.assertEqual(return_history_response.data["data"]["count"], 1)
        self.assertEqual(return_history_response.data["data"]["items"][0]["asset_code"], asset.asset_code)

    def test_hr_can_view_asset_request_history_for_asset(self):
        asset = Asset.objects.create(
            company=self.company,
            name_en="HR Request Laptop",
            type=Asset.AssetType.LAPTOP,
            cpu="i5",
            ram="8GB",
            storage="256GB",
            mac_address="AA:BB:CC:DD:EE:09",
            operating_system="Linux",
            status=Asset.AssetStatus.ASSIGNED,
        )
        AssetAssignment.objects.create(
            asset=asset,
            employee=self.employee_profile,
            assigned_by=self.hr_user,
            is_active=True,
        )

        self.client.force_authenticate(user=self.employee_user)
        self.client.post(f"/api/assets/{asset.id}/damage-report/", {"description": "Keyboard issue"})
        self.client.post(f"/api/assets/{asset.id}/return-request/", {"note": "Assigned by mistake"})

        self.client.force_authenticate(user=self.hr_user)
        damage_history_response = self.client.get(f"/api/assets/damage-reports/?asset={asset.id}")
        self.assertEqual(damage_history_response.status_code, status.HTTP_200_OK)
        self.assertEqual(damage_history_response.data["data"]["count"], 1)

        return_history_response = self.client.get(f"/api/assets/return-requests/?asset={asset.id}")
        self.assertEqual(return_history_response.status_code, status.HTTP_200_OK)
        self.assertEqual(return_history_response.data["data"]["count"], 1)

    def test_hr_manager_asset_requests_start_pending_ceo(self):
        asset = Asset.objects.create(
            company=self.company,
            name_en="Laptop HR",
            type=Asset.AssetType.LAPTOP,
            cpu="i5",
            ram="8GB",
            storage="256GB",
            mac_address="AA:BB:CC:DD:EE:99",
            operating_system="Linux",
            status=Asset.AssetStatus.ASSIGNED,
        )
        AssetAssignment.objects.create(
            asset=asset, employee=self.hr_profile, assigned_by=self.hr_user, is_active=True
        )
        self.client.force_authenticate(user=self.hr_user)

        damage_response = self.client.post(f"/api/assets/{asset.id}/damage-report/", {"description": "Broken charger"})
        self.assertEqual(damage_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(damage_response.data["data"]["status"], "PENDING_CEO")

        return_response = self.client.post(f"/api/assets/{asset.id}/return-request/", {"note": "Need replacement"})
        self.assertEqual(return_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(return_response.data["data"]["status"], "PENDING_CEO")

    def test_employee_without_manager_goes_directly_to_hr_for_return_request(self):
        self.employee_profile.manager = None
        self.employee_profile.manager_profile = None
        self.employee_profile.save(update_fields=["manager", "manager_profile", "updated_at"])

        asset = Asset.objects.create(
            company=self.company,
            name_en="Laptop No Manager",
            type=Asset.AssetType.LAPTOP,
            cpu="i5",
            ram="8GB",
            storage="256GB",
            mac_address="AA:BB:CC:DD:EE:11",
            operating_system="Linux",
            status=Asset.AssetStatus.ASSIGNED,
        )
        AssetAssignment.objects.create(asset=asset, employee=self.employee_profile, assigned_by=self.hr_user, is_active=True)

        self.client.force_authenticate(user=self.employee_user)
        response = self.client.post(f"/api/assets/{asset.id}/return-request/", {"note": "No manager"})
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["data"]["status"], AssetReturnRequest.RequestStatus.PENDING)

    def test_manager_can_approve_asset_return_request_and_move_it_to_hr(self):
        asset = Asset.objects.create(
            company=self.company,
            name_en="Laptop Manager Approval",
            type=Asset.AssetType.LAPTOP,
            cpu="i5",
            ram="8GB",
            storage="256GB",
            mac_address="AA:BB:CC:DD:EE:12",
            operating_system="Linux",
            status=Asset.AssetStatus.ASSIGNED,
        )
        AssetAssignment.objects.create(asset=asset, employee=self.employee_profile, assigned_by=self.hr_user, is_active=True)

        self.client.force_authenticate(user=self.employee_user)
        create_response = self.client.post(f"/api/assets/{asset.id}/return-request/", {"note": "Project ended"})
        request_id = create_response.data["data"]["id"]

        self.client.force_authenticate(user=self.manager_user)
        inbox_response = self.client.get("/api/assets/manager/return-requests/")
        self.assertEqual(inbox_response.status_code, status.HTTP_200_OK)
        self.assertEqual(inbox_response.data["data"]["count"], 1)

        approve_response = self.client.post(
            f"/api/assets/manager/return-requests/{request_id}/approve/",
            {"comment": "Approved by manager"},
        )
        self.assertEqual(approve_response.status_code, status.HTTP_200_OK)
        self.assertEqual(approve_response.data["data"]["status"], AssetReturnRequest.RequestStatus.PENDING)

        return_request = AssetReturnRequest.objects.get(id=request_id)
        self.assertEqual(return_request.manager_decision_by, self.manager_user)
        self.assertIsNotNone(return_request.manager_decision_at)

    def test_hr_can_approve_return_request_after_manager_stage(self):
        asset = Asset.objects.create(
            company=self.company,
            name_en="Laptop HR Approval",
            type=Asset.AssetType.LAPTOP,
            cpu="i5",
            ram="8GB",
            storage="256GB",
            mac_address="AA:BB:CC:DD:EE:13",
            operating_system="Linux",
            status=Asset.AssetStatus.ASSIGNED,
        )
        AssetAssignment.objects.create(asset=asset, employee=self.employee_profile, assigned_by=self.hr_user, is_active=True)

        self.client.force_authenticate(user=self.employee_user)
        create_response = self.client.post(f"/api/assets/{asset.id}/return-request/", {"note": "Need return"})
        request_id = create_response.data["data"]["id"]

        self.client.force_authenticate(user=self.manager_user)
        self.client.post(f"/api/assets/manager/return-requests/{request_id}/approve/", {"comment": "Forwarding to HR"})

        self.client.force_authenticate(user=self.hr_user)
        approve_response = self.client.post(f"/api/assets/return-requests/{request_id}/approve/", {"comment": "Approved by HR"})
        self.assertEqual(approve_response.status_code, status.HTTP_200_OK)
        self.assertEqual(approve_response.data["data"]["status"], AssetReturnRequest.RequestStatus.APPROVED)

    def test_duplicate_open_return_request_is_rejected(self):
        asset = Asset.objects.create(
            company=self.company,
            name_en="Laptop Duplicate Return",
            type=Asset.AssetType.LAPTOP,
            cpu="i5",
            ram="8GB",
            storage="256GB",
            mac_address="AA:BB:CC:DD:EE:14",
            operating_system="Linux",
            status=Asset.AssetStatus.ASSIGNED,
        )
        AssetAssignment.objects.create(asset=asset, employee=self.employee_profile, assigned_by=self.hr_user, is_active=True)

        self.client.force_authenticate(user=self.employee_user)
        first_response = self.client.post(f"/api/assets/{asset.id}/return-request/", {"note": "First"})
        self.assertEqual(first_response.status_code, status.HTTP_201_CREATED)

        second_response = self.client.post(f"/api/assets/{asset.id}/return-request/", {"note": "Second"})
        self.assertEqual(second_response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_dashboard_summary_and_warranty_window(self):
        today = timezone.localdate()
        Asset.objects.create(
            company=self.company,
            name_en="Asset Available",
            type=Asset.AssetType.OTHER,
            flexible_attributes={"x": 1},
            status=Asset.AssetStatus.AVAILABLE,
            warranty_expiry=today + timedelta(days=10),
        )
        Asset.objects.create(
            company=self.company,
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

    def test_list_can_filter_warranty_expiring_soon(self):
        today = timezone.localdate()
        soon_asset = Asset.objects.create(
            company=self.company,
            name_en="Soon Warranty",
            type=Asset.AssetType.OTHER,
            flexible_attributes={"x": 1},
            warranty_expiry=today + timedelta(days=5),
        )
        Asset.objects.create(
            company=self.company,
            name_en="Later Warranty",
            type=Asset.AssetType.OTHER,
            flexible_attributes={"x": 2},
            warranty_expiry=today + timedelta(days=45),
        )

        self.client.force_authenticate(user=self.hr_user)
        response = self.client.get("/api/assets/?warranty_expiring_soon=true&ordering=warranty_expiry")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["count"], 1)
        self.assertEqual(response.data["data"]["items"][0]["id"], soon_asset.id)

    def test_termination_auto_closes_assignments(self):
        asset = Asset.objects.create(
            company=self.company,
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


class AssetLabelAndLookupTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.employee_group, _ = Group.objects.get_or_create(name="Employee")

        self.company = OrganizationNode.objects.create(
            code="LABEL_CO",
            name="Label Company",
            node_type=OrganizationNode.NodeType.COMPANY,
            employee_id_prefix="LBL",
        )
        self.other_company = OrganizationNode.objects.create(
            code="OTHER_LABEL_CO",
            name="Other Label Company",
            node_type=OrganizationNode.NodeType.COMPANY,
            employee_id_prefix="OTH",
        )
        self.hr_user = User.objects.create_user(email="hr-labels@ffi.com", password="password")
        self.hr_user.groups.add(self.hr_group)
        UserOrganizationAccess.objects.create(user=self.hr_user, organization=self.company)

        self.employee_user = User.objects.create_user(email="emp-labels@ffi.com", password="password")
        self.employee_user.groups.add(self.employee_group)
        self.employee_profile = EmployeeProfile.objects.create(
            user=self.employee_user,
            company=self.company,
            employee_id="LBL-001",
            full_name="Label Employee",
            department_name_en="Operations",
            job_title_en="Technician",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        self.asset = Asset.objects.create(
            company=self.company,
            name_en="Scanner Laptop",
            type=Asset.AssetType.LAPTOP,
            cpu="i7",
            ram="16GB",
            storage="512GB",
            mac_address="AA:BB:CC:DD:EE:70",
            operating_system="Windows",
            status=Asset.AssetStatus.ASSIGNED,
        )
        self.other_asset = Asset.objects.create(
            company=self.other_company,
            name_en="Other Company Laptop",
            type=Asset.AssetType.LAPTOP,
            cpu="i7",
            ram="16GB",
            storage="512GB",
            mac_address="AA:BB:CC:DD:EE:71",
            operating_system="Windows",
        )
        AssetAssignment.objects.create(
            asset=self.asset,
            employee=self.employee_profile,
            assigned_by=self.hr_user,
            is_active=True,
        )
        AssetDamageReport.objects.create(asset=self.asset, employee=self.employee_profile, description="Scratch")
        AssetReturnRequest.objects.create(asset=self.asset, employee=self.employee_profile, note="Replace")
        self.client.force_authenticate(user=self.hr_user)

    def _company_header(self):
        return {"HTTP_HOST": "localhost", "HTTP_X_ACTIVE_COMPANY_ID": str(self.company.id)}

    def test_lookup_returns_scoped_asset_context(self):
        response = self.client.get(
            f"/api/assets/lookup/?code={self.asset.asset_code.lower()}",
            **self._company_header(),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.data["data"]
        self.assertEqual(data["asset"]["id"], self.asset.id)
        self.assertEqual(data["active_assignment"]["employee"]["employee_id"], "LBL-001")
        self.assertEqual(len(data["recent_damage_reports"]), 1)
        self.assertEqual(len(data["recent_return_requests"]), 1)

    def test_lookup_hides_other_company_asset(self):
        response = self.client.get(
            f"/api/assets/lookup/?code={self.other_asset.asset_code}",
            **self._company_header(),
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_print_labels_saves_job_and_returns_pdf(self):
        response = self.client.post(
            "/api/assets/labels/print/",
            {"asset_ids": [self.asset.id], "paper_size": "50X30"},
            format="json",
            **self._company_header(),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertTrue(bytes(response.content).startswith(b"%PDF"))
        job = PrintedLabelJob.objects.get()
        self.assertEqual(response["X-Label-Job-Id"], str(job.id))
        self.assertEqual(job.company, self.company)
        self.assertEqual(job.asset_codes, [self.asset.asset_code])
        self.assertTrue(job.pdf_file.name.startswith("assets/labels/"))
        self.asset.refresh_from_db()
        self.assertIsNotNone(self.asset.last_label_printed_at)
        self.assertEqual(self.asset.label_print_count, 1)

    def test_label_status_filter_distinguishes_printed_assets(self):
        unprinted_response = self.client.get(
            "/api/assets/?label_status=never_printed",
            **self._company_header(),
        )
        self.assertEqual(unprinted_response.status_code, status.HTTP_200_OK)
        ids_before = {item["id"] for item in unprinted_response.data["data"]["items"]}
        self.assertIn(self.asset.id, ids_before)

        self.client.post(
            "/api/assets/labels/print/",
            {"asset_ids": [self.asset.id], "paper_size": "50X30"},
            format="json",
            **self._company_header(),
        )

        unprinted_after = self.client.get(
            "/api/assets/?label_status=never_printed",
            **self._company_header(),
        )
        ids_after = {item["id"] for item in unprinted_after.data["data"]["items"]}
        self.assertNotIn(self.asset.id, ids_after)

        printed = self.client.get(
            "/api/assets/?label_status=printed",
            **self._company_header(),
        )
        printed_ids = {item["id"] for item in printed.data["data"]["items"]}
        self.assertIn(self.asset.id, printed_ids)

    def test_print_labels_rejects_any_asset_outside_scope(self):
        response = self.client.post(
            "/api/assets/labels/print/",
            {"asset_ids": [self.asset.id, self.other_asset.id], "paper_size": "A4_GRID"},
            format="json",
            **self._company_header(),
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(PrintedLabelJob.objects.count(), 0)

    def test_label_jobs_list_and_pdf_download_are_scoped(self):
        print_response = self.client.post(
            "/api/assets/labels/print/",
            {"asset_ids": [self.asset.id], "paper_size": "A4_GRID"},
            format="json",
            **self._company_header(),
        )
        job_id = print_response["X-Label-Job-Id"]

        list_response = self.client.get("/api/assets/labels/jobs/", **self._company_header())
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(list_response.data["data"]["count"], 1)
        self.assertEqual(list_response.data["data"]["items"][0]["id"], int(job_id))

        pdf_response = self.client.get(f"/api/assets/labels/jobs/{job_id}/pdf/", **self._company_header())
        self.assertEqual(pdf_response.status_code, status.HTTP_200_OK)
        self.assertEqual(pdf_response["Content-Type"], "application/pdf")
