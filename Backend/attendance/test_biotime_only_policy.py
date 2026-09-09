"""BioTime-only attendance policy: retired manual writes, mapping-gated reads."""

from datetime import date, timedelta
from importlib import import_module
from types import SimpleNamespace
from unittest import mock

from django.apps import apps as django_apps
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.contenttypes.models import ContentType
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import models
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from audit.models import AuditLog
from core.models import WorkflowDefinition, WorkflowInstance
from employees.models import EmployeeDocument, EmployeeProfile
from hr_reference.models import Department, Position
from job_offers.models import StartingWorkAcknowledgment
from organization.models import OrganizationNode, UserOrganizationAccess

from .absence import mark_absentees_for_date
from .biotime_policy import (
    ATTENDANCE_UNAVAILABLE_UNMAPPED_MESSAGE,
    MANUAL_ATTENDANCE_RETIRED_MESSAGE,
)
from .models import (
    AttendanceCorrectionRequest,
    AttendanceRecord,
    BioTimeDeviceEmployee,
    BioTimeEmployeeMap,
)

User = get_user_model()

# Migration module names are not importable identifiers.
migration_0012 = import_module("attendance.migrations.0012_retire_manual_attendance")
purge_manual_attendance = migration_0012.purge_manual_attendance


class BioTimeOnlyAttendancePolicyBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.employee_group, _ = Group.objects.get_or_create(name="Employee")
        self.manager_group, _ = Group.objects.get_or_create(name="Manager")
        self.hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.ceo_group, _ = Group.objects.get_or_create(name="CEO")

        self.company = OrganizationNode.objects.create(
            code="BIOTIME_ONLY",
            name="BioTime Only Company",
            node_type=OrganizationNode.NodeType.COMPANY,
        )
        self.department = Department.objects.create(company=self.company, code="OPS", name="Operations")
        self.position = Position.objects.create(company=self.company, code="OPR", name="Operator")
        self.headers = {"HTTP_X_ACTIVE_COMPANY_ID": str(self.company.id)}

        self.hr_user = User.objects.create_user(email="hr-biotime-only@ffi.com", password="password")
        self.hr_user.groups.add(self.hr_group)
        UserOrganizationAccess.objects.create(user=self.hr_user, organization=self.company)

        self.manager_user = User.objects.create_user(email="mgr-biotime-only@ffi.com", password="password")
        self.manager_user.groups.add(self.manager_group)
        UserOrganizationAccess.objects.create(user=self.manager_user, organization=self.company)
        self.manager_profile = self._profile(self.manager_user, "BTO-MGR")

        self.ceo_user = User.objects.create_user(email="ceo-biotime-only@ffi.com", password="password")
        self.ceo_user.groups.add(self.ceo_group)
        UserOrganizationAccess.objects.create(user=self.ceo_user, organization=self.company)
        # Company scope for a non-HR role comes from the employee profile, so
        # the CEO needs one to read any company-scoped attendance list.
        self.ceo_profile = self._profile(self.ceo_user, "BTO-CEO")

        # Mapped employee: registered on a BioTime device, so attendance-eligible.
        self.mapped_user = User.objects.create_user(email="mapped-biotime-only@ffi.com", password="password")
        self.mapped_user.groups.add(self.employee_group)
        self.mapped_profile = self._profile(self.mapped_user, "BTO-MAPPED", manager=self.manager_profile)
        self.mapping = BioTimeEmployeeMap.objects.create(
            employee_profile=self.mapped_profile, biotime_emp_code="BT-1001"
        )

        # Unmapped employee: a real HR employee (construction site / visitor)
        # with no device registration and therefore no attendance access.
        self.unmapped_user = User.objects.create_user(email="unmapped-biotime-only@ffi.com", password="password")
        self.unmapped_user.groups.add(self.employee_group)
        self.unmapped_profile = self._profile(self.unmapped_user, "BTO-UNMAPPED", manager=self.manager_profile)

        self.today = timezone.localdate()

    def _profile(self, user, employee_id, manager=None):
        return EmployeeProfile.objects.create(
            user=user,
            company=self.company,
            employee_id=employee_id,
            department_ref=self.department,
            position_ref=self.position,
            hire_date=date.today() - timedelta(days=30),
            manager_profile=manager,
        )

    def _biotime_record(self, profile, record_date=None, emp_code="BT-1001"):
        return AttendanceRecord.objects.create(
            employee_profile=profile,
            date=record_date or self.today,
            check_in_at=timezone.now(),
            status=AttendanceRecord.Status.PRESENT,
            source=AttendanceRecord.Source.SYSTEM,
            biotime_emp_code=emp_code,
            biotime_terminal_sn="TERMINAL-01",
        )

    def assertGone(self, response):
        self.assertEqual(response.status_code, status.HTTP_410_GONE)
        self.assertEqual(response.data["message"], MANUAL_ATTENDANCE_RETIRED_MESSAGE)


