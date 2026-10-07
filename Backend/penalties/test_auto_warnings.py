import base64
import re
import unicodedata
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from io import BytesIO, StringIO
from unittest.mock import patch

import pymupdf
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.base import ContentFile
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from attendance.late_notices import MAPPED_TEXT_FIELDS, WHATSAPP_VARIABLES, load_notice_assets
from audit.models import AuditLog
from employees.models import EmployeeProfile
from in_app_notifications.dispatcher import _load_whatsapp_document
from in_app_notifications.i18n import notification_text
from organization.models import OrganizationNode, UserOrganizationAccess
from payroll.models import PayrollRun, PayrollRunItem

from .catalog import CATALOG
from .models import PenaltyCatalog, PenaltyDeduction, PenaltyRecord, PenaltyWarningNotice
from .payroll import sync_penalty_deductions
from .services import _rated_level, sync_attendance_candidates
from .tasks import issue_auto_warnings
from .warning_notices import AUTOMATED_REASON, build_notice_values

User = get_user_model()
AUTO = PenaltyRecord.Automation
LATER = timezone.make_aware(datetime(2026, 10, 25, 12, 0))


def _png():
    buffer = BytesIO()
    Image.new("RGB", (240, 80), (20, 117, 200)).save(buffer, format="PNG")
    return buffer.getvalue()


def _field_rect(spec, page_height):
    x, y, width, height = (float(spec[key]) for key in ("x", "y", "width", "height"))
    return pymupdf.Rect(x, page_height - (y + height), x + width, page_height - y)


