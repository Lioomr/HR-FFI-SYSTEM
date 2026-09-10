"""The permanent-deletion invariant and its reconciliation.

    No EmployeeDocument is ever visible while its source file is missing.

A filesystem delete cannot be rolled back by a database transaction, so deletion
is two-phase: the intent (`deletion_started_at`) is committed before the file is
touched, and every read path filters flagged rows out. These tests drive each way
the two phases can come apart.
"""

from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from audit.models import AuditLog
from organization.models import OrganizationNode, UserOrganizationAccess

from .models import EmployeeDocument, EmployeeProfile
from .services.document_jobs import (
    CLEANUP_PENDING_ERROR,
    STORAGE_DELETE_ERROR,
    DocumentDeletionError,
    delete_document_permanently,
    reconcile_pending_document_deletions,
)
from .tasks import reconcile_employee_document_deletions

User = get_user_model()


class DocumentDeletionInvariantTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        hr_group, _ = Group.objects.get_or_create(name="HRManager")
        self.company = OrganizationNode.objects.create(
            code="DEL_INV", name="Deletion Invariant", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.hr = User.objects.create_user(email="inv-hr@test.com", password="password")
        self.hr.groups.add(hr_group)
        UserOrganizationAccess.objects.create(user=self.hr, organization=self.company)
        self.profile = EmployeeProfile.objects.create(
            company=self.company,
            employee_id="INV-001",
            full_name="Invariant Subject",
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

    def _list_ids(self):
        self.client.force_authenticate(self.hr)
        response = self.client.get(
            f"/api/employees/{self.profile.id}/documents/",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )
        return [item["id"] for item in response.data["data"]]

    # --- the invariant itself ------------------------------------------------

    def test_a_flagged_document_is_invisible_to_the_archive(self):
        visible = self._document()
        flagged = self._document()
        flagged.deletion_started_at = timezone.now()
        flagged.save(update_fields=["deletion_started_at"])

        self.assertEqual(self._list_ids(), [visible.id])

    def test_a_flagged_document_cannot_be_downloaded_or_deleted_again(self):
        document = self._document()
        document.deletion_started_at = timezone.now()
        document.save(update_fields=["deletion_started_at"])
        self.client.force_authenticate(self.hr)

        download = self.client.get(
            f"/api/employees/{self.profile.id}/documents/{document.id}/download/",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )
        delete = self.client.delete(
            f"/api/employees/{self.profile.id}/documents/{document.id}/",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
        )

        self.assertEqual(download.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(delete.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_flagged_document_is_not_re_extracted(self):
        from .tasks import extract_employee_document

        document = self._document()
        document.deletion_started_at = timezone.now()
        document.save(update_fields=["deletion_started_at"])

        result = extract_employee_document.apply(args=[document.id]).get()

        self.assertEqual(result["status"], "missing")

    # --- phase 2 failure: file survives, record must come back ---------------

    def test_storage_failure_restores_full_visibility_and_writes_no_audit(self):
        document = self._document()
        file_name = document.file.name
        storage = document.file.storage

        with patch("employees.storage.PrivateUploadStorage.delete", side_effect=OSError("permission denied")):
            with self.assertRaises(DocumentDeletionError) as caught:
                delete_document_permanently(document, actor=self.hr)

        self.assertEqual(str(caught.exception), STORAGE_DELETE_ERROR)
        self.assertEqual(caught.exception.status_code, 500)
        self.assertFalse(caught.exception.file_removed)
        document.refresh_from_db()
        self.assertIsNone(document.deletion_started_at)
        self.assertTrue(storage.exists(file_name))
        self.assertEqual(self._list_ids(), [document.id])
        self.assertFalse(AuditLog.objects.filter(action="employee_document_deleted").exists())

    def test_a_storage_that_reports_success_without_deleting_restores_the_record(self):
        document = self._document()

        with patch("employees.storage.PrivateUploadStorage.delete", return_value=None):
            with self.assertRaises(DocumentDeletionError):
                delete_document_permanently(document, actor=self.hr)

        document.refresh_from_db()
        self.assertIsNone(document.deletion_started_at)
        self.assertEqual(self._list_ids(), [document.id])

    # --- phase 3 failure: file gone, row must stay hidden -------------------

    def test_row_delete_failure_leaves_a_hidden_record_not_a_broken_one(self):
        document = self._document()
        file_name = document.file.name
        storage = document.file.storage

        with patch(
            "employees.services.document_jobs.delete_document_row",
            side_effect=RuntimeError("row delete failed"),
        ):
            with self.assertRaises(DocumentDeletionError) as caught:
                delete_document_permanently(document, actor=self.hr)

        self.assertEqual(str(caught.exception), CLEANUP_PENDING_ERROR)
        self.assertTrue(caught.exception.file_removed)
        # The file really is gone - this is the case a DB rollback cannot undo.
        self.assertFalse(storage.exists(file_name))
        document.refresh_from_db()
        self.assertIsNotNone(document.deletion_started_at)
        # The invariant: the row survives, but nobody can see it.
        self.assertEqual(self._list_ids(), [])

    def test_api_reports_cleanup_pending_and_still_audits_the_destruction(self):
        document = self._document()
        self.client.force_authenticate(self.hr)

        with patch(
            "employees.services.document_jobs.delete_document_row",
            side_effect=RuntimeError("row delete failed"),
        ):
            response = self.client.delete(
                f"/api/employees/{self.profile.id}/documents/{document.id}/",
                HTTP_X_ACTIVE_COMPANY_ID=str(self.company.id),
            )

        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertIn("hidden", str(response.data["errors"]).lower())
        entry = AuditLog.objects.get(action="employee_document_deleted", entity_id=str(document.id))
        self.assertEqual(entry.actor, self.hr)
        self.assertTrue(entry.metadata["cleanup_pending"])
        self.assertEqual(self._list_ids(), [])

    def test_a_hidden_record_from_a_failed_row_delete_is_swept_by_reconciliation(self):
        document = self._document()

        with patch(
            "employees.services.document_jobs.delete_document_row",
            side_effect=RuntimeError("row delete failed"),
        ):
            with self.assertRaises(DocumentDeletionError):
                delete_document_permanently(document, actor=self.hr)

        EmployeeDocument.objects.filter(pk=document.pk).update(deletion_started_at=timezone.now() - timedelta(hours=1))
        result = reconcile_pending_document_deletions()

        self.assertEqual([item["document_id"] for item in result["finished"]], [document.id])
        self.assertFalse(EmployeeDocument.objects.filter(pk=document.id).exists())

    # --- reconciliation ------------------------------------------------------

    def test_reconciliation_finishes_a_deletion_whose_file_is_already_gone(self):
        document = self._document()
        document.file.storage.delete(document.file.name)
        document.deletion_started_at = timezone.now() - timedelta(hours=1)
        document.save(update_fields=["deletion_started_at"])

        result = reconcile_pending_document_deletions()

        self.assertEqual([item["document_id"] for item in result["finished"]], [document.id])
        self.assertEqual(result["restored"], [])
        self.assertFalse(EmployeeDocument.objects.filter(pk=document.id).exists())

    def test_reconciliation_restores_a_record_whose_file_survived(self):
        document = self._document()
        document.deletion_started_at = timezone.now() - timedelta(hours=1)
        document.save(update_fields=["deletion_started_at"])

        result = reconcile_pending_document_deletions()

        document.refresh_from_db()
        self.assertEqual([item["document_id"] for item in result["restored"]], [document.id])
        self.assertIsNone(document.deletion_started_at)
        self.assertEqual(self._list_ids(), [document.id])

    def test_reconciliation_leaves_recent_deletions_alone(self):
        document = self._document()
        document.deletion_started_at = timezone.now()
        document.save(update_fields=["deletion_started_at"])

        result = reconcile_pending_document_deletions(grace_seconds=3600)

        document.refresh_from_db()
        self.assertEqual(result["finished"], [])
        self.assertEqual(result["restored"], [])
        self.assertIsNotNone(document.deletion_started_at)

    def test_reconciliation_task_audits_the_deletions_it_completes(self):
        document = self._document()
        document.file.storage.delete(document.file.name)
        document.deletion_started_at = timezone.now() - timedelta(hours=1)
        document.save(update_fields=["deletion_started_at"])

        summary = reconcile_employee_document_deletions.apply().get()

        self.assertEqual(summary["finished"], 1)
        entry = AuditLog.objects.get(action="employee_document_deleted", entity_id=str(document.id))
        self.assertIsNone(entry.actor)
        self.assertTrue(entry.metadata["reconciled"])
        self.assertEqual(entry.metadata["document_type"], "PASSPORT")
        self.assertNotIn("%PDF", str(entry.metadata))

    def test_a_second_delete_while_one_is_in_flight_is_refused(self):
        document = self._document()
        document.deletion_started_at = timezone.now()
        document.save(update_fields=["deletion_started_at"])

        with self.assertRaises(DocumentDeletionError) as caught:
            delete_document_permanently(document, actor=self.hr)

        self.assertEqual(caught.exception.status_code, 409)

    def test_successful_deletion_leaves_nothing_behind(self):
        document = self._document()
        file_name = document.file.name
        storage = document.file.storage

        snapshot = delete_document_permanently(document, actor=self.hr)

        self.assertEqual(snapshot["document_id"], document.id)
        self.assertFalse(EmployeeDocument.objects.filter(pk=document.id).exists())
        self.assertFalse(storage.exists(file_name))
        self.assertEqual(reconcile_pending_document_deletions()["finished"], [])
