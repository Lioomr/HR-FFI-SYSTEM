"""Final attendance-policy projection layered over immutable attendance evidence."""

from __future__ import annotations

from datetime import date as date_type
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import transaction

from admin_portal.models import SystemSettings
from audit.utils import audit
from payroll.models import AttendancePayrollDeduction, PayrollRun

from .biotime_policy import is_attendance_exempt
from .models import AttendanceAdjustment, AttendanceDailyResult, AttendanceGraceUse, AttendanceLateViolation
from .schedule import is_working_day

Lifecycle = AttendanceLateViolation.Lifecycle
DeductionStatus = AttendancePayrollDeduction.Status

# Lifetime sequencing counts every violation that is, or was, chargeable.
# Void violations were never charged and never count.
COUNTED_LIFECYCLES = (Lifecycle.ACTIVE, Lifecycle.APPLIED, Lifecycle.MANUAL_REVIEW)
# Payroll-locked history: never re-rated, re-sequenced, or reactivated.
FROZEN_LIFECYCLES = (Lifecycle.APPLIED, Lifecycle.MANUAL_REVIEW)

# The grace window stays open all month until the employee collects this many
# late violations; from the next arrival on it is withdrawn for the rest of that
# month. Fixed company policy, deliberately not an HR-editable setting.
MONTHLY_LATE_VIOLATION_LIMIT = 3


def _is_payroll_locked(violation) -> bool:
    """Only a penalty payroll actually charged is frozen history.

    A zero-amount warning is never a payroll deduction, so an excused warning
    voids normally rather than becoming a manual-review exception.
    """
    return violation.lifecycle in FROZEN_LIFECYCLES and violation.penalty_amount > 0


def _month_start(value: date_type) -> date_type:
    return value.replace(day=1)


def _next_month_start(month: date_type) -> date_type:
    return (month.replace(day=28) + timedelta(days=4)).replace(day=1)


def _late_policy_effective_from() -> date_type | None:
    """Return the optional date from which late-policy actions are allowed."""
    configured = str(getattr(settings, "LATE_POLICY_EFFECTIVE_FROM", "") or "").strip()
    if not configured:
        return None
    try:
        return date_type.fromisoformat(configured)
    except ValueError as exc:
        raise ImproperlyConfigured("LATE_POLICY_EFFECTIVE_FROM must use YYYY-MM-DD.") from exc


def penalty_percent(occurrence: int) -> Decimal:
    """Lifetime occurrence 1 is a zero-amount warning; 2 is 5%, 3 is 10%, 4+ is 50%."""
    return {1: Decimal("0"), 2: Decimal("0.05"), 3: Decimal("0.10")}.get(occurrence, Decimal("0.50"))


def _daily_rate(profile) -> Decimal:
    return ((profile.total_salary or Decimal("0")) / Decimal("30")).quantize(Decimal("0.01"), ROUND_HALF_UP)


def _penalty_amount(daily_rate: Decimal, percent: Decimal) -> Decimal:
    return (daily_rate * percent).quantize(Decimal("0.01"), ROUND_HALF_UP)