class ManualAttendanceRetiredTests(BioTimeOnlyAttendancePolicyBase):
    def test_employee_check_in_and_check_out_are_gone_and_create_no_records(self):
        self.client.force_authenticate(user=self.mapped_user)

        check_in = self.client.post("/api/attendance/me/check-in/", **self.headers)
        check_out = self.client.post("/api/attendance/me/check-out/", **self.headers)

        self.assertGone(check_in)
        self.assertGone(check_out)
        self.assertFalse(AttendanceRecord.objects.exists())
        self.assertFalse(
            AuditLog.objects.filter(action__in=["attendance.check_in", "attendance.check_out"]).exists()
        )

    def test_check_in_is_gone_for_every_role_including_unmapped_employees(self):
        for user in [self.unmapped_user, self.manager_user, self.hr_user, self.ceo_user]:
            with self.subTest(user=user.email):
                self.client.force_authenticate(user=user)
                self.assertGone(self.client.post("/api/attendance/me/check-in/", **self.headers))
        self.assertFalse(AttendanceRecord.objects.exists())

    def test_unauthenticated_manual_endpoints_still_require_authentication(self):
        self.client.force_authenticate(user=None)
        response = self.client.post("/api/attendance/me/check-in/", **self.headers)
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_hr_override_is_gone_and_leaves_the_record_untouched(self):
        record = self._biotime_record(self.mapped_profile)
        original_check_in = record.check_in_at
        self.client.force_authenticate(user=self.hr_user)

        patched = self.client.patch(
            f"/api/attendance/{record.id}/",
            {"status": AttendanceRecord.Status.ABSENT, "override_reason": "manual fix"},
            format="json",
            **self.headers,
        )
        put = self.client.put(
            f"/api/attendance/{record.id}/",
            {"status": AttendanceRecord.Status.ABSENT, "override_reason": "manual fix"},
            format="json",
            **self.headers,
        )

        self.assertGone(patched)
        self.assertGone(put)
        record.refresh_from_db()
        self.assertEqual(record.status, AttendanceRecord.Status.PRESENT)
        self.assertEqual(record.check_in_at, original_check_in)
        self.assertFalse(record.is_overridden)
        self.assertEqual(record.source, AttendanceRecord.Source.SYSTEM)
        self.assertFalse(AuditLog.objects.filter(action="attendance.override").exists())

    def test_hr_create_and_delete_of_attendance_records_are_gone(self):
        record = self._biotime_record(self.mapped_profile)
        self.client.force_authenticate(user=self.hr_user)

        created = self.client.post(
            "/api/attendance/",
            {"employee_profile": self.mapped_profile.id, "date": str(self.today)},
            format="json",
            **self.headers,
        )
        destroyed = self.client.delete(f"/api/attendance/{record.id}/", **self.headers)

        self.assertGone(created)
        self.assertGone(destroyed)
        self.assertEqual(AttendanceRecord.objects.count(), 1)

    def test_manager_and_ceo_attendance_decisions_are_gone(self):
        record = self._biotime_record(self.mapped_profile)
        record.status = AttendanceRecord.Status.PENDING_MANAGER
        record.save(update_fields=["status"])

        self.client.force_authenticate(user=self.manager_user)
        self.assertGone(self.client.post(f"/api/manager/attendance/{record.id}/approve/", **self.headers))
        self.assertGone(
            self.client.post(
                f"/api/manager/attendance/{record.id}/reject/", {"notes": "no"}, format="json", **self.headers
            )
        )

        self.client.force_authenticate(user=self.ceo_user)
        self.assertGone(self.client.post(f"/api/ceo/attendance/{record.id}/approve/", **self.headers))
        self.assertGone(
            self.client.post(
                f"/api/ceo/attendance/{record.id}/reject/", {"notes": "no"}, format="json", **self.headers
            )
        )

        record.refresh_from_db()
        self.assertEqual(record.status, AttendanceRecord.Status.PENDING_MANAGER)
        self.assertIsNone(record.manager_decision_at)
        self.assertIsNone(record.ceo_decision_at)


