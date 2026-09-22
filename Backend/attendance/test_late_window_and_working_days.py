"""Monthly late-window withdrawal and the fixed working week by nationality.

Two fixed policies, neither of them HR-editable:

* The 15-minute grace window is open all month, with no cap on how often it is
  used, until the employee collects ``MONTHLY_LATE_VIOLATION_LIMIT`` late
  violations. From then until the end of that calendar month only the
  post-grace tolerance remains. The count resets when the month does.
* Friday is a day off for everyone and Saudi employees are also off on
  Saturday, so Saudis work Sunday-Thursday and everyone else Saturday-Thursday.
  A punch on an employee's own day off is recorded but never rated.

Dates are chosen inside June/July 2026 so that every "work day" used here is a
working day for the non-Saudi test profile (Saturday-Thursday).
"""

from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.test import SimpleTestCase
from django.utils import timezone

from payroll.models import AttendancePayrollDeduction

from .models import (
    AttendanceDailyResult,
    AttendanceGraceUse,
    AttendanceLateNotice,
    AttendanceLateViolation,
    AttendanceRecord,
    BioTimeEmployeeMap,
    NormalizedAttendanceEvent,
)
from .policy import MONTHLY_LATE_VIOLATION_LIMIT, AttendancePolicyService, penalty_percent
from .schedule import is_rest_day_for_everyone, is_working_day
from .services import SyncBioTimeService
from .test_policy_enforcement import AttendancePolicyTestBase

Lifecycle = AttendanceLateViolation.Lifecycle

# June 2026: 1 Mon .. 4 Thu, 5 Fri (off), 6 Sat, 7 Sun, 8 Mon .. 11 Thu.
FRIDAY_JUNE = date(2026, 6, 5)
SATURDAY_JUNE = date(2026, 6, 6)


class LateWindowTestBase(AttendancePolicyTestBase):
    """Adds second-precision arrivals on top of the shared policy fixture."""

    def _arrival(self, day, hour=9, minute=0, second=0):
        """A calculated day whose only check-in is at the given local time."""
        start = timezone.make_aware(datetime.combine(day, time(9, 0)))
        return AttendanceDailyResult.objects.create(
            employee_profile=self.profile,
            company=self.company,
            date=day,
            shift_start_at=start,
            shift_end_at=start.replace(hour=18),
            scheduled_minutes=540,
            first_check_in_at=start.replace(hour=hour, minute=minute, second=second),
            final_check_out_at=start.replace(hour=18),
        )

    def _reconcile(self, day):
        AttendancePolicyService.reconcile_month(self.profile, day)

    def _reason(self, day):
        return AttendanceGraceUse.objects.get(employee_profile=self.profile, date=day).reason

    def _is_late(self, day):
        return AttendanceDailyResult.objects.get(employee_profile=self.profile, date=day).status_input == "LATE"

    def _violation_days(self):
        return set(
            AttendanceLateViolation.objects.filter(
                employee_profile=self.profile, lifecycle__in=(Lifecycle.ACTIVE, Lifecycle.APPLIED,
                                                              Lifecycle.MANUAL_REVIEW)
            ).values_list("date", flat=True)
        )


