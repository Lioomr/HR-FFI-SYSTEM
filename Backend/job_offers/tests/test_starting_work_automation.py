from datetime import date
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from attendance.models import AttendanceRecord, BioTimeConfig, BioTimeEmployeeMap
from attendance.services import SyncBioTimeService
from audit.models import AuditLog
from employees.models import EmployeeDocument, EmployeeProfile
from organization.models import OrganizationNode, UserOrganizationAccess

from ..models import JobOffer, StartingWorkAcknowledgment
from ..notifications import notify_starting_work_acknowledgment_ready
from ..starting_work_service import generate_starting_work_acknowledgment

User = get_user_model()


@override_settings(SECURE_SSL_REDIRECT=False, ALLOWED_HOSTS=["testserver", "localhost", "127.0.0.1"])
class StartingWorkAcknowledgmentAutomationTests(TestCase):
    def setUp(self):
        self.media_root = TemporaryDirectory()
        self.settings_override = override_settings(MEDIA_ROOT=self.media_root.name)
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        self.addCleanup(self.media_root.cleanup)

        hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.company = OrganizationNode.objects.create(
            code="SWA_A",
            name="Starting Work Company A",
            node_type=OrganizationNode.NodeType.COMPANY,
        )
        self.other_company = OrganizationNode.objects.create(
            code="SWA_B",
            name="Starting Work Company B",
            node_type=OrganizationNode.NodeType.COMPANY,
        )
        self.hr = User.objects.create_user(
            email="starting-work-hr@example.com",
            password="StrongPass123!",
            full_name="Starting Work HR",
        )
        self.hr.groups.add(hr_group)
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.company)
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.other_company)
        self.other_hr = User.objects.create_user(
            email="starting-work-other-hr@example.com",
            password="StrongPass123!",
            full_name="Other Company HR",
        )
        self.other_hr.groups.add(hr_group)
        UserOrganizationAccess.objects.create(user=self.other_hr, organization=self.other_company)
        self.employee = User.objects.create_user(email="starting-work-employee@example.com", password="password")
        self.profile = EmployeeProfile.objects.create(
            user=self.employee,
            company=self.company,
            employee_id="SWA-EMP-100",
            full_name="BioTime Employee",
            department="Operations",
            job_title="Operator",
            hire_date=date(2026, 4, 1),
        )
        self.mapping = BioTimeEmployeeMap.objects.create(
            employee_profile=self.profile,
            biotime_emp_code="SWA100",
        )
        self.config = BioTimeConfig.get_solo()
        self.config.server_ip = "192.168.1.10"
        self.config.server_port = "8090"
        self.config.username = "admin"
        self.config.password = "secret"
        self.config.is_active = True
        self.config.last_sync_time = None
        self.config.save()

    def _sync(self, transactions):
        with (
            patch("attendance.services.BioTimeClient") as client_class,
            patch(
                "job_offers.starting_work_service.build_starting_work_acknowledgment_pdf",
                return_value=b"%PDF-1.4\n%%EOF",
            ),
            patch(
                "job_offers.starting_work_service.notify_starting_work_acknowledgment_ready",
                return_value=[
                    {
                        "recipient_id": self.hr.id,
                        "in_app_created": True,
                        "whatsapp_status": "pending",
                        "email_sent": True,
                    }
                ],
            ) as notify,
        ):
            client = client_class.return_value
            client.test_connection.return_value = True
            client.get_transactions.return_value = transactions
            successful, result = SyncBioTimeService.execute(days_back=3)
        return successful, result, notify

    def _transactions(self, record_date="2026-04-01"):
        return [
            {"emp_code": "SWA100", "punch_time": f"{record_date} 08:00:00", "is_attendance": 1},
            {"emp_code": "SWA100", "punch_time": f"{record_date} 17:30:00", "is_attendance": 1},
        ]

    def _accepted_job_offer(self):
        return JobOffer.objects.create(
            company=self.company,
            employee_profile=self.profile,
            candidate_full_name=self.profile.full_name,
            candidate_email=self.employee.email,
            position_title=self.profile.job_title,
            basic_salary=1000,
            total_salary_package=1000,
            offer_date=date(2026, 3, 1),
            expiry_date=date(2026, 3, 8),
            reference_number="JO-SWA_A-2026-0001",
            hr_signer_user=self.hr,
            hr_signer_name=self.hr.full_name,
            hr_signer_title="HR Manager",
            status=JobOffer.Status.ACCEPTED,
            accepted_at=timezone.now(),
            created_by=self.hr,
            updated_by=self.hr,
        )

    def test_first_biotime_attendance_generates_and_archives_one_acknowledgment(self):
        offer = self._accepted_job_offer()

        successful, result, notify = self._sync(self._transactions())

        self.assertTrue(successful)
        self.assertEqual(result["created"], 1)
        acknowledgment = StartingWorkAcknowledgment.objects.select_related("document").get(
            employee_profile=self.profile
        )
        self.assertEqual(acknowledgment.job_offer, offer)
        self.assertEqual(acknowledgment.reference_number, "SWA-SWA-EMP-100-20260401")
        self.assertEqual(acknowledgment.status, StartingWorkAcknowledgment.Status.PENDING_HR)
        self.assertTrue(acknowledgment.generated_by_system)
        self.assertEqual(acknowledgment.document.document_type, EmployeeDocument.DocumentType.OTHER)
        self.assertEqual(acknowledgment.document.custom_name, "Starting Work Acknowledgment")
        self.assertEqual(acknowledgment.document.extraction_status, EmployeeDocument.ExtractionStatus.SUCCESS)
        self.assertEqual(acknowledgment.document.extracted_fields["ocr"], "skipped")
        self.assertEqual(
            acknowledgment.document.original_filename,
            "starting-work-acknowledgment-SWA-EMP-100-20260401.pdf",
        )
        self.assertTrue(acknowledgment.document.file.read().startswith(b"%PDF"))
        notify.assert_called_once_with(acknowledgment)
        self.assertEqual(
            set(AuditLog.objects.filter(entity_id=str(acknowledgment.id)).values_list("action", flat=True)),
            {
                "starting_work_acknowledgment_pending_hr_created",
                "starting_work_acknowledgment_document_archived",
                "starting_work_acknowledgment_hr_notified",
                "workflow_transition",
            },
        )

    def test_rerunning_sync_does_not_duplicate_pdf_document_or_notification(self):
        first_successful, _, first_notify = self._sync(self._transactions())
        second_successful, second_result, second_notify = self._sync(self._transactions())

        self.assertTrue(first_successful)
        self.assertTrue(second_successful)
        self.assertEqual(second_result["created"], 0)
        self.assertEqual(StartingWorkAcknowledgment.objects.filter(employee_profile=self.profile).count(), 1)
        self.assertEqual(
            EmployeeDocument.objects.filter(
                employee_profile=self.profile,
                custom_name="Starting Work Acknowledgment",
            ).count(),
            1,
        )
        first_notify.assert_called_once()
        second_notify.assert_not_called()

    def test_manual_attendance_does_not_trigger_generation(self):
        AttendanceRecord.objects.create(
            employee_profile=self.profile,
            date=date(2026, 4, 1),
            source=AttendanceRecord.Source.HR,
            status=AttendanceRecord.Status.PRESENT,
        )

        successful, result, notify = self._sync(self._transactions())

        self.assertTrue(successful)
        self.assertEqual(result["created"], 0)
        self.assertEqual(result["skipped"], 1)
        self.assertFalse(StartingWorkAcknowledgment.objects.exists())
        notify.assert_not_called()

    def test_archiving_mapped_employee_is_blocked_before_generation(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.profile.is_archived = True
            self.profile.save(update_fields=["is_archived", "updated_at"])

        self.profile.refresh_from_db()
        self.assertFalse(self.profile.is_archived)
        self.assertFalse(AttendanceRecord.objects.filter(employee_profile=self.profile).exists())
        self.assertFalse(StartingWorkAcknowledgment.objects.exists())

    def test_unmapped_biotime_record_does_not_trigger_generation(self):
        self.mapping.delete()

        successful, result, notify = self._sync(self._transactions())

        self.assertTrue(successful)
        self.assertEqual(result["unmapped"], 1)
        self.assertFalse(AttendanceRecord.objects.exists())
        self.assertFalse(StartingWorkAcknowledgment.objects.exists())
        notify.assert_not_called()

    @patch("job_offers.starting_work_service.notify_starting_work_acknowledgment_ready", side_effect=RuntimeError)
    @patch(
        "job_offers.starting_work_service.build_starting_work_acknowledgment_pdf",
        return_value=b"%PDF-1.4\n%%EOF",
    )
    def test_notification_failure_does_not_undo_generation(self, _pdf, _notify):
        record = AttendanceRecord.objects.create(
            employee_profile=self.profile,
            date=date(2026, 4, 1),
            source=AttendanceRecord.Source.SYSTEM,
            status=AttendanceRecord.Status.PRESENT,
            biotime_emp_code=self.mapping.biotime_emp_code,
        )

        acknowledgment = generate_starting_work_acknowledgment(record)

        self.assertIsNotNone(acknowledgment)
        self.assertTrue(StartingWorkAcknowledgment.objects.filter(pk=acknowledgment.pk).exists())
        self.assertTrue(EmployeeDocument.objects.filter(pk=acknowledgment.document_id).exists())

    def test_generated_document_appears_in_scoped_employee_archive(self):
        self._sync(self._transactions())
        acknowledgment = StartingWorkAcknowledgment.objects.get(employee_profile=self.profile)
        client = APIClient()
        client.force_authenticate(user=self.hr)

        own_company = client.get(
            f"/api/employees/{self.profile.id}/documents/",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )
        other_company = client.get(
            f"/api/employees/{self.profile.id}/documents/",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.other_company.id),
        )

        self.assertEqual(own_company.status_code, 200)
        self.assertEqual([item["id"] for item in own_company.data["data"]], [acknowledgment.document_id])
        self.assertEqual(other_company.status_code, 404)

    @patch("job_offers.notifications._safe_email", return_value={"success": True})
    @patch("job_offers.notifications.dispatch_notification_channels")
    def test_hr_notification_uses_all_channels_and_company_scope(self, dispatch, email):
        dispatch.return_value = {"notification": object(), "whatsapp": {"status": "pending"}}
        record = AttendanceRecord.objects.create(
            employee_profile=self.profile,
            date=date(2026, 4, 1),
            source=AttendanceRecord.Source.SYSTEM,
            status=AttendanceRecord.Status.PRESENT,
            biotime_emp_code=self.mapping.biotime_emp_code,
        )
        with (
            patch(
                "job_offers.starting_work_service.build_starting_work_acknowledgment_pdf",
                return_value=b"%PDF-1.4\n%%EOF",
            ),
            patch("job_offers.starting_work_service.notify_starting_work_acknowledgment_ready"),
        ):
            acknowledgment = generate_starting_work_acknowledgment(record)

        results = notify_starting_work_acknowledgment_ready(acknowledgment)

        self.assertEqual(results[0]["recipient_id"], self.hr.id)
        self.assertEqual(len(results), 1)
        dispatch.assert_called_once()
        self.assertEqual(dispatch.call_args.kwargs["recipient"], self.hr)
        self.assertEqual(dispatch.call_args.kwargs["company"], self.company)
        self.assertTrue(dispatch.call_args.kwargs["whatsapp_enabled"])
        self.assertIn(self.profile.employee_id, dispatch.call_args.kwargs["message"])
        self.assertIn("2026-04-01", dispatch.call_args.kwargs["message"])
        email.assert_called_once()

    def test_direct_generation_rejects_non_system_attendance(self):
        record = AttendanceRecord.objects.create(
            employee_profile=self.profile,
            date=date(2026, 4, 1),
            source=AttendanceRecord.Source.HR,
            status=AttendanceRecord.Status.PRESENT,
        )

        self.assertIsNone(generate_starting_work_acknowledgment(record))
        self.assertFalse(StartingWorkAcknowledgment.objects.exists())

    def test_only_the_earliest_system_present_attendance_is_eligible(self):
        first = AttendanceRecord.objects.create(
            employee_profile=self.profile,
            date=date(2026, 4, 1),
            source=AttendanceRecord.Source.SYSTEM,
            status=AttendanceRecord.Status.PRESENT,
            biotime_emp_code=self.mapping.biotime_emp_code,
        )
        later = AttendanceRecord.objects.create(
            employee_profile=self.profile,
            date=date(2026, 4, 2),
            source=AttendanceRecord.Source.SYSTEM,
            status=AttendanceRecord.Status.PRESENT,
            biotime_emp_code=self.mapping.biotime_emp_code,
        )

        self.assertIsNone(generate_starting_work_acknowledgment(later))
        with (
            patch(
                "job_offers.starting_work_service.build_starting_work_acknowledgment_pdf",
                return_value=b"%PDF-1.4\n%%EOF",
            ),
            patch("job_offers.starting_work_service.notify_starting_work_acknowledgment_ready", return_value=[]),
        ):
            acknowledgment = generate_starting_work_acknowledgment(first)
        self.assertEqual(acknowledgment.attendance_record, first)