class AttendanceCorrectionRequestRetiredTests(BioTimeOnlyAttendancePolicyBase):
    def _correction(self):
        return AttendanceCorrectionRequest.objects.create(
            employee_profile=self.mapped_profile,
            date=self.today,
            reason="legacy row",
            status=AttendanceCorrectionRequest.Status.DRAFT,
            created_by=self.mapped_user,
        )

    def test_create_update_and_delete_are_gone(self):
        correction = self._correction()
        self.client.force_authenticate(user=self.mapped_user)

        payload = {"date": str(self.today), "reason": "please fix"}
        self.assertGone(
            self.client.post("/api/attendance-correction-requests/", payload, format="json", **self.headers)
        )
        self.assertGone(
            self.client.put(
                f"/api/attendance-correction-requests/{correction.id}/", payload, format="json", **self.headers
            )
        )
        self.assertGone(
            self.client.patch(
                f"/api/attendance-correction-requests/{correction.id}/",
                {"reason": "edited"},
                format="json",
                **self.headers,
            )
        )
        self.assertGone(self.client.delete(f"/api/attendance-correction-requests/{correction.id}/", **self.headers))

        self.assertEqual(AttendanceCorrectionRequest.objects.count(), 1)
        correction.refresh_from_db()
        self.assertEqual(correction.reason, "legacy row")

    def test_submit_approve_reject_and_cancel_are_gone(self):
        correction = self._correction()

        self.client.force_authenticate(user=self.mapped_user)
        self.assertGone(
            self.client.post(f"/api/attendance-correction-requests/{correction.id}/submit/", **self.headers)
        )
        self.assertGone(
            self.client.post(f"/api/attendance-correction-requests/{correction.id}/cancel/", **self.headers)
        )

        for approver in [self.manager_user, self.hr_user]:
            self.client.force_authenticate(user=approver)
            with self.subTest(user=approver.email):
                self.assertGone(
                    self.client.post(f"/api/attendance-correction-requests/{correction.id}/approve/", **self.headers)
                )
                self.assertGone(
                    self.client.post(
                        f"/api/attendance-correction-requests/{correction.id}/reject/",
                        {"notes": "no"},
                        format="json",
                        **self.headers,
                    )
                )

        correction.refresh_from_db()
        self.assertEqual(correction.status, AttendanceCorrectionRequest.Status.DRAFT)
        self.assertIsNone(correction.submitted_at)
        self.assertIsNone(correction.decided_at)
        self.assertFalse(AuditLog.objects.filter(action__startswith="attendance_correction.").exists())


class AttendanceReadAccessTests(BioTimeOnlyAttendancePolicyBase):
    def test_mapped_employee_can_read_own_attendance(self):
        record = self._biotime_record(self.mapped_profile)
        self.client.force_authenticate(user=self.mapped_user)

        response = self.client.get("/api/attendance/me/", **self.headers)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([row["id"] for row in response.data["data"]["items"]], [record.id])

    def test_unmapped_employee_is_forbidden_with_a_mapping_message(self):
        self.client.force_authenticate(user=self.unmapped_user)

        response = self.client.get("/api/attendance/me/", **self.headers)

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data["message"], ATTENDANCE_UNAVAILABLE_UNMAPPED_MESSAGE)

    def test_employee_whose_mapping_is_removed_loses_read_access(self):
        self._biotime_record(self.mapped_profile)
        self.mapping.delete()
        self.client.force_authenticate(user=self.mapped_user)

        response = self.client.get("/api/attendance/me/", **self.headers)

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_hr_manager_and_ceo_lists_exclude_unmapped_employees(self):
        mapped_record = self._biotime_record(self.mapped_profile)
        unmapped_record = AttendanceRecord.objects.create(
            employee_profile=self.unmapped_profile,
            date=self.today,
            status=AttendanceRecord.Status.ABSENT,
            source=AttendanceRecord.Source.SYSTEM,
            notes="legacy auto-absence for an unmapped employee",
        )

        cases = [
            ("hr", self.hr_user, "/api/attendance/"),
            ("manager", self.manager_user, "/api/manager/attendance/"),
            ("ceo", self.ceo_user, "/api/ceo/attendance/"),
        ]
        for label, user, url in cases:
            with self.subTest(role=label):
                self.client.force_authenticate(user=user)
                response = self.client.get(url, **self.headers)
                self.assertEqual(response.status_code, status.HTTP_200_OK)
                ids = [row["id"] for row in response.data["data"]["items"]]
                self.assertIn(mapped_record.id, ids)
                self.assertNotIn(unmapped_record.id, ids)