class MonthlyLateWindowTests(LateWindowTestBase):
    def test_the_threshold_is_a_fixed_module_constant(self):
        self.assertEqual(MONTHLY_LATE_VIOLATION_LIMIT, 3)

    def test_window_stays_open_with_no_cap_while_the_month_has_no_violations(self):
        """Six arrivals inside the window in one month, none of them late."""
        days = [date(2026, 6, day) for day in (1, 2, 3, 4, 6, 7)]
        for day in days:
            self._arrival(day, minute=10)

        self._reconcile(days[-1])

        self.assertFalse(AttendanceLateViolation.objects.exists())
        self.assertEqual({self._reason(day) for day in days}, {"monthly_grace"})
        self.assertEqual(AttendanceGraceUse.objects.filter(consumed=True).count(), 6)

    def test_window_is_still_open_after_one_and_after_two_violations(self):
        # 09:30 is outside the window and so is a violation; 09:10 is inside it.
        self._arrival(date(2026, 6, 1), minute=30)   # violation 1
        self._arrival(date(2026, 6, 2), minute=10)   # window still open
        self._arrival(date(2026, 6, 3), minute=30)   # violation 2
        self._arrival(date(2026, 6, 4), minute=10)   # window still open

        self._reconcile(date(2026, 6, 4))

        self.assertEqual(self._reason(date(2026, 6, 2)), "monthly_grace")
        self.assertEqual(self._reason(date(2026, 6, 4)), "monthly_grace")
        self.assertEqual(self._violation_days(), {date(2026, 6, 1), date(2026, 6, 3)})

    def test_third_violation_withdraws_the_window_so_0906_is_late(self):
        for day in (1, 2, 3):
            self._arrival(date(2026, 6, day), minute=30)
        self._arrival(date(2026, 6, 4), minute=6)

        self._reconcile(date(2026, 6, 4))

        self.assertTrue(self._is_late(date(2026, 6, 4)))
        self.assertEqual(self._reason(date(2026, 6, 4)), "post_grace_late")
        self.assertEqual(AttendanceLateViolation.objects.filter(date=date(2026, 6, 4)).count(), 1)

    def test_third_violation_withdraws_the_window_but_090559_is_still_on_time(self):
        for day in (1, 2, 3):
            self._arrival(date(2026, 6, day), minute=30)
        self._arrival(date(2026, 6, 4), minute=5, second=59)

        self._reconcile(date(2026, 6, 4))

        self.assertFalse(self._is_late(date(2026, 6, 4)))
        self.assertEqual(self._reason(date(2026, 6, 4)), "post_grace_tolerance")
        self.assertFalse(AttendanceLateViolation.objects.filter(date=date(2026, 6, 4)).exists())

    def test_an_arrival_inside_the_window_is_late_once_the_window_is_withdrawn(self):
        for day in (1, 2, 3):
            self._arrival(date(2026, 6, day), minute=30)
        self._arrival(date(2026, 6, 4), minute=10)

        self._reconcile(date(2026, 6, 4))

        self.assertTrue(self._is_late(date(2026, 6, 4)))
        self.assertEqual(self._reason(date(2026, 6, 4)), "post_grace_late")

    def test_the_window_comes_back_on_the_first_of_the_next_month(self):
        for day in (1, 2, 3):
            self._arrival(date(2026, 6, day), minute=30)
        self._arrival(date(2026, 6, 4), minute=10)
        self._reconcile(date(2026, 6, 4))
        self.assertTrue(self._is_late(date(2026, 6, 4)))

        # July 1 2026 is a Wednesday: a fresh month, so a fresh window.
        july_first = date(2026, 7, 1)
        self._arrival(july_first, minute=10)
        self._reconcile(july_first)

        self.assertFalse(self._is_late(july_first))
        self.assertEqual(self._reason(july_first), "monthly_grace")
        self.assertFalse(AttendanceLateViolation.objects.filter(date=july_first).exists())

    def test_the_lifetime_penalty_ladder_is_unchanged(self):
        self.assertEqual(
            [penalty_percent(occurrence) for occurrence in (1, 2, 3, 4, 9)],
            [Decimal("0"), Decimal("0.05"), Decimal("0.10"), Decimal("0.50"), Decimal("0.50")],
        )

        for day in (1, 2, 3, 4):
            self._arrival(date(2026, 6, day), minute=30)
        self._reconcile(date(2026, 6, 4))

        ladder = list(
            AttendanceLateViolation.objects.order_by("date").values_list(
                "occurrence_number", "penalty_percent", "penalty_amount"
            )
        )
        # Daily rate is 3000/30 = 100.00.
        self.assertEqual(
            ladder,
            [
                (1, Decimal("0.0000"), Decimal("0.00")),
                (2, Decimal("0.0500"), Decimal("5.00")),
                (3, Decimal("0.1000"), Decimal("10.00")),
                (4, Decimal("0.5000"), Decimal("50.00")),
            ],
        )


