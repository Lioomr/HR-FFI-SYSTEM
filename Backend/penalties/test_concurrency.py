from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time
from decimal import Decimal
from threading import Event
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import close_old_connections, connection, connections, transaction
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from attendance.models import AttendanceDailyResult
from employees.models import EmployeeProfile
from organization.models import OrganizationNode
from payroll.models import PayrollRun, PayrollRunItem

from .catalog import CATALOG
from .models import PenaltyCatalog, PenaltyDeduction, PenaltyRecord, PenaltyWarningNotice
from .payroll import sync_penalty_deductions
from .services import issue, sync_attendance_candidates
from .tasks import issue_auto_warnings


class PenaltyLockTests(TransactionTestCase):
    # The teardown flush would otherwise delete migration-seeded rows (groups,
    # catalog) for later tests and for --reuse-db runs of the shared test DB.
    serialized_rollback = True

    def _fixture_teardown(self):
        super()._fixture_teardown()
        for alias in self._databases_names(include_mirrors=False):
            contents = getattr(connections[alias], "_test_serialized_contents", None)
            if contents:
                connections[alias].creation.deserialize_db_from_string(contents)

    def test_payroll_waits_for_profile_lock_and_reads_fresh_penalty_eligibility(self):
        if connection.vendor != "postgresql":
            self.skipTest("Requires PostgreSQL row locks and independent connections.")
        PenaltyCatalog.objects.bulk_create([PenaltyCatalog(**row) for row in CATALOG], ignore_conflicts=True)
        company = OrganizationNode.objects.create(code="PEN_LOCK", name="Lock", node_type="company")
        user = get_user_model().objects.create_user(email="pen-lock@ffi.test")
        profile = EmployeeProfile.objects.create(user=user, company=company, employee_id="LOCK-1", total_salary=3000)
        penalty = PenaltyRecord.objects.create(
            company=company,
            employee_profile=profile,
            catalog=PenaltyCatalog.objects.get(code="O01"),
            occurred_on=date(2026, 9, 29),
            occurrence_number=0,
            action="pending",
            status="pending_hr_mark",
            source="hr",
        )
        issue(penalty)
        deduction = PenaltyDeduction.objects.get(penalty=penalty)
        deduction.status = PenaltyDeduction.Status.APPROVED
        deduction.save(update_fields=["status"])
        run = PayrollRun.objects.create(company=company, year=2026, month=9, status="DRAFT")
        PayrollRunItem.objects.create(
            payroll_run=run,
            employee_id=profile.employee_id,
            employee_name="Lock",
            basic_salary=3000,
            total_allowances=0,
            total_deductions=0,
            net_salary=3000,
        )
        started = Event()

        def reconcile():
            close_old_connections()
            try:
                with connection.cursor() as cursor:
                    cursor.execute("SET lock_timeout = '5s'")
                started.set()
                return sync_penalty_deductions(run)
            finally:
                connection.close()

        with ThreadPoolExecutor(max_workers=1) as executor:
            with transaction.atomic():
                EmployeeProfile.objects.select_for_update().get(pk=profile.pk)
                future = executor.submit(reconcile)
                self.assertTrue(started.wait(3))
                # Payroll has an initially approved candidate but must re-read
                # the penalty under its lock after the profile lock is released.
                PenaltyRecord.objects.filter(pk=penalty.pk).update(status=PenaltyRecord.Status.DISPUTED)
            self.assertEqual(future.result(timeout=8), {"claimed": 0, "released": 0})
        deduction.refresh_from_db()
        self.assertEqual(deduction.claimed_amount, Decimal("0"))

    @override_settings(PENALTIES_EFFECTIVE_FROM="2026-09-29", PENALTY_AUTO_WARNINGS_EFFECTIVE_FROM="2026-10-01")
    def test_auto_warning_task_skips_locked_profile_and_never_double_issues(self):
        if connection.vendor != "postgresql":
            self.skipTest("Requires PostgreSQL row locks and independent connections.")
        PenaltyCatalog.objects.bulk_create([PenaltyCatalog(**row) for row in CATALOG], ignore_conflicts=True)
        company = OrganizationNode.objects.create(code="PEN_AUTO_LOCK", name="Auto lock", node_type="company")
        user = get_user_model().objects.create_user(email="pen-auto-lock@ffi.test")
        profile = EmployeeProfile.objects.create(user=user, company=company, employee_id="ALOCK-1", total_salary=3000)
        start = timezone.make_aware(datetime.combine(date(2026, 10, 1), time(9, 0)))
        result = AttendanceDailyResult.objects.create(
            employee_profile=profile,
            company=company,
            date=start.date(),
            shift_start_at=start,
            shift_end_at=start.replace(hour=18),
            scheduled_minutes=540,
            first_check_in_at=start.replace(minute=5),
            final_check_out_at=start.replace(hour=18),
        )
        sync_attendance_candidates(result)

        def run():
            close_old_connections()
            try:
                return issue_auto_warnings()
            finally:
                connection.close()

        with (
            patch("django.utils.timezone.now", return_value=start.replace(day=20)),
            # Committed transactions would otherwise queue real WhatsApp deliveries.
            patch("penalties.warning_notices.dispatch_notification_channels", return_value={}),
        ):
            with ThreadPoolExecutor(max_workers=2) as executor:
                with transaction.atomic():
                    # An HR action holds the profile: the task skips it instead of waiting.
                    EmployeeProfile.objects.select_for_update().get(pk=profile.pk)
                    self.assertEqual(executor.submit(run).result(timeout=30), {"skipped": 1})
                results = [future.result(timeout=60) for future in [executor.submit(run) for _ in range(2)]]
        try:
            self.assertEqual(sum(row.get("issued", 0) for row in results), 1)
            self.assertEqual(PenaltyWarningNotice.objects.filter(penalty__employee_profile=profile).count(), 1)
        finally:
            for notice in PenaltyWarningNotice.objects.filter(penalty__employee_profile=profile):
                notice.document.delete(save=False)