class AbsenceDetectionEligibilityTests(BioTimeOnlyAttendancePolicyBase):
    def test_absence_detection_only_creates_records_for_mapped_employees(self):
        target = self.today - timedelta(days=1)

        result = mark_absentees_for_date(target, force=True)

        created = AttendanceRecord.objects.filter(date=target, status=AttendanceRecord.Status.ABSENT)
        self.assertEqual(set(created.values_list("employee_profile_id", flat=True)), {self.mapped_profile.id})
        self.assertEqual(result["eligible"], 1)
        self.assertFalse(AttendanceRecord.objects.filter(employee_profile=self.unmapped_profile).exists())

    def test_unmapping_an_employee_stops_future_absence_records(self):
        self.mapping.delete()
        target = self.today - timedelta(days=1)

        mark_absentees_for_date(target, force=True)

        self.assertFalse(AttendanceRecord.objects.exists())


class ManualAttendancePurgeMigrationTests(BioTimeOnlyAttendancePolicyBase):
    """Exercise the 0012 data migration purge against a realistic mixture of rows."""

    def _workflow_for(self, instance, key="attendance_request"):
        definition, _ = WorkflowDefinition.objects.get_or_create(
            key=key,
            defaults={"name": key.replace("_", " ").title(), "module_key": "attendance"},
        )
        return WorkflowInstance.objects.create(
            definition=definition,
            content_type=ContentType.objects.get_for_model(type(instance)),
            object_id=instance.id,
        )

    def _extra_profile(self, slug, employee_id, *, biotime_emp_code=None):
        """A second employee, since a profile may own only one acknowledgment."""
        user = User.objects.create_user(email=f"{slug}@ffi.com", password="password")
        profile = self._profile(user, employee_id)
        if biotime_emp_code:
            BioTimeEmployeeMap.objects.create(employee_profile=profile, biotime_emp_code=biotime_emp_code)
        return profile

    def _acknowledgment(self, profile, record, reference):
        """A Starting Work acknowledgment plus the archived PDF it points at."""
        document = EmployeeDocument.objects.create(
            employee_profile=profile,
            company=self.company,
            document_type=EmployeeDocument.DocumentType.OTHER,
            custom_name="Starting Work Acknowledgment",
            original_filename=f"{reference}.pdf",
            file=SimpleUploadedFile(f"{reference}.pdf", b"%PDF-1.4", content_type="application/pdf"),
        )
        acknowledgment = StartingWorkAcknowledgment.objects.create(
            employee_profile=profile,
            attendance_record=record,
            company=self.company,
            reference_number=reference,
            status=StartingWorkAcknowledgment.Status.PENDING_HR,
            document=document,
        )
        return acknowledgment, document

    def _starting_work_audit(self, acknowledgment, action="starting_work_acknowledgment_pending_hr_created"):
        return AuditLog.objects.create(
            action=action, entity="StartingWorkAcknowledgment", entity_id=str(acknowledgment.id)
        )

    def test_purge_deletes_manual_and_invalid_rows_and_preserves_biotime_records(self):
        biotime_present = self._biotime_record(self.mapped_profile, self.today - timedelta(days=1))
        biotime_absent_mapped = AttendanceRecord.objects.create(
            employee_profile=self.mapped_profile,
            date=self.today - timedelta(days=2),
            status=AttendanceRecord.Status.ABSENT,
            source=AttendanceRecord.Source.SYSTEM,
            notes="Auto-marked absent: no attendance recorded.",
        )
        employee_manual = AttendanceRecord.objects.create(
            employee_profile=self.mapped_profile,
            date=self.today - timedelta(days=3),
            check_in_at=timezone.now(),
            status=AttendanceRecord.Status.PENDING_HR,
            source=AttendanceRecord.Source.EMPLOYEE,
            created_by=self.mapped_user,
        )
        hr_manual = AttendanceRecord.objects.create(
            employee_profile=self.mapped_profile,
            date=self.today - timedelta(days=4),
            check_in_at=timezone.now(),
            status=AttendanceRecord.Status.PRESENT,
            source=AttendanceRecord.Source.HR,
            is_overridden=True,
            created_by=self.hr_user,
        )
        unmapped_auto_absence = AttendanceRecord.objects.create(
            employee_profile=self.unmapped_profile,
            date=self.today - timedelta(days=1),
            status=AttendanceRecord.Status.ABSENT,
            source=AttendanceRecord.Source.SYSTEM,
            notes="Auto-marked absent: no attendance recorded.",
        )
        # A SYSTEM row for an unmapped employee that still carries BioTime punch
        # data is real device evidence and must survive.
        unmapped_biotime_punch = AttendanceRecord.objects.create(
            employee_profile=self.unmapped_profile,
            date=self.today - timedelta(days=5),
            check_in_at=timezone.now(),
            status=AttendanceRecord.Status.PRESENT,
            source=AttendanceRecord.Source.SYSTEM,
            biotime_emp_code="BT-LEGACY",
        )
        correction = AttendanceCorrectionRequest.objects.create(
            employee_profile=self.mapped_profile,
            date=self.today - timedelta(days=3),
            attendance_record=employee_manual,
            reason="wrong time",
            status=AttendanceCorrectionRequest.Status.APPROVED,
            created_by=self.mapped_user,
        )

        AuditLog.objects.create(
            action="attendance.check_in", entity="attendance_record", entity_id=str(employee_manual.id)
        )
        AuditLog.objects.create(
            action="attendance.override", entity="attendance_record", entity_id=str(hr_manual.id)
        )
        AuditLog.objects.create(
            action="attendance_correction.submitted",
            entity="AttendanceCorrectionRequest",
            entity_id=str(correction.id),
        )
        kept_run_audit = AuditLog.objects.create(
            action="attendance.absence_detection_run",
            entity="attendance_absence_run",
            entity_id=str(self.today),
        )
        kept_biotime_audit = AuditLog.objects.create(
            action="attendance.check_in", entity="attendance_record", entity_id=str(biotime_present.id)
        )
        kept_mapping_audit = AuditLog.objects.create(
            action="biotime.mapping_created", entity="biotime_mapping", entity_id=str(self.mapping.id)
        )

        manual_workflow = self._workflow_for(employee_manual)
        correction_workflow = self._workflow_for(correction)
        kept_workflow = self._workflow_for(biotime_present)

        purge_manual_attendance(django_apps, None)

        self.assertEqual(
            set(AttendanceRecord.objects.values_list("id", flat=True)),
            {biotime_present.id, biotime_absent_mapped.id, unmapped_biotime_punch.id},
        )
        for gone in [employee_manual, hr_manual, unmapped_auto_absence]:
            self.assertFalse(AttendanceRecord.objects.filter(id=gone.id).exists())

        self.assertFalse(AttendanceCorrectionRequest.objects.exists())

        self.assertFalse(WorkflowInstance.objects.filter(id=manual_workflow.id).exists())
        self.assertFalse(WorkflowInstance.objects.filter(id=correction_workflow.id).exists())
        self.assertTrue(WorkflowInstance.objects.filter(id=kept_workflow.id).exists())

        self.assertEqual(
            set(AuditLog.objects.values_list("id", flat=True)),
            {kept_run_audit.id, kept_biotime_audit.id, kept_mapping_audit.id},
        )

        # Both employees remain HR employees; only their attendance data changed.
        self.assertTrue(EmployeeProfile.objects.filter(id=self.mapped_profile.id).exists())
        self.assertTrue(EmployeeProfile.objects.filter(id=self.unmapped_profile.id).exists())

    def test_purge_removes_a_manual_record_protected_by_a_starting_work_acknowledgment(self):
        # How this row occurs in production: BioTime created it, the
        # acknowledgment was generated from it, then an HR override stamped
        # source=HR on it. The policy says the manual row goes, so the
        # acknowledgment blocking it (PROTECT) must go first.
        profile = self._extra_profile("swa-manual", "BTO-SWA-MAN", biotime_emp_code="BT-SWA-MAN")
        overridden = AttendanceRecord.objects.create(
            employee_profile=profile,
            date=self.today - timedelta(days=6),
            check_in_at=timezone.now(),
            status=AttendanceRecord.Status.PRESENT,
            source=AttendanceRecord.Source.HR,
            is_overridden=True,
            biotime_emp_code="BT-SWA-MAN",
            created_by=self.hr_user,
        )
        acknowledgment, document = self._acknowledgment(profile, overridden, "SWA-MANUAL-1")
        ack_workflow = self._workflow_for(acknowledgment, key="starting_work_acknowledgment")
        record_workflow = self._workflow_for(overridden)
        ack_audit = self._starting_work_audit(acknowledgment)
        approved_audit = self._starting_work_audit(
            acknowledgment, action="starting_work_acknowledgment_approved"
        )
        override_audit = AuditLog.objects.create(
            action="attendance.override", entity="attendance_record", entity_id=str(overridden.id)
        )
        unrelated_audit = AuditLog.objects.create(
            action="attendance.absence_detection_run",
            entity="attendance_absence_run",
            entity_id=str(self.today),
        )

        purge_manual_attendance(django_apps, None)

        # The manual attendance row and the acknowledgment blocking it are gone.
        self.assertFalse(AttendanceRecord.objects.filter(id=overridden.id).exists())
        self.assertFalse(StartingWorkAcknowledgment.objects.filter(id=acknowledgment.id).exists())

        # Their workflow and audit trails go with them.
        self.assertFalse(WorkflowInstance.objects.filter(id=ack_workflow.id).exists())
        self.assertFalse(WorkflowInstance.objects.filter(id=record_workflow.id).exists())
        for gone in [ack_audit, approved_audit, override_audit]:
            self.assertFalse(AuditLog.objects.filter(id=gone.id).exists())

        # The HR document itself is retained — only the relationship is removed.
        self.assertTrue(EmployeeDocument.objects.filter(id=document.id).exists())

        # No replacement audit event is written for it: the purge removes manual
        # attendance data *and* its audit trail, and a stand-in row would carry
        # the same identifiers back in.
        self.assertEqual(
            list(AuditLog.objects.values_list("id", flat=True)), [unrelated_audit.id]
        )

        # The employee keeps their HR record.
        self.assertTrue(EmployeeProfile.objects.filter(id=profile.id).exists())

    def test_purge_preserves_a_biotime_record_and_its_starting_work_acknowledgment(self):
        profile = self._extra_profile("swa-biotime", "BTO-SWA-BT", biotime_emp_code="BT-SWA-OK")
        genuine = self._biotime_record(profile, self.today - timedelta(days=7), emp_code="BT-SWA-OK")
        acknowledgment, document = self._acknowledgment(profile, genuine, "SWA-BIOTIME-1")
        ack_workflow = self._workflow_for(acknowledgment, key="starting_work_acknowledgment")
        ack_audit = self._starting_work_audit(acknowledgment)

        purge_manual_attendance(django_apps, None)

        self.assertTrue(AttendanceRecord.objects.filter(id=genuine.id).exists())
        self.assertTrue(StartingWorkAcknowledgment.objects.filter(id=acknowledgment.id).exists())
        self.assertTrue(WorkflowInstance.objects.filter(id=ack_workflow.id).exists())
        self.assertTrue(AuditLog.objects.filter(id=ack_audit.id).exists())
        self.assertTrue(EmployeeDocument.objects.filter(id=document.id).exists())
        # Nothing was written either: the only audit row is the one seeded above.
        self.assertEqual(list(AuditLog.objects.values_list("id", flat=True)), [ack_audit.id])

    def test_purge_aborts_without_deleting_when_an_auto_absence_carries_an_acknowledgment(self):
        # Not reachable through the application (an acknowledgment always needs
        # a biotime_emp_code and a live mapping), so this asserts the fail-closed
        # guard rather than a real state: nothing is deleted, and the error names
        # the row needing manual review.
        manual = AttendanceRecord.objects.create(
            employee_profile=self.mapped_profile,
            date=self.today - timedelta(days=3),
            check_in_at=timezone.now(),
            status=AttendanceRecord.Status.PENDING_HR,
            source=AttendanceRecord.Source.EMPLOYEE,
            created_by=self.mapped_user,
        )
        stranded_absence = AttendanceRecord.objects.create(
            employee_profile=self.unmapped_profile,
            date=self.today - timedelta(days=4),
            status=AttendanceRecord.Status.ABSENT,
            source=AttendanceRecord.Source.SYSTEM,
            notes="Auto-marked absent: no attendance recorded.",
        )
        acknowledgment, document = self._acknowledgment(
            self.unmapped_profile, stranded_absence, "SWA-STRANDED-1"
        )

        with self.assertRaises(RuntimeError) as raised:
            purge_manual_attendance(django_apps, None)

        message = str(raised.exception)
        self.assertIn("aborted before deleting anything", message)
        self.assertIn("SWA-STRANDED-1", message)
        self.assertIn(str(stranded_absence.id), message)

        # Nothing was purged — not even the plainly manual row.
        self.assertTrue(AttendanceRecord.objects.filter(id=manual.id).exists())
        self.assertTrue(AttendanceRecord.objects.filter(id=stranded_absence.id).exists())
        self.assertTrue(StartingWorkAcknowledgment.objects.filter(id=acknowledgment.id).exists())
        self.assertTrue(EmployeeDocument.objects.filter(id=document.id).exists())


    # --- fail-closed inbound-reference guard --------------------------------

    @staticmethod
    def _fake_relation(label, field_name, on_delete, count):
        """A stand-in reverse relation, so the guard can be exercised without
        adding a real model that references StartingWorkAcknowledgment."""

        class _Manager:
            def filter(self, **kwargs):
                return self

            def count(self):
                return count

        related_model = type(
            "FakeReferencing",
            (),
            {"_meta": SimpleNamespace(label=label), "_default_manager": _Manager()},
        )
        return SimpleNamespace(
            many_to_many=False,
            related_model=related_model,
            field=SimpleNamespace(name=field_name, remote_field=SimpleNamespace(on_delete=on_delete)),
        )

    def _blockers_for(self, relations):
        fake_model = type("FakeAcknowledgment", (), {"_meta": SimpleNamespace(related_objects=relations)})
        fake_apps = SimpleNamespace(get_model=lambda *args, **kwargs: fake_model)
        return migration_0012._acknowledgment_delete_blockers(fake_apps, [1])

    def test_guard_treats_only_cascade_and_set_null_as_safe(self):
        def unknown_behaviour(collector, field, sub_objs, using):  # pragma: no cover - never called
            raise AssertionError("custom on_delete should not run")

        safe = [models.CASCADE, models.SET_NULL]
        unsafe = [models.DO_NOTHING, models.PROTECT, models.RESTRICT, models.SET_DEFAULT, unknown_behaviour]

        for on_delete in safe:
            with self.subTest(on_delete=getattr(on_delete, "__name__", on_delete), expected="safe"):
                relation = self._fake_relation("fake.Model", "acknowledgment", on_delete, 3)
                self.assertEqual(self._blockers_for([relation]), [])

        for on_delete in unsafe:
            with self.subTest(on_delete=getattr(on_delete, "__name__", on_delete), expected="blocked"):
                relation = self._fake_relation("fake.Model", "acknowledgment", on_delete, 3)
                blockers = self._blockers_for([relation])
                self.assertEqual(len(blockers), 1)
                self.assertIn("fake.Model.acknowledgment", blockers[0])
                self.assertIn("3 acknowledgment(s)", blockers[0])
                self.assertIn(getattr(on_delete, "__name__", str(on_delete)), blockers[0])

    def test_guard_ignores_unsafe_relations_that_have_no_rows(self):
        relation = self._fake_relation("fake.Model", "acknowledgment", models.PROTECT, 0)
        self.assertEqual(self._blockers_for([relation]), [])

    def test_purge_aborts_without_deleting_when_the_inbound_guard_trips(self):
        profile = self._extra_profile("swa-blocked", "BTO-SWA-BLK", biotime_emp_code="BT-SWA-BLK")
        overridden = AttendanceRecord.objects.create(
            employee_profile=profile,
            date=self.today - timedelta(days=8),
            check_in_at=timezone.now(),
            status=AttendanceRecord.Status.PRESENT,
            source=AttendanceRecord.Source.HR,
            is_overridden=True,
            biotime_emp_code="BT-SWA-BLK",
            created_by=self.hr_user,
        )
        acknowledgment, document = self._acknowledgment(profile, overridden, "SWA-BLOCKED-1")
        plain_manual = AttendanceRecord.objects.create(
            employee_profile=self.mapped_profile,
            date=self.today - timedelta(days=3),
            check_in_at=timezone.now(),
            status=AttendanceRecord.Status.PENDING_HR,
            source=AttendanceRecord.Source.EMPLOYEE,
            created_by=self.mapped_user,
        )

        blocker = "fake.Model.acknowledgment still references 1 acknowledgment(s) with on_delete=DO_NOTHING"
        with mock.patch.object(
            migration_0012, "_acknowledgment_delete_blockers", return_value=[blocker]
        ) as guard:
            with self.assertRaises(RuntimeError) as raised:
                purge_manual_attendance(django_apps, None)

        guard.assert_called_once()
        self.assertIn("aborted before deleting anything", str(raised.exception))
        self.assertIn(blocker, str(raised.exception))

        # Nothing was mutated — not even the unprotected manual row.
        self.assertTrue(AttendanceRecord.objects.filter(id=overridden.id).exists())
        self.assertTrue(AttendanceRecord.objects.filter(id=plain_manual.id).exists())
        self.assertTrue(StartingWorkAcknowledgment.objects.filter(id=acknowledgment.id).exists())
        self.assertTrue(EmployeeDocument.objects.filter(id=document.id).exists())

