from datetime import date
from io import BytesIO
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase, override_settings
from django.utils import timezone
from pypdf import PdfReader
from rest_framework.test import APIClient

from attendance.models import AttendanceRecord, BioTimeEmployeeMap
from attendance.services import SyncBioTimeService
from audit.models import AuditLog
from employees.models import EmployeeDocument, EmployeeProfile
from in_app_notifications.models import Notification
from organization.models import OrganizationNode, UserOrganizationAccess

from ..models import StartingWorkAcknowledgment
from ..starting_work_service import generate_starting_work_acknowledgment

User = get_user_model()


@override_settings(SECURE_SSL_REDIRECT=False, ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"])
class StartingWorkVerificationTests(TestCase):
    def setUp(self):
        self.media_root = TemporaryDirectory()
        self.settings_override = override_settings(MEDIA_ROOT=self.media_root.name)
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        self.addCleanup(self.media_root.cleanup)

        hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.company = OrganizationNode.objects.create(
            code="SWV_A", name="Verification Company A", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.other_company = OrganizationNode.objects.create(
            code="SWV_B", name="Verification Company B", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.hr = User.objects.create_user(
            email="verification-hr@example.com", password="StrongPass123!", full_name="Verification HR"
        )
        self.hr.groups.add(hr_group)
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.company)
        self.foreign_hr = User.objects.create_user(
            email="foreign-verification-hr@example.com", password="StrongPass123!", full_name="Foreign HR"
        )
        self.foreign_hr.groups.add(hr_group)
        UserOrganizationAccess.objects.create(user=self.foreign_hr, organization=self.other_company)
        self.employee = User.objects.create_user(
            email="verification-employee@example.com", password="StrongPass123!", full_name="Verification Employee"
        )
        self.profile = EmployeeProfile.objects.create(
            user=self.employee,
            company=self.company,
            employee_id="SWV-100",
            full_name="Verification Employee",
            department="Operations",
            job_title="Operator",
            hire_date=date(2026, 8, 1),
        )
        self.mapping = BioTimeEmployeeMap.objects.create(
            employee_profile=self.profile,
            biotime_emp_code="SWV100",
        )

    def _system_record(self, record_date, *, status=AttendanceRecord.Status.PRESENT):
        return AttendanceRecord.objects.create(
            employee_profile=self.profile,
            date=record_date,
            source=AttendanceRecord.Source.SYSTEM,
            status=status,
            biotime_emp_code=self.mapping.biotime_emp_code,
        )

    def _generate(self, record=None):
        record = record or self._system_record(date(2026, 8, 1))
        with (
            patch("job_offers.starting_work_service.notify_starting_work_acknowledgment_ready", return_value=[]),
            patch("job_offers.starting_work_service.resolve_template_path", return_value=None, create=True),
        ):
            acknowledgment = generate_starting_work_acknowledgment(record)
        return acknowledgment

    def _hr_client(self, user=None, company=None):
        client = APIClient()
        client.force_authenticate(user=user or self.hr)
        client.credentials(HTTP_X_ACTIVE_COMPANY_ID=str((company or self.company).id))
        return client

    @patch("job_offers.notifications._safe_email", return_value={"success": True})
    @patch("job_offers.notifications.dispatch_notification_channels")
    @patch("job_offers.starting_work_service.build_starting_work_acknowledgment_pdf", return_value=b"%PDF-1.4\n%%EOF")
    def test_first_biotime_present_creates_one_pending_ack_and_notifies_only_company_hr(
        self, _pdf, dispatch, _email
    ):
        dispatch.side_effect = lambda **kwargs: {
            "notification": Notification.objects.create(
                recipient=kwargs["recipient"],
                event_key=kwargs["event_key"],
                title=kwargs["title"],
                message=kwargs["message"],
                category=kwargs["category"],
                company=kwargs["company"],
            ),
            "whatsapp": {"status": "pending"},
        }
        transactions = [
            {"emp_code": "SWV100", "punch_time": "2026-08-01 08:00:00", "is_attendance": 1},
            {"emp_code": "SWV100", "punch_time": "2026-08-01 17:00:00", "is_attendance": 1},
        ]

        first = SyncBioTimeService.ingest_transactions(transactions)
        second = SyncBioTimeService.ingest_transactions(transactions)

        acknowledgment = StartingWorkAcknowledgment.objects.get(employee_profile=self.profile)
        record = AttendanceRecord.objects.get(employee_profile=self.profile, date=date(2026, 8, 1))
        self.assertEqual(first["created"], 1)
        self.assertEqual(second["created"], 0)
        self.assertEqual(acknowledgment.status, StartingWorkAcknowledgment.Status.PENDING_HR)
        self.assertEqual(record.status, AttendanceRecord.Status.PENDING_HR)
        self.assertEqual(acknowledgment.affected_attendance_records.count(), 1)
        self.assertEqual(StartingWorkAcknowledgment.objects.count(), 1)
        self.assertEqual(EmployeeDocument.objects.filter(custom_name="Starting Work Acknowledgment").count(), 1)
        self.assertEqual(Notification.objects.filter(event_key="starting_work_acknowledgment.pending_hr").count(), 1)
        self.assertFalse(Notification.objects.filter(recipient=self.employee).exists())
        self.assertFalse(Notification.objects.filter(recipient=self.foreign_hr).exists())
        self.assertEqual(dispatch.call_count, 1)
        self.assertEqual(dispatch.call_args.kwargs["recipient"], self.hr)

    def test_hr_only_document_is_hidden_from_employee_and_company_scoped(self):
        acknowledgment = self._generate()
        employee_client = APIClient()
        employee_client.force_authenticate(user=self.employee)

        employee_list = employee_client.get(f"/api/employees/{self.profile.id}/documents/")
        employee_download = employee_client.get(
            f"/api/employees/{self.profile.id}/documents/{acknowledgment.document_id}/download/"
        )
        own_hr = self._hr_client().get(f"/starting-work-acknowledgments/{acknowledgment.id}/pdf/")
        foreign_hr = self._hr_client(self.foreign_hr, self.other_company).get(
            f"/starting-work-acknowledgments/{acknowledgment.id}/pdf/"
        )

        self.assertEqual(employee_list.status_code, 200)
        self.assertEqual(employee_list.data["data"], [])
        self.assertEqual(employee_download.status_code, 404)
        self.assertEqual(own_hr.status_code, 200)
        self.assertEqual(foreign_hr.status_code, 404)

    def test_pending_is_not_present_and_rejection_requires_reason_and_marks_linked_range_absent(self):
        first = self._system_record(date(2026, 8, 1))
        acknowledgment = self._generate(first)
        later = self._system_record(date(2026, 8, 2))
        SyncBioTimeService.ingest_transactions(
            [{"emp_code": "SWV100", "punch_time": "2026-08-02 08:00:00", "is_attendance": 1}]
        )
        first.refresh_from_db()
        later.refresh_from_db()
        self.assertEqual(first.status, AttendanceRecord.Status.PENDING_HR)
        self.assertEqual(later.status, AttendanceRecord.Status.PENDING_HR)
        self.assertEqual(
            AttendanceRecord.objects.filter(
                employee_profile=self.profile,
                status=AttendanceRecord.Status.PRESENT,
            ).count(),
            0,
        )

        missing_reason = self._hr_client().post(
            f"/starting-work-acknowledgments/{acknowledgment.id}/reject/", {}, format="json"
        )
        rejected = self._hr_client().post(
            f"/starting-work-acknowledgments/{acknowledgment.id}/reject/",
            {"reason": "BioTime identity needs correction."},
            format="json",
        )

        self.assertEqual(missing_reason.status_code, 422)
        self.assertEqual(rejected.status_code, 200)
        self.assertTrue(rejected.data["data"]["workflow"]["can_approve"])
        self.assertFalse(rejected.data["data"]["workflow"]["can_reject"])
        acknowledgment.refresh_from_db()
        self.assertEqual(acknowledgment.status, StartingWorkAcknowledgment.Status.REJECTED)
        self.assertEqual(acknowledgment.rejection_reason, "BioTime identity needs correction.")
        self.assertEqual(acknowledgment.rejected_by, self.hr)
        self.assertTrue(
            AuditLog.objects.filter(
                action="starting_work_acknowledgment_rejected", entity_id=str(acknowledgment.id)
            ).exists()
        )
        self.assertEqual(
            set(acknowledgment.affected_attendance_records.values_list("status", flat=True)),
            {AttendanceRecord.Status.ABSENT},
        )

    def test_approval_after_rejection_restores_only_eligible_system_rows_and_finalizes_pdf(self):
        first = self._system_record(date(2026, 8, 1))
        acknowledgment = self._generate(first)
        second = self._system_record(date(2026, 8, 2))
        SyncBioTimeService.ingest_transactions(
            [{"emp_code": "SWV100", "punch_time": "2026-08-02 08:00:00", "is_attendance": 1}]
        )
        rejected = self._hr_client().post(
            f"/starting-work-acknowledgments/{acknowledgment.id}/reject/",
            {"reason": "Verify punches."},
            format="json",
        )
        self.assertEqual(rejected.status_code, 200)
        second.refresh_from_db()
        second.source = AttendanceRecord.Source.HR
        second.is_overridden = True
        second.status = AttendanceRecord.Status.LATE
        second.save(update_fields=["source", "is_overridden", "status", "updated_at"])

        with patch("job_offers.starting_work_pdf.resolve_template_path", return_value=None):
            approved = self._hr_client().post(
                f"/starting-work-acknowledgments/{acknowledgment.id}/approve/", {}, format="json"
            )

        self.assertEqual(approved.status_code, 200)
        acknowledgment.refresh_from_db()
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(acknowledgment.status, StartingWorkAcknowledgment.Status.APPROVED)
        self.assertEqual(acknowledgment.approved_by, self.hr)
        self.assertIsNotNone(acknowledgment.approved_at)
        self.assertEqual(first.status, AttendanceRecord.Status.PRESENT)
        self.assertEqual(second.status, AttendanceRecord.Status.LATE)
        self.assertEqual(second.source, AttendanceRecord.Source.HR)
        extracted = PdfReader(BytesIO(acknowledgment.document.file.read())).pages[0].extract_text()
        self.assertIn(self.hr.full_name, extracted)
        self.assertIn(timezone.localdate(acknowledgment.approved_at).isoformat(), extracted)

    def test_resync_preserves_pending_and_rejected_holds(self):
        first = self._system_record(date(2026, 8, 1))
        acknowledgment = self._generate(first)
        transaction = [{"emp_code": "SWV100", "punch_time": "2026-08-01 09:00:00", "is_attendance": 1}]

        SyncBioTimeService.ingest_transactions(transaction)
        first.refresh_from_db()
        self.assertEqual(first.status, AttendanceRecord.Status.PENDING_HR)
        with patch(
            "job_offers.starting_work_service.generate_starting_work_acknowledgment",
            side_effect=RuntimeError("verification projection unavailable"),
        ):
            SyncBioTimeService.ingest_transactions(transaction)
        first.refresh_from_db()
        self.assertEqual(first.status, AttendanceRecord.Status.PENDING_HR)

        response = self._hr_client().post(
            f"/starting-work-acknowledgments/{acknowledgment.id}/reject/",
            {"reason": "Invalid start."},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        SyncBioTimeService.ingest_transactions(transaction)
        first.refresh_from_db()
        self.assertEqual(first.status, AttendanceRecord.Status.ABSENT)

    def test_list_detail_actions_workflow_audits_and_role_scope(self):
        acknowledgment = self._generate()
        client = self._hr_client()

        listed = client.get("/starting-work-acknowledgments/?status=pending_hr")
        detailed = client.get(f"/starting-work-acknowledgments/{acknowledgment.id}/")

        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.data["data"]["items"][0]["id"], acknowledgment.id)
        payload = detailed.data["data"]
        self.assertEqual(payload["status"], "pending_hr")
        self.assertEqual(payload["first_biotime_attendance_date"], "2026-08-01")
        self.assertEqual(payload["affected_attendance_count"], 1)
        self.assertTrue(payload["actions"]["can_approve"])
        self.assertTrue(payload["actions"]["can_reject"])
        self.assertTrue(payload["actions"]["can_download"])
        self.assertEqual(payload["workflow"]["current_stage"], "hr")

        employee_client = APIClient()
        employee_client.force_authenticate(user=self.employee)
        self.assertEqual(employee_client.get("/starting-work-acknowledgments/").status_code, 403)
        foreign = self._hr_client(self.foreign_hr, self.other_company).get(
            f"/starting-work-acknowledgments/{acknowledgment.id}/"
        )
        self.assertEqual(foreign.status_code, 404)

        admin_group, _ = Group.objects.get_or_create(name="SystemAdmin")
        admin = User.objects.create_user(email="verification-admin@example.com", password="StrongPass123!")
        admin.groups.add(admin_group)
        admin_client = self._hr_client(admin, self.company)
        self.assertEqual(
            admin_client.get(f"/starting-work-acknowledgments/{acknowledgment.id}/").status_code,
            200,
        )

        approved = client.post(f"/starting-work-acknowledgments/{acknowledgment.id}/approve/", {}, format="json")
        self.assertEqual(approved.status_code, 200)
        self.assertTrue(
            AuditLog.objects.filter(
                action="starting_work_acknowledgment_approved", entity_id=str(acknowledgment.id)
            ).exists()
        )
        self.assertTrue(approved.data["data"]["workflow"]["history"])