class MonthlyLateCountMembershipTests(LateWindowTestBase):
    """Which violations count toward the month's three."""

    def _lock_violation(self, day):
        """Make a violation payroll history: applied with money actually charged."""
        violation = AttendanceLateViolation.objects.get(employee_profile=self.profile, date=day)
        self.assertGreater(violation.penalty_amount, 0)
        violation.lifecycle = Lifecycle.APPLIED
        violation.save(update_fields=["lifecycle"])
        return violation

    def test_a_voided_violation_reopens_the_window(self):
        for day in (1, 2, 3):
            self._arrival(date(2026, 6, day), minute=30)
        self._arrival(date(2026, 6, 4), minute=10)
        self._reconcile(date(2026, 6, 4))
        self.assertTrue(self._is_late(date(2026, 6, 4)))

        # A late permission excuses June 3, voiding that violation.
        self._excuse(date(2026, 6, 3))

        voided = AttendanceLateViolation.objects.get(date=date(2026, 6, 3))
        self.assertEqual(voided.lifecycle, Lifecycle.VOID)
        # Only two violations remain, so the window is open again for June 4.
        self.assertFalse(self._is_late(date(2026, 6, 4)))
        self.assertEqual(self._reason(date(2026, 6, 4)), "monthly_grace")

    def test_a_payroll_locked_violation_still_counts_and_keeps_the_window_shut(self):
        for day in (1, 2, 3):
            self._arrival(date(2026, 6, day), minute=30)
        self._arrival(date(2026, 6, 4), minute=10)
        self._reconcile(date(2026, 6, 4))
        # June 3 is occurrence 3, a 10% charge, and payroll has applied it.
        self._lock_violation(date(2026, 6, 3))

        self._excuse(date(2026, 6, 3))

        locked = AttendanceLateViolation.objects.get(date=date(2026, 6, 3))
        self.assertEqual(locked.lifecycle, Lifecycle.MANUAL_REVIEW)
        # It is no longer chargeable, but it still counts: the window stays shut.
        self.assertTrue(self._is_late(date(2026, 6, 4)))
        self.assertEqual(self._reason(date(2026, 6, 4)), "post_grace_late")

    def test_excused_days_are_never_late_and_never_count(self):
        for day in (1, 2, 3):
            self._arrival(date(2026, 6, day), minute=30)
            self._excuse(date(2026, 6, day))
        self._arrival(date(2026, 6, 4), minute=10)
        self._reconcile(date(2026, 6, 4))

        self.assertFalse(AttendanceLateViolation.objects.exists())
        self.assertEqual({self._reason(date(2026, 6, day)) for day in (1, 2, 3)}, {"late_permission"})
        self.assertEqual(self._reason(date(2026, 6, 4)), "monthly_grace")

    def test_exempt_employees_are_never_late_and_never_count(self):
        self.profile.attendance_exempt = True
        self.profile.save(update_fields=["attendance_exempt"])
        for day in (1, 2, 3, 4):
            self._arrival(date(2026, 6, day), minute=30)

        self._reconcile(date(2026, 6, 4))

        self.assertFalse(AttendanceLateViolation.objects.exists())
        self.assertEqual(
            set(AttendanceGraceUse.objects.values_list("consumed", "reason")), {(False, "attendance_exempt")}
        )


class DelayedPunchCutoffTests(LateWindowTestBase):
    def test_a_delayed_punch_on_an_earlier_day_moves_the_third_violation_cutoff(self):
        """June 6 is inside the window until an earlier day becomes late."""
        self._arrival(date(2026, 6, 3), minute=30)   # violation 1
        self._arrival(date(2026, 6, 4), minute=30)   # violation 2
        self._arrival(date(2026, 6, 6), minute=10)   # count is 2: window still open
        self._reconcile(date(2026, 6, 6))

        self.assertEqual(self._reason(date(2026, 6, 6)), "monthly_grace")
        self.assertFalse(self._is_late(date(2026, 6, 6)))

        # A delayed punch lands for June 1, which now becomes violation 1.
        self._arrival(date(2026, 6, 1), minute=30)
        self._reconcile(date(2026, 6, 1))

        # June 1/3/4 are now the month's three violations, so June 6 is late.
        self.assertEqual(self._violation_days(), {date(2026, 6, 1), date(2026, 6, 3), date(2026, 6, 4),
                                                  date(2026, 6, 6)})
        self.assertEqual(self._reason(date(2026, 6, 6)), "post_grace_late")
        self.assertTrue(self._is_late(date(2026, 6, 6)))
        # The lifetime ladder renumbers in date order.
        self.assertEqual(
            list(AttendanceLateViolation.objects.order_by("date").values_list("date", "occurrence_number")),
            [
                (date(2026, 6, 1), 1),
                (date(2026, 6, 3), 2),
                (date(2026, 6, 4), 3),
                (date(2026, 6, 6), 4),
            ],
        )


