"""Hash-only tamper evidence for late-attendance notices (verify-upload)."""

import base64
import hashlib
from datetime import date

import pymupdf
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from audit.models import AuditLog
from in_app_notifications.dispatcher import _load_whatsapp_document

from .models import AttendanceLateNotice
from .test_late_notice_delivery import LateAttendanceNoticeTestBase

VERIFY_URL = "/api/documents/verify-upload/"


def _edited(data: bytes) -> bytes:
    """An editor's re-save with one added word: the printed reference survives."""
    document = pymupdf.open(stream=data, filetype="pdf")
    document[0].insert_text((40, 40), "EDITED", fontsize=8)
    return document.tobytes()


class LateNoticeHashTests(LateAttendanceNoticeTestBase):
    def setUp(self):
        super().setUp()
        self.hr = self._user("hash-hr@notice.test", "HRManager", self.company)
        self.other_hr = self._user("hash-hr-other@notice.test", "HRManager", self.other_company)

    def _verify(self, user, data, company=None):
        client = APIClient()
        client.force_authenticate(user=user)
        response = client.post(
            VERIFY_URL,
            {"file": SimpleUploadedFile("notice.pdf", data, content_type="application/pdf")},
            format="multipart",
            HTTP_X_ACTIVE_COMPANY_ID=str((company or self.company).id),
        )
        self.assertEqual(response.status_code, 200, response.content)
        return response.data["data"]

    def test_issuance_hash_matches_the_stored_file_and_whatsapp_attachment(self):
        self._late(date(2026, 5, 2))
        notice = AttendanceLateNotice.objects.get(employee_profile=self.profile)
        stored = self._pdf_bytes(notice)
        self.assertEqual(notice.document_sha256, hashlib.sha256(stored).hexdigest())
        self.assertIsNotNone(notice.document_hashed_at)
        self.assertEqual(self._generated_audit(notice).metadata["document_sha256"], notice.document_sha256)
        attachment = _load_whatsapp_document({"attendance_late_notice_id": notice.id})
        sent = base64.b64decode(attachment["document_base64"])
        self.assertEqual(hashlib.sha256(sent).hexdigest(), notice.document_sha256)

    def test_exact_copy_is_frozen_valid_and_edited_copy_is_tampered(self):
        self._late(date(2026, 5, 2))
        notice = AttendanceLateNotice.objects.get(employee_profile=self.profile)
        stored = self._pdf_bytes(notice)

        exact = self._verify(self.hr, stored)
        self.assertEqual(
            exact["matched_record"], {"type": "late_notice", "id": notice.id, "reference": notice.reference_number}
        )
        self.assertEqual(exact["integrity"]["status"], "frozen_valid")
        self.assertEqual(exact["integrity"]["signing_mode"], "hash_only")
        self.assertIn("Hash-verified only", exact["summary"])

        edited = self._verify(self.hr, _edited(stored))
        self.assertEqual(edited["matched_record"]["id"], notice.id)
        self.assertEqual(edited["integrity"]["status"], "tampered")
        results = list(
            AuditLog.objects.filter(action="document_upload_verified", entity="late_notice").values_list(
                "metadata__result", flat=True
            )
        )
        self.assertEqual(sorted(results), ["frozen_valid", "tampered"])

    def test_other_company_hr_gets_no_match(self):
        self._late(date(2026, 5, 2))
        notice = AttendanceLateNotice.objects.get(employee_profile=self.profile)
        data = self._verify(self.other_hr, self._pdf_bytes(notice), company=self.other_company)
        self.assertIsNone(data["matched_record"])
        self.assertEqual(data["integrity"]["status"], "not_frozen")

    def test_unrelated_pdf_is_unchanged_not_frozen(self):
        document = pymupdf.open()
        document.new_page().insert_text((72, 72), "LAN-NOTICE-999999 unrelated")
        data = self._verify(self.hr, document.tobytes())
        self.assertIsNone(data["matched_record"])
        self.assertEqual(data["integrity"]["status"], "not_frozen")
