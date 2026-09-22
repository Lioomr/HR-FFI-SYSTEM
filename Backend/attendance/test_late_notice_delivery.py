import base64
import dataclasses
import hashlib
import json
import unicodedata
from datetime import date, datetime, time
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pymupdf
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.base import ContentFile
from django.db import transaction
from django.test import TestCase, override_settings
from django.urls import resolve
from django.utils import timezone
from PIL import Image, ImageDraw
from pypdf import PdfReader
from reportlab.pdfbase import pdfmetrics
from rest_framework import status
from rest_framework.test import APIClient

from admin_portal.models import SystemSettings
from audit.models import AuditLog
from core.pdf import font_pair, shape_ar
from core.pdf_forms import _is_rtl, render_mapped_form
from core.services.whatsapp_service import WHATSAPP_TEMPLATE_REGISTRY, WhatsAppService
from core.services.whatsapp_template_library import (
    CAPTION_MAX_CHARS,
    DEFAULT_WHATSAPP_TEMPLATES,
    SIGNATURE,
    list_template_definitions,
)
from employees.models import EmployeeProfile
from in_app_notifications.dispatcher import _load_whatsapp_document, _send_whatsapp, dispatch_notification_channels
from in_app_notifications.i18n import MESSAGES
from in_app_notifications.models import Notification
from organization.models import OrganizationNode, UserOrganizationAccess
from organization.services import get_head_office_node
from payroll.models import AttendancePayrollDeduction, PayrollRun, PayrollRunItem
from payroll.services import finalize_attendance_deductions
from payroll.views import _generate_payroll_items

from . import late_notices
from .late_notices import (
    HR_SIGNATURE_FIELD,
    LOGO_FIELD,
    MAPPED_TEXT_FIELDS,
    WHATSAPP_TEMPLATE,
    WHATSAPP_VARIABLES,
    NoticeTemplateUnavailable,
    build_notice_values,
    issue_late_notice_for_new_violation,
    level_labels,
    load_notice_assets,
    notice_filename,
    policy_result,
    render_notice_pdf,
)
from .models import (
    AttendanceAdjustment,
    AttendanceDailyResult,
    AttendanceLateNotice,
    AttendanceLateViolation,
    AttendanceRecord,
)
from .policy import AttendancePolicyService
from .views import AttendanceNoticeViewSet


def _without_marks(value: str) -> str:
    """Drop Unicode combining marks: the PDF shaper never draws them."""
    return "".join(ch for ch in value if unicodedata.category(ch) != "Mn")


User = get_user_model()
NOTICES_URL = "/api/attendance/notices/"
TEMPLATES_DIR = Path(settings.BASE_DIR) / "static" / "pdf_templates"
CONTRACT_FIELDS = {
    "id",
    "violation_id",
    "employee_profile_id",
    "employee_name",
    "employee_code",
    "violation_date",
    "occurrence_number",
    "notice_level",
    "reference_number",
    "issued_at",
    "delivery_status",
    "delivery_message",
    "filename",
}
#: SHA-256 of the active version 3 pairs in artifacts/late-attendance-notice/v3 (CHECKSUMS.sha256).
V3_PAIR_SHA256 = {
    "late_attendance_level_1_blank_v3.pdf": "e8def8393f43a1cb5409175d086d4a9a339676ae984371167853f45d0232afdb",
    "late_attendance_level_1_field_map_v3.json": "8bfa6b06fca7e6335ed7f14886e13e4e3cd2a9141e538ca639a906b9a83a4aa6",
    "late_attendance_level_2_blank_v3.pdf": "0f476f81ce98dcb3fa94484aa1f8444557cb0f268a3dbcc02f519fec0bd1a89b",
    "late_attendance_level_2_field_map_v3.json": "9fd454e8b8b2dc62c0fabdae242c227a724b0d30b493c9345859a67006b33f12",
    "late_attendance_level_3_blank_v3.pdf": "2e5f756f93e11b08497351a41eb9f041d2d46111cd2517d3060392887105a04f",
    "late_attendance_level_3_field_map_v3.json": "61a84f501842eda6e30039ff32960ccb83cb39996cf62380aab5687fac3c6639",
    "late_attendance_level_4_blank_v3.pdf": "33821ff03c0f6891acea29a9b79c3212101b95c09169ec442293ea948d3b79af",
    "late_attendance_level_4_field_map_v3.json": "7df938fc05fd825450a81382a2527e3d8648ed3e39d1be80fa27b3ee98aabfb7",
}
#: SHA-256 of the retained version 2 pairs; they must never change.
V2_PAIR_SHA256 = {
    "late_attendance_level_1_blank_v2.pdf": "d30de7c96481d8a7fb66e07fb6c94b393d31fdb94e76beb6fe90ad2a3810c610",
    "late_attendance_level_1_field_map_v2.json": "1de3f57e8566a847f882a543cd36ca1532319bd5178c528af94428ceaa801928",
    "late_attendance_level_2_blank_v2.pdf": "d831214156cb313e2b75a88880f36b15b5ca280674841c6d204cb425482ee992",
    "late_attendance_level_2_field_map_v2.json": "82756d079bd6fe011aba5220ad64c9fe5ec187359780cefa795edf1dd7f53f32",
    "late_attendance_level_3_blank_v2.pdf": "f37b11fde211db7189c77377671382d09e37f401aafd4cb7bc79debfda375844",
    "late_attendance_level_3_field_map_v2.json": "d6a62b3bbd770471b3fac5b56fa175e8b8b136d6739d4027b6ef5033167345b6",
    "late_attendance_level_4_blank_v2.pdf": "6a1fe470bfa2bcde0c794973d66fa88fb31625bbf1c21ce5c5bf5fae8ab2230d",
    "late_attendance_level_4_field_map_v2.json": "fe6a169f8285d87eeb804e739d25307b485774d4d39a8811e183953add63906e",
}
#: SHA-256 of the retained version 1 pairs; they must never change.
V1_PAIR_SHA256 = {
    "late_attendance_level_1_blank.pdf": "84abe40cc0444501e3637eacc219409b5c2ba7c66f1228a78bf78f75f04ae02b",
    "late_attendance_level_1_blank_field_map.json": "46c3d8351ea86c2c3d7cf99cc064295d83abffc7be8d49e006a5eb50a125ca20",
    "late_attendance_level_2_blank.pdf": "47b306149996bef08e7e10968bfa171406a8709daad0ce6232af95f142afe92b",
    "late_attendance_level_2_blank_field_map.json": "e2084ac00965877a39ebb1018da7a9fb0d9e5773605cdc7fdbf4fef3e408eb97",
    "late_attendance_level_3_blank.pdf": "912bfd3801aa582ce25b358a6f453f72360364cf298c3e35e78fb3d864fb6b6b",
    "late_attendance_level_3_blank_field_map.json": "75e6775387a2f305f626b1f378947be7ac5c3b40843b52d208e33a727cbd4800",
    "late_attendance_level_4_blank.pdf": "31ee07f20f69197b2450d62f9475cb6f7852bfd7edfd0035d063cb07f6b7e455",
    "late_attendance_level_4_blank_field_map.json": "65c4fd3c023042c9b60d5cc0fa108006e62d365a1cfd1ff02de2183f76024493",
}
LEVEL_POLICY_COPY = {
    1: "Warning only - no payroll deduction.",
    2: "Formal caution - 5% daily-rate deduction.",
    3: "Serious warning - 10% daily-rate deduction.",
    4: "Critical final warning - 50% daily-rate deduction.",
}
LEVEL_POLICY_COPY_AR = {
    1: "تحذير فقط - لا يوجد خصم من الراتب.",
    2: "تنبيه رسمي - خصم بنسبة ٥٪ من الأجر اليومي.",
    3: "تحذير جاد - خصم بنسبة ١٠٪ من الأجر اليومي.",
    4: "إنذار نهائي حرج - خصم بنسبة ٥٠٪ من الأجر اليومي.",
}
#: Canonical severity taxonomy shared by the v3 PDF, the frontend, in-app titles, and WhatsApp.
CANONICAL_LEVEL_LABELS = {
    1: ("Informational Warning", "إنذار توعوي"),
    2: ("Formal Caution", "تنبيه رسمي"),
    3: ("Serious Warning", "تحذير جاد"),
    4: ("Critical Final Warning", "إنذار نهائي حرج"),
}
OLD_LEVEL_WORDING = ("Level 1", "Level 2", "Level 3", "Level 4", "المستوى", "إشعار توعوي", "إشعار التأخر")
EVOLUTION_SETTINGS = {
    "EVOLUTION_API_BASE_URL": "http://evolution-api:8080",
    "EVOLUTION_API_KEY": "evolution-key",
    "EVOLUTION_INSTANCE_NAME": "ffi-test",
}