def union_permission_minutes(adjustments, *, shift_start, shift_end, physical_intervals=()):
    """Union valid During Shift intervals, excluding time already physically worked."""
    intervals = []
    for adjustment in adjustments:
        if adjustment.kind != AttendanceAdjustment.Kind.DURING_SHIFT_PERMISSION:
            continue
        if not adjustment.start_time or not adjustment.end_time:
            continue
        start = shift_start.replace(hour=adjustment.start_time.hour, minute=adjustment.start_time.minute, second=0, microsecond=0)
        end = shift_start.replace(hour=adjustment.end_time.hour, minute=adjustment.end_time.minute, second=0, microsecond=0)
        if end <= start:
            continue
        intervals.append((max(start, shift_start), min(end, shift_end)))
    intervals = sorted((start, end) for start, end in intervals if end > start)
    merged = []
    for start, end in intervals:
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))

    # Foundation currently provides a daily physical total rather than worked
    # intervals.  Accept explicit intervals for callers that have them; never
    # manufacture physical-work time from an approval.
    def remaining(start, end):
        segments = [(start, end)]
        for physical_start, physical_end in physical_intervals:
            next_segments = []
            for left, right in segments:
                if physical_end <= left or physical_start >= right:
                    next_segments.append((left, right))
                else:
                    if left < physical_start:
                        next_segments.append((left, physical_start))
                    if physical_end < right:
                        next_segments.append((physical_end, right))
            segments = next_segments
        return segments

    return sum(int((end - start).total_seconds() // 60) for interval in merged for start, end in remaining(*interval))


def _locked_deduction(violation):
    return AttendancePayrollDeduction.objects.select_for_update().filter(violation=violation).first()


def _remove_warning_deduction(deduction):
    """A zero-amount warning carries no payroll deduction.

    A row no payroll run holds was never inside any totals and is deleted. A row
    still held by a draft is voided so that draft's next sync releases exactly what
    it included; a zero row inside a locked run is voided in place, which changes no
    totals because nothing was ever included.
    """
    if deduction is None:
        return
    if deduction.payroll_run_id is None and deduction.status in (DeductionStatus.PENDING, DeductionStatus.VOID):
        deduction.delete()
    elif deduction.status != DeductionStatus.VOID and (
        deduction.status in (DeductionStatus.PENDING, DeductionStatus.CLAIMED) or deduction.claimed_amount == 0
    ):
        deduction.status = DeductionStatus.VOID
        deduction.save(update_fields=["status", "updated_at"])


def _sync_deduction(violation):
    """Keep an unlocked deduction equal to its active monetary penalty; warnings have none."""
    deduction = _locked_deduction(violation)
    if violation.penalty_amount <= 0:
        _remove_warning_deduction(deduction)
        return None
    if deduction is None:
        return AttendancePayrollDeduction.objects.create(
            violation=violation,
            employee_profile_id=violation.employee_profile_id,
            company_id=violation.company_id,
            intended_year=violation.date.year,
            intended_month=violation.date.month,
            amount=violation.penalty_amount,
        )
    fields = {"status": deduction.status, "amount": violation.penalty_amount}
    if deduction.status in (DeductionStatus.APPLIED, DeductionStatus.MANUAL_REVIEW):
        if deduction.claimed_amount:
            # Money inside a locked run is never rewritten.
            return deduction
        # A leftover zero-value warning row included nothing, so it can carry this penalty.
        fields.update(status=DeductionStatus.PENDING, payroll_run=None, payroll_run_item=None)
    elif deduction.status == DeductionStatus.VOID:
        if deduction.payroll_run_id and deduction.payroll_run.status == PayrollRun.Status.DRAFT:
            # Still held by a draft: that draft's next sync re-includes it.
            fields["status"] = DeductionStatus.CLAIMED
        elif deduction.payroll_run_id and deduction.claimed_amount:
            return deduction
        else:
            # Nothing of this row is inside a locked run's totals, so it is due again.
            fields.update(status=DeductionStatus.PENDING, payroll_run=None, payroll_run_item=None)
    if any(getattr(deduction, name) != value for name, value in fields.items()):
        for name, value in fields.items():
            setattr(deduction, name, value)
        deduction.save(update_fields=[*fields, "updated_at"])
    return deduction


def _void_deduction(violation):
    deduction = _locked_deduction(violation)
    if deduction and deduction.status in (DeductionStatus.PENDING, DeductionStatus.CLAIMED):
        # A draft still holding this claim releases it from its totals on its next sync.
        deduction.status = DeductionStatus.VOID
        deduction.save(update_fields=["status", "updated_at"])


def _flag_deduction_for_review(violation):
    deduction = _locked_deduction(violation)
    if deduction and deduction.status == DeductionStatus.APPLIED:
        deduction.status = DeductionStatus.MANUAL_REVIEW
        deduction.save(update_fields=["status", "updated_at"])


def _notify_violation(profile, violation):
    if not profile.user_id:
        return
    try:
        from in_app_notifications.dispatcher import dispatch_notification_channels
        from in_app_notifications.models import Notification

        dispatch_notification_channels(
            recipient=profile.user,
            event_key="attendance.late_violation",
            title="Late attendance recorded",
            message=f"A late attendance violation was recorded for {violation.date.isoformat()}.",
            category=Notification.Category.ATTENDANCE,
            action_url="/employee/attendance",
            related_object=violation,
            company=profile.company,
            deduplication_key=f"attendance.late_violation:{violation.id}",
        )
    except Exception:
        # Attendance enforcement is authoritative even when an optional
        # external delivery provider is unavailable.
        pass


class AttendancePolicyService:
    @staticmethod
    def classify_arrival(result, settings_obj, month_late_count, *, exempt, excused, working_day=True):
        """Return ``(late, reason, used_window)`` for one calculated work day.

        ``month_late_count`` is how many late violations this calendar month has
        already produced. Below :data:`MONTHLY_LATE_VIOLATION_LIMIT` the grace
        window is open with no cap on how often it is used; at the limit it is
        withdrawn for the rest of the month and only the post-grace tolerance
        remains.
        """
        if exempt:
            return False, "attendance_exempt", False
        if not working_day:
            # A punch on the employee's day off is recorded but never rated.
            return False, "non_working_day", False
        if excused:
            return False, "late_permission", False
        check_in = result.first_check_in_at
        if check_in is None:
            return False, "no_check_in", False
        if check_in <= result.shift_start_at:
            return False, "on_time", False
        if month_late_count < MONTHLY_LATE_VIOLATION_LIMIT:
            if check_in <= result.shift_start_at + timedelta(minutes=int(settings_obj.grace_window_minutes)):
                return False, "monthly_grace", True
            return True, "outside_grace", False
        # Once the window is withdrawn, lateness starts at the first minute past
        # the tolerance: with a 5-minute tolerance 09:05:59 is on time, 09:06:00 is late.
        late_at = result.shift_start_at + timedelta(minutes=int(settings_obj.post_grace_tolerance_minutes) + 1)
        if check_in >= late_at:
            return True, "post_grace_late", False
        return False, "post_grace_tolerance", False

    @classmethod
    def reconcile_month(cls, profile, work_date: date_type):
        """Reconcile one calendar month in date order, then re-sequence later history.

        Deterministic for delayed punch ingestion.  Applied and manual-review
        violations keep their historical occurrence and deduction snapshot but
        still count toward every later occurrence number.
        """
        with transaction.atomic():
            profile = type(profile).objects.select_related("company", "user").select_for_update(of=("self",)).get(
                pk=profile.pk
            )
            settings_obj = SystemSettings.get_solo()
            month = _month_start(work_date)
            next_month = _next_month_start(month)
            exempt = is_attendance_exempt(profile)
            results = list(
                AttendanceDailyResult.objects.select_for_update()
                .filter(employee_profile=profile, date__gte=month, date__lt=next_month)
                .order_by("date", "id")
            )
            violations = {
                violation.date: violation
                for violation in AttendanceLateViolation.objects.select_for_update().filter(
                    employee_profile=profile, date__gte=month, date__lt=next_month
                )
            }
            late_marker_days = {
                day
                for pair in AttendanceAdjustment.objects.filter(
                    employee_profile=profile,
                    date__gte=month,
                    date__lt=next_month,
                    kind=AttendanceAdjustment.Kind.LATE_PERMISSION,
                ).values_list("date", "effective_date")
                for day in pair
                if day
            }
            effective_from = _late_policy_effective_from()
            historical_violations = AttendanceLateViolation.objects.filter(
                employee_profile=profile, date__lt=month, lifecycle__in=COUNTED_LIFECYCLES
            )
            if effective_from is not None:
                historical_violations = historical_violations.filter(date__gte=effective_from)
            occurrences = historical_violations.count()
            # Every calendar month starts with the grace window open and no late
            # violations. Walking the month in date order is what resets it, so a
            # delayed punch on an earlier day moves the cutoff for every later day.
            month_late_count = 0
            for result in results:
                # Attendance remains visible, but late-policy actions begin only
                # on the configured cutover date. This covers sync and manual
                # recalculation because both call this central reconciliation.
                if effective_from is not None and result.date < effective_from:
                    continue
                working_day = is_working_day(profile, result.date)
                excused = result.date in late_marker_days
                late, reason, used_window = cls.classify_arrival(
                    result,
                    settings_obj,
                    month_late_count,
                    exempt=exempt,
                    excused=excused,
                    working_day=working_day,
                )
                AttendanceGraceUse.objects.update_or_create(
                    employee_profile=profile,
                    date=result.date,
                    defaults={
                        "company": profile.company,
                        "month": month,
                        "result": result,
                        "consumed": used_window,
                        "reason": reason,
                    },
                )
                violation = violations.get(result.date)
                if violation is not None and _is_payroll_locked(violation):
                    # Payroll-locked history still counts toward both sequences.
                    occurrences += 1
                    month_late_count += 1
                    if not late and violation.lifecycle == Lifecycle.APPLIED:
                        cls._send_to_manual_review(violation, reason)
                elif late:
                    occurrences += 1
                    month_late_count += 1
                    cls._charge(profile, result, violation, occurrences, reason)
                elif violation is not None and violation.lifecycle != Lifecycle.VOID:
                    # A voided violation never counts toward the month's limit.
                    cls._void(violation, reason)

                inputs = dict(result.calculation_inputs or {})
                inputs["policy"] = {
                    "late_excused": excused,
                    "grace_reason": reason,
                    "is_exempt": exempt,
                    "working_day": working_day,
                }
                result.status_input = "LATE" if late else "PRESENT"
                if not working_day:
                    # Recorded, but never counted as missing time.
                    result.missing_minutes = 0
                result.calculation_inputs = inputs
                result.save(
                    update_fields=["status_input", "missing_minutes", "calculation_inputs", "calculated_at"]
                )
            cls._resequence_from(profile, next_month, occurrences)
            return AttendanceDailyResult.objects.get(employee_profile=profile, date=work_date)

    @classmethod
    def _charge(cls, profile, result, violation, occurrence, reason):
        percent = penalty_percent(occurrence)
        if violation is None or violation.lifecycle == Lifecycle.VOID:
            daily_rate = _daily_rate(profile)
        else:
            # An open violation keeps the salary snapshot taken when it was recorded.
            daily_rate = violation.daily_rate
        amount = _penalty_amount(daily_rate, percent)

        if violation is None:
            violation = AttendanceLateViolation.objects.create(
                employee_profile=profile,
                company=profile.company,
                date=result.date,
                result=result,
                occurrence_number=occurrence,
                daily_rate=daily_rate,
                penalty_percent=percent,
                penalty_amount=amount,
                reason=reason,
            )
            _sync_deduction(violation)
            audit(
                None,
                "attendance_late_violation_created",
                "AttendanceLateViolation",
                violation.id,
                {"date": str(result.date), "occurrence": occurrence, "amount": str(amount)},
            )
            from .late_notices import issue_late_notice_for_new_violation

            # The notice carries the employee notification; the plain violation
            # notification is only the fallback when no notice could be issued.
            if issue_late_notice_for_new_violation(violation) is None:
                _notify_violation(profile, violation)
            return violation

        current = (violation.lifecycle, violation.occurrence_number, violation.daily_rate, violation.penalty_percent,
                   violation.penalty_amount, violation.reason, violation.void_reason)
        if current != (Lifecycle.ACTIVE, occurrence, daily_rate, percent, amount, reason, ""):
            previous_lifecycle = violation.lifecycle
            violation.lifecycle = Lifecycle.ACTIVE
            violation.occurrence_number = occurrence
            violation.daily_rate = daily_rate
            violation.penalty_percent = percent
            violation.penalty_amount = amount
            violation.reason = reason
            violation.void_reason = ""
            violation.save()
            audit(
                None,
                "attendance_late_violation_reactivated"
                if previous_lifecycle == Lifecycle.VOID
                else "attendance_late_violation_updated",
                "AttendanceLateViolation",
                violation.id,
                {"date": str(result.date), "occurrence": occurrence, "amount": str(amount)},
            )
        _sync_deduction(violation)
        return violation

    @staticmethod
    def _void(violation, reason):
        violation.lifecycle = Lifecycle.VOID
        violation.void_reason = reason
        violation.save(update_fields=["lifecycle", "void_reason", "updated_at"])
        if violation.penalty_amount > 0:
            _void_deduction(violation)
        else:
            _remove_warning_deduction(_locked_deduction(violation))
        audit(None, "attendance_late_violation_voided", "AttendanceLateViolation", violation.id, {"reason": reason})

    @staticmethod
    def _send_to_manual_review(violation, reason):
        # Locked payroll history is never credited automatically: HR resolves it.
        violation.lifecycle = Lifecycle.MANUAL_REVIEW
        violation.void_reason = reason
        violation.save(update_fields=["lifecycle", "void_reason", "updated_at"])
        _flag_deduction_for_review(violation)
        audit(
            None,
            "attendance_late_violation_manual_review",
            "AttendanceLateViolation",
            violation.id,
            {"reason": reason, "occurrence": violation.occurrence_number, "amount": str(violation.penalty_amount)},
        )

    @staticmethod
    def _resequence_from(profile, start_date, occurrences):
        """Renumber later open violations after an earlier month changed the lifetime count."""
        later = AttendanceLateViolation.objects.select_for_update().filter(
            employee_profile=profile, date__gte=start_date, lifecycle__in=COUNTED_LIFECYCLES
        ).order_by("date", "id")
        for violation in later:
            occurrences += 1
            if _is_payroll_locked(violation) or violation.occurrence_number == occurrences:
                continue
            percent = penalty_percent(occurrences)
            violation.occurrence_number = occurrences
            violation.penalty_percent = percent
            violation.penalty_amount = _penalty_amount(violation.daily_rate, percent)
            # A warning is never payroll history, so it is always open to renumbering.
            violation.lifecycle = Lifecycle.ACTIVE
            violation.save(
                update_fields=["occurrence_number", "penalty_percent", "penalty_amount", "lifecycle", "updated_at"]
            )
            _sync_deduction(violation)
            audit(
                None,
                "attendance_late_violation_resequenced",
                "AttendanceLateViolation",
                violation.id,
                {"occurrence": occurrences, "amount": str(violation.penalty_amount)},
            )

    @classmethod
    def recalculate(cls, profile, work_date):
        from .calculation import AttendanceCalculationService

        with transaction.atomic():
            AttendanceCalculationService.recalculate(profile, work_date, apply_policy=False)
            return cls.reconcile_month(profile, work_date)
