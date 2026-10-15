"""Hash-only tamper evidence for automatic warning letters (verify-upload)."""

import hashlib
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from unittest.mock import patch

import pymupdf
from attendance.models import BioTimeEmployeeMap
from audit.models import AuditLog
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from employees.models import EmployeeProfile
from organization.models import OrganizationNode, UserOrganizationAccess
from rest_framework.test import APIClient

from .catalog import CATALOG
from .models import PenaltyCatalog, PenaltyRecord, PenaltyWarningNotice
from .services import sync_attendance_candidates
from .tasks import issue_auto_warnings

User = get_user_model()
LATER = timezone.make_aware(datetime(2026, 10, 25, 12, 0))
VERIFY_URL = "/api/documents/verify-upload/"


def _stored(notice):
    notice.document.open("rb")
    try:
        return notice.document.read()
    finally:
        notice.document.close()


def _edited(data: bytes) -> bytes:
    """An editor's re-save with one added word: the printed reference survives."""
    document = pymupdf.open(stream=data, filetype="pdf")
    document[0].insert_text((40, 40), "EDITED", fontsize=8)
    return document.tobytes()


@override_settings(PENALTIES_EFFECTIVE_FROM="2026-09-29", PENALTY_AUTO_WARNINGS_EFFECTIVE_FROM="2026-10-01")
class WarningNoticeHashTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        for row in CATALOG:
            PenaltyCatalog.objects.update_or_create(code=row["code"], defaults=row)
        cls.company = OrganizationNode.objects.create(
            code="HASHWARN", name="Hash Warning Co", node_type=OrganizationNode.NodeType.COMPANY
        )
        cls.other_company = OrganizationNode.objects.create(
            code="HASHWARN_OTHER", name="Other Hash Co", node_type=OrganizationNode.NodeType.COMPANY
        )
        hr_group = Group.objects.get_or_create(name="HRManager")[0]
        cls.user = User.objects.create_user(email="hashwarn@ffi.test", password="test")
        cls.profile = EmployeeProfile.objects.create(
            user=cls.user,
            company=cls.company,
            employee_id="HW-001",
            full_name="Hash Warned",
            total_salary=Decimal("3000.00"),
            basic_salary=Decimal("3000.00"),
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        # Attendance penalties only apply to BioTime-mapped employees.
        BioTimeEmployeeMap.objects.create(employee_profile=cls.profile, biotime_emp_code="HW-001")
        UserOrganizationAccess.objects.create(user=cls.user, organization=cls.company)
        cls.hr = User.objects.create_user(email="hashwarn-hr@ffi.test", password="test")
        cls.hr.groups.add(hr_group)
        UserOrganizationAccess.objects.create(user=cls.hr, organization=cls.company)
        cls.other_hr = User.objects.create_user(email="hashwarn-other-hr@ffi.test", password="test")
        cls.other_hr.groups.add(hr_group)
        UserOrganizationAccess.objects.create(user=cls.other_hr, organization=cls.other_company)

    def tearDown(self):
        for notice in PenaltyWarningNotice.objects.all():
            notice.document.delete(save=False)
        super().tearDown()

    def _issue(self):
        from attendance.models import AttendanceDailyResult

        day = date(2026, 10, 1)
        start = timezone.make_aware(datetime.combine(day, time(9, 0)))
        result = AttendanceDailyResult.objects.create(
            employee_profile=self.profile,
            company=self.company,
            date=day,
            shift_start_at=start,
            shift_end_at=start.replace(hour=18),
            scheduled_minutes=540,
            first_check_in_at=start + timedelta(minutes=6),
            final_check_out_at=start.replace(hour=18),
        )
        sync_attendance_candidates(result)
        record = PenaltyRecord.objects.get(attendance_result=result, source_kind="late_arrival")
        with patch("django.utils.timezone.now", return_value=LATER):
            issue_auto_warnings()
        return PenaltyWarningNotice.objects.get(penalty=record)

    def _verify(self, user, data, company=None):
        client = APIClient()
        client.force_authenticate(user)
        response = client.post(
            VERIFY_URL,
            {"file": SimpleUploadedFile("letter.pdf", data, content_type="application/pdf")},
            format="multipart",
            HTTP_X_ACTIVE_COMPANY_ID=str((company or self.company).pk),
        )
        self.assertEqual(response.status_code, 200, response.content)
        return response.data["data"]

    def test_issuance_records_the_hash_of_the_stored_and_delivered_bytes(self):
        notice = self._issue()
        stored = _stored(notice)
        self.assertEqual(notice.document_sha256, hashlib.sha256(stored).hexdigest())
        self.assertIsNotNone(notice.document_hashed_at)
        generated = AuditLog.objects.get(action="penalty_warning_notice_generated", entity_id=str(notice.pk))
        self.assertEqual(generated.metadata["document_sha256"], notice.document_sha256)
        # The employee download serves exactly the hashed bytes.
        client = APIClient()
        client.force_authenticate(self.user)
        client.defaults["HTTP_X_ACTIVE_COMPANY_ID"] = str(self.company.pk)
        response = client.get(f"/api/penalties/{notice.penalty_id}/warning-notice/")
        downloaded = b"".join(response.streaming_content)
        for close in response._resource_closers:
            close()
        self.assertEqual(hashlib.sha256(downloaded).hexdigest(), notice.document_sha256)

    def test_exact_copy_is_frozen_valid_and_names_the_notice(self):
        notice = self._issue()
        data = self._verify(self.hr, _stored(notice))
        self.assertEqual(
            data["matched_record"],
            {
                "type": "warning_notice",
                "id": notice.pk,
                "reference": notice.reference_number,
                "penalty_id": notice.penalty_id,
            },
        )
        self.assertEqual(data["integrity"]["status"], "frozen_valid")
        self.assertEqual(data["integrity"]["signing_mode"], "hash_only")
        self.assertEqual(data["integrity"]["sha256"], notice.document_sha256)
        self.assertEqual(data["integrity"]["frozen_at"], notice.document_hashed_at.isoformat())
        self.assertEqual(data["integrity"]["signatures"], [])
        self.assertIn("Hash-verified only", data["summary"])
        log = AuditLog.objects.filter(action="document_upload_verified").latest("id")
        self.assertEqual((log.entity, log.entity_id), ("warning_notice", str(notice.pk)))
        self.assertEqual(log.metadata["result"], "frozen_valid")
        self.assertEqual(log.metadata["verification"], "hash_only")

    def test_edited_copy_with_the_printed_reference_is_tampered(self):
        notice = self._issue()
        data = self._verify(self.hr, _edited(_stored(notice)))
        self.assertEqual(data["matched_record"]["type"], "warning_notice")
        self.assertEqual(data["matched_record"]["id"], notice.pk)
        self.assertEqual(data["integrity"]["status"], "tampered")
        self.assertNotEqual(data["integrity"]["sha256"], notice.document_sha256)

    def test_other_company_hr_gets_no_match(self):
        notice = self._issue()
        for payload in (_stored(notice), _edited(_stored(notice))):
            data = self._verify(self.other_hr, payload, company=self.other_company)
            self.assertIsNone(data["matched_record"])
            self.assertEqual(data["integrity"]["status"], "not_frozen")

    def test_unhashed_older_letter_is_never_matched(self):
        notice = self._issue()
        stored = _stored(notice)
        PenaltyWarningNotice.objects.filter(pk=notice.pk).update(document_sha256="", document_hashed_at=None)
        for payload in (stored, _edited(stored)):
            data = self._verify(self.hr, payload)
            self.assertIsNone(data["matched_record"])
            self.assertEqual(data["integrity"]["status"], "not_frozen")

    def test_employee_cannot_use_verify_upload(self):
        notice = self._issue()
        client = APIClient()
        client.force_authenticate(self.user)
        response = client.post(
            VERIFY_URL,
            {"file": SimpleUploadedFile("letter.pdf", _stored(notice), content_type="application/pdf")},
            format="multipart",
            HTTP_X_ACTIVE_COMPANY_ID=str(self.company.pk),
        )
        self.assertEqual(response.status_code, 403)
