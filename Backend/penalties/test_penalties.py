from datetime import date, datetime, time, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from attendance.models import AttendanceAdjustment, AttendanceDailyResult, AttendanceLateViolation, AttendanceRecord
from attendance.policy import AttendancePolicyService
from attendance.schedule import is_working_day
from employees.models import EmployeeProfile
from organization.models import OrganizationNode, UserOrganizationAccess
from payroll.models import AttendancePayrollDeduction, PayrollRun, PayrollRunItem, Payslip
from payroll.services import sync_attendance_deductions

from .catalog import CATALOG
from .models import PenaltyCatalog, PenaltyDeduction, PenaltyRecord
from .notifications import notify_penalty
from .payroll import finalize_penalty_deductions, sync_penalty_deductions
from .services import (
    _absence_band,
    issue,
    reconcile_absence_candidates,
    sync_absence_candidates,
    sync_attendance_candidates,
)


@override_settings(PENALTIES_EFFECTIVE_FROM="2026-09-29")
class PenaltyScheduleTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        for row in CATALOG:
            PenaltyCatalog.objects.update_or_create(code=row["code"], defaults=row)
        cls.company = OrganizationNode.objects.create(
            code="PENALTY_TEST", name="Penalty test", node_type=OrganizationNode.NodeType.COMPANY
        )
        cls.user = get_user_model().objects.create_user(email="penalty@ffi.test", password="test")
        cls.profile = EmployeeProfile.objects.create(
            user=cls.user,
            company=cls.company,
            employee_id="PEN-001",
            total_salary=Decimal("3000.00"),
            basic_salary=Decimal("3000.00"),
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        cls.hr = get_user_model().objects.create_user(email="penalty-hr@ffi.test", password="test")
        cls.hr.groups.add(Group.objects.get_or_create(name="HRManager")[0])
        UserOrganizationAccess.objects.create(user=cls.hr, organization=cls.company)
        UserOrganizationAccess.objects.create(user=cls.user, organization=cls.company)

    def _result(self, day, minute):
        start = timezone.make_aware(datetime.combine(day, time(9, 0)))
        return AttendanceDailyResult.objects.create(
            employee_profile=self.profile,
            company=self.company,
            date=day,
            shift_start_at=start,
            shift_end_at=start.replace(hour=18),
            scheduled_minutes=540,
            first_check_in_at=start + timedelta(minutes=minute),
            final_check_out_at=start.replace(hour=18),
        )

    def test_catalog_covers_fifty_printed_rows_with_source_mapping(self):
        self.assertEqual(len(CATALOG), 50)
        expected = {
            *(f"W{number:02d}" for number in range(1, 17)),
            *(f"O{number:02d}" for number in range(1, 19)),
            *(f"B{number:02d}" for number in range(1, 17)),
        }
        self.assertEqual(set(PenaltyCatalog.objects.values_list("code", flat=True)), expected)
        for row in PenaltyCatalog.objects.all():
            self.assertEqual(row.source_row, int(row.code[1:]))
            self.assertIn(row.source_page, {39, 40, 41, 42})
            self.assertEqual(row.automatic, row.code.startswith("W"))
            self.assertTrue(row.title_en and row.title_ar and row.levels)

    def test_recurrence_resets_monthly_and_contract_year_but_other_rows_are_cumulative(self):
        self.profile.contract_date = date(2025, 10, 1)
        self.profile.save(update_fields=["contract_date"])

        def add(code, day):
            record = PenaltyRecord.objects.create(
                company=self.company,
                employee_profile=self.profile,
                catalog=PenaltyCatalog.objects.get(code=code),
                occurred_on=day,
                occurrence_number=0,
                action="pending",
                status=PenaltyRecord.Status.ISSUED,
                source=PenaltyRecord.Source.HR,
            )
            issue(record)
            return record.occurrence_number

        self.assertEqual((add("W03", date(2026, 9, 29)), add("W03", date(2026, 10, 1))), (1, 1))
        self.assertEqual((add("W11", date(2026, 9, 29)), add("W11", date(2026, 10, 1))), (1, 1))
        self.assertEqual((add("O01", date(2026, 9, 29)), add("O01", date(2026, 10, 1))), (1, 2))

    def test_employee_and_hr_cannot_read_records_outside_authorized_scope(self):
        other_user = get_user_model().objects.create_user(email="penalty-other@ffi.test", password="test")
        other_profile = EmployeeProfile.objects.create(
            user=other_user,
            company=self.company,
            employee_id="PEN-002",
            total_salary=Decimal("3000.00"),
            basic_salary=Decimal("3000.00"),
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        UserOrganizationAccess.objects.create(user=other_user, organization=self.company)
        other_company = OrganizationNode.objects.create(
            code="PENALTY_OTHER", name="Other penalty company", node_type=OrganizationNode.NodeType.COMPANY
        )
        third_user = get_user_model().objects.create_user(email="penalty-third@ffi.test", password="test")
        third_profile = EmployeeProfile.objects.create(
            user=third_user,
            company=other_company,
            employee_id="PEN-003",
            total_salary=Decimal("3000.00"),
            basic_salary=Decimal("3000.00"),
            employment_status=EmployeeProfile.EmploymentStatus.ACTIVE,
        )
        own = PenaltyRecord.objects.create(
            company=self.company,
            employee_profile=self.profile,
            catalog=PenaltyCatalog.objects.get(code="O01"),
            occurred_on=date(2026, 9, 29),
            occurrence_number=1,
            action="deduction",
            status=PenaltyRecord.Status.ISSUED,
            source=PenaltyRecord.Source.HR,
        )
        peer = PenaltyRecord.objects.create(
            company=self.company,
            employee_profile=other_profile,
            catalog=PenaltyCatalog.objects.get(code="O01"),
            occurred_on=date(2026, 9, 29),
            occurrence_number=1,
            action="deduction",
            status=PenaltyRecord.Status.ISSUED,
            source=PenaltyRecord.Source.HR,
        )
        foreign = PenaltyRecord.objects.create(
            company=other_company,
            employee_profile=third_profile,
            catalog=PenaltyCatalog.objects.get(code="O01"),
            occurred_on=date(2026, 9, 29),
            occurrence_number=1,
            action="deduction",
            status=PenaltyRecord.Status.ISSUED,
            source=PenaltyRecord.Source.HR,
        )
        client = APIClient()
        client.force_authenticate(self.user)
        client.defaults["HTTP_X_ACTIVE_COMPANY_ID"] = str(self.company.pk)
        listed = client.get("/api/penalties/")
        self.assertEqual(listed.status_code, 200, listed.content)
        self.assertEqual([row["id"] for row in listed.data["data"]["items"]], [own.pk])
        self.assertEqual(client.get(f"/api/penalties/{peer.pk}/").status_code, 404)
        client.force_authenticate(self.hr)
        self.assertEqual(client.get(f"/api/penalties/{foreign.pk}/").status_code, 404)
        client.defaults["HTTP_X_ACTIVE_COMPANY_ID"] = str(other_company.pk)
        self.assertEqual(client.get(f"/api/penalties/{foreign.pk}/").status_code, 403)

    def test_first_late_event_inside_legacy_grace_opens_one_new_candidate(self):
        day = date(2026, 9, 29)
        self._result(day, 5)
        AttendancePolicyService.reconcile_month(self.profile, day)
        AttendancePolicyService.reconcile_month(self.profile, day)

        candidate = PenaltyRecord.objects.get(source_kind="late_arrival")
        self.assertEqual((candidate.catalog.code, candidate.status), ("W01", PenaltyRecord.Status.PENDING_HR_MARK))
        self.assertEqual(PenaltyRecord.objects.count(), 1)
        self.assertFalse(AttendanceLateViolation.objects.filter(date=day).exists())

    def test_approved_late_permission_excludes_candidate(self):
        day = date(2026, 9, 30)
        self._result(day, 5)
        AttendanceAdjustment.objects.create(
            employee_profile=self.profile,
            company=self.company,
            date=day,
            effective_date=day,
            kind=AttendanceAdjustment.Kind.LATE_PERMISSION,
            source_key="penalty-test-permission",
            approved_minutes=0,
            reason="Approved",
        )
        AttendancePolicyService.reconcile_month(self.profile, day)
        self.assertFalse(PenaltyRecord.objects.exists())

    def test_cutover_preserves_legacy_history_before_release(self):
        old_day = date(2026, 9, 28)
        new_day = date(2026, 9, 29)
        self._result(old_day, 30)
        self._result(new_day, 30)
        AttendancePolicyService.reconcile_month(self.profile, new_day)
        self.assertTrue(AttendanceLateViolation.objects.filter(date=old_day).exists())
        self.assertFalse(AttendanceLateViolation.objects.filter(date=new_day).exists())
        self.assertTrue(PenaltyRecord.objects.filter(occurred_on=new_day).exists())
        self.assertFalse(PenaltyRecord.objects.filter(occurred_on=old_day).exists())

    def test_unapproved_and_disputed_amounts_do_not_enter_draft(self):
        catalog = PenaltyCatalog.objects.get(code="O01")
        record = PenaltyRecord.objects.create(
            company=self.company,
            employee_profile=self.profile,
            catalog=catalog,
            occurred_on=date(2026, 9, 29),
            occurrence_number=0,
            action="pending",
            status=PenaltyRecord.Status.ISSUED,
            source=PenaltyRecord.Source.HR,
        )
        issue(record)
        deduction = PenaltyDeduction.objects.get(penalty=record)
        self.assertEqual(deduction.status, PenaltyDeduction.Status.PENDING_REVIEW)
        run = PayrollRun.objects.create(company=self.company, year=2026, month=9, total_net=Decimal("3000.00"))
        item = PayrollRunItem.objects.create(
            payroll_run=run,
            employee_id=self.profile.employee_id,
            employee_name="Penalty test",
            basic_salary=Decimal("3000.00"),
            net_salary=Decimal("3000.00"),
        )
        Payslip.objects.create(
            employee=self.user,
            payroll_run=run,
            year=2026,
            month=9,
            basic_salary=Decimal("3000.00"),
            total_salary=Decimal("3000.00"),
            net_salary=Decimal("3000.00"),
        )
        self.assertEqual(sync_penalty_deductions(run)["claimed"], 0)
        deduction.status = PenaltyDeduction.Status.APPROVED
        deduction.save(update_fields=["status"])
        self.assertEqual(sync_penalty_deductions(run)["claimed"], 1)
        self.assertEqual(sync_penalty_deductions(run)["claimed"], 0)
        item.refresh_from_db()
        self.assertEqual(item.total_deductions, Decimal("10.00"))

        record.status = PenaltyRecord.Status.DISPUTED
        record.save(update_fields=["status"])
        deduction.status = PenaltyDeduction.Status.HELD
        deduction.save(update_fields=["status"])
        self.assertEqual(sync_penalty_deductions(run)["released"], 1)
        item.refresh_from_db()
        self.assertEqual(item.total_deductions, Decimal("0.00"))
        self.assertEqual(finalize_penalty_deductions(run)["applied"], 0)

    def _draft_with_item(self, month):
        run = PayrollRun.objects.create(company=self.company, year=2026, month=month, total_net=Decimal("3000.00"))
        PayrollRunItem.objects.create(
            payroll_run=run,
            employee_id=self.profile.employee_id,
            employee_name="Penalty test",
            basic_salary=Decimal("3000.00"),
            net_salary=Decimal("3000.00"),
        )
        Payslip.objects.create(
            employee=self.user,
            payroll_run=run,
            year=2026,
            month=month,
            basic_salary=Decimal("3000.00"),
            total_salary=Decimal("3000.00"),
            net_salary=Decimal("3000.00"),
        )
        return run

    def test_attendance_correction_releases_draft_but_never_rewrites_finalized_run(self):
        for day, month, finalized in ((date(2026, 9, 29), 9, False), (date(2026, 10, 1), 10, True)):
            result = self._result(day, 20)
            result.calculation_inputs = {"policy": {"working_day": True}}
            result.save(update_fields=["calculation_inputs"])
            sync_attendance_candidates(result)
            candidate = PenaltyRecord.objects.get(attendance_result=result, source_kind="late_arrival")
            issue(candidate, catalog=PenaltyCatalog.objects.get(code="W03"))
            deduction = PenaltyDeduction.objects.get(penalty=candidate)
            deduction.status = PenaltyDeduction.Status.APPROVED
            deduction.save(update_fields=["status"])
            run = self._draft_with_item(month)
            sync_penalty_deductions(run)
            if finalized:
                finalize_penalty_deductions(run)
                run.status = PayrollRun.Status.COMPLETED
                run.save(update_fields=["status"])
            before = PayrollRunItem.objects.get(payroll_run=run).total_deductions
            result.first_check_in_at = result.shift_start_at
            result.save(update_fields=["first_check_in_at"])
            sync_attendance_candidates(result)
            candidate.refresh_from_db()
            deduction.refresh_from_db()
            if finalized:
                self.assertEqual(candidate.status, PenaltyRecord.Status.APPLIED)
                self.assertEqual(candidate.resolution["decision"], "manual_review")
                self.assertEqual(deduction.status, PenaltyDeduction.Status.APPLIED)
                self.assertEqual(PayrollRunItem.objects.get(payroll_run=run).total_deductions, before)
            else:
                self.assertEqual(candidate.status, PenaltyRecord.Status.WAIVED)
                self.assertEqual(deduction.status, PenaltyDeduction.Status.VOID)
                sync_penalty_deductions(run)
                self.assertEqual(PayrollRunItem.objects.get(payroll_run=run).total_deductions, Decimal("0.00"))

    def test_late_dispute_resolution_preserves_finalized_payroll(self):
        client = APIClient()
        client.force_authenticate(self.hr)
        client.defaults["HTTP_X_ACTIVE_COMPANY_ID"] = str(self.company.pk)
        for month, decision in ((9, "uphold"), (10, "waive")):
            record = PenaltyRecord.objects.create(
                company=self.company,
                employee_profile=self.profile,
                catalog=PenaltyCatalog.objects.get(code="O01"),
                occurred_on=date(2026, month, 1),
                occurrence_number=0,
                action="pending",
                status=PenaltyRecord.Status.ISSUED,
                source=PenaltyRecord.Source.HR,
            )
            issue(record)
            deduction = PenaltyDeduction.objects.get(penalty=record)
            deduction.status = PenaltyDeduction.Status.APPROVED
            deduction.save(update_fields=["status"])
            run = self._draft_with_item(month)
            finalize_penalty_deductions(run)
            run.status = PayrollRun.Status.COMPLETED
            run.save(update_fields=["status"])
            before = PayrollRunItem.objects.get(payroll_run=run).total_deductions
            record.status = PenaltyRecord.Status.DISPUTED
            record.employee_response = {
                "decision": "disputed",
                "reason": "Please review",
                "submitted_at": timezone.now().isoformat(),
            }
            record.save(update_fields=["status", "employee_response"])
            response = client.post(
                f"/api/penalties/{record.pk}/resolve/", {"decision": decision, "note": "Reviewed"}, format="json"
            )
            self.assertEqual(response.status_code, 200, response.content)
            record.refresh_from_db()
            deduction.refresh_from_db()
            self.assertEqual(
                record.status, PenaltyRecord.Status.APPLIED if decision == "uphold" else PenaltyRecord.Status.WAIVED
            )
            self.assertEqual(deduction.status, PenaltyDeduction.Status.APPLIED)
            self.assertEqual(PayrollRunItem.objects.get(payroll_run=run).total_deductions, before)
            self.assertEqual(PayrollRun.objects.get(pk=run.pk).status, PayrollRun.Status.COMPLETED)

    def test_marking_requires_branch_or_confirmation_and_records_excuse(self):
        client = APIClient()
        client.force_authenticate(self.hr)
        client.defaults["HTTP_X_ACTIVE_COMPANY_ID"] = str(self.company.pk)
        for day, minute, expected_code in ((date(2026, 9, 29), 20, "W03"), (date(2026, 9, 30), 65, "W07")):
            result = self._result(day, minute)
            result.calculation_inputs = {"policy": {"working_day": True}}
            result.save(update_fields=["calculation_inputs"])
            sync_attendance_candidates(result)
            record = PenaltyRecord.objects.get(attendance_result=result, source_kind="late_arrival")
            wrong = "confirmed" if expected_code == "W03" else "disrupted"
            rejected = client.post(
                f"/api/penalties/{record.pk}/mark-disruption/",
                {"disruption": wrong, "note": "Checked schedule facts"},
                format="json",
            )
            self.assertEqual(rejected.status_code, 422, rejected.content)
            accepted = client.post(
                f"/api/penalties/{record.pk}/mark-disruption/",
                {
                    "disruption": "not_disrupted" if expected_code == "W03" else "confirmed",
                    "note": "Checked schedule facts",
                },
                format="json",
            )
            self.assertEqual(accepted.status_code, 200, accepted.content)
            record.refresh_from_db()
            self.assertEqual(record.catalog.code, expected_code)
            self.assertEqual(record.status, PenaltyRecord.Status.ISSUED)
        result = self._result(date(2026, 10, 1), 5)
        result.calculation_inputs = {"policy": {"working_day": True}}
        result.save(update_fields=["calculation_inputs"])
        sync_attendance_candidates(result)
        record = PenaltyRecord.objects.get(attendance_result=result, source_kind="late_arrival")
        response = client.post(
            f"/api/penalties/{record.pk}/mark-disruption/",
            {"disruption": "excused", "note": "Written permission confirmed"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        record.refresh_from_db()
        self.assertEqual(record.status, PenaltyRecord.Status.WAIVED)
        self.assertEqual(record.resolution["decision"], "excused")
        self.assertFalse(PenaltyDeduction.objects.filter(penalty=record).exists())

    def test_acknowledgement_then_late_dispute_preserves_applied_claim(self):
        record = PenaltyRecord.objects.create(
            company=self.company,
            employee_profile=self.profile,
            catalog=PenaltyCatalog.objects.get(code="O01"),
            occurred_on=date(2026, 9, 29),
            occurrence_number=0,
            action="pending",
            status=PenaltyRecord.Status.ISSUED,
            source=PenaltyRecord.Source.HR,
        )
        issue(record)
        deduction = PenaltyDeduction.objects.get(penalty=record)
        deduction.status = PenaltyDeduction.Status.APPROVED
        deduction.save(update_fields=["status"])
        run = self._draft_with_item(9)
        finalize_penalty_deductions(run)
        run.status = PayrollRun.Status.COMPLETED
        run.save(update_fields=["status"])
        before = PayrollRunItem.objects.get(payroll_run=run).total_deductions
        client = APIClient()
        client.force_authenticate(self.user)
        client.defaults["HTTP_X_ACTIVE_COMPANY_ID"] = str(self.company.pk)
        acknowledged = client.post(f"/api/penalties/{record.pk}/acknowledge/", format="json")
        self.assertEqual(acknowledged.status_code, 200, acknowledged.content)
        disputed = client.post(f"/api/penalties/{record.pk}/dispute/", {"reason": "Please reconsider"}, format="json")
        self.assertEqual(disputed.status_code, 200, disputed.content)
        record.refresh_from_db()
        deduction.refresh_from_db()
        self.assertEqual(record.status, PenaltyRecord.Status.DISPUTED)
        self.assertEqual(record.employee_response["decision"], "disputed")
        self.assertEqual(deduction.status, PenaltyDeduction.Status.APPLIED)
        self.assertEqual(PayrollRunItem.objects.get(payroll_run=run).total_deductions, before)

    def test_written_warning_with_extra_wage_uses_total_in_review_and_payroll(self):
        result = self._result(date(2026, 9, 29), 0)
        result.final_check_out_at -= timedelta(minutes=5)
        result.calculation_inputs = {"policy": {"working_day": True}}
        result.save(update_fields=["final_check_out_at", "calculation_inputs"])
        sync_attendance_candidates(result)
        record = PenaltyRecord.objects.get(attendance_result=result, source_kind="early_departure")
        issue(record)
        self.assertEqual(record.action, "written_warning")
        self.assertEqual(record.amount, Decimal("0.00"))
        self.assertEqual(record.extra_wage_amount, Decimal("0.93"))
        self.assertEqual(record.total_deduction_amount, Decimal("0.93"))
        client = APIClient()
        client.force_authenticate(self.hr)
        client.defaults["HTTP_X_ACTIVE_COMPANY_ID"] = str(self.company.pk)
        review = client.post(
            f"/api/penalties/{record.pk}/payroll-review/",
            {"decision": "approve", "note": "Source allowance checked"},
            format="json",
        )
        self.assertEqual(review.status_code, 200, review.content)
        run = self._draft_with_item(9)
        self.assertEqual(sync_penalty_deductions(run)["claimed"], 1)
        self.assertEqual(PayrollRunItem.objects.get(payroll_run=run).total_deductions, Decimal("0.93"))

    def _approved_fine(self, fine, extra=Decimal("0.00")):
        record = PenaltyRecord.objects.create(
            company=self.company,
            employee_profile=self.profile,
            catalog=PenaltyCatalog.objects.get(code="O01"),
            occurred_on=date(2026, 9, 29),
            occurrence_number=1,
            action="deduction",
            amount=fine,
            extra_wage_amount=extra,
            total_deduction_amount=fine + extra,
            status=PenaltyRecord.Status.ISSUED,
            source=PenaltyRecord.Source.HR,
        )
        return PenaltyDeduction.objects.create(
            penalty=record,
            company=self.company,
            employee_profile=self.profile,
            intended_year=2026,
            intended_month=9,
            amount=fine + extra,
            status=PenaltyDeduction.Status.APPROVED,
        )

    def _pending_legacy_fine(self, amount):
        result = self._result(date(2026, 9, 28), 5)
        violation = AttendanceLateViolation.objects.create(
            employee_profile=self.profile,
            company=self.company,
            date=result.date,
            result=result,
            occurrence_number=2,
            daily_rate=Decimal("100.00"),
            penalty_percent=Decimal("1.0000"),
            penalty_amount=amount,
        )
        return AttendancePayrollDeduction.objects.create(
            violation=violation,
            company=self.company,
            employee_profile=self.profile,
            intended_year=2026,
            intended_month=9,
            amount=amount,
            status=AttendancePayrollDeduction.Status.PENDING,
        )

    def test_fines_over_monthly_five_day_budget_defer_as_whole_until_later_draft(self):
        first = self._approved_fine(Decimal("300.00"), Decimal("7.00"))
        deferred = self._approved_fine(Decimal("250.00"), Decimal("9.00"))
        unworked_time = self._approved_fine(Decimal("0.00"), Decimal("20.00"))
        september = self._draft_with_item(9)
        self.assertEqual(sync_penalty_deductions(september)["claimed"], 2)
        self.assertEqual(sync_penalty_deductions(september)["claimed"], 0)
        self.assertEqual(PayrollRunItem.objects.get(payroll_run=september).total_deductions, Decimal("327.00"))
        deferred.refresh_from_db()
        unworked_time.refresh_from_db()
        self.assertEqual(deferred.status, PenaltyDeduction.Status.APPROVED)
        self.assertIsNone(deferred.payroll_run_id)
        self.assertEqual(unworked_time.status, PenaltyDeduction.Status.CLAIMED)
        finalize_penalty_deductions(september)
        september.status = PayrollRun.Status.COMPLETED
        september.save(update_fields=["status"])
        october = self._draft_with_item(10)
        self.assertEqual(sync_penalty_deductions(october)["claimed"], 1)
        self.assertEqual(PayrollRunItem.objects.get(payroll_run=october).total_deductions, Decimal("259.00"))
        first.refresh_from_db()
        self.assertEqual(first.status, PenaltyDeduction.Status.APPLIED)

    def test_legacy_fine_consumes_budget_but_extra_wage_does_not(self):
        result = self._result(date(2026, 9, 28), 5)
        violation = AttendanceLateViolation.objects.create(
            employee_profile=self.profile,
            company=self.company,
            date=result.date,
            result=result,
            occurrence_number=2,
            daily_rate=Decimal("100.00"),
            penalty_percent=Decimal("4.0000"),
            penalty_amount=Decimal("400.00"),
        )
        run = self._draft_with_item(9)
        item = PayrollRunItem.objects.get(payroll_run=run)
        item.total_deductions = Decimal("400.00")
        item.net_salary = Decimal("2600.00")
        item.save(update_fields=["total_deductions", "net_salary"])
        AttendancePayrollDeduction.objects.create(
            violation=violation,
            company=self.company,
            employee_profile=self.profile,
            intended_year=2026,
            intended_month=9,
            amount=Decimal("400.00"),
            claimed_amount=Decimal("400.00"),
            status=AttendancePayrollDeduction.Status.CLAIMED,
            payroll_run=run,
            payroll_run_item=item,
        )
        blocked = self._approved_fine(Decimal("120.00"))
        extra_only = self._approved_fine(Decimal("0.00"), Decimal("20.00"))
        self.assertEqual(sync_penalty_deductions(run)["claimed"], 1)
        blocked.refresh_from_db()
        extra_only.refresh_from_db()
        self.assertEqual(blocked.status, PenaltyDeduction.Status.APPROVED)
        self.assertEqual(extra_only.status, PenaltyDeduction.Status.CLAIMED)
        self.assertEqual(PayrollRunItem.objects.get(payroll_run=run).total_deductions, Decimal("420.00"))

    def test_legacy_single_fine_over_five_days_is_deferred(self):
        legacy = self._pending_legacy_fine(Decimal("600.00"))
        run = self._draft_with_item(9)
        self.assertEqual(sync_attendance_deductions(run)["claimed"], 0)
        legacy.refresh_from_db()
        self.assertEqual(legacy.status, AttendancePayrollDeduction.Status.PENDING)
        self.assertIsNone(legacy.payroll_run_id)
        self.assertEqual(PayrollRunItem.objects.get(payroll_run=run).total_deductions, Decimal("0.00"))

    def test_new_claim_first_reserves_fine_budget_against_legacy(self):
        new = self._approved_fine(Decimal("300.00"), Decimal("20.00"))
        legacy = self._pending_legacy_fine(Decimal("250.00"))
        run = self._draft_with_item(9)
        self.assertEqual(sync_penalty_deductions(run)["claimed"], 1)
        self.assertEqual(sync_attendance_deductions(run)["claimed"], 0)
        self.assertEqual(sync_attendance_deductions(run)["claimed"], 0)
        legacy.refresh_from_db()
        new.refresh_from_db()
        self.assertEqual(
            (legacy.status, new.status), (AttendancePayrollDeduction.Status.PENDING, PenaltyDeduction.Status.CLAIMED)
        )
        self.assertEqual(PayrollRunItem.objects.get(payroll_run=run).total_deductions, Decimal("320.00"))

    def test_legacy_claim_first_reserves_fine_budget_against_new(self):
        new = self._approved_fine(Decimal("300.00"), Decimal("20.00"))
        legacy = self._pending_legacy_fine(Decimal("250.00"))
        run = self._draft_with_item(9)
        self.assertEqual(sync_attendance_deductions(run)["claimed"], 1)
        self.assertEqual(sync_penalty_deductions(run)["claimed"], 0)
        self.assertEqual(sync_penalty_deductions(run)["claimed"], 0)
        legacy.refresh_from_db()
        new.refresh_from_db()
        self.assertEqual(
            (legacy.status, new.status), (AttendancePayrollDeduction.Status.CLAIMED, PenaltyDeduction.Status.APPROVED)
        )
        self.assertEqual(PayrollRunItem.objects.get(payroll_run=run).total_deductions, Decimal("250.00"))

    def test_one_fine_cannot_exceed_five_days_wages(self):
        catalog = PenaltyCatalog.objects.get(code="O01")
        catalog.levels = [
            {"occurrence": 1, "action": "deduction", "amount_basis": "daily_wage_days", "amount_value": "6"}
        ]
        catalog.save(update_fields=["levels"])
        record = PenaltyRecord.objects.create(
            company=self.company,
            employee_profile=self.profile,
            catalog=catalog,
            occurred_on=date(2026, 9, 29),
            occurrence_number=0,
            action="pending",
            status=PenaltyRecord.Status.ISSUED,
            source=PenaltyRecord.Source.HR,
        )
        with self.assertRaisesRegex(ValueError, "five days"):
            issue(record)
        self.assertFalse(PenaltyDeduction.objects.filter(penalty=record).exists())

    @patch("penalties.notifications.dispatch_notification_channels")
    def test_notification_uses_dispatcher_with_private_summary_and_company_link(self, dispatch):
        record = PenaltyRecord.objects.create(
            company=self.company,
            employee_profile=self.profile,
            catalog=PenaltyCatalog.objects.get(code="B01"),
            occurred_on=date(2026, 9, 29),
            occurrence_number=1,
            action="deduction",
            amount=Decimal("100.00"),
            total_deduction_amount=Decimal("100.00"),
            status=PenaltyRecord.Status.ISSUED,
            source=PenaltyRecord.Source.HR,
            note="Sensitive investigation narrative",
        )
        notify_penalty(record, "issued")
        dispatch.assert_called_once()
        payload = dispatch.call_args.kwargs
        self.assertEqual(payload["company"], self.company)
        self.assertEqual(payload["action_url"], f"/employee/penalties/{record.pk}")
        self.assertEqual(payload["whatsapp_template"], "request_status_update")
        self.assertNotIn(record.catalog.title_en, str(payload))
        self.assertNotIn(record.note, str(payload))

    def test_absence_spell_advances_one_candidate_and_reclassifies_after_correction(self):
        days = []
        current = date(2026, 9, 29)
        through = current + timedelta(days=6)
        while current <= through:
            if is_working_day(self.profile, current):
                days.append(current)
            current += date.resolution
        rows = [
            AttendanceRecord.objects.create(
                employee_profile=self.profile,
                date=day,
                source=AttendanceRecord.Source.SYSTEM,
                status=AttendanceRecord.Status.ABSENT,
            )
            for day in days
        ]
        for row in rows:
            sync_absence_candidates([row])
        candidate = PenaltyRecord.objects.get(source_kind="absence")
        self.assertEqual(candidate.catalog.code, "W13")
        self.assertEqual(candidate.evidence["absence_days"], len(rows))
        self.assertEqual(candidate.evidence["continuous_calendar_days"], 7)

        rows[-1].status = AttendanceRecord.Status.PRESENT
        with self.captureOnCommitCallbacks(execute=True):
            rows[-1].save(update_fields=["status"])
        reconcile_absence_candidates(self.profile, rows[-1].date)
        candidate.refresh_from_db()
        self.assertEqual(candidate.catalog.code, "W12")
        self.assertEqual(candidate.evidence["absence_days"], len(rows) - 1)
        self.assertEqual(candidate.evidence["continuous_calendar_days"], (rows[-2].date - rows[0].date).days + 1)
        self.assertEqual(candidate.status, PenaltyRecord.Status.PENDING_HR_MARK)

        with self.captureOnCommitCallbacks(execute=True):
            for row in rows[1:]:
                row.status = AttendanceRecord.Status.PRESENT
                row.save(update_fields=["status"])
        reconcile_absence_candidates(self.profile, rows[-1].date)
        candidate.refresh_from_db()
        self.assertEqual(candidate.catalog.code, "W11")
        self.assertEqual(candidate.evidence["absence_days"], 1)
        self.assertEqual(candidate.evidence["continuous_calendar_days"], 1)

    def test_off_days_bridge_calendar_spell_but_never_supply_absence_evidence(self):
        self.profile.is_saudi = True
        self.profile.save(update_fields=["is_saudi"])
        start = date(2026, 9, 29)
        pair = None
        for offset in range(20):
            first = start + timedelta(days=offset)
            later = first + timedelta(days=3)
            if (
                is_working_day(self.profile, first)
                and is_working_day(self.profile, later)
                and all(not is_working_day(self.profile, first + timedelta(days=gap)) for gap in (1, 2))
            ):
                pair = first, later
                break
        self.assertIsNotNone(pair)
        first, later = pair
        off_day = first + timedelta(days=1)
        false_absence = AttendanceRecord.objects.create(
            employee_profile=self.profile,
            date=off_day,
            source=AttendanceRecord.Source.SYSTEM,
            status=AttendanceRecord.Status.ABSENT,
        )
        sync_absence_candidates([false_absence])
        self.assertFalse(PenaltyRecord.objects.exists())
        for day in (first, later):
            row = AttendanceRecord.objects.create(
                employee_profile=self.profile,
                date=day,
                source=AttendanceRecord.Source.SYSTEM,
                status=AttendanceRecord.Status.ABSENT,
            )
            sync_absence_candidates([row])
        candidate = PenaltyRecord.objects.get(source_kind="absence")
        self.assertEqual(candidate.catalog.code, "W12")
        self.assertEqual(candidate.evidence["continuous_calendar_days"], 4)
        self.assertEqual(candidate.evidence["absence_days"], 2)
        self.assertEqual(candidate.evidence["contract_year_absence_days"], 2)

    def test_calendar_day_fifteen_has_no_new_band_and_day_sixteen_opens_w15(self):
        start = date(2026, 9, 29)
        for offset in range(16):
            day = start + timedelta(days=offset)
            if not is_working_day(self.profile, day):
                continue
            row = AttendanceRecord.objects.create(
                employee_profile=self.profile,
                date=day,
                source=AttendanceRecord.Source.SYSTEM,
                status=AttendanceRecord.Status.ABSENT,
            )
            sync_absence_candidates([row])
            if offset == 14:
                candidate = PenaltyRecord.objects.get(source_kind="absence")
                self.assertEqual(candidate.catalog.code, "W14")
            if offset == 15:
                candidate = PenaltyRecord.objects.get(source_kind="absence")
                self.assertEqual(candidate.catalog.code, "W15")
                self.assertEqual(candidate.evidence["continuous_calendar_days"], 16)
        self.assertEqual(PenaltyRecord.objects.filter(source_kind="absence").count(), 1)

    def test_w16_intermittent_total_still_applies_on_continuous_day_fifteen(self):
        self.assertIsNone(_absence_band(15, 30))
        self.assertEqual(_absence_band(15, 31), "W16")
        self.assertEqual(_absence_band(16, 31), "W15")

    def test_issued_absence_band_uses_full_spell_not_threshold_anchor_on_correction(self):
        start = date(2026, 10, 6)
        unrelated = AttendanceRecord.objects.create(
            employee_profile=self.profile,
            date=date(2026, 9, 29),
            source=AttendanceRecord.Source.SYSTEM,
            status=AttendanceRecord.Status.ABSENT,
        )
        rows = []
        for offset in range(8):
            day = start + timedelta(days=offset)
            if not is_working_day(self.profile, day):
                continue
            row = AttendanceRecord.objects.create(
                employee_profile=self.profile,
                date=day,
                source=AttendanceRecord.Source.SYSTEM,
                status=AttendanceRecord.Status.ABSENT,
            )
            rows.append(row)
            sync_absence_candidates([row])
            if offset == 5:
                issued_w12 = PenaltyRecord.objects.get(
                    source_kind="absence", status=PenaltyRecord.Status.PENDING_HR_MARK
                )
                self.assertEqual(issued_w12.catalog.code, "W12")
                issue(issued_w12)
        issued_w13 = PenaltyRecord.objects.get(source_kind="absence", status=PenaltyRecord.Status.PENDING_HR_MARK)
        self.assertEqual(issued_w13.catalog.code, "W13")
        self.assertGreater(issued_w13.attendance_record.date, rows[0].date)
        issue(issued_w13)
        self.assertEqual(issued_w13.evidence["continuous_calendar_days"], 8)
        self.assertEqual(issued_w13.evidence["spell_start_on"], start.isoformat())

        # A correction to a separate, earlier day triggers reconciliation but
        # must not measure W13 from its later threshold anchor.
        unrelated.status = AttendanceRecord.Status.PRESENT
        with self.captureOnCommitCallbacks(execute=True):
            unrelated.save(update_fields=["status"])
        reconcile_absence_candidates(self.profile, unrelated.date)
        issued_w12.refresh_from_db()
        issued_w13.refresh_from_db()
        self.assertEqual(issued_w12.status, PenaltyRecord.Status.ISSUED)
        self.assertEqual(issued_w13.status, PenaltyRecord.Status.ISSUED)
        self.assertEqual(PenaltyRecord.objects.filter(source_kind="absence").count(), 2)

        # Removing the W13 threshold anchor genuinely breaks support.
        anchor = issued_w13.attendance_record
        anchor.status = AttendanceRecord.Status.PRESENT
        with self.captureOnCommitCallbacks(execute=True):
            anchor.save(update_fields=["status"])
        reconcile_absence_candidates(self.profile, anchor.date)
        issued_w13.refresh_from_db()
        self.assertEqual(issued_w13.status, PenaltyRecord.Status.WAIVED)
        self.assertEqual(PenaltyDeduction.objects.get(penalty=issued_w13).status, PenaltyDeduction.Status.VOID)

    def test_anniversary_cycle_ignores_multiyear_expiry_and_missing_dates_use_rollout(self):
        from .services import _next_occurrence, penalty_year_cycle

        self.profile.contract_date = date(2024, 10, 1)
        self.profile.contract_expiry = date(2028, 10, 1)
        self.assertEqual(penalty_year_cycle(self.profile, date(2026, 9, 30)), (date(2025, 10, 1), date(2026, 9, 30)))
        self.assertEqual(penalty_year_cycle(self.profile, date(2026, 10, 1)), (date(2026, 10, 1), date(2027, 9, 30)))
        self.profile.contract_date = self.profile.hire_date = None
        self.profile.save(update_fields=["contract_date", "hire_date"])
        catalog = PenaltyCatalog.objects.get(code="W11")
        record = PenaltyRecord.objects.create(
            company=self.company,
            employee_profile=self.profile,
            catalog=catalog,
            occurred_on=date(2026, 9, 29),
            occurrence_number=0,
            action="pending",
            status="pending_hr_mark",
            source="hr",
        )
        issue(record)
        self.assertEqual(_next_occurrence(self.profile, catalog, date(2026, 10, 1)), 2)

    def test_create_rejects_nonobject_inactive_and_missing_salary(self):
        client = APIClient()
        client.force_authenticate(self.hr)
        client.defaults["HTTP_X_ACTIVE_COMPANY_ID"] = str(self.company.pk)
        for body in ([], "bad", 3):
            self.assertEqual(client.post("/api/penalties/", body, format="json").status_code, 422)
        body = {
            "employee_profile_id": self.profile.pk,
            "occurred_on": "2026-09-29",
            "catalog_code": "O01",
            "note": "Incident",
        }
        for state in (
            EmployeeProfile.EmploymentStatus.TERMINATED,
            EmployeeProfile.EmploymentStatus.PREHIRE,
            EmployeeProfile.EmploymentStatus.SUSPENDED,
        ):
            self.profile.employment_status = state
            self.profile.save(update_fields=["employment_status"])
            self.assertEqual(client.post("/api/penalties/", body, format="json").status_code, 422)
        self.profile.employment_status = EmployeeProfile.EmploymentStatus.ACTIVE
        self.profile.is_archived = True
        self.profile.save(update_fields=["employment_status", "is_archived"])
        self.assertEqual(client.post("/api/penalties/", body, format="json").status_code, 422)
        self.profile.is_archived = False
        self.profile.total_salary = Decimal("0")
        self.profile.save(update_fields=["employment_status", "total_salary", "is_archived"])
        self.assertEqual(client.post("/api/penalties/", body, format="json").status_code, 422)
        self.assertFalse(PenaltyRecord.objects.exists())
        body["catalog_code"] = "O02"
        self.assertEqual(client.post("/api/penalties/", body, format="json").status_code, 201)
        self.assertEqual(PenaltyRecord.objects.get().action, "written_warning")

    def test_same_kind_corrections_hold_issued_snapshot_in_both_directions(self):
        for initial, corrected in ((20, 50), (50, 20)):
            result = self._result(date(2026, 9, 29) + timedelta(days=initial), initial)
            sync_attendance_candidates(result)
            candidate = PenaltyRecord.objects.get(attendance_result=result, source_kind="late_arrival")
            issue(candidate)
            amount = candidate.total_deduction_amount
            result.first_check_in_at = result.shift_start_at + timedelta(minutes=corrected)
            result.save(update_fields=["first_check_in_at"])
            sync_attendance_candidates(result)
            candidate.refresh_from_db()
            self.assertEqual(candidate.resolution["decision"], "manual_review")
            self.assertEqual(candidate.total_deduction_amount, amount)
            self.assertEqual(candidate.deduction.status, PenaltyDeduction.Status.HELD)

    def test_successive_absence_bands_only_withhold_uncovered_dates(self):
        issued = []
        start = date(2026, 9, 29)
        for offset in range(12):
            day = start + timedelta(days=offset)
            if not is_working_day(self.profile, day):
                continue
            row = AttendanceRecord.objects.create(
                employee_profile=self.profile, date=day, source="SYSTEM", status="ABSENT"
            )
            sync_absence_candidates([row])
            if offset in (1, 6, 11):
                candidate = PenaltyRecord.objects.get(status="pending_hr_mark", source_kind="absence")
                issue(candidate)
                issued.append(candidate)
        self.assertEqual([record.catalog.code for record in issued], ["W12", "W13", "W14"])
        covered = [day for record in issued for day in record.evidence["wage_absence_dates"]]
        self.assertEqual(len(covered), len(set(covered)))
        self.assertEqual(sum(record.extra_wage_amount for record in issued), Decimal(len(covered)) * 100)
        paid = issued[0]
        paid.status = PenaltyRecord.Status.APPLIED
        paid.save(update_fields=["status"])
        PenaltyDeduction.objects.filter(penalty=paid).update(status=PenaltyDeduction.Status.APPLIED)
        snapshot = paid.extra_wage_amount
        first = AttendanceRecord.objects.get(employee_profile=self.profile, date=start)
        first.status = AttendanceRecord.Status.PRESENT
        first.save(update_fields=["status"])
        reconcile_absence_candidates(self.profile, start)
        paid.refresh_from_db()
        self.assertEqual(paid.extra_wage_amount, snapshot)
        self.assertEqual(paid.deduction.status, PenaltyDeduction.Status.APPLIED)
        self.assertEqual(paid.resolution["decision"], "manual_review")

    def test_permission_interval_suppresses_only_covered_departure(self):
        result = self._result(date(2026, 9, 29), 0)
        result.final_check_out_at = result.shift_end_at - timedelta(minutes=20)
        result.save(update_fields=["final_check_out_at"])
        adjustment = AttendanceAdjustment.objects.create(
            employee_profile=self.profile,
            company=self.company,
            date=result.date,
            kind=AttendanceAdjustment.Kind.EXIT_PERMISSION,
            start_time=time(17, 40),
            end_time=time(18),
            reason="Approved",
        )
        sync_attendance_candidates(result)
        self.assertFalse(PenaltyRecord.objects.exists())
        adjustment.end_time = time(17, 50)
        adjustment.save(update_fields=["end_time"])
        sync_attendance_candidates(result)
        self.assertTrue(PenaltyRecord.objects.filter(source_kind="early_departure").exists())

    @override_settings(LATE_POLICY_EFFECTIVE_FROM="2026-10-01")
    def test_penalty_cutover_precedes_late_cutover(self):
        day = date(2026, 9, 29)
        result = self._result(day, 5)
        AttendancePolicyService.reconcile_month(self.profile, day)
        result.refresh_from_db()
        self.assertIn("working_day", result.calculation_inputs["policy"])
        self.assertTrue(PenaltyRecord.objects.filter(source_kind="late_arrival").exists())

    @override_settings(PENALTIES_EFFECTIVE_FROM="invalid")
    def test_invalid_rollout_is_reported_by_system_check(self):
        from .checks import check_penalties_effective_from

        self.assertEqual(check_penalties_effective_from(None)[0].id, "penalties.E001")

    def test_backdated_issuance_holds_downstream_without_rerating(self):
        catalog = PenaltyCatalog.objects.get(code="O01")

        def create(day):
            record = PenaltyRecord.objects.create(
                company=self.company,
                employee_profile=self.profile,
                catalog=catalog,
                occurred_on=day,
                occurrence_number=0,
                action="pending",
                status="pending_hr_mark",
                source="hr",
            )
            issue(record)
            return record

        later = create(date(2026, 9, 30))
        earlier = create(date(2026, 9, 29))
        later.refresh_from_db()
        self.assertEqual(earlier.occurrence_number, 1)
        self.assertEqual(later.occurrence_number, 1)
        self.assertEqual(later.resolution["proposed_evidence"]["expected_occurrence"], 2)
        self.assertEqual(later.deduction.status, PenaltyDeduction.Status.HELD)

    def test_bulk_absence_eligibility_queries_do_not_scale_per_day(self):
        from .services import _eligible_absences

        start = date(2026, 9, 29)
        for offset in range(20):
            AttendanceRecord.objects.create(
                employee_profile=self.profile, date=start + timedelta(days=offset), source="SYSTEM", status="ABSENT"
            )
        with self.assertNumQueries(2):
            self.assertTrue(_eligible_absences(self.profile, start, start + timedelta(days=20)))

    def test_frozen_catalog_refresh_updates_existing_rows_and_rollback_preserves_references(self):
        from importlib import import_module

        from django.apps import apps

        row = PenaltyCatalog.objects.get(code="O01")
        row.title_en = "Outdated catalog"
        row.save(update_fields=["title_en"])
        refresh = import_module("penalties.migrations.0004_refresh_frozen_catalog")
        refresh.refresh_catalog(apps, None)
        row.refresh_from_db()
        self.assertEqual(row.title_en, next(item["title_en"] for item in CATALOG if item["code"] == "O01"))
        issue(
            PenaltyRecord.objects.create(
                company=self.company,
                employee_profile=self.profile,
                catalog=row,
                occurred_on=date(2026, 9, 29),
                occurrence_number=0,
                action="pending",
                status="pending_hr_mark",
                source="hr",
            )
        )
        import_module("penalties.migrations.0002_seed_catalog").unseed_catalog(apps, None)
        self.assertTrue(PenaltyCatalog.objects.filter(pk=row.pk).exists())

    def test_aged_candidate_monitor_is_bounded_and_does_not_send(self):
        from django.core.management import call_command

        result = self._result(date(2026, 9, 29), 5)
        sync_attendance_candidates(result)
        candidate = PenaltyRecord.objects.get()
        PenaltyRecord.objects.filter(pk=candidate.pk).update(created_at=timezone.now() - timedelta(days=8))
        with self.assertLogs("penalties.monitoring", level="WARNING") as output:
            call_command("check_aged_penalties")
        self.assertIn("penalty_hr_candidates_aged", output.output[0])

    def test_manual_review_can_reopen_unapplied_candidate_but_not_applied_payroll(self):
        client = APIClient()
        client.force_authenticate(self.hr)
        client.defaults["HTTP_X_ACTIVE_COMPANY_ID"] = str(self.company.pk)
        result = self._result(date(2026, 9, 29), 20)
        sync_attendance_candidates(result)
        candidate = PenaltyRecord.objects.get(source_kind="late_arrival")
        issue(candidate)
        result.first_check_in_at = result.shift_start_at + timedelta(minutes=50)
        result.save(update_fields=["first_check_in_at"])
        sync_attendance_candidates(result)
        response = client.post(
            f"/api/penalties/{candidate.pk}/payroll-review/", {"decision": "approve", "note": "Reviewed"}, format="json"
        )
        self.assertEqual(response.status_code, 409)
        response = client.post(
            f"/api/penalties/{candidate.pk}/resolve/",
            {"decision": "reopen", "note": "Reassess corrected arrival"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        candidate.refresh_from_db()
        self.assertEqual(candidate.status, PenaltyRecord.Status.PENDING_HR_MARK)
        self.assertEqual(candidate.catalog.code, "W05")
        self.assertEqual(candidate.deduction.status, PenaltyDeduction.Status.VOID)
        issue(candidate)
        deduction = PenaltyDeduction.objects.get(penalty=candidate)
        deduction.status = PenaltyDeduction.Status.APPLIED
        deduction.save(update_fields=["status"])
        candidate.status = PenaltyRecord.Status.APPLIED
        candidate.save(update_fields=["status"])
        result.first_check_in_at = result.shift_start_at + timedelta(minutes=25)
        result.save(update_fields=["first_check_in_at"])
        sync_attendance_candidates(result)
        response = client.post(
            f"/api/penalties/{candidate.pk}/resolve/", {"decision": "reopen", "note": "Reassess"}, format="json"
        )
        self.assertEqual(response.status_code, 409)
        deduction.refresh_from_db()
        self.assertEqual(deduction.status, PenaltyDeduction.Status.APPLIED)

    def test_waived_occurrence_excluded_and_downstream_is_reviewed(self):
        from .services import _next_occurrence, waive

        catalog = PenaltyCatalog.objects.get(code="O01")
        records = []
        for day in (date(2026, 9, 29), date(2026, 9, 30)):
            record = PenaltyRecord.objects.create(
                company=self.company,
                employee_profile=self.profile,
                catalog=catalog,
                occurred_on=day,
                occurrence_number=0,
                action="pending",
                status="pending_hr_mark",
                source="hr",
            )
            issue(record)
            records.append(record)
        waive(records[0], reason="Incident excused")
        self.assertEqual(_next_occurrence(self.profile, catalog, date(2026, 10, 1)), 2)
        records[1].refresh_from_db()
        self.assertEqual(records[1].resolution["decision"], "manual_review")
        self.assertEqual(records[1].resolution["proposed_evidence"]["expected_occurrence"], 1)

    def test_after_hours_permission_requires_complete_interval(self):
        result = self._result(date(2026, 9, 29), 0)
        result.final_check_out_at = result.shift_end_at + timedelta(minutes=30)
        result.save(update_fields=["final_check_out_at"])
        adjustment = AttendanceAdjustment.objects.create(
            employee_profile=self.profile,
            company=self.company,
            date=result.date,
            kind=AttendanceAdjustment.Kind.DURING_SHIFT_PERMISSION,
            start_time=time(18),
            end_time=time(18, 30),
            reason="Approved",
        )
        sync_attendance_candidates(result)
        self.assertFalse(PenaltyRecord.objects.exists())
        adjustment.end_time = None
        adjustment.save(update_fields=["end_time"])
        sync_attendance_candidates(result)
        self.assertTrue(PenaltyRecord.objects.filter(source_kind="after_hours").exists())

    def test_earlier_absence_wage_waiver_holds_downstream_allocation_without_rerating(self):
        from .services import waive

        start = date(2026, 9, 29)
        dates = [start.isoformat(), (start + timedelta(days=1)).isoformat()]

        def create(code, day, evidence):
            record = PenaltyRecord.objects.create(
                company=self.company,
                employee_profile=self.profile,
                catalog=PenaltyCatalog.objects.get(code=code),
                occurred_on=day,
                occurrence_number=0,
                action="pending",
                status="pending_hr_mark",
                source="automatic",
                source_kind="absence",
                evidence=evidence,
            )
            issue(record)
            return record

        earlier = create(
            "W12",
            start + timedelta(days=1),
            {"spell_start_on": start.isoformat(), "absence_days": 2, "absence_dates": dates},
        )
        later_dates = dates + [(start + timedelta(days=4)).isoformat()]
        later = create(
            "W13",
            start + timedelta(days=6),
            {"spell_start_on": start.isoformat(), "absence_days": 3, "absence_dates": later_dates},
        )
        snapshot = later.extra_wage_amount
        self.assertEqual(snapshot, Decimal("100"))
        waive(earlier, reason="HR waived the first band")
        later.refresh_from_db()
        self.assertEqual(later.extra_wage_amount, snapshot)
        self.assertEqual(later.deduction.status, PenaltyDeduction.Status.HELD)
        self.assertEqual(later.resolution["proposed_evidence"]["released_wage_dates"], dates)
        self.assertEqual(later.resolution["proposed_evidence"]["proposed_wage_absence_dates"], sorted(later_dates))

    def test_paid_earlier_absence_wage_waiver_retains_coverage_and_finalized_amounts(self):
        from .services import waive

        start = date(2026, 9, 29)
        records = []
        dates = [start.isoformat(), (start + timedelta(days=1)).isoformat()]
        for code, offset, evidence_dates in (
            ("W12", 1, dates),
            ("W13", 6, dates + [(start + timedelta(days=4)).isoformat()]),
        ):
            record = PenaltyRecord.objects.create(
                company=self.company,
                employee_profile=self.profile,
                catalog=PenaltyCatalog.objects.get(code=code),
                occurred_on=start + timedelta(days=offset),
                occurrence_number=0,
                action="pending",
                status="pending_hr_mark",
                source="automatic",
                source_kind="absence",
                evidence={
                    "spell_start_on": start.isoformat(),
                    "absence_days": len(evidence_dates),
                    "absence_dates": evidence_dates,
                },
            )
            issue(record)
            records.append(record)
        PenaltyDeduction.objects.filter(penalty=records[0]).update(status=PenaltyDeduction.Status.APPLIED)
        records[0].status = PenaltyRecord.Status.APPLIED
        records[0].save(update_fields=["status"])
        waive(records[0], reason="Waived after payroll application")
        records[1].refresh_from_db()
        self.assertEqual(PenaltyDeduction.objects.get(penalty=records[0]).status, PenaltyDeduction.Status.APPLIED)
        self.assertEqual(records[1].extra_wage_amount, Decimal("100"))
        self.assertNotEqual((records[1].resolution or {}).get("decision"), "manual_review")

    def _hr_client(self):
        client = APIClient()
        client.force_authenticate(self.hr)
        client.defaults["HTTP_X_ACTIVE_COMPANY_ID"] = str(self.company.pk)
        return client

    def _issued_hr(self, day, code="O01"):
        record = PenaltyRecord.objects.create(
            company=self.company,
            employee_profile=self.profile,
            catalog=PenaltyCatalog.objects.get(code=code),
            occurred_on=day,
            occurrence_number=0,
            action="pending",
            status="pending_hr_mark",
            source="hr",
        )
        return issue(record)

    def test_lone_opaque_punch_keeps_check_in_but_opens_no_candidate(self):
        from attendance.models import BioTimeEmployeeMap
        from attendance.services import SyncBioTimeService

        BioTimeEmployeeMap.objects.create(employee_profile=self.profile, biotime_emp_code="PEN-001")
        SyncBioTimeService.ingest_transactions(
            [{"emp_code": "PEN-001", "punch_time": "2026-09-29 17:30:00", "is_attendance": 1, "id": "lone"}]
        )
        record = AttendanceRecord.objects.get(employee_profile=self.profile, date=date(2026, 9, 29))
        self.assertIsNotNone(record.check_in_at)
        self.assertFalse(PenaltyRecord.objects.filter(source_kind="late_arrival").exists())
        # An existing unissued candidate is invalidated through the normal path.
        result = self._result(date(2026, 9, 30), 510)
        sync_attendance_candidates(result)
        candidate = PenaltyRecord.objects.get(attendance_result=result)
        self.assertEqual(candidate.catalog.code, "W07")
        result.calculation_inputs = {"lone_opaque_punch": True}
        result.save(update_fields=["calculation_inputs"])
        sync_attendance_candidates(result)
        candidate.refresh_from_db()
        self.assertEqual(candidate.status, PenaltyRecord.Status.WAIVED)

    def test_rerate_clears_recurrence_review_after_earlier_hr_waiver(self):
        from audit.models import AuditLog

        from .services import waive

        first = self._issued_hr(date(2026, 9, 29))
        second = self._issued_hr(date(2026, 9, 30))
        self.assertEqual((second.occurrence_number, second.amount), (2, Decimal("25.00")))
        second.employee_response = {"decision": "acknowledged", "reason": None}
        second.save(update_fields=["employee_response"])
        waive(first, reason="Incident excused")
        second.refresh_from_db()
        self.assertEqual(second.resolution["decision"], "manual_review")
        client = self._hr_client()
        url = f"/api/penalties/{second.pk}/resolve/"
        self.assertEqual(client.post(url, {"decision": "uphold", "note": "Keep"}, format="json").status_code, 409)
        self.assertEqual(client.post(url, {"decision": "rerate"}, format="json").status_code, 422)
        response = client.post(url, {"decision": "rerate", "note": "First remaining incident"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        second.refresh_from_db()
        self.assertEqual(second.occurrence_number, 1)
        self.assertEqual(second.amount, Decimal("10.00"))
        self.assertEqual(second.total_deduction_amount, Decimal("10.00"))
        self.assertEqual(second.resolution["decision"], "recurrence_rerated")
        self.assertEqual(second.employee_response["decision"], "acknowledged")
        self.assertEqual(second.deduction.amount, Decimal("10.00"))
        self.assertEqual(second.deduction.status, PenaltyDeduction.Status.PENDING_REVIEW)
        log = AuditLog.objects.get(action="penalty_recurrence_rerated", entity_id=str(second.pk))
        self.assertEqual(log.metadata["previous"]["amount"], "25.00")
        self.assertEqual(log.metadata["previous_resolution"]["decision"], "manual_review")
        response = client.post(
            f"/api/penalties/{second.pk}/payroll-review/", {"decision": "approve", "note": "OK"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)

    def test_rerate_refuses_applied_and_attendance_reviews(self):
        later = self._issued_hr(date(2026, 9, 30))
        self._issued_hr(date(2026, 9, 29))
        later.refresh_from_db()
        self.assertEqual(later.resolution["proposed_evidence"]["expected_occurrence"], 2)
        PenaltyDeduction.objects.filter(penalty=later).update(status=PenaltyDeduction.Status.APPLIED)
        client = self._hr_client()
        body = {"decision": "rerate", "note": "Re-rate"}
        self.assertEqual(client.post(f"/api/penalties/{later.pk}/resolve/", body, format="json").status_code, 409)
        later.refresh_from_db()
        self.assertEqual((later.occurrence_number, later.amount), (1, Decimal("10.00")))
        self.assertEqual(later.deduction.status, PenaltyDeduction.Status.APPLIED)
        result = self._result(date(2026, 10, 1), 20)
        sync_attendance_candidates(result)
        candidate = issue(PenaltyRecord.objects.get(attendance_result=result))
        result.first_check_in_at = result.shift_start_at + timedelta(minutes=50)
        result.save(update_fields=["first_check_in_at"])
        sync_attendance_candidates(result)
        self.assertEqual(client.post(f"/api/penalties/{candidate.pk}/resolve/", body, format="json").status_code, 409)

    def test_attendance_revert_clears_review_and_restores_only_review_hold(self):
        client = self._hr_client()
        for day, hr_hold in ((date(2026, 9, 29), False), (date(2026, 9, 30), True)):
            result = self._result(day, 20)
            sync_attendance_candidates(result)
            candidate = issue(PenaltyRecord.objects.get(attendance_result=result))
            if hr_hold:
                response = client.post(
                    f"/api/penalties/{candidate.pk}/payroll-review/",
                    {"decision": "hold", "note": "Hold"},
                    format="json",
                )
                self.assertEqual(response.status_code, 200)
            for minute in (50, 20):
                result.first_check_in_at = result.shift_start_at + timedelta(minutes=minute)
                result.save(update_fields=["first_check_in_at"])
                sync_attendance_candidates(result)
            candidate.refresh_from_db()
            self.assertNotEqual((candidate.resolution or {}).get("decision"), "manual_review")
            expected = PenaltyDeduction.Status.HELD if hr_hold else PenaltyDeduction.Status.PENDING_REVIEW
            self.assertEqual(candidate.deduction.status, expected)

    def test_reopen_recomputes_current_evidence_not_stored_proposal(self):
        result = self._result(date(2026, 9, 29), 20)
        sync_attendance_candidates(result)
        candidate = issue(PenaltyRecord.objects.get(attendance_result=result))
        result.first_check_in_at = result.shift_start_at + timedelta(minutes=50)
        result.save(update_fields=["first_check_in_at"])
        sync_attendance_candidates(result)
        candidate.refresh_from_db()
        self.assertEqual(candidate.resolution["proposed_evidence"]["catalog_code"], "W05")
        # A second correction lands before candidate reconciliation runs.
        result.first_check_in_at = result.shift_start_at + timedelta(minutes=70)
        result.save(update_fields=["first_check_in_at"])
        response = self._hr_client().post(
            f"/api/penalties/{candidate.pk}/resolve/", {"decision": "reopen", "note": "Reassess"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        candidate.refresh_from_db()
        self.assertEqual(candidate.catalog.code, "W07")
        self.assertEqual(candidate.evidence["minutes"], 70)
        self.assertIn("Measured 70 late minutes", candidate.note)
        self.assertIn("reopened_at", candidate.resolution)

    def test_reopen_refuses_when_current_evidence_is_gone(self):
        result = self._result(date(2026, 9, 29), 20)
        sync_attendance_candidates(result)
        candidate = issue(PenaltyRecord.objects.get(attendance_result=result))
        result.first_check_in_at = result.shift_start_at + timedelta(minutes=50)
        result.save(update_fields=["first_check_in_at"])
        sync_attendance_candidates(result)
        result.calculation_inputs = {"lone_opaque_punch": True}
        result.save(update_fields=["calculation_inputs"])
        response = self._hr_client().post(
            f"/api/penalties/{candidate.pk}/resolve/", {"decision": "reopen", "note": "Reassess"}, format="json"
        )
        self.assertEqual(response.status_code, 409)
        candidate.refresh_from_db()
        self.assertEqual(candidate.status, PenaltyRecord.Status.ISSUED)

    def test_absence_wage_waiver_skips_wage_less_downstream_rows(self):
        from .services import waive

        start = date(2026, 9, 29)
        dates = [(start + timedelta(days=offset)).isoformat() for offset in range(16)]

        def create(code, offset, evidence_dates):
            record = PenaltyRecord.objects.create(
                company=self.company,
                employee_profile=self.profile,
                catalog=PenaltyCatalog.objects.get(code=code),
                occurred_on=start + timedelta(days=offset),
                occurrence_number=0,
                action="pending",
                status="pending_hr_mark",
                source="automatic",
                source_kind="absence",
                evidence={
                    "spell_start_on": start.isoformat(),
                    "absence_days": len(evidence_dates),
                    "absence_dates": evidence_dates,
                },
            )
            return issue(record)

        earlier = create("W12", 1, dates[:2])
        w15 = create("W15", 15, dates)
        waive(earlier, reason="HR waived the first band")
        w15.refresh_from_db()
        self.assertNotEqual((w15.resolution or {}).get("decision"), "manual_review")

    def test_aged_monitor_uses_time_since_reopen(self):
        from django.core.management import call_command

        result = self._result(date(2026, 9, 29), 5)
        sync_attendance_candidates(result)
        candidate = PenaltyRecord.objects.get()
        PenaltyRecord.objects.filter(pk=candidate.pk).update(
            created_at=timezone.now() - timedelta(days=30),
            resolution={"decision": "reopened", "reopened_at": timezone.now().isoformat()},
        )
        with self.assertNoLogs("penalties.monitoring", level="WARNING"):
            call_command("check_aged_penalties")
        PenaltyRecord.objects.filter(pk=candidate.pk).update(
            resolution={"decision": "reopened", "reopened_at": (timezone.now() - timedelta(days=8)).isoformat()}
        )
        with self.assertLogs("penalties.monitoring", level="WARNING"):
            call_command("check_aged_penalties")