SLOT_BACKGROUND = (0xF8, 0xFA, 0xFC)
OPAQUE_LOGO_COLOUR = (20, 117, 200)


def _png(width=240, height=80, *, transparent=False):
    buffer = BytesIO()
    if transparent:
        image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        ImageDraw.Draw(image).ellipse(
            [width // 3, height // 4, 2 * width // 3, 3 * height // 4], fill=(200, 60, 20, 255)
        )
    else:
        image = Image.new("RGB", (width, height), OPAQUE_LOGO_COLOUR)
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _close_to(rgb, expected, tolerance=3):
    return all(abs(actual - wanted) <= tolerance for actual, wanted in zip(rgb[:3], expected))


def _image_hashes(page):
    xobjects = page["/Resources"].get("/XObject") or {}
    return sorted(hashlib.sha256(xobject.get_object().get_data()).hexdigest() for xobject in xobjects.values())


def _field_rect(spec, page_height):
    """The map's bottom-left box as a PyMuPDF top-left rectangle."""
    x, y, width, height = (float(spec[key]) for key in ("x", "y", "width", "height"))
    return pymupdf.Rect(x, page_height - (y + height), x + width, page_height - y)


class LateAttendanceNoticeTestBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.company = OrganizationNode.objects.create(
            code="NOTICE", name="Notice Company", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.other_company = OrganizationNode.objects.create(
            code="NOTICE_OTHER", name="Other Notice Company", node_type=OrganizationNode.NodeType.COMPANY
        )
        self.user = self._user("employee@notice.test", "Employee", self.company)
        self.profile = self._profile(self.user, self.company, "NOTICE-001", "Notice Employee")
        settings_obj = SystemSettings.get_solo()
        settings_obj.work_day_start_time = time(9, 0)
        settings_obj.default_shift_end_time = time(18, 0)
        settings_obj.grace_window_minutes = 15
        settings_obj.post_grace_tolerance_minutes = 0
        settings_obj.save()

    def tearDown(self):
        for notice in AttendanceLateNotice.objects.all():
            notice.document.delete(save=False)
        for company in OrganizationNode.objects.filter(pk__in=[self.company.pk, self.other_company.pk]):
            if company.logo:
                company.logo.delete(save=False)
        super().tearDown()

    @staticmethod
    def _user(email, group_name, *organizations):
        user = User.objects.create_user(email=email, password="password")
        user.groups.add(Group.objects.get_or_create(name=group_name)[0])
        for organization in organizations:
            UserOrganizationAccess.objects.create(user=user, organization=organization)
        return user

    @staticmethod
    def _profile(user, company, employee_id, full_name):
        return EmployeeProfile.objects.create(
            user=user,
            company=company,
            employee_id=employee_id,
            full_name=full_name,
            department="Operations",
            job_title="Site Engineer",
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
            basic_salary=Decimal("3000.00"),
            total_salary=Decimal("3000.00"),
        )

    def _late(self, day, profile=None):
        profile = profile or self.profile
        start = timezone.make_aware(datetime.combine(day, time(9, 0)))
        AttendanceDailyResult.objects.create(
            employee_profile=profile,
            company=profile.company,
            date=day,
            shift_start_at=start,
            shift_end_at=start.replace(hour=18),
            scheduled_minutes=540,
            first_check_in_at=start.replace(minute=30),
            final_check_out_at=start.replace(hour=18),
        )
        AttendancePolicyService.reconcile_month(profile, day)
        return AttendanceLateViolation.objects.filter(employee_profile=profile, date=day).first()

    @staticmethod
    def _pdf_bytes(notice):
        notice.document.open("rb")
        try:
            return notice.document.read()
        finally:
            notice.document.close()

    def _page(self, notice):
        return PdfReader(BytesIO(self._pdf_bytes(notice))).pages[0]

    @staticmethod
    def _template_image_hashes(level):
        return _image_hashes(PdfReader(load_notice_assets(level).template_path).pages[0])

    @staticmethod
    def _generated_audit(notice):
        return AuditLog.objects.get(action="attendance_late_notice_generated", entity_id=str(notice.id))

    def _get(self, user, url, company):
        self.client.force_authenticate(user=user)
        return self.client.get(url, HTTP_X_ACTIVE_COMPANY_ID=str(company.id))


class LateNoticeTemplateTests(LateAttendanceNoticeTestBase):
    def test_version_three_pairs_are_the_approved_files_and_older_pairs_are_untouched(self):
        for filename, digest in {**V3_PAIR_SHA256, **V2_PAIR_SHA256, **V1_PAIR_SHA256}.items():
            with self.subTest(filename=filename):
                content = (TEMPLATES_DIR / filename).read_bytes()
                if filename.endswith("_field_map_v2.json"):
                    # These approved hashes were recorded on Windows. Git may
                    # check JSON out with LF on Linux; preserve the content check.
                    content = content.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
                self.assertEqual(hashlib.sha256(content).hexdigest(), digest)

        for level, copy in LEVEL_POLICY_COPY.items():
            with self.subTest(level=level):
                assets = load_notice_assets(level)
                meta = assets.meta
                self.assertEqual(Path(assets.template_path).name, f"late_attendance_level_{level}_blank_v3.pdf")
                self.assertEqual(
                    (meta["template"], meta["version"], meta["asset_revision"], meta["style"]["level"]),
                    (f"late_attendance_level_{level}_blank_v3.pdf", 3, 5, level),
                )
                self.assertEqual(meta["logo"]["background"], "opaque #F8FAFC")
                text_fields = {key for key, spec in assets.fields.items() if spec.get("kind") == "text"}
                image_fields = {key for key, spec in assets.fields.items() if spec.get("kind") == "image"}
                self.assertEqual(text_fields, set(MAPPED_TEXT_FIELDS))
                self.assertEqual(image_fields, {LOGO_FIELD, HR_SIGNATURE_FIELD})
                self.assertLessEqual(set(meta["required_keys"]), set(MAPPED_TEXT_FIELDS))
                signature = assets.fields[HR_SIGNATURE_FIELD]
                self.assertEqual((signature["auto_sign"], signature["manual_only"]), (False, True))
                self.assertEqual(meta["manual_only_fields"], [HR_SIGNATURE_FIELD])
                self.assertEqual(len(PdfReader(assets.template_path).pages), 1)
                # PDF policy result, notification text, and WhatsApp copy all equal the preprinted policy.
                preprinted = meta["preprinted_content"]
                self.assertEqual(policy_result(level), (preprinted["policy_en"], preprinted["policy_ar"]))
                self.assertEqual(preprinted["policy_en"], copy)
                self.assertEqual(MESSAGES[f"attendance.late_notice_level_{level}"]["message"][0], copy)

    def test_a_map_that_is_not_the_approved_version_three_is_refused(self):
        assets = load_notice_assets(2)
        downgraded = dataclasses.replace(assets, meta={**assets.meta, "version": 2})
        stale_revision = dataclasses.replace(assets, meta={**assets.meta, "asset_revision": 2})
        wrong_template = dataclasses.replace(
            assets, meta={**assets.meta, "template": "late_attendance_level_2_blank_v2.pdf"}
        )
        auto_signed = dataclasses.replace(
            assets,
            fields={**assets.fields, HR_SIGNATURE_FIELD: {**assets.fields[HR_SIGNATURE_FIELD], "auto_sign": True}},
        )
        for broken in (downgraded, stale_revision, wrong_template, auto_signed):
            with patch("attendance.late_notices.load_form_assets", return_value=broken):
                with self.assertRaises(NoticeTemplateUnavailable):
                    load_notice_assets(2)

    def test_v3_logo_slot_is_an_opaque_neutral_surface_without_placeholder_text(self):
        placeholders = ("Company logo", "شعار الشركة")
        for level in (1, 2, 3, 4):
            with self.subTest(level=level):
                assets = load_notice_assets(level)
                document = pymupdf.open(assets.template_path)
                try:
                    page = document[0]
                    # Arabic extracts as presentation forms; NFKC maps it back to logical letters.
                    text = unicodedata.normalize("NFKC", page.get_text())
                    for placeholder in placeholders:
                        self.assertNotIn(placeholder, text)
                    slot = _field_rect(assets.fields[LOGO_FIELD], page.rect.height)
                    self.assertEqual(page.get_text(clip=slot).strip(), "")
                    pixmap = page.get_pixmap(dpi=144, clip=slot)
                    for x, y in ((0.5, 0.5), (0.25, 0.3), (0.75, 0.7)):
                        rgb = pixmap.pixel(int(pixmap.width * x), int(pixmap.height * y))
                        self.assertTrue(_close_to(rgb, SLOT_BACKGROUND), rgb)
                finally:
                    document.close()

        # Control: the same extraction finds the placeholder printed on the retained v2 artwork.
        document = pymupdf.open(str(TEMPLATES_DIR / "late_attendance_level_1_blank_v2.pdf"))
        try:
            text = unicodedata.normalize("NFKC", document[0].get_text())
        finally:
            document.close()
        for placeholder in placeholders:
            self.assertIn(placeholder, text)

    def test_notice_titles_and_level_labels_use_the_canonical_v3_taxonomy(self):
        for level, (english, arabic) in CANONICAL_LEVEL_LABELS.items():
            with self.subTest(level=level):
                catalog = MESSAGES[f"attendance.late_notice_level_{level}"]
                self.assertEqual(level_labels(level), (english, arabic))
                self.assertEqual(
                    catalog["title"],
                    (f"Late Attendance Notice - {english}", f"إنذار التأخر في الحضور - {arabic}"),
                )
                for old in OLD_LEVEL_WORDING:
                    self.assertNotIn(old, " ".join(catalog["title"]))
                # Policy-result messages are unchanged.
                self.assertEqual(catalog["message"], (LEVEL_POLICY_COPY[level], LEVEL_POLICY_COPY_AR[level]))
                self.assertEqual(policy_result(level), (LEVEL_POLICY_COPY[level], LEVEL_POLICY_COPY_AR[level]))
                # The same labels are printed on the approved v3 artwork.
                document = pymupdf.open(load_notice_assets(level).template_path)
                try:
                    text = unicodedata.normalize("NFKC", document[0].get_text())
                finally:
                    document.close()
                for printed in ("LATE ATTENDANCE NOTICE", "إنذار التأخر في الحضور", english.upper(), arabic):
                    self.assertIn(printed, text)
                self.assertNotIn("المستوى", text)


class LateNoticeIssuanceTests(LateAttendanceNoticeTestBase):
    def test_each_occurrence_renders_on_its_v3_level_pair_with_formatted_policy_values(self):
        violations = [self._late(date(2026, 5, day)) for day in range(2, 7)]
        notices = list(AttendanceLateNotice.objects.order_by("violation__date"))

        self.assertEqual([(n.occurrence_number, n.level) for n in notices], [(1, 1), (2, 2), (3, 3), (4, 4), (5, 4)])
        self.assertEqual(
            [n.template_name for n in notices],
            [f"late_attendance_level_{level}_blank_v3.pdf" for level in (1, 2, 3, 4, 4)],
        )
        self.assertEqual({n.template_version for n in notices}, {3})
        values = [build_notice_values(notice) for notice in notices]
        self.assertEqual(
            [
                (v["occurrence_number"], v["penalty_percentage"], v["penalty_amount"], v["policy_result"])
                for v in values
            ],
            [
                ("1", "0%", "SAR 0.00", LEVEL_POLICY_COPY[1]),
                ("2", "5%", "SAR 5.00", LEVEL_POLICY_COPY[2]),
                ("3", "10%", "SAR 10.00", LEVEL_POLICY_COPY[3]),
                ("4", "50%", "SAR 50.00", LEVEL_POLICY_COPY[4]),
                ("5", "50%", "SAR 50.00", LEVEL_POLICY_COPY[4]),
            ],
        )
        # Level 1 is a warning only: no payroll deduction exists for it.
        self.assertFalse(AttendancePayrollDeduction.objects.filter(violation=violations[0]).exists())
        for notice in notices:
            with self.subTest(level=notice.level, occurrence=notice.occurrence_number):
                page = self._page(notice)
                self.assertEqual([round(float(value), 4) for value in page.mediabox], [0.0, 0.0, 595.2756, 841.8898])
                # Without a configured logo the approved artwork is unchanged: no image is added.
                self.assertEqual(_image_hashes(page), self._template_image_hashes(notice.level))
                self.assertEqual(notice.notification.message, LEVEL_POLICY_COPY[notice.level])
                self.assertEqual(
                    notice.notification.title, f"Late Attendance Notice - {CANONICAL_LEVEL_LABELS[notice.level][0]}"
                )
                self.assertEqual(self._generated_audit(notice).metadata["template_version"], 3)

    def test_occurrences_four_and_five_each_receive_their_own_level_four_notice(self):
        for day in range(2, 7):
            self._late(date(2026, 5, day))
        fourth, fifth = AttendanceLateNotice.objects.filter(level=4).order_by("occurrence_number")

        self.assertEqual((fourth.occurrence_number, fifth.occurrence_number), (4, 5))
        self.assertNotEqual(fourth.violation_id, fifth.violation_id)
        self.assertNotEqual(fourth.reference_number, fifth.reference_number)
        self.assertNotEqual(fourth.document.name, fifth.document.name)
        self.assertNotEqual(fourth.notification_id, fifth.notification_id)

    def test_rendered_values_sit_inside_their_declared_v3_fields(self):
        self._late(date(2026, 5, 2))
        self._late(date(2026, 5, 3))
        notice = AttendanceLateNotice.objects.get(occurrence_number=2)
        values = build_notice_values(notice)

        self.assertEqual(set(values), set(MAPPED_TEXT_FIELDS))
        self.assertEqual(
            {key: values[key] for key in ("company_name", "company_name_ar", "scheduled_shift_start")},
            {"company_name": "Notice Company", "company_name_ar": "Notice Company", "scheduled_shift_start": "09:00"},
        )
        self.assertEqual((values["actual_first_check_in"], values["minutes_late"]), ("09:30", "30"))
        # The policy's internal reason code is translated, never printed.
        # These are the month's first violations, so the window was still open
        # and the 09:30 arrival simply fell outside it.
        self.assertEqual(notice.violation.reason, "outside_grace")
        self.assertEqual(values["reason"], late_notices.REASON_TEXT["outside_grace"])
        # No authoritative contact data exists: optional contact fields stay empty.
        for key in ("company_phone", "company_address", "company_website", "company_email"):
            self.assertEqual(values[key], "")

        assets = load_notice_assets(2)
        rendered = pymupdf.open(stream=self._pdf_bytes(notice), filetype="pdf")
        blank = pymupdf.open(assets.template_path)
        try:
            page, blank_page = rendered[0], blank[0]
            height = page.rect.height
            blank_words = {(w[4], round(w[0], 1), round(w[1], 1)) for w in blank_page.get_text("words")}
            overlay = [w for w in page.get_text("words") if (w[4], round(w[0], 1), round(w[1], 1)) not in blank_words]
            rects = {key: _field_rect(assets.fields[key], height) for key in MAPPED_TEXT_FIELDS}
            self.assertTrue(overlay)
            for word in overlay:
                centre = pymupdf.Point((word[0] + word[2]) / 2, (word[1] + word[3]) / 2)
                self.assertTrue(any(centre in rect for rect in rects.values()), f"{word[4]!r} is outside every field")
            for key, rect in rects.items():
                with self.subTest(field=key):
                    inside = sorted(
                        (w for w in overlay if pymupdf.Point((w[0] + w[2]) / 2, (w[1] + w[3]) / 2) in rect),
                        key=lambda w: (round(w[1]), w[0]),
                    )
                    if _is_rtl(values[key]):
                        # The renderer reshapes and bidi-reorders Arabic before drawing,
                        # so extracted glyphs are presentation forms in visual (not
                        # logical) order. NFKC maps them back to logical letters; comparing
                        # the sorted character multiset sidesteps bidi word-order/attachment
                        # quirks while still proving exactly the expected text was drawn.
                        extracted = unicodedata.normalize("NFKC", "".join(w[4] for w in inside))
                        # shape_ar drops Arabic combining marks (the tanween in
                        # "متجاوزًا"), so they are never drawn and cannot be
                        # extracted. Compare the letters that are actually drawn.
                        self.assertEqual(
                            sorted(_without_marks(extracted).replace(" ", "")),
                            sorted(_without_marks(values[key]).replace(" ", "")),
                        )
                    else:
                        self.assertEqual(" ".join(w[4] for w in inside), values[key])
        finally:
            rendered.close()
            blank.close()

        with self.assertRaises(ValueError):
            render_notice_pdf(2, {**values, "hr_representative_name": "Unmapped"})

    def test_opaque_and_transparent_logos_fill_only_their_slot_and_the_hr_signature_is_never_passed(self):
        cases = (
            ("opaque", date(2026, 5, 2), _png()),
            ("transparent", date(2026, 5, 3), _png(transparent=True)),
        )
        with patch("attendance.late_notices.render_mapped_form", wraps=render_mapped_form) as renderer:
            for _, day, content in cases:
                if self.company.logo:
                    self.company.logo.delete(save=True)
                self.company.logo.save("company-logo.png", ContentFile(content), save=True)
                self._late(day)

        self.assertEqual(renderer.call_count, 2)
        for call in renderer.call_args_list:
            self.assertEqual(set(call.kwargs["signatures"]), {LOGO_FIELD})
        for kind, day, _ in cases:
            with self.subTest(logo=kind):
                notice = AttendanceLateNotice.objects.get(violation__date=day)
                self.assertTrue(notice.company_logo_configured)
                metadata = self._generated_audit(notice).metadata
                self.assertEqual(metadata["company_logo_state"], "placed")
                self.assertNotIn("organization_logos", json.dumps(metadata))

                assets = load_notice_assets(notice.level)
                rendered = pymupdf.open(stream=self._pdf_bytes(notice), filetype="pdf")
                blank = pymupdf.open(assets.template_path)
                try:
                    page = rendered[0]
                    height = page.rect.height
                    template_boxes = {tuple(round(v, 1) for v in info["bbox"]) for info in blank[0].get_image_info()}
                    added = [
                        pymupdf.Rect(info["bbox"])
                        for info in page.get_image_info()
                        if tuple(round(v, 1) for v in info["bbox"]) not in template_boxes
                    ]
                    logo_rect = _field_rect(assets.fields[LOGO_FIELD], height)
                    signature_rect = _field_rect(assets.fields[HR_SIGNATURE_FIELD], height)
                    self.assertEqual(len(added), 1)
                    self.assertTrue(logo_rect.contains(added[0]), (added[0], logo_rect))
                    self.assertFalse(added[0].intersects(signature_rect))
                    # Nothing printed shows through the logo: the v3 slot carries no text at all.
                    self.assertEqual(page.get_text(clip=logo_rect).strip(), "")
                    self.assertNotIn("Company logo", unicodedata.normalize("NFKC", page.get_text()))
                    # A transparent corner shows the neutral slot; an opaque logo covers it.
                    corner = page.get_pixmap(dpi=144, clip=added[0]).pixel(2, 2)
                    expected = SLOT_BACKGROUND if kind == "transparent" else OPAQUE_LOGO_COLOUR
                    self.assertTrue(_close_to(corner, expected), (kind, corner))
                finally:
                    rendered.close()
                    blank.close()

    def test_missing_invalid_unreadable_or_oversized_logo_keeps_the_placeholder_and_never_blocks(self):
        def configure(content):
            if self.company.logo:
                self.company.logo.delete(save=True)
            if content is not None:
                self.company.logo.save("company-logo.png", ContentFile(content), save=True)

        cases = []
        configure(None)
        cases.append(("not_configured", self._late(date(2026, 5, 2))))
        configure(b"this is not an image")
        cases.append(("invalid", self._late(date(2026, 5, 3))))
        configure(None)
        OrganizationNode.objects.filter(pk=self.company.pk).update(logo="organization_logos/missing-logo.png")
        with self.assertLogs("attendance.late_notices", level="WARNING") as logs:
            cases.append(("unreadable", self._late(date(2026, 5, 4))))
        OrganizationNode.objects.filter(pk=self.company.pk).update(logo="")
        self.company.refresh_from_db()
        configure(_png())
        with patch("attendance.late_notices.MAX_LOGO_BYTES", 16):
            cases.append(("oversized", self._late(date(2026, 5, 5))))

        for expected, violation in cases:
            with self.subTest(outcome=expected):
                self.assertEqual(violation.lifecycle, AttendanceLateViolation.Lifecycle.ACTIVE)
                notice = AttendanceLateNotice.objects.get(violation=violation)
                self.assertTrue(notice.document)
                self.assertEqual(notice.delivery_status, AttendanceLateNotice.DeliveryStatus.SCHEDULED)
                self.assertEqual(_image_hashes(self._page(notice)), self._template_image_hashes(notice.level))
                metadata = self._generated_audit(notice).metadata
                self.assertEqual(metadata["company_logo_state"], expected)
                self.assertNotIn("organization_logos", json.dumps(metadata))
        for record in logs.records:
            self.assertNotIn("missing-logo", str(vars(record)))
            self.assertNotIn(str(settings.PRIVATE_UPLOAD_ROOT), str(vars(record)))

    def test_recalculation_reuses_the_notice_without_a_new_pdf_notification_or_audit(self):
        violation = self._late(date(2026, 5, 2))
        notice = AttendanceLateNotice.objects.get()
        document_name = notice.document.name

        AttendancePolicyService.reconcile_month(self.profile, violation.date)
        AttendancePolicyService.reconcile_month(self.profile, violation.date)
        again = issue_late_notice_for_new_violation(violation)

        self.assertEqual(again.pk, notice.pk)
        self.assertEqual(AttendanceLateNotice.objects.count(), 1)
        notice.refresh_from_db()
        self.assertEqual(notice.document.name, document_name)
        self.assertEqual(Notification.objects.filter(event_key="attendance.late_notice").count(), 1)
        self.assertEqual(AuditLog.objects.filter(action="attendance_late_notice_generated").count(), 1)
        self.assertEqual(AuditLog.objects.filter(action="attendance_late_notice_delivery_scheduled").count(), 1)

    def test_existing_v1_and_v2_notices_are_never_re_rendered_replaced_backfilled_or_redelivered(self):
        first = self._late(date(2026, 5, 2))
        second = self._late(date(2026, 5, 3))
        snapshots = {}
        # Turn both notices into snapshots issued before the v3 package.
        for violation, version, template in (
            (first, 1, "late_attendance_level_1_blank.pdf"),
            (second, 2, "late_attendance_level_2_blank_v2.pdf"),
        ):
            notice = AttendanceLateNotice.objects.get(violation=violation)
            content = f"%PDF-1.4 approved version {version} snapshot".encode()
            notice.document.delete(save=False)
            notice.document.save(notice_filename(notice), ContentFile(content), save=False)
            AttendanceLateNotice.objects.filter(pk=notice.pk).update(
                document=notice.document.name, template_name=template, template_version=version
            )
            snapshots[notice.pk] = (
                version,
                template,
                content,
                notice.document.name,
                notice.notification_id,
                notice.delivery_status,
                notice.issued_at,
            )
        # A logo configured later would change any re-render; it must not reach the stored snapshots.
        self.company.logo.save("company-logo.png", ContentFile(_png()), save=True)

        with patch(
            "attendance.late_notices.dispatch_notification_channels", wraps=dispatch_notification_channels
        ) as dispatch:
            AttendancePolicyService.reconcile_month(self.profile, first.date)
            for violation in (first, second):
                self.assertIn(issue_late_notice_for_new_violation(violation).pk, snapshots)
            self._late(date(2026, 5, 4))

        for pk, (version, template, content, name, notification_id, delivery_status, issued_at) in snapshots.items():
            with self.subTest(template_version=version):
                notice = AttendanceLateNotice.objects.get(pk=pk)
                self.assertEqual((notice.template_version, notice.template_name), (version, template))
                self.assertEqual(
                    (notice.document.name, notice.notification_id, notice.delivery_status, notice.issued_at),
                    (name, notification_id, delivery_status, issued_at),
                )
                self.assertEqual(self._pdf_bytes(notice), content)
        newest = AttendanceLateNotice.objects.get(occurrence_number=3)
        self.assertEqual((newest.template_version, newest.template_name), (3, "late_attendance_level_3_blank_v3.pdf"))
        # Only the genuinely new violation was delivered.
        self.assertEqual(dispatch.call_count, 1)
        self.assertEqual(dispatch.call_args.kwargs["whatsapp_document"], {"attendance_late_notice_id": newest.id})
        self.assertEqual(AttendanceLateNotice.objects.count(), 3)
        self.assertEqual(AuditLog.objects.filter(action="attendance_late_notice_generated").count(), 3)
        self.assertEqual(AuditLog.objects.filter(action="attendance_late_notice_delivery_scheduled").count(), 3)
        self.assertEqual(Notification.objects.filter(event_key="attendance.late_notice").count(), 3)

    def test_exempt_excused_voided_and_legacy_rows_never_receive_notices(self):
        # The exempt day is in its own month, which is never reconciled again below.
        self.profile.attendance_exempt = True
        self.profile.save(update_fields=["attendance_exempt"])
        self.assertIsNone(self._late(date(2026, 3, 2)))
        self.profile.attendance_exempt = False
        self.profile.save(update_fields=["attendance_exempt"])

        AttendanceAdjustment.objects.create(
            employee_profile=self.profile,
            company=self.company,
            date=date(2026, 5, 2),
            effective_date=date(2026, 5, 2),
            kind=AttendanceAdjustment.Kind.LATE_PERMISSION,
            source_key="notice-excused",
            reason="late:approved",
        )
        self.assertIsNone(self._late(date(2026, 5, 2)))

        start = timezone.make_aware(datetime(2026, 4, 1, 9, 0))
        voided = AttendanceLateViolation.objects.create(
            employee_profile=self.profile,
            company=self.company,
            date=date(2026, 4, 1),
            result=AttendanceDailyResult.objects.create(
                employee_profile=self.profile,
                company=self.company,
                date=date(2026, 4, 1),
                shift_start_at=start,
                shift_end_at=start.replace(hour=18),
            ),
            occurrence_number=1,
            daily_rate=Decimal("100.00"),
            penalty_percent=Decimal("0"),
            penalty_amount=Decimal("0.00"),
            lifecycle=AttendanceLateViolation.Lifecycle.VOID,
        )
        self.assertIsNone(issue_late_notice_for_new_violation(voided))

        # A legacy LATE AttendanceRecord is never read by the notice workflow.
        AttendanceRecord.objects.create(
            employee_profile=self.profile,
            date=date(2026, 5, 3),
            check_in_at=timezone.make_aware(datetime(2026, 5, 3, 10, 0)),
            status=AttendanceRecord.Status.LATE,
            source=AttendanceRecord.Source.SYSTEM,
            is_late_flagged=True,
        )
        # Reconcile the month that contains the legacy row (May 2 has a calculated result).
        AttendancePolicyService.reconcile_month(self.profile, date(2026, 5, 2))

        # A violation that predates the workflow is not backfilled on recalculation.
        legacy_start = timezone.make_aware(datetime(2026, 6, 1, 9, 0))
        legacy_result = AttendanceDailyResult.objects.create(
            employee_profile=self.profile,
            company=self.company,
            date=date(2026, 6, 1),
            shift_start_at=legacy_start,
            shift_end_at=legacy_start.replace(hour=18),
            first_check_in_at=legacy_start.replace(minute=30),
        )
        AttendanceLateViolation.objects.create(
            employee_profile=self.profile,
            company=self.company,
            date=date(2026, 6, 1),
            result=legacy_result,
            occurrence_number=1,
            daily_rate=Decimal("100.00"),
            penalty_percent=Decimal("0"),
            penalty_amount=Decimal("0.00"),
            reason="post_grace_late",
        )
        AttendancePolicyService.reconcile_month(self.profile, date(2026, 6, 1))

        self.assertFalse(AttendanceLateNotice.objects.exists())
        self.assertFalse(Notification.objects.filter(event_key="attendance.late_notice").exists())

    def test_arabic_and_english_values_render_with_the_arabic_capable_font(self):
        self.profile.full_name = ""
        self.profile.full_name_en = ""
        self.profile.full_name_ar = "موظف الإشعار"
        self.profile.save(update_fields=["full_name", "full_name_en", "full_name_ar"])

        self._late(date(2026, 5, 2))
        page = self._page(AttendanceLateNotice.objects.get())
        text = page.extract_text()

        # The overlay stores shaped glyphs; text extraction maps them back to logical Arabic.
        self.assertNotEqual(shape_ar("موظف الإشعار"), "موظف الإشعار")
        self.assertIn("موظف الإشعار", unicodedata.normalize("NFKC", text))
        for english in ("NOTICE-001", "Operations", "Notice Company", "SAR 0.00", LEVEL_POLICY_COPY[1]):
            self.assertIn(english, text)
        # The overlay embeds a subset of the registered Arabic-capable TrueType face.
        regular_font, _ = font_pair()
        face_name = pdfmetrics.getFont(regular_font).face.name
        face_name = face_name.decode() if isinstance(face_name, bytes) else str(face_name)
        fonts = [str(font.get_object().get("/BaseFont")) for font in page["/Resources"]["/Font"].values()]
        self.assertTrue(any(name.endswith(f"+{face_name}") for name in fonts), (face_name, fonts))

    def test_notice_issuance_never_changes_finalized_payroll_totals(self):
        self._late(date(2026, 5, 2))
        self._late(date(2026, 5, 3))
        run = PayrollRun.objects.create(company=self.company, year=2026, month=5)
        with transaction.atomic():
            _generate_payroll_items(run)
            finalize_attendance_deductions(run)
            run.status = PayrollRun.Status.COMPLETED
            run.save(update_fields=["status", "updated_at"])
        run.refresh_from_db()
        item = PayrollRunItem.objects.get(payroll_run=run)
        before = (run.total_net, item.total_deductions, item.net_salary)
        applied = list(AttendancePayrollDeduction.objects.values_list("id", "status", "claimed_amount"))

        self._late(date(2026, 5, 4))

        run.refresh_from_db()
        item.refresh_from_db()
        self.assertEqual((run.total_net, item.total_deductions, item.net_salary), before)
        self.assertEqual(before, (Decimal("2995.00"), Decimal("5.00"), Decimal("2995.00")))
        self.assertEqual(
            list(
                AttendancePayrollDeduction.objects.filter(id__in=[row[0] for row in applied]).values_list(
                    "id", "status", "claimed_amount"
                )
            ),
            applied,
        )
        self.assertEqual(AttendanceLateNotice.objects.get(occurrence_number=3).level, 3)


class LateNoticeDeliveryTests(LateAttendanceNoticeTestBase):
    def test_notice_notification_replaces_the_violation_notification_and_audits_carry_no_paths(self):
        self._late(date(2026, 5, 2))
        notice = AttendanceLateNotice.objects.get()
        notification = notice.notification

        self.assertEqual(
            (notification.event_key, notification.action_url, notification.metadata["download_path"]),
            ("attendance.late_notice", "/employee/attendance", f"/api/attendance/notices/{notice.id}/download/"),
        )
        self.assertEqual(notice.delivery_status, AttendanceLateNotice.DeliveryStatus.SCHEDULED)
        self.assertFalse(Notification.objects.filter(event_key="attendance.late_violation").exists())
        logs = AuditLog.objects.filter(action__startswith="attendance_late_notice")
        self.assertEqual(
            set(logs.values_list("action", flat=True)),
            {"attendance_late_notice_generated", "attendance_late_notice_delivery_scheduled"},
        )
        for log in logs:
            self.assertNotIn("attendance_late_notices/", str(log.metadata))
            self.assertNotIn(str(settings.PRIVATE_UPLOAD_ROOT), str(log.metadata))

    def test_whatsapp_delivery_uses_the_dedicated_template_exact_variables_and_private_attachment(self):
        with patch(
            "attendance.late_notices.dispatch_notification_channels", wraps=dispatch_notification_channels
        ) as dispatch:
            self._late(date(2026, 5, 2))
            self._late(date(2026, 5, 3))
        notice = AttendanceLateNotice.objects.get(occurrence_number=2)
        kwargs = dispatch.call_args.kwargs
        first_variables = dispatch.call_args_list[0].kwargs["whatsapp_variables"]
        self.assertEqual(
            (first_variables["notice_level"], first_variables["notice_level_ar"]), CANONICAL_LEVEL_LABELS[1]
        )
        self.assertEqual(notice.notification.title, "Late Attendance Notice - Formal Caution")

        self.assertEqual(kwargs["whatsapp_template"], "late_attendance_notice_v1")
        self.assertEqual(kwargs["whatsapp_document"], {"attendance_late_notice_id": notice.id})
        variables = kwargs["whatsapp_variables"]
        self.assertEqual(
            list(variables),
            [
                "employee_name",
                "notice_level",
                "notice_level_ar",
                "violation_date",
                "occurrence_number",
                "reference_number",
                "policy_result",
                "policy_result_ar",
                "action_url",
            ],
        )
        self.assertEqual(
            variables,
            {
                "employee_name": "Notice Employee",
                "notice_level": "Formal Caution",
                "notice_level_ar": "تنبيه رسمي",
                "violation_date": "2026-05-03",
                "occurrence_number": "2",
                "reference_number": notice.reference_number,
                "policy_result": "Formal caution - 5% daily-rate deduction.",
                "policy_result_ar": "تنبيه رسمي - خصم بنسبة ٥٪ من الأجر اليومي.",
                "action_url": "/employee/attendance",
            },
        )

        pdf_bytes = self._pdf_bytes(notice)
        attachment = _load_whatsapp_document(kwargs["whatsapp_document"])
        self.assertEqual(attachment["file_name"], f"late_attendance_notice_{notice.reference_number}.pdf")
        self.assertEqual(base64.b64decode(attachment["document_base64"]), pdf_bytes)

        recipient = SimpleNamespace(employee_profile=SimpleNamespace(mobile="+966501234567"))
        with override_settings(**EVOLUTION_SETTINGS, FRONTEND_URL="https://app.example.com"):
            with patch("core.services.messaging_providers.requests.post") as post:
                post.return_value = Mock(status_code=201, text="", json=lambda: {"key": {"id": "notice-1"}})
                result = _send_whatsapp(
                    recipient=recipient,
                    title="",
                    message="",
                    action_url="",
                    template=kwargs["whatsapp_template"],
                    variables=variables,
                    timeout=5,
                    document=kwargs["whatsapp_document"],
                )
        self.assertTrue(result["success"], result)
        post.assert_called_once()
        self.assertIn("/message/sendMedia/", post.call_args.args[0])
        payload = post.call_args.kwargs["json"]
        self.assertEqual(base64.b64decode(payload["media"]), pdf_bytes)
        self.assertEqual(payload["fileName"], f"late_attendance_notice_{notice.reference_number}.pdf")
        caption = payload["caption"]
        self.assertTrue(caption.startswith("⚠️ *إنذار التأخر في الحضور*\n"), caption[:40])
        self.assertLess(caption.index("إنذار التأخر في الحضور"), caption.index("Late attendance notice"))
        self.assertIn("• *نوع الإنذار:* تنبيه رسمي", caption)
        self.assertIn("• *Notice type:* Formal Caution", caption)
        for old in ("إشعار تأخر في الحضور", "مستوى", "*Level:*"):
            self.assertNotIn(old, caption)
        self.assertIn("🔗 https://app.example.com/employee/attendance", caption)
        self.assertNotIn("/api/attendance/notices", caption)
        self.assertNotIn("attendance_late_notices/", caption)

    def test_notification_failure_never_blocks_attendance_and_is_audited(self):
        with patch("attendance.late_notices.dispatch_notification_channels", side_effect=RuntimeError("down")):
            violation = self._late(date(2026, 5, 2))

        self.assertEqual(violation.lifecycle, AttendanceLateViolation.Lifecycle.ACTIVE)
        self.assertEqual(AttendanceDailyResult.objects.get(date=date(2026, 5, 2)).status_input, "LATE")
        notice = AttendanceLateNotice.objects.get()
        self.assertEqual(notice.delivery_status, AttendanceLateNotice.DeliveryStatus.FAILED)
        self.assertTrue(notice.document)
        self.assertTrue(AuditLog.objects.filter(action="attendance_late_notice_delivery_failed").exists())

    def test_rendering_failure_never_blocks_attendance_and_falls_back_to_the_violation_notification(self):
        with patch("attendance.late_notices.render_mapped_form", side_effect=ValueError("broken template")):
            violation = self._late(date(2026, 5, 2))

        self.assertEqual(violation.lifecycle, AttendanceLateViolation.Lifecycle.ACTIVE)
        self.assertFalse(AttendanceLateNotice.objects.exists())
        self.assertTrue(AuditLog.objects.filter(action="attendance_late_notice_generation_failed").exists())
        self.assertTrue(Notification.objects.filter(event_key="attendance.late_violation").exists())

    def test_employee_without_an_active_user_is_skipped_but_the_notice_is_kept_for_hr(self):
        self.user.is_active = False
        self.user.save(update_fields=["is_active"])
        self._late(date(2026, 5, 2))

        notice = AttendanceLateNotice.objects.get()
        self.assertEqual(notice.delivery_status, AttendanceLateNotice.DeliveryStatus.SKIPPED)
        self.assertIsNone(notice.notification)
        self.assertTrue(AuditLog.objects.filter(action="attendance_late_notice_delivery_skipped").exists())


class LateNoticeWhatsAppTemplateTests(TestCase):
    def test_registry_and_library_declare_the_same_template_and_variable_order(self):
        spec = WHATSAPP_TEMPLATE_REGISTRY[WHATSAPP_TEMPLATE]
        definition = DEFAULT_WHATSAPP_TEMPLATES[WHATSAPP_TEMPLATE]

        self.assertEqual(WHATSAPP_TEMPLATE, "late_attendance_notice_v1")
        self.assertEqual(spec.template_name, WHATSAPP_TEMPLATE)
        self.assertEqual(spec.variable_order, WHATSAPP_VARIABLES)
        self.assertEqual(definition.key, WHATSAPP_TEMPLATE)
        self.assertEqual(definition.variables, WHATSAPP_VARIABLES)
        self.assertEqual(set(definition.sample_variables), set(WHATSAPP_VARIABLES))
        self.assertIn(WHATSAPP_TEMPLATE, [item.key for item in list_template_definitions()])

    def test_body_is_arabic_first_states_the_policy_result_and_attachment_and_has_no_pdf_url(self):
        body = DEFAULT_WHATSAPP_TEMPLATES[WHATSAPP_TEMPLATE].default_body
        for name in WHATSAPP_VARIABLES:
            self.assertIn(f"{{{{ {name} }}}}", body)
        # Approved v3 terminology: إنذار heading and captions, no إشعار or مستوى wording.
        self.assertTrue(body.startswith("⚠️ *إنذار التأخر في الحضور*\n"))
        self.assertIn("• *نوع الإنذار:* {{ notice_level_ar }}", body)
        self.assertIn("• *Notice type:* {{ notice_level }}", body)
        for old in ("إشعار تأخر في الحضور", "إشعار", "مستوى", "*Level:*"):
            self.assertNotIn(old, body)
        self.assertLess(body.index("إنذار التأخر في الحضور"), body.index("Late attendance notice"))

        service = WhatsAppService()
        for level in (1, 2, 3, 4):
            with self.subTest(level=level):
                level_en, level_ar = level_labels(level)
                result_en, result_ar = policy_result(level)
                variables = {
                    "employee_name": "Sara Ali",
                    "notice_level": level_en,
                    "notice_level_ar": level_ar,
                    "violation_date": "2026-09-14",
                    "occurrence_number": str(level),
                    "reference_number": f"LAN-FFI-00000{level}",
                    "policy_result": result_en,
                    "policy_result_ar": result_ar,
                    "action_url": "/employee/attendance",
                }
                with override_settings(FRONTEND_URL="https://app.example.com"):
                    text, error = service.render_template(template_name=WHATSAPP_TEMPLATE, template_variables=variables)

                self.assertEqual(error, "")
                arabic, english = text.index("إنذار التأخر في الحضور"), text.index("Late attendance notice")
                self.assertTrue(text.startswith("⚠️ *إنذار التأخر في الحضور*\n"), text[:40])
                self.assertIn(
                    "صدر لك إنذار تأخر في الحضور. نسختك الخاصة من الإنذار بصيغة PDF مرفقة بهذه الرسالة.", text
                )
                self.assertNotIn("إشعار", text[:english])
                self.assertLess(arabic, english)
                self.assertLess(text.index(result_ar), english)
                self.assertGreater(text.index(result_en), english)
                self.assertLess(text.index("مرفقة"), english)
                self.assertIn("private PDF copy of the notice is attached", text)
                self.assertEqual((level_en, level_ar), CANONICAL_LEVEL_LABELS[level])
                self.assertIn(f"• *نوع الإنذار:* {level_ar}", text)
                self.assertIn(f"• *Notice type:* {level_en}", text)
                for old in ("إشعار تأخر في الحضور", "إشعار التأخر", "إشعار توعوي", "مستوى", "Level"):
                    self.assertNotIn(old, text)
                self.assertTrue(text.endswith(SIGNATURE))
                self.assertIn("🔗 https://app.example.com/employee/attendance", text)
                for forbidden in ("/api/", "download", ".pdf", "attendance_late_notices"):
                    self.assertNotIn(forbidden, text)
                self.assertLessEqual(len(text), CAPTION_MAX_CHARS)

        _, error = service.render_template(
            template_name=WHATSAPP_TEMPLATE, template_variables={"employee_name": "Sara Ali"}
        )
        self.assertIn("Missing template variables", error)


class LateNoticeApiTests(LateAttendanceNoticeTestBase):
    def setUp(self):
        super().setUp()
        self.coworker = self._user("coworker@notice.test", "Employee", self.company)
        self.coworker_profile = self._profile(self.coworker, self.company, "NOTICE-002", "Coworker Person")
        self.foreign = self._user("foreign@notice.test", "Employee", self.other_company)
        self.foreign_profile = self._profile(self.foreign, self.other_company, "NOTICE-B01", "Foreign Person")
        self.hr = self._user("hr@notice.test", "HRManager", self.company, self.other_company, get_head_office_node())
        self.hr_other_only = self._user("hr-other@notice.test", "HRManager", self.other_company)
        self.admin = self._user("admin@notice.test", "SystemAdmin")

        self._late(date(2026, 5, 2))
        self._late(date(2026, 5, 2), profile=self.coworker_profile)
        self._late(date(2026, 5, 2), profile=self.foreign_profile)
        self.own = AttendanceLateNotice.objects.get(employee_profile=self.profile)
        self.coworker_notice = AttendanceLateNotice.objects.get(employee_profile=self.coworker_profile)
        self.foreign_notice = AttendanceLateNotice.objects.get(employee_profile=self.foreign_profile)

    @staticmethod
    def _ids(response):
        return {row["id"] for row in response.data["data"]["items"]}

    def test_notice_routes_are_not_captured_by_the_attendance_record_route(self):
        for url in (NOTICES_URL, f"{NOTICES_URL}7/", f"{NOTICES_URL}7/download/"):
            with self.subTest(url=url):
                self.assertIs(resolve(url).func.cls, AttendanceNoticeViewSet)

    def test_list_and_detail_expose_exactly_the_contract_fields_with_company_scope(self):
        employee_list = self._get(self.user, NOTICES_URL, self.company)
        self.assertEqual(employee_list.status_code, status.HTTP_200_OK)
        data = employee_list.data["data"]
        self.assertTrue({"items", "count", "page", "page_size"} <= set(data))
        self.assertEqual(self._ids(employee_list), {self.own.id})
        item = data["items"][0]
        self.assertEqual(set(item), CONTRACT_FIELDS)
        self.assertEqual(
            (item["violation_id"], item["employee_profile_id"], item["employee_name"], item["employee_code"]),
            (self.own.violation_id, self.profile.id, "Notice Employee", "NOTICE-001"),
        )
        self.assertEqual(
            (item["violation_date"], item["occurrence_number"], item["notice_level"], item["reference_number"]),
            ("2026-05-02", 1, 1, self.own.reference_number),
        )
        self.assertEqual(item["delivery_status"], "scheduled")
        self.assertTrue(item["delivery_message"])
        self.assertEqual(item["filename"], f"late_attendance_notice_{self.own.reference_number}.pdf")
        self.assertNotIn("attendance_late_notices/", str(employee_list.data))

        self.assertEqual(
            self._ids(self._get(self.hr, NOTICES_URL, self.company)), {self.own.id, self.coworker_notice.id}
        )
        self.assertEqual(self._ids(self._get(self.hr, NOTICES_URL, self.other_company)), {self.foreign_notice.id})
        self.assertEqual(self._get(self.hr, NOTICES_URL, get_head_office_node()).status_code, status.HTTP_403_FORBIDDEN)

        detail = self._get(self.user, f"{NOTICES_URL}{self.own.id}/", self.company)
        self.assertEqual((detail.status_code, detail.data["status"]), (status.HTTP_200_OK, "success"))
        self.assertEqual(set(detail.data["data"]), CONTRACT_FIELDS)
        self.assertEqual(
            self._get(self.user, f"{NOTICES_URL}{self.coworker_notice.id}/", self.company).status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertEqual(
            self._get(self.hr, f"{NOTICES_URL}{self.foreign_notice.id}/", self.company).status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_hr_filters_are_validated_and_never_widen_scope(self):
        self.assertEqual(
            self._ids(self._get(self.hr, f"{NOTICES_URL}?notice_level=1", self.company)),
            {self.own.id, self.coworker_notice.id},
        )
        self.assertEqual(self._ids(self._get(self.hr, f"{NOTICES_URL}?notice_level=2,3", self.company)), set())
        self.assertEqual(
            self._ids(
                self._get(self.hr, f"{NOTICES_URL}?employee_profile_id={self.coworker_profile.id}", self.company)
            ),
            {self.coworker_notice.id},
        )
        self.assertEqual(
            self._ids(self._get(self.hr, f"{NOTICES_URL}?employee_profile_id={self.foreign_profile.id}", self.company)),
            set(),
        )
        self.assertEqual(
            self._ids(self._get(self.hr, f"{NOTICES_URL}?search=coworker", self.company)), {self.coworker_notice.id}
        )
        self.assertEqual(
            self._ids(self._get(self.hr, f"{NOTICES_URL}?date_from=2026-05-02&date_to=2026-05-02", self.company)),
            {self.own.id, self.coworker_notice.id},
        )
        for query, field in (("notice_level=5", "notice_level"), ("date_from=01-05-2026", "date_from")):
            with self.subTest(query=query):
                response = self._get(self.hr, f"{NOTICES_URL}?{query}", self.company)
                self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
                self.assertIn(field, {row["field"] for row in response.data["errors"]})

    def test_download_is_private_and_limited_to_the_owner_and_active_company_hr(self):
        url = f"{NOTICES_URL}{self.own.id}/download/"

        for user, company in ((self.user, self.company), (self.hr, self.company), (self.admin, self.company)):
            with self.subTest(user=user.email):
                response = self._get(user, url, company)
                self.assertEqual(response.status_code, status.HTTP_200_OK)
                self.assertEqual(response["Content-Type"], "application/octet-stream")
                self.assertEqual(response["Cache-Control"], "private, no-store")
                self.assertEqual(response["X-Content-Type-Options"], "nosniff")
                self.assertEqual(
                    response["Content-Disposition"],
                    f'attachment; filename="late_attendance_notice_{self.own.reference_number}.pdf"',
                )
                self.assertTrue(b"".join(response.streaming_content).startswith(b"%PDF"))

        self.assertEqual(self._get(self.coworker, url, self.company).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self._get(self.hr, url, self.other_company).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self._get(self.hr_other_only, url, self.other_company).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self._get(self.hr, url, get_head_office_node()).status_code, status.HTTP_403_FORBIDDEN)
        self.client.force_authenticate(user=None)
        self.assertIn(self.client.get(url).status_code, {status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN})

        downloads = AuditLog.objects.filter(action="attendance_late_notice_downloaded", entity_id=str(self.own.id))
        self.assertEqual(downloads.count(), 3)
        for log in downloads:
            self.assertNotIn("attendance_late_notices/", str(log.metadata))