@override_settings(BIOTIME_AGENT_TOKEN="policy-agent-token")
class BioTimeAgentIngestStillWorksTests(BioTimeOnlyAttendancePolicyBase):
    """The agent endpoints are the only remaining attendance writer."""

    def test_agent_ingest_creates_records_for_mapped_employees_and_drops_unmapped(self):
        response = self.client.post(
            "/api/biotime/agent/ingest/",
            {
                "transactions": [
                    {
                        "emp_code": "BT-1001",
                        "punch_time": "2026-05-04 08:00:00",
                        "terminal_sn": "TERMINAL-01",
                        "is_attendance": 1,
                    },
                    {
                        "emp_code": "BT-NOT-MAPPED",
                        "punch_time": "2026-05-04 08:05:00",
                        "is_attendance": 1,
                    },
                ]
            },
            format="json",
            HTTP_X_BIOTIME_AGENT_TOKEN="policy-agent-token",
            **self.headers,
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["created"], 1)
        self.assertEqual(response.data["data"]["unmapped"], 1)

        record = AttendanceRecord.objects.get(employee_profile=self.mapped_profile, date=date(2026, 5, 4))
        self.assertEqual(record.source, AttendanceRecord.Source.SYSTEM)
        self.assertEqual(record.biotime_emp_code, "BT-1001")
        self.assertEqual(record.biotime_terminal_sn, "TERMINAL-01")
        self.assertFalse(AttendanceRecord.objects.filter(employee_profile=self.unmapped_profile).exists())

    def test_agent_ingest_rejects_a_bad_token(self):
        response = self.client.post(
            "/api/biotime/agent/ingest/",
            {"transactions": []},
            format="json",
            HTTP_X_BIOTIME_AGENT_TOKEN="wrong",
            **self.headers,
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_agent_employee_sync_still_records_device_employees(self):
        response = self.client.post(
            "/api/biotime/agent/employees/",
            {"employees": [{"emp_code": "BT-DEVICE-9", "first_name": "Device", "last_name": "User"}]},
            format="json",
            HTTP_X_BIOTIME_AGENT_TOKEN="policy-agent-token",
            **self.headers,
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(BioTimeDeviceEmployee.objects.filter(emp_code="BT-DEVICE-9").exists())