class WorkingWeekTests(SimpleTestCase):
    """The fixed weekly schedule. No database or settings are involved."""

    class _Profile:
        def __init__(self, is_saudi):
            self.is_saudi = is_saudi

    def test_non_saudi_works_saturday_to_thursday_with_friday_off(self):
        profile = self._Profile(is_saudi=False)
        # 2026-06-01 Mon .. 2026-06-07 Sun.
        worked = [is_working_day(profile, date(2026, 6, day)) for day in range(1, 8)]
        self.assertEqual(worked, [True, True, True, True, False, True, True])

    def test_saudi_works_sunday_to_thursday_with_friday_and_saturday_off(self):
        profile = self._Profile(is_saudi=True)
        worked = [is_working_day(profile, date(2026, 6, day)) for day in range(1, 8)]
        self.assertEqual(worked, [True, True, True, True, False, False, True])

    def test_saturday_splits_by_nationality_and_friday_never_does(self):
        self.assertTrue(is_working_day(self._Profile(is_saudi=False), SATURDAY_JUNE))
        self.assertFalse(is_working_day(self._Profile(is_saudi=True), SATURDAY_JUNE))
        self.assertFalse(is_working_day(self._Profile(is_saudi=False), FRIDAY_JUNE))
        self.assertFalse(is_working_day(self._Profile(is_saudi=True), FRIDAY_JUNE))

    def test_only_friday_is_a_rest_day_for_everyone(self):
        self.assertTrue(is_rest_day_for_everyone(FRIDAY_JUNE))
        self.assertFalse(is_rest_day_for_everyone(SATURDAY_JUNE))


class OffDayAttendanceTests(LateWindowTestBase):
    """A punch on the employee's own day off is recorded but never calculated."""

    def setUp(self):
        super().setUp()
        BioTimeEmployeeMap.objects.create(employee_profile=self.profile, biotime_emp_code="POLICY-001")

    def _punch(self, day, hour, minute, punch_id, punch_state):
        return {
            "emp_code": "POLICY-001",
            "punch_time": f"{day.isoformat()} {hour:02d}:{minute:02d}:00",
            "is_attendance": 1,
            "terminal_sn": "TERM-01",
            "id": punch_id,
            "punch_state": punch_state,
        }

    def _ingest_very_late_day(self, day):
        """Arrive at 11:00 and leave at 12:00 - flagrantly late and short on a work day."""
        SyncBioTimeService.ingest_transactions(
            [
                self._punch(day, 11, 0, f"off-in-{day}", 0),
                self._punch(day, 12, 0, f"off-out-{day}", 1),
            ]
        )

    def test_friday_punch_is_recorded_but_produces_nothing(self):
        self._ingest_very_late_day(FRIDAY_JUNE)

        # Recorded: raw punches, normalized events and a daily result all exist.
        self.assertEqual(
            NormalizedAttendanceEvent.objects.filter(
                employee_profile=self.profile, attendance_date=FRIDAY_JUNE
            ).count(),
            2,
        )
        result = AttendanceDailyResult.objects.get(employee_profile=self.profile, date=FRIDAY_JUNE)
        self.assertIsNotNone(result.first_check_in_at)
        self.assertEqual(result.physical_work_minutes, 60)

        # Calculated into nothing.
        self.assertEqual(result.status_input, "PRESENT")
        self.assertEqual(result.missing_minutes, 0)
        self.assertEqual(self._reason(FRIDAY_JUNE), "non_working_day")
        self.assertFalse(AttendanceGraceUse.objects.get(date=FRIDAY_JUNE).consumed)
        self.assertFalse(AttendanceLateViolation.objects.exists())
        self.assertFalse(AttendancePayrollDeduction.objects.exists())
        self.assertFalse(AttendanceLateNotice.objects.exists())

    def test_saturday_is_a_working_day_for_a_non_saudi_employee(self):
        self.assertFalse(self.profile.is_saudi)

        self._ingest_very_late_day(SATURDAY_JUNE)

        result = AttendanceDailyResult.objects.get(employee_profile=self.profile, date=SATURDAY_JUNE)
        self.assertEqual(result.status_input, "LATE")
        self.assertGreater(result.missing_minutes, 0)
        self.assertEqual(self._reason(SATURDAY_JUNE), "outside_grace")
        self.assertTrue(AttendanceLateViolation.objects.filter(date=SATURDAY_JUNE).exists())

    def test_saturday_produces_nothing_for_a_saudi_employee(self):
        self.profile.is_saudi = True
        self.profile.save(update_fields=["is_saudi"])

        self._ingest_very_late_day(SATURDAY_JUNE)

        result = AttendanceDailyResult.objects.get(employee_profile=self.profile, date=SATURDAY_JUNE)
        self.assertEqual(result.status_input, "PRESENT")
        self.assertEqual(result.missing_minutes, 0)
        self.assertEqual(self._reason(SATURDAY_JUNE), "non_working_day")
        self.assertFalse(AttendanceLateViolation.objects.exists())
        self.assertFalse(AttendancePayrollDeduction.objects.exists())
        self.assertFalse(AttendanceLateNotice.objects.exists())

    def test_an_off_day_never_counts_toward_the_months_three_violations(self):
        for day in (1, 2, 3):
            self._arrival(date(2026, 6, day), minute=30)
        # A Friday arrival well outside the window does not add a fourth.
        self._arrival(FRIDAY_JUNE, minute=45)
        self._reconcile(FRIDAY_JUNE)

        self.assertEqual(self._violation_days(), {date(2026, 6, day) for day in (1, 2, 3)})
        self.assertEqual(self._reason(FRIDAY_JUNE), "non_working_day")