@override_settings(PENALTIES_EFFECTIVE_FROM="2026-09-29", PENALTY_AUTO_WARNINGS_EFFECTIVE_FROM="2026-10-01")
class AutomaticWarningTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        for row in CATALOG:
            PenaltyCatalog.objects.update_or_create(code=row["code"], defaults=row)
        cls.company = OrganizationNode.objects.create(
            code="AUTOWARN",
            name="Auto Warning Co",
            node_type=OrganizationNode.NodeType.COMPANY,
            phone="+966110000000",
            email="hr@autowarn.test",
            website="autowarn.test",
            address="Riyadh",
        )
        cls.other_company = OrganizationNode.objects.create(
            code="AUTOWARN_OTHER", name="Other Co", node_type=OrganizationNode.NodeType.COMPANY
        )
        hr_group = Group.objects.get_or_create(name="HRManager")[0]
        cls.user = User.objects.create_user(email="autowarn@ffi.test", password="test")
        cls.profile = cls._profile(cls.user, "AW-001", "Auto Warned")
        cls.peer = User.objects.create_user(email="autowarn-peer@ffi.test", password="test")
        cls._profile(cls.peer, "AW-002", "Peer Employee")
        cls.hr = User.objects.create_user(email="autowarn-hr@ffi.test", password="test")
        cls.hr.groups.add(hr_group)
        cls.hr_profile = cls._profile(cls.hr, "AW-HR", "Hana Signer")
        for user in (cls.user, cls.peer, cls.hr):
            UserOrganizationAccess.objects.create(user=user, organization=cls.company)
        UserOrganizationAccess.objects.create(user=cls.hr, organization=cls.other_company)

    @classmethod
    def _profile(cls, user, employee_id, name):
        return EmployeeProfile.objects.create(
            user=user,
            company=cls.company,
            employee_id=employee_id,
            full_name=name,
            total_salary=Decimal("3000.00"),
            basic_salary=Decimal("3000.00"),
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )

    def tearDown(self):
        for notice in PenaltyWarningNotice.objects.all():
            notice.document.delete(save=False)
        self.company.refresh_from_db()
        if self.company.logo:
            self.company.logo.delete(save=False)
        super().tearDown()

    def _late(self, day, minutes=5):
        start = timezone.make_aware(datetime.combine(day, time(9, 0)))
        from attendance.models import AttendanceDailyResult

        result = AttendanceDailyResult.objects.create(
            employee_profile=self.profile,
            company=self.company,
            date=day,
            shift_start_at=start,
            shift_end_at=start.replace(hour=18),
            scheduled_minutes=540,
            first_check_in_at=start + timedelta(minutes=minutes),
            final_check_out_at=start.replace(hour=18),
        )
        sync_attendance_candidates(result)
        return PenaltyRecord.objects.get(attendance_result=result, source_kind="late_arrival")

    def _run(self, now=LATER):
        with patch("django.utils.timezone.now", return_value=now):
            return issue_auto_warnings()

    def _client(self, user, company=None):
        client = APIClient()
        client.force_authenticate(user)
        client.defaults["HTTP_X_ACTIVE_COMPANY_ID"] = str((company or self.company).pk)
        return client

    @staticmethod
    def _close_file(response):
        # response.close() would also fire request_finished and end the test DB connection.
        for close in response._resource_closers:
            close()

    def _hr_list_ids(self, query=""):
        response = self._client(self.hr).get(f"/api/penalties/{query}")
        self.assertEqual(response.status_code, 200, response.content)
        return [row["id"] for row in response.data["data"]["items"]]

    def test_level_mapping_shifts_printed_fines_after_three_warnings(self):
        expected = {
            "W01": [None, None, None, "5", "10", "20", "20"],
            "W02": [None, None, None, "15", "25", "50", "50"],
            "W07": [None, None, None, "1", "2", "3", "3"],
        }
        for code, values in expected.items():
            catalog = PenaltyCatalog.objects.get(code=code)
            for occurrence, value in enumerate(values, 1):
                level = _rated_level(catalog, occurrence, date(2026, 10, 5))
                with self.subTest(code=code, occurrence=occurrence):
                    self.assertEqual(level["action"], "written_warning" if value is None else "deduction")
                    self.assertEqual(level["amount_value"], value)
        # Before the rollout and for other rows the printed schedule is unchanged.
        self.assertEqual(
            _rated_level(PenaltyCatalog.objects.get(code="W01"), 2, date(2026, 9, 30))["amount_value"], "5"
        )
        self.assertEqual(
            _rated_level(PenaltyCatalog.objects.get(code="W03"), 1, date(2026, 10, 5))["amount_value"], "10"
        )
        catalog = self._client(self.user).get("/api/penalties/catalog/").data["data"]
        extra = {row["code"]: row["auto_warning_extra_levels"] for row in catalog}
        self.assertEqual((extra["W01"], extra["W02"], extra["W07"], extra["W03"]), (2, 2, 2, 0))

    @override_settings(PENALTY_AUTO_WARNINGS_EFFECTIVE_FROM="")
    def test_feature_off_keeps_existing_behaviour(self):
        record = self._late(date(2026, 10, 1))
        self.assertEqual(record.automation, "")
        self.assertEqual(self._run(), {})
        record.refresh_from_db()
        self.assertEqual(record.status, PenaltyRecord.Status.PENDING_HR_MARK)
        self.assertIn(record.pk, self._hr_list_ids())
        self.assertEqual(_rated_level(record.catalog, 2, record.occurred_on)["amount_value"], "5")
        catalog = self._client(self.user).get("/api/penalties/catalog/").data["data"]
        self.assertTrue(all(row["auto_warning_extra_levels"] == 0 for row in catalog))

    def test_effective_from_boundary_and_hidden_candidates(self):
        before = self._late(date(2026, 9, 30))
        after = self._late(date(2026, 10, 1))
        self.assertEqual((before.automation, after.automation), ("", AUTO.WARNING_PENDING))
        self.assertIn(before.pk, self._hr_list_ids())
        self.assertNotIn(after.pk, self._hr_list_ids())
        self.assertNotIn(after.pk, self._hr_list_ids("?status=pending_hr_mark"))
        self.assertIn(after.pk, self._hr_list_ids("?include_automated=true"))
        self.assertIn(after.pk, self._hr_list_ids(f"?employee_profile_id={self.profile.pk}"))
        # The aged HR queue monitor ignores candidates waiting for the system.
        PenaltyRecord.objects.filter(pk__in=[before.pk, after.pk]).update(created_at=timezone.now() - timedelta(days=8))
        with self.assertLogs("penalties.monitoring", level="WARNING") as output:
            call_command("check_aged_penalties", stdout=StringIO())
        self.assertEqual([row["id"] for row in output.records[0].candidates], [before.pk])

    def test_issue_waits_for_the_settle_delay_after_shift_end(self):
        day = date(2026, 10, 1)
        record = self._late(day)
        shift_end = timezone.make_aware(datetime.combine(day, time(18, 0)))
        self.assertEqual(self._run(shift_end + timedelta(hours=11)), {})
        record.refresh_from_db()
        self.assertEqual(record.status, PenaltyRecord.Status.PENDING_HR_MARK)
        self.assertEqual(self._run(shift_end + timedelta(hours=13))["issued"], 1)
        record.refresh_from_db()
        self.assertEqual((record.status, record.automation), (PenaltyRecord.Status.ISSUED, AUTO.WARNING_ISSUED))

    def test_chronological_warnings_then_fourth_goes_to_hr(self):
        records = [self._late(date(2026, 10, day)) for day in (5, 1, 2, 6, 4)]
        self.assertEqual(self._run(), {"issued": 3, "released": 2})
        self.assertEqual(self._run(), {})  # Re-running issues nothing twice.
        by_day = {r.occurred_on.day: r for r in PenaltyRecord.objects.filter(pk__in=[r.pk for r in records])}
        for day, occurrence in ((1, 1), (2, 2), (4, 3)):
            record = by_day[day]
            self.assertEqual(
                (record.status, record.occurrence_number, record.action, record.automation, record.amount),
                (PenaltyRecord.Status.ISSUED, occurrence, "written_warning", AUTO.WARNING_ISSUED, Decimal("0.00")),
            )
            self.assertEqual(record.resolution["decision"], "auto_warning")
            self.assertTrue(PenaltyWarningNotice.objects.filter(penalty=record).exists())
        for day in (5, 6):
            self.assertEqual((by_day[day].status, by_day[day].automation), (PenaltyRecord.Status.PENDING_HR_MARK, ""))
        self.assertEqual(PenaltyWarningNotice.objects.count(), 3)
        self.assertFalse(PenaltyDeduction.objects.exists())
        hr_ids = self._hr_list_ids()
        self.assertEqual(sorted(hr_ids), sorted([by_day[5].pk, by_day[6].pk]))
        response = self._client(self.hr).post(
            f"/api/penalties/{by_day[5].pk}/mark-disruption/",
            {"disruption": "not_disrupted", "note": "Checked"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        fourth = PenaltyRecord.objects.get(pk=by_day[5].pk)
        self.assertEqual((fourth.occurrence_number, fourth.action, fourth.amount), (4, "deduction", Decimal("5.00")))

    def test_backdated_candidate_renumbers_warnings_and_flags_the_new_fourth(self):
        for day in (2, 3, 4):
            self._late(date(2026, 10, day))
        self._run()
        backdated = self._late(date(2026, 10, 1))
        self.assertEqual(self._run(), {"issued": 1})
        rows = list(PenaltyRecord.objects.filter(catalog__code="W01").order_by("occurred_on"))
        self.assertEqual([row.occurrence_number for row in rows], [1, 2, 3, 3])
        self.assertEqual(rows[0].pk, backdated.pk)
        self.assertNotEqual((rows[1].resolution or {}).get("decision"), "manual_review")
        self.assertEqual(rows[3].resolution["decision"], "manual_review")
        self.assertEqual(rows[3].resolution["proposed_evidence"], {"expected_occurrence": 4})
        self.assertEqual(self._hr_list_ids(), [rows[3].pk])
        self.assertTrue(AuditLog.objects.filter(action="penalty_auto_warning_renumbered").exists())

    def test_render_failure_rolls_back_issue_and_releases_after_three_attempts(self):
        record = self._late(date(2026, 10, 1))
        with patch("penalties.tasks.create_notice", side_effect=RuntimeError("render failed")):
            for attempt in (1, 2, 3):
                self.assertEqual(self._run()["failed"], 1)
                record.refresh_from_db()
                self.assertEqual(record.status, PenaltyRecord.Status.PENDING_HR_MARK)
                self.assertEqual(record.occurrence_number, 0)
                self.assertEqual(record.resolution["auto_warning_failures"], attempt)
                self.assertEqual(record.automation, "" if attempt == 3 else AUTO.WARNING_PENDING)
        self.assertFalse(PenaltyWarningNotice.objects.exists())
        self.assertFalse(PenaltyDeduction.objects.exists())
        self.assertIn(record.pk, self._hr_list_ids())
        self.assertEqual(AuditLog.objects.filter(action="penalty_auto_warning_failed").count(), 3)
        self.assertEqual(self._run(), {})

    def test_pdf_uses_level_one_template_with_blank_count_and_company_details(self):
        self.company.logo.save("logo.png", ContentFile(_png()), save=False)
        self.company.late_notice_signer = self.hr_profile
        self.company.save(update_fields=["logo", "late_notice_signer"])
        record = self._late(date(2026, 10, 1), minutes=7)
        self._run()
        notice = PenaltyWarningNotice.objects.select_related("penalty").get(penalty=record)
        values = build_notice_values(notice)
        self.assertEqual(set(values), set(MAPPED_TEXT_FIELDS))
        self.assertEqual((values["occurrence_number"], values["penalty_percentage"]), ("", ""))
        self.assertEqual(values["reason"], AUTOMATED_REASON)
        self.assertIsNone(re.search(r"[A-Za-z]", values["reason"]))
        self.assertEqual(values["minutes_late"], "7")
        self.assertEqual(values["penalty_amount"], "SAR 0.00")
        self.assertEqual(values["policy_result"], "Warning only - no payroll deduction.")
        self.assertEqual(values["hr_signer_name"], "Hana Signer")
        self.assertEqual(
            (values["company_phone"], values["company_email"], values["company_website"], values["company_address"]),
            ("+966110000000", "hr@autowarn.test", "autowarn.test", "Riyadh"),
        )
        self.assertEqual(notice.reference_number, f"PWN-AUTOWARN-{record.pk:06d}")
        self.assertEqual(notice.template_name, "late_attendance_level_1_blank_v3.pdf")
        generated = AuditLog.objects.get(action="penalty_warning_notice_generated", entity_id=str(notice.pk))
        self.assertEqual(generated.metadata["company_logo_state"], "placed")
        notice.document.open("rb")
        try:
            rendered = pymupdf.open(stream=notice.document.read(), filetype="pdf")
        finally:
            notice.document.close()
        assets = load_notice_assets(1)
        blank = pymupdf.open(assets.template_path)
        page, blank_page = rendered[0], blank[0]
        text = unicodedata.normalize("NFKC", page.get_text())
        for expected in (notice.reference_number, "AW-001", "hr@autowarn.test", "+966110000000"):
            self.assertIn(expected, text)
        height = page.rect.height
        for field in ("occurrence_number", "penalty_percentage"):
            rect = _field_rect(assets.fields[field], height)
            self.assertEqual(page.get_text(clip=rect), blank_page.get_text(clip=rect), field)

    @patch("penalties.warning_notices.dispatch_notification_channels")
    def test_delivery_payload_never_states_a_count(self, dispatch):
        dispatch.return_value = {"notification": None}
        for day in (1, 2):
            self._late(date(2026, 10, day))
        self._run()
        self.assertEqual(dispatch.call_count, 2)
        for call, day in zip(dispatch.call_args_list, (1, 2)):
            payload = call.kwargs
            expected = notification_text("penalty.auto_warning", date=f"2026-10-0{day}")
            self.assertEqual((payload["title"], payload["message"]), (expected["title"], expected["message"]))
            self.assertEqual(payload["event_key"], "penalty.auto_warning")
            self.assertEqual(payload["whatsapp_template"], "late_attendance_notice_v1")
            self.assertEqual(tuple(payload["whatsapp_variables"]), WHATSAPP_VARIABLES)
            self.assertEqual(payload["whatsapp_variables"]["occurrence_number"], "-")
            notice = PenaltyWarningNotice.objects.get(penalty__occurred_on=date(2026, 10, day))
            self.assertEqual(payload["whatsapp_document"], {"penalty_warning_notice_id": notice.pk})
            self.assertNotIn("of 3", str(payload))
            self.assertEqual(notice.delivery_status, PenaltyWarningNotice.DeliveryStatus.FAILED)

    def test_whatsapp_document_loader_reads_the_stored_letter(self):
        record = self._late(date(2026, 10, 1))
        self._run()
        notice = PenaltyWarningNotice.objects.get(penalty=record)
        attachment = _load_whatsapp_document({"penalty_warning_notice_id": notice.pk})
        self.assertEqual(attachment["file_name"], f"penalty_warning_notice_{notice.reference_number}.pdf")
        self.assertTrue(base64.b64decode(attachment["document_base64"]).startswith(b"%PDF"))
        self.assertIsNone(_load_whatsapp_document({"penalty_warning_notice_id": notice.pk + 999}))
        # The employee is notified in-app with a download path, not a storage URL.
        self.assertEqual(notice.delivery_status, PenaltyWarningNotice.DeliveryStatus.SCHEDULED)
        self.assertEqual(notice.notification.metadata["download_path"], f"/api/penalties/{record.pk}/warning-notice/")

    def test_download_is_limited_to_own_letter_and_selected_company(self):
        record = self._late(date(2026, 10, 1))
        self._run()
        path = f"/api/penalties/{record.pk}/warning-notice/"
        own = self._client(self.user).get(path)
        self.assertEqual(own.status_code, 200)
        self.assertEqual(own["Cache-Control"], "private, no-store")
        self.assertEqual(own["X-Content-Type-Options"], "nosniff")
        self.assertTrue(b"".join(own.streaming_content).startswith(b"%PDF"))
        self._close_file(own)
        self.assertEqual(self._client(self.peer).get(path).status_code, 404)
        hr = self._client(self.hr).get(path)
        self._close_file(hr)
        self.assertEqual(hr.status_code, 200)
        self.assertEqual(self._client(self.hr, self.other_company).get(path).status_code, 404)
        self.assertTrue(AuditLog.objects.filter(action="penalty_warning_notice_downloaded").exists())

    def test_employee_sees_own_warning_without_count_and_hr_sees_it(self):
        record = self._late(date(2026, 10, 1))
        self._run()
        mine = self._client(self.user).get("/api/penalties/?mine=true").data["data"]["items"]
        self.assertEqual([row["id"] for row in mine], [record.pk])
        detail = self._client(self.user).get(f"/api/penalties/{record.pk}/").data["data"]
        self.assertIsNone(detail["occurrence_number"])
        self.assertEqual(detail["automation"], AUTO.WARNING_ISSUED)
        self.assertEqual(detail["warning_notice"]["download_path"], f"/api/penalties/{record.pk}/warning-notice/")
        hr_detail = self._client(self.hr).get(f"/api/penalties/{record.pk}/").data["data"]
        self.assertEqual(hr_detail["occurrence_number"], 1)

    def test_w07_keeps_unworked_wage_and_w01_has_no_deduction(self):
        w01 = self._late(date(2026, 10, 1), minutes=5)
        w07 = self._late(date(2026, 10, 2), minutes=65)
        self.assertEqual(self._run()["issued"], 2)
        w01.refresh_from_db()
        w07.refresh_from_db()
        self.assertEqual((w07.catalog.code, w07.action, w07.amount), ("W07", "written_warning", Decimal("0.00")))
        self.assertEqual(w07.extra_wage_amount, Decimal("12.04"))
        self.assertEqual(w07.total_deduction_amount, Decimal("12.04"))
        self.assertEqual(PenaltyDeduction.objects.get(penalty=w07).status, PenaltyDeduction.Status.PENDING_REVIEW)
        self.assertFalse(PenaltyDeduction.objects.filter(penalty=w01).exists())
        # HR still has a payroll decision for the unworked wage; the pure warning stays hidden.
        self.assertEqual(self._hr_list_ids(), [w07.pk])

    def test_zero_money_warning_does_not_touch_payroll(self):
        self._late(date(2026, 10, 1))
        self._run()
        run = PayrollRun.objects.create(company=self.company, year=2026, month=10, total_net=Decimal("3000.00"))
        item = PayrollRunItem.objects.create(
            payroll_run=run,
            employee_id=self.profile.employee_id,
            employee_name="Auto Warned",
            basic_salary=Decimal("3000.00"),
            net_salary=Decimal("3000.00"),
        )
        self.assertEqual(sync_penalty_deductions(run), {"claimed": 0, "released": 0})
        item.refresh_from_db()
        self.assertEqual(item.total_deductions, Decimal("0.00"))

    @patch("penalties.notifications.notify_penalty")
    @patch("penalties.warning_notices.dispatch_notification_channels")
    def test_dispute_shows_hr_and_waiver_sends_one_withdrawn_notice(self, dispatch, notify):
        record = self._late(date(2026, 10, 1))
        self._run()
        dispatch.reset_mock()
        employee = self._client(self.user)
        with self.captureOnCommitCallbacks(execute=True):
            disputed = employee.post(
                f"/api/penalties/{record.pk}/dispute/", {"reason": "I had permission"}, format="json"
            )
        self.assertEqual(disputed.status_code, 200, disputed.content)
        self.assertIn(record.pk, self._hr_list_ids())
        with self.captureOnCommitCallbacks(execute=True):
            waived = self._client(self.hr).post(
                f"/api/penalties/{record.pk}/resolve/", {"decision": "waive", "note": "Permission found"}, format="json"
            )
        self.assertEqual(waived.status_code, 200, waived.content)
        record.refresh_from_db()
        self.assertEqual((record.status, record.automation), (PenaltyRecord.Status.WAIVED, AUTO.WARNING_ISSUED))
        dispatch.assert_called_once()
        payload = dispatch.call_args.kwargs
        self.assertEqual(payload["event_key"], "penalty.warning_withdrawn")
        self.assertEqual(payload["deduplication_key"], f"penalty.warning_withdrawn:{record.pk}")
        self.assertEqual(
            payload["message"], "The late attendance warning dated 2026-10-01 has been withdrawn. No action is needed."
        )
        self.assertNotIn(record.pk, self._hr_list_ids())
        # The waiver reaches HR, while the employee receives the withdrawn notice once.
        self.assertEqual([call.args[1] for call in notify.call_args_list], ["disputed", "waived"])

    @patch("penalties.warning_notices.dispatch_notification_channels")
    def test_disappeared_evidence_waives_and_sends_withdrawn_notice_once(self, dispatch):
        record = self._late(date(2026, 10, 1))
        self._run()
        dispatch.reset_mock()
        result = record.attendance_result
        result.first_check_in_at = result.shift_start_at
        result.save(update_fields=["first_check_in_at"])
        with self.captureOnCommitCallbacks(execute=True):
            sync_attendance_candidates(result)
            sync_attendance_candidates(result)
        record.refresh_from_db()
        self.assertEqual(record.status, PenaltyRecord.Status.WAIVED)
        self.assertEqual(dispatch.call_count, 1)
        self.assertEqual(dispatch.call_args.kwargs["event_key"], "penalty.warning_withdrawn")
        # Evidence returning reopens it for HR; the withdrawn letter is never re-sent.
        result.first_check_in_at = result.shift_start_at + timedelta(minutes=5)
        result.save(update_fields=["first_check_in_at"])
        sync_attendance_candidates(result)
        record.refresh_from_db()
        self.assertEqual((record.status, record.automation), (PenaltyRecord.Status.PENDING_HR_MARK, ""))
        self.assertIn(record.pk, self._hr_list_ids())

    def test_hr_marking_a_hidden_candidate_takes_it_out_of_automation(self):
        record = self._late(date(2026, 10, 1))
        response = self._client(self.hr).post(
            f"/api/penalties/{record.pk}/mark-disruption/",
            {"disruption": "not_disrupted", "note": "Checked"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        record.refresh_from_db()
        self.assertEqual((record.status, record.automation), (PenaltyRecord.Status.ISSUED, ""))
        self.assertEqual(self._run(), {})
        self.assertFalse(PenaltyWarningNotice.objects.exists())

    def test_invalid_settings_are_reported_by_system_checks(self):
        from .checks import check_penalties_effective_from

        with override_settings(PENALTY_AUTO_WARNINGS_EFFECTIVE_FROM="tomorrow", PENALTY_AUTO_WARNING_SETTLE_HOURS="x"):
            ids = [error.id for error in check_penalties_effective_from(None)]
        self.assertEqual(ids, ["penalties.E002", "penalties.E003"])
