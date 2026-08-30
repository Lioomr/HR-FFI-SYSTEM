from datetime import date, datetime
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from admin_portal.models import SystemSettings
from audit.models import AuditLog
from employees.models import EmployeeProfile
from organization.models import OrganizationNode

from .geofence import haversine_distance_meters
from .models import AttendanceRecord, BioTimeEmployeeMap, WorkLocation
from .services import SyncBioTimeService

User = get_user_model()


class GeofenceAttendanceTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        cache.clear()
        self.manager_lookup = patch("attendance.views.get_valid_manager_user", return_value=None)
        self.manager_lookup.start()
        self.addCleanup(self.manager_lookup.stop)
        self.admin_group, _ = Group.objects.get_or_create(name="SystemAdmin")
        self.employee_group, _ = Group.objects.get_or_create(name="Employee")
        self.company = OrganizationNode.objects.create(
            code="GEOFENCE_A", name="Geofence Company A", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.other_company = OrganizationNode.objects.create(
            code="GEOFENCE_B", name="Geofence Company B", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.admin = User.objects.create_user(email="geofence-admin@ffi.com", password="password")
        self.admin.groups.add(self.admin_group)
        self.employee = User.objects.create_user(email="geofence-employee@ffi.com", password="password")
        self.employee.groups.add(self.employee_group)
        self.profile = EmployeeProfile.objects.create(
            user=self.employee,
            company=self.company,
            employee_id="GEO001",
            department="Operations",
            job_title="Operator",
            hire_date=date.today(),
        )
        self.headers = {"HTTP_X_ACTIVE_COMPANY_ID": str(self.company.id)}

    def _set_geofence_enabled(self, enabled=True):
        settings_obj = SystemSettings.get_solo()
        settings_obj.geofence_attendance_enabled = enabled
        settings_obj.save(update_fields=["geofence_attendance_enabled", "updated_at"])

    def _create_location(self, **overrides):
        data = {
            "company": self.company,
            "name": "Main Office",
            "latitude": Decimal("24.713600"),
            "longitude": Decimal("46.675300"),
            "radius_meters": 100,
        }
        data.update(overrides)
        return WorkLocation.objects.create(**data)

    def _mobile_payload(self, **overrides):
        data = {"latitude": "24.713600", "longitude": "46.675300", "accuracy_meters": "10.00"}
        data.update(overrides)
        return data

    def test_haversine_known_city_pair_and_radius_boundary(self):
        # Riyadh (Saudi Arabia) to Makkah is approximately 790 km by great-circle distance.
        riyadh_to_makkah = haversine_distance_meters(
            Decimal("24.7136"), Decimal("46.6753"), Decimal("21.4225"), Decimal("39.8262")
        )
        self.assertAlmostEqual(riyadh_to_makkah / 1_000, 792, delta=15)
        self.assertLess(haversine_distance_meters(0, 0, 0, Decimal("0.000899")), 100)
        self.assertGreater(haversine_distance_meters(0, 0, 0, Decimal("0.000900")), 100)

    def test_work_location_crud_is_admin_only_company_injected_scoped_and_audited(self):
        self.client.force_authenticate(user=self.employee)
        forbidden = self.client.get("/api/work-locations/", **self.headers)
        self.assertEqual(forbidden.status_code, status.HTTP_403_FORBIDDEN)

        self.client.force_authenticate(user=self.admin)
        rejected = self.client.post(
            "/api/work-locations/",
            {
                **self._mobile_payload(),
                "name": "Rejected Company",
                "radius_meters": 50,
                "company": self.other_company.id,
            },
            format="json",
            **self.headers,
        )
        self.assertEqual(rejected.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

        created = self.client.post(
            "/api/work-locations/",
            {"name": "Main Office", "latitude": "24.713600", "longitude": "46.675300", "radius_meters": 100},
            format="json",
            **self.headers,
        )
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        location_id = created.data["data"]["id"]
        location = WorkLocation.objects.get(pk=location_id)
        self.assertEqual(location.company_id, self.company.id)
        self.assertTrue(
            AuditLog.objects.filter(action="attendance.work_location_created", entity_id=str(location_id)).exists()
        )

        other = self._create_location(company=self.other_company, name="Other Office")
        listing = self.client.get("/api/work-locations/", **self.headers)
        self.assertEqual([item["id"] for item in listing.data["data"]["items"]], [location_id])
        self.assertEqual(
            self.client.get(f"/api/work-locations/{other.id}/", **self.headers).status_code, status.HTTP_404_NOT_FOUND
        )
        self.assertEqual(
            self.client.patch(
                f"/api/work-locations/{other.id}/", {"radius_meters": 125}, format="json", **self.headers
            ).status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertEqual(
            self.client.delete(f"/api/work-locations/{other.id}/", **self.headers).status_code,
            status.HTTP_404_NOT_FOUND,
        )
        other.refresh_from_db()
        self.assertTrue(other.is_active)

        updated = self.client.patch(
            f"/api/work-locations/{location_id}/", {"radius_meters": 120}, format="json", **self.headers
        )
        self.assertEqual(updated.status_code, status.HTTP_200_OK)
        self.assertTrue(
            AuditLog.objects.filter(action="attendance.work_location_updated", entity_id=str(location_id)).exists()
        )

        deleted = self.client.delete(f"/api/work-locations/{location_id}/", **self.headers)
        self.assertEqual(deleted.status_code, status.HTTP_200_OK)
        location.refresh_from_db()
        self.assertFalse(location.is_active)
        self.assertEqual(
            self.client.get(f"/api/work-locations/{location_id}/", **self.headers).status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertTrue(
            AuditLog.objects.filter(action="attendance.work_location_deleted", entity_id=str(location_id)).exists()
        )

    def test_work_location_create_requires_an_active_company_context(self):
        head_office = OrganizationNode.objects.create(
            code="GEOFENCE_HO", name="Geofence Head Office", node_type=OrganizationNode.NodeType.HEAD_OFFICE
        )
        inactive_company = OrganizationNode.objects.create(
            code="GEOFENCE_INACTIVE",
            name="Geofence Inactive Company",
            node_type=OrganizationNode.NodeType.COMPANY,
            is_active=False,
        )
        payload = {"name": "Office", "latitude": "24.713600", "longitude": "46.675300", "radius_meters": 100}
        self.client.force_authenticate(user=self.admin)

        head_office_response = self.client.post(
            "/api/work-locations/",
            payload,
            format="json",
            HTTP_X_ACTIVE_COMPANY_ID=str(head_office.id),
        )
        inactive_company_response = self.client.post(
            "/api/work-locations/",
            payload,
            format="json",
            HTTP_X_ACTIVE_COMPANY_ID=str(inactive_company.id),
        )

        self.assertEqual(head_office_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(inactive_company_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(WorkLocation.objects.filter(name="Office").exists())

    def test_work_location_validation(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post(
            "/api/work-locations/",
            {"name": "Invalid", "latitude": "90.000001", "longitude": "46.675300", "radius_meters": 0},
            format="json",
            **self.headers,
        )
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(WorkLocation.objects.count(), 0)

    def test_settings_contract_exposes_and_audits_global_toggle(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.put(
            "/settings/",
            {
                "password_policy": {
                    "min_length": 8,
                    "require_upper": True,
                    "require_lower": True,
                    "require_number": True,
                    "require_special": False,
                },
                "session": {"timeout_minutes": 30},
                "invites": {"default_expiry_hours": 72},
                "security": {"max_login_attempts": 5},
                "attendance": {"geofence_enabled": True},
            },
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["data"]["attendance"]["geofence_enabled"])
        self.assertTrue(SystemSettings.get_solo().geofence_attendance_enabled)
        self.assertTrue(AuditLog.objects.filter(action="settings_updated").exists())

    def test_toggle_off_keeps_empty_body_client_compatible(self):
        self.client.force_authenticate(user=self.employee)
        response = self.client.post("/api/attendance/me/check-in/", **self.headers)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["data"].keys(), {"id", "date", "check_in_at", "status"})

    def test_enabled_check_in_and_out_accept_inside_and_boundary_with_audit_metadata(self):
        self._set_geofence_enabled()
        location = self._create_location()
        self.client.force_authenticate(user=self.employee)
        check_in = self.client.post(
            "/api/attendance/me/check-in/", self._mobile_payload(), format="json", **self.headers
        )
        self.assertEqual(check_in.status_code, status.HTTP_201_CREATED)
        self.assertNotIn("work_location_id", check_in.data["data"])
        audit_metadata = AuditLog.objects.get(action="attendance.check_in").metadata
        self.assertEqual(audit_metadata["work_location_id"], location.id)
        self.assertEqual(audit_metadata["work_location_name"], location.name)

        check_out = self.client.post(
            "/api/attendance/me/check-out/",
            self._mobile_payload(longitude="46.675300"),
            format="json",
            **self.headers,
        )
        self.assertEqual(check_out.status_code, status.HTTP_200_OK)
        self.assertNotIn("work_location_id", check_out.data["data"])
        duplicate_checkout = self.client.post(
            "/api/attendance/me/check-out/",
            self._mobile_payload(),
            format="json",
            **self.headers,
        )
        self.assertEqual(
            (duplicate_checkout.status_code, duplicate_checkout.data["message"]),
            (400, "Check-out already exists for today."),
        )

        self.profile.employee_id = "GEO002"
        self.profile.save(update_fields=["employee_id", "updated_at"])
        AttendanceRecord.objects.filter(employee_profile=self.profile).delete()
        boundary = WorkLocation.objects.create(
            company=self.company,
            name="Equator Boundary",
            latitude=Decimal("0"),
            longitude=Decimal("0"),
            radius_meters=100,
        )
        boundary_response = self.client.post(
            "/api/attendance/me/check-in/",
            {"latitude": "0", "longitude": "0.000899", "accuracy_meters": "1"},
            format="json",
            **self.headers,
        )
        self.assertEqual(boundary_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(
            AuditLog.objects.filter(action="attendance.check_in", metadata__work_location_id=boundary.id).count(), 1
        )

    def test_enabled_rejects_invalid_poor_accuracy_outside_and_no_locations_before_duplicate(self):
        self._set_geofence_enabled()
        self._create_location()
        self.client.force_authenticate(user=self.employee)

        invalid = self.client.post(
            "/api/attendance/me/check-in/",
            self._mobile_payload(latitude="91"),
            format="json",
            **self.headers,
        )
        self.assertEqual((invalid.status_code, invalid.data["message"]), (422, "Invalid GPS coordinates."))
        missing = self.client.post("/api/attendance/me/check-in/", {}, format="json", **self.headers)
        self.assertEqual((missing.status_code, missing.data["message"]), (422, "Invalid GPS coordinates."))
        non_finite = self.client.post(
            "/api/attendance/me/check-in/",
            self._mobile_payload(longitude="NaN"),
            format="json",
            **self.headers,
        )
        self.assertEqual((non_finite.status_code, non_finite.data["message"]), (422, "Invalid GPS coordinates."))
        poor_accuracy = self.client.post(
            "/api/attendance/me/check-in/",
            self._mobile_payload(accuracy_meters="100.01"),
            format="json",
            **self.headers,
        )
        self.assertEqual(
            (poor_accuracy.status_code, poor_accuracy.data["message"]),
            (422, "GPS accuracy must be 100 metres or better."),
        )
        outside = self.client.post(
            "/api/attendance/me/check-in/",
            self._mobile_payload(latitude="25"),
            format="json",
            **self.headers,
        )
        self.assertEqual(
            (outside.status_code, outside.data["message"]), (403, "You are not within an approved work location.")
        )

        success_response = self.client.post(
            "/api/attendance/me/check-in/", self._mobile_payload(), format="json", **self.headers
        )
        self.assertEqual(success_response.status_code, status.HTTP_201_CREATED)
        duplicate = self.client.post(
            "/api/attendance/me/check-in/", self._mobile_payload(), format="json", **self.headers
        )
        self.assertEqual(
            (duplicate.status_code, duplicate.data["message"]), (400, "Check-in already exists for today.")
        )

        WorkLocation.objects.update(is_active=False)
        no_locations = self.client.post(
            "/api/attendance/me/check-out/", self._mobile_payload(), format="json", **self.headers
        )
        self.assertEqual(
            (no_locations.status_code, no_locations.data["message"]),
            (403, "You are not within an approved work location."),
        )

    def test_enabled_checkout_rejects_invalid_poor_accuracy_and_outside_then_accepts_boundary(self):
        self._set_geofence_enabled()
        WorkLocation.objects.create(
            company=self.company,
            name="Equator Checkout Boundary",
            latitude=Decimal("0"),
            longitude=Decimal("0"),
            radius_meters=100,
        )
        AttendanceRecord.objects.create(
            employee_profile=self.profile,
            date=timezone.localdate(),
            check_in_at=timezone.now(),
            status=AttendanceRecord.Status.PENDING_HR,
            source=AttendanceRecord.Source.EMPLOYEE,
            created_by=self.employee,
            updated_by=self.employee,
        )
        self.client.force_authenticate(user=self.employee)

        invalid = self.client.post(
            "/api/attendance/me/check-out/",
            {"latitude": "91", "longitude": "0", "accuracy_meters": "1"},
            format="json",
            **self.headers,
        )
        poor_accuracy = self.client.post(
            "/api/attendance/me/check-out/",
            {"latitude": "0", "longitude": "0", "accuracy_meters": "100.01"},
            format="json",
            **self.headers,
        )
        outside = self.client.post(
            "/api/attendance/me/check-out/",
            {"latitude": "0", "longitude": "0.000900", "accuracy_meters": "1"},
            format="json",
            **self.headers,
        )
        boundary = self.client.post(
            "/api/attendance/me/check-out/",
            {"latitude": "0", "longitude": "0.000899", "accuracy_meters": "1"},
            format="json",
            **self.headers,
        )

        self.assertEqual((invalid.status_code, invalid.data["message"]), (422, "Invalid GPS coordinates."))
        self.assertEqual(
            (poor_accuracy.status_code, poor_accuracy.data["message"]),
            (422, "GPS accuracy must be 100 metres or better."),
        )
        self.assertEqual(
            (outside.status_code, outside.data["message"]), (403, "You are not within an approved work location.")
        )
        self.assertEqual(boundary.status_code, status.HTTP_200_OK)

    def test_enabled_preserves_missing_checkout_and_missing_company_failures(self):
        self._set_geofence_enabled()
        self._create_location()
        self.client.force_authenticate(user=self.employee)
        no_check_in = self.client.post(
            "/api/attendance/me/check-out/", self._mobile_payload(), format="json", **self.headers
        )
        self.assertEqual(
            (no_check_in.status_code, no_check_in.data["message"]), (400, "No check-in record found for today.")
        )

        unassigned_user = User.objects.create_user(email="geofence-unassigned@ffi.com", password="password")
        unassigned_user.groups.add(self.employee_group)
        EmployeeProfile.objects.create(
            user=unassigned_user,
            employee_id="GEONOCOMPANY",
            department="Operations",
            job_title="Operator",
            hire_date=date.today(),
            is_archived=True,
        )
        self.client.force_authenticate(user=unassigned_user)
        missing_company = self.client.post("/api/attendance/me/check-in/", self._mobile_payload(), format="json")
        self.assertEqual(
            (missing_company.status_code, missing_company.data["message"]), (403, "Archived employees cannot check in.")
        )

    def test_biotime_ingestion_is_independent_of_mobile_gps_and_preserves_employee_and_hr_records(self):
        self._set_geofence_enabled()
        BioTimeEmployeeMap.objects.create(employee_profile=self.profile, biotime_emp_code="GEO-BIOTIME")
        result = SyncBioTimeService.ingest_transactions(
            [
                {
                    "emp_code": "GEO-BIOTIME",
                    "punch_time": "2026-08-29 08:00:00",
                    "terminal_sn": "TERMINAL-01",
                    "is_attendance": 1,
                }
            ]
        )
        self.assertEqual(result["created"], 1)
        system_record = AttendanceRecord.objects.get(employee_profile=self.profile, date=date(2026, 8, 29))
        self.assertEqual(system_record.source, AttendanceRecord.Source.SYSTEM)
        self.assertEqual(system_record.biotime_terminal_sn, "TERMINAL-01")

        employee_check_in = system_record.check_in_at
        system_record.source = AttendanceRecord.Source.EMPLOYEE
        system_record.save(update_fields=["source", "updated_at"])
        result = SyncBioTimeService.ingest_transactions(
            [{"emp_code": "GEO-BIOTIME", "punch_time": "2026-08-29 18:00:00", "is_attendance": 1}]
        )
        self.assertEqual(result["skipped"], 1)
        system_record.refresh_from_db()
        self.assertEqual(system_record.source, AttendanceRecord.Source.EMPLOYEE)
        self.assertEqual(system_record.check_in_at, employee_check_in)

        hr_record = AttendanceRecord.objects.create(
            employee_profile=self.profile,
            date=date(2026, 8, 30),
            check_in_at=timezone.make_aware(datetime(2026, 8, 30, 9, 0)),
            source=AttendanceRecord.Source.HR,
            status=AttendanceRecord.Status.PRESENT,
        )
        result = SyncBioTimeService.ingest_transactions(
            [{"emp_code": "GEO-BIOTIME", "punch_time": "2026-08-30 08:00:00", "is_attendance": 1}]
        )
        self.assertEqual(result["skipped"], 1)
        hr_record.refresh_from_db()
        self.assertEqual(hr_record.source, AttendanceRecord.Source.HR)
        self.assertEqual(hr_record.check_in_at, timezone.make_aware(datetime(2026, 8, 30, 9, 0)))