class OffDayAbsenceDetectionTests(LateWindowTestBase):
    def test_absence_detection_skips_friday_for_everyone(self):
        from .absence import mark_absentees_for_date

        outcome = mark_absentees_for_date(FRIDAY_JUNE, force=True)

        self.assertTrue(outcome["non_working_day"])
        self.assertFalse(
            AttendanceRecord.objects.filter(date=FRIDAY_JUNE, status=AttendanceRecord.Status.ABSENT).exists()
        )

    def test_absence_detection_skips_saturday_only_for_saudi_employees(self):
        from .absence import mark_absentees_for_date

        self.profile.is_saudi = True
        self.profile.save(update_fields=["is_saudi"])

        mark_absentees_for_date(SATURDAY_JUNE, force=True)

        self.assertFalse(
            AttendanceRecord.objects.filter(
                employee_profile=self.profile, date=SATURDAY_JUNE, status=AttendanceRecord.Status.ABSENT
            ).exists()
        )


class WorkingDayHelperUsageTests(SimpleTestCase):
    def test_the_removed_work_week_setting_is_gone_from_the_model(self):
        from admin_portal.models import SystemSettings

        field_names = {field.name for field in SystemSettings._meta.get_fields()}
        self.assertNotIn("work_week_days", field_names)
        self.assertNotIn("grace_use_limit_per_month", field_names)

    def test_the_work_schedule_no_longer_carries_a_configurable_week(self):
        from .schedule import WorkSchedule

        self.assertNotIn("work_week_days", WorkSchedule.__dataclass_fields__)
        self.assertFalse(hasattr(WorkSchedule, "is_working_day"))


class NonWorkingDayCalculationTests(SimpleTestCase):
    def test_a_day_off_is_scheduled_for_no_missing_time(self):
        """`calculate_daily_attendance` zeroes missing minutes on a day off."""
        from admin_portal.models import SystemSettings

        from .calculation import calculate_daily_attendance

        settings_obj = SystemSettings(
            work_day_start_time=time(9, 0), default_shift_end_time=time(18, 0), grace_window_minutes=15
        )
        common = dict(work_date=SATURDAY_JUNE, settings_obj=settings_obj)

        working = calculate_daily_attendance([], working_day=True, **common)
        off = calculate_daily_attendance([], working_day=False, **common)

        self.assertEqual(working.missing_minutes, working.shift.scheduled_minutes)
        self.assertEqual(off.missing_minutes, 0)
        self.assertEqual(off.status_input, "PRESENT")

    def test_a_late_arrival_on_a_day_off_is_not_late(self):
        from admin_portal.models import SystemSettings

        from .calculation import calculate_daily_attendance

        settings_obj = SystemSettings(
            work_day_start_time=time(9, 0), default_shift_end_time=time(18, 0), grace_window_minutes=15
        )
        start = timezone.make_aware(datetime.combine(SATURDAY_JUNE, time(9, 0)))
        event = NormalizedAttendanceEvent(
            attendance_date=SATURDAY_JUNE,
            occurred_at=start + timedelta(hours=2),
            event_type=NormalizedAttendanceEvent.EventType.CHECK_IN,
            sequence=1,
        )

        working = calculate_daily_attendance(
            [event], work_date=SATURDAY_JUNE, settings_obj=settings_obj, working_day=True
        )
        off = calculate_daily_attendance(
            [event], work_date=SATURDAY_JUNE, settings_obj=settings_obj, working_day=False
        )

        self.assertEqual(working.status_input, "LATE")
        self.assertEqual(off.status_input, "PRESENT")
