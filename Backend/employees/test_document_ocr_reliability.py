"""Reliability rules around the employee document OCR job.

Covers the queue claim that keeps duplicate jobs off the broker, the Celery
retry/timeout handling, and the explicit HR re-run path.
"""

from datetime import timedelta
from unittest.mock import patch

from celery.exceptions import MaxRetriesExceededError, SoftTimeLimitExceeded
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import OperationalError
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from organization.models import OrganizationNode, UserOrganizationAccess

from .models import EmployeeDocument, EmployeeProfile
from .ocr.engine import TransientExtractionError
from .services.document_jobs import (
    ALREADY_QUEUED_WARNING,
    QUEUE_FAILED_WARNING,
    claim_document_for_extraction,
    queue_document_extraction,
)
from .tasks import OCR_TIMEOUT_MESSAGE, extract_employee_document

User = get_user_model()


class Retry(Exception):
    """Stand-in for celery's Retry signal in eager tests."""


class DocumentExtractionQueueTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.company = OrganizationNode.objects.create(
            code="OCR_QUEUE", name="OCR Queue Company", node_type=OrganizationNode.NodeType.COMPANY
        )

    def tearDown(self):
        for document in EmployeeDocument.objects.exclude(file=""):
            document.file.delete(save=False)

    def _document(self, document_type=EmployeeDocument.DocumentType.PASSPORT, **kwargs):
        profile = EmployeeProfile.objects.create(
            company=self.company,
            employee_id=f"OCRQ-{EmployeeProfile.objects.count() + 1}",
        )
        return EmployeeDocument.objects.create(
            employee_profile=profile,
            company=self.company,
            document_type=document_type,
            file=SimpleUploadedFile("passport.pdf", b"%PDF-1.4\ncontent", content_type="application/pdf"),
            original_filename="passport.pdf",
            **kwargs,
        )

    @patch("employees.tasks.extract_employee_document.apply_async")
    def test_first_queue_claims_the_document_and_records_the_task_id(self, apply_async):
        apply_async.return_value = type("Result", (), {"id": "task-abc"})()
        document = self._document()

        outcome = queue_document_extraction(document)

        document.refresh_from_db()
        self.assertTrue(outcome.queued)
        self.assertEqual(outcome.warnings, [])
        self.assertEqual(document.extraction_status, EmployeeDocument.ExtractionStatus.PENDING)
        self.assertEqual(document.extraction_task_id, "task-abc")
        self.assertIsNotNone(document.extraction_queued_at)
        apply_async.assert_called_once_with(args=[document.id], retry=False)

    @patch("employees.tasks.extract_employee_document.apply_async")
    def test_second_queue_for_a_pending_document_is_refused(self, apply_async):
        apply_async.return_value = type("Result", (), {"id": "task-abc"})()
        document = self._document()

        queue_document_extraction(document)
        outcome = queue_document_extraction(document)

        self.assertFalse(outcome.queued)
        self.assertEqual(outcome.reason, "already_queued")
        self.assertEqual(outcome.warnings, [ALREADY_QUEUED_WARNING])
        self.assertEqual(apply_async.call_count, 1)

    @patch("employees.tasks.extract_employee_document.apply_async")
    def test_a_stale_claim_can_be_queued_again(self, apply_async):
        apply_async.return_value = type("Result", (), {"id": "task-abc"})()
        document = self._document(
            extraction_status=EmployeeDocument.ExtractionStatus.PENDING,
            extraction_queued_at=timezone.now() - timedelta(hours=2),
        )

        outcome = queue_document_extraction(document)

        self.assertTrue(outcome.queued)
        self.assertEqual(apply_async.call_count, 1)

    @override_settings(EMPLOYEE_DOCUMENT_OCR_QUEUE_LEASE_SECONDS=1)
    @patch("employees.tasks.extract_employee_document.apply_async")
    def test_the_lease_window_is_configurable(self, apply_async):
        apply_async.return_value = type("Result", (), {"id": "task-abc"})()
        document = self._document(
            extraction_status=EmployeeDocument.ExtractionStatus.PENDING,
            extraction_queued_at=timezone.now() - timedelta(seconds=30),
        )

        self.assertTrue(claim_document_for_extraction(document))

    @patch("employees.tasks.extract_employee_document.apply_async")
    def test_a_failed_document_can_be_queued_immediately(self, apply_async):
        apply_async.return_value = type("Result", (), {"id": "task-retry"})()
        document = self._document(
            extraction_status=EmployeeDocument.ExtractionStatus.FAILED,
            extraction_error="Earlier failure",
            extraction_queued_at=timezone.now(),
        )

        outcome = queue_document_extraction(document)

        document.refresh_from_db()
        self.assertTrue(outcome.queued)
        self.assertEqual(document.extraction_status, EmployeeDocument.ExtractionStatus.PENDING)
        self.assertEqual(document.extraction_error, "")

    @patch("employees.tasks.extract_employee_document.apply_async", side_effect=OSError("broker down"))
    def test_broker_failure_marks_the_document_failed_with_a_safe_message(self, _apply_async):
        document = self._document()

        outcome = queue_document_extraction(document)

        document.refresh_from_db()
        self.assertFalse(outcome.queued)
        self.assertEqual(outcome.warnings, [QUEUE_FAILED_WARNING])
        self.assertEqual(document.extraction_status, EmployeeDocument.ExtractionStatus.FAILED)
        self.assertIn("Re-run extraction", document.extraction_error)
        self.assertIsNone(document.extraction_queued_at)

    @patch("employees.tasks.extract_employee_document.apply_async")
    def test_non_identity_documents_are_completed_without_queueing(self, apply_async):
        document = self._document(EmployeeDocument.DocumentType.OTHER, custom_name="Medical Certificate")

        outcome = queue_document_extraction(document)

        document.refresh_from_db()
        self.assertFalse(outcome.queued)
        self.assertEqual(outcome.reason, "not_applicable")
        self.assertEqual(document.extraction_status, EmployeeDocument.ExtractionStatus.SUCCESS)
        apply_async.assert_not_called()


class DocumentExtractionTaskTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.company = OrganizationNode.objects.create(
            code="OCR_TASK", name="OCR Task Company", node_type=OrganizationNode.NodeType.COMPANY
        )

    def tearDown(self):
        for document in EmployeeDocument.objects.exclude(file=""):
            document.file.delete(save=False)

    def _document(self, **kwargs):
        profile = EmployeeProfile.objects.create(
            company=self.company,
            employee_id=f"OCRT-{EmployeeProfile.objects.count() + 1}",
        )
        return EmployeeDocument.objects.create(
            employee_profile=profile,
            company=self.company,
            document_type=EmployeeDocument.DocumentType.PASSPORT,
            file=SimpleUploadedFile("passport.pdf", b"%PDF-1.4\ncontent", content_type="application/pdf"),
            original_filename="passport.pdf",
            **kwargs,
        )

    def test_task_declares_time_limits_and_retries(self):
        self.assertTrue(extract_employee_document.acks_late)
        self.assertGreater(extract_employee_document.time_limit, 0)
        self.assertGreater(extract_employee_document.soft_time_limit, 0)
        self.assertLess(extract_employee_document.soft_time_limit, extract_employee_document.time_limit)
        self.assertEqual(extract_employee_document.max_retries, 3)

    def test_missing_document_is_reported_not_raised(self):
        result = extract_employee_document.apply(args=[999999]).get()

        self.assertEqual(result["status"], "missing")

    def test_successful_run_counts_the_attempt(self):
        document = self._document()

        with patch("employees.tasks.extract_document_fields", return_value=[]) as extract:
            result = extract_employee_document.apply(args=[document.id]).get()

        document.refresh_from_db()
        extract.assert_called_once()
        self.assertEqual(document.extraction_attempts, 1)
        self.assertEqual(result["attempts"], 1)

    def test_soft_time_limit_records_an_actionable_failure(self):
        document = self._document()

        with patch("employees.tasks.extract_document_fields", side_effect=SoftTimeLimitExceeded()):
            result = extract_employee_document.apply(args=[document.id]).get()

        document.refresh_from_db()
        self.assertEqual(document.extraction_status, EmployeeDocument.ExtractionStatus.FAILED)
        self.assertEqual(document.extraction_error, OCR_TIMEOUT_MESSAGE)
        self.assertEqual(document.extraction_warnings, [OCR_TIMEOUT_MESSAGE])
        self.assertEqual(result["warnings"], [OCR_TIMEOUT_MESSAGE])

    def test_transient_errors_are_retried(self):
        document = self._document()

        with patch("employees.tasks.extract_document_fields", side_effect=TransientExtractionError("storage blip")):
            with patch.object(extract_employee_document, "retry", side_effect=Retry) as retry:
                with self.assertRaises(Retry):
                    extract_employee_document.apply(args=[document.id], throw=True).get()

        self.assertEqual(retry.call_count, 1)
        document.refresh_from_db()
        self.assertNotEqual(document.extraction_status, EmployeeDocument.ExtractionStatus.FAILED)

    def test_database_errors_are_retried(self):
        document = self._document()

        with patch("employees.tasks.extract_document_fields", side_effect=OperationalError("connection reset")):
            with patch.object(extract_employee_document, "retry", side_effect=Retry) as retry:
                with self.assertRaises(Retry):
                    extract_employee_document.apply(args=[document.id], throw=True).get()

        self.assertEqual(retry.call_count, 1)

    def test_exhausted_retries_record_a_permanent_failure(self):
        document = self._document()

        with patch("employees.tasks.extract_document_fields", side_effect=TransientExtractionError("storage blip")):
            with patch.object(extract_employee_document, "retry", side_effect=MaxRetriesExceededError):
                result = extract_employee_document.apply(args=[document.id]).get()

        document.refresh_from_db()
        self.assertEqual(document.extraction_status, EmployeeDocument.ExtractionStatus.FAILED)
        self.assertEqual(document.extraction_error, "storage blip")
        self.assertEqual(result["warnings"], ["storage blip"])

    def test_a_superseded_job_does_not_overwrite_a_newer_run(self):
        document = self._document(extraction_task_id="newer-task")

        with patch("employees.tasks.extract_document_fields") as extract:
            result = extract_employee_document.apply(args=[document.id], task_id="older-task").get()

        self.assertEqual(result["status"], "superseded")
        extract.assert_not_called()


class DocumentExtractionApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.company = OrganizationNode.objects.create(
            code="OCR_API", name="OCR API Company", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.hr = User.objects.create_user(email="ocr-hr@test.com", password="password")
        self.hr.groups.add(hr_group)
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.company)
        self.profile = EmployeeProfile.objects.create(
            company=self.company,
            employee_id="OCR-API-001",
            full_name="OCR Subject",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )

    def tearDown(self):
        for document in EmployeeDocument.objects.exclude(file=""):
            document.file.delete(save=False)

    def _document(self, **kwargs):
        return EmployeeDocument.objects.create(
            employee_profile=self.profile,
            company=self.company,
            document_type=EmployeeDocument.DocumentType.PASSPORT,
            file=SimpleUploadedFile("passport.pdf", b"%PDF-1.4\ncontent", content_type="application/pdf"),
            original_filename="passport.pdf",
            uploaded_by=self.hr,
            **kwargs,
        )

    def _extract(self, document):
        self.client.force_authenticate(self.hr)
        return self.client.post(
            f"/api/employees/{self.profile.id}/documents/{document.id}/extract/",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

    @patch("employees.tasks.extract_employee_document.apply_async")
    def test_hr_rerun_queues_one_job_and_a_double_click_does_not_queue_a_second(self, apply_async):
        apply_async.return_value = type("Result", (), {"id": "task-1"})()
        document = self._document(extraction_status=EmployeeDocument.ExtractionStatus.FAILED)

        first = self._extract(document)
        second = self._extract(document)

        self.assertEqual(first.status_code, status.HTTP_200_OK, first.data)
        self.assertEqual(first.data["data"]["extraction_status"], "pending")
        self.assertEqual(first.data["data"]["extraction_warnings"], [])
        self.assertEqual(second.status_code, status.HTTP_200_OK, second.data)
        self.assertEqual(second.data["data"]["extraction_warnings"], [ALREADY_QUEUED_WARNING])
        self.assertEqual(apply_async.call_count, 1)

    @patch("employees.tasks.extract_employee_document.apply_async")
    def test_upload_queues_extraction_once(self, apply_async):
        apply_async.return_value = type("Result", (), {"id": "task-upload"})()
        self.client.force_authenticate(self.hr)

        response = self.client.post(
            f"/api/employees/{self.profile.id}/documents/",
            {
                "document_type": EmployeeDocument.DocumentType.PASSPORT,
                "file": SimpleUploadedFile("upload.pdf", b"%PDF-1.4\nvalid", content_type="application/pdf"),
            },
            format="multipart",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(response.data["data"]["extraction_status"], "pending")
        self.assertEqual(apply_async.call_count, 1)

    def test_raw_ocr_text_is_never_returned_by_the_api(self):
        document = self._document(
            extraction_status=EmployeeDocument.ExtractionStatus.SUCCESS,
            extraction_raw_text="P<EGYSAMPLE<<EMPLOYEE<<<<<<",
            extracted_fields={"passport_number": "X12345678", "raw_text": "legacy transcript"},
        )
        self.client.force_authenticate(self.hr)

        response = self.client.get(
            f"/api/employees/{self.profile.id}/documents/",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        payload = next(item for item in response.data["data"] if item["id"] == document.id)
        self.assertEqual(payload["extracted_fields"], {"passport_number": "X12345678"})
        self.assertNotIn("extraction_raw_text", payload)
        self.assertNotIn("legacy transcript", str(response.data))
        self.assertNotIn("P<EGY", str(response.data))

    def test_extraction_result_fields_are_exposed_to_hr(self):
        document = self._document(
            extraction_status=EmployeeDocument.ExtractionStatus.PARTIAL,
            extraction_warnings=["Could not extract: Expiry Date."],
            extraction_confidence=0.71,
            extraction_metadata={"engine": "paddleocr", "engine_version": "2.10.0", "field_confidence": {}},
        )
        self.client.force_authenticate(self.hr)

        response = self.client.get(
            f"/api/employees/{self.profile.id}/documents/",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        payload = next(item for item in response.data["data"] if item["id"] == document.id)
        self.assertEqual(payload["extraction_status"], "partial")
        self.assertEqual(payload["extraction_warnings"], ["Could not extract: Expiry Date."])
        self.assertEqual(payload["extraction_confidence"], 0.71)
        self.assertEqual(payload["extraction_metadata"]["engine"], "paddleocr")
        self.assertEqual(payload["extraction_metadata"]["engine_version"], "2.10.0")
        self.assertFalse(payload["is_system_generated"])
