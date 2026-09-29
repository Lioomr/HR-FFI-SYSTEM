"""Issue schedule penalties and reconcile prospective attendance evidence."""

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from audit.utils import audit
from leaves.utils import get_contract_year_cycle

from .catalog import monetary_amount
from .models import PenaltyCatalog, PenaltyDeduction, PenaltyRecord


def effective_from():
    raw = getattr(settings, "PENALTIES_EFFECTIVE_FROM", "2026-09-29")
    try:
        return date.fromisoformat(str(raw))
    except ValueError as exc:
        raise ImproperlyConfigured("PENALTIES_EFFECTIVE_FROM must be YYYY-MM-DD.") from exc


def _count_period_start(profile, catalog, occurred_on):
    if catalog.count_period == PenaltyCatalog.Period.MONTHLY:
        return occurred_on.replace(day=1)
    if catalog.count_period == PenaltyCatalog.Period.CONTRACT_YEAR:
        start, _end = get_contract_year_cycle(profile, occurred_on)
        return start or occurred_on
    return None


def _next_occurrence(profile, catalog, occurred_on, *, exclude_id=None):
    qs = PenaltyRecord.objects.filter(
        employee_profile=profile,
        catalog__recurrence_group=catalog.recurrence_group,
        occurred_on__lte=occurred_on,
        status__in=[PenaltyRecord.Status.ISSUED, PenaltyRecord.Status.DISPUTED, PenaltyRecord.Status.APPLIED],
    )
    start = _count_period_start(profile, catalog, occurred_on)
    if start:
        qs = qs.filter(occurred_on__gte=start)
    if exclude_id:
        qs = qs.exclude(pk=exclude_id)
    return qs.count() + 1


def _rated_level(catalog, occurrence):
    levels = catalog.levels
    if not levels:
        raise ValueError("Catalog row has no schedule action.")
    if occurrence > len(levels) and len(levels) < 4:
        raise ValueError("The source schedule does not specify another occurrence level for this violation.")
    return levels[min(occurrence, len(levels)) - 1]


def _extra_wage_amount(record, catalog):
    kind = catalog.extra_wage_deduction
    if not kind:
        return Decimal("0.00")
    daily = (record.employee_profile.total_salary or Decimal("0")) / Decimal("30")
    evidence = record.evidence or {}
    if kind in {"late_minutes", "late_hours", "unworked_time"}:
        minutes = Decimal(str(evidence.get("minutes", 0)))
        scheduled = Decimal(str(evidence.get("scheduled_minutes", 0)))
        if scheduled <= 0:
            return Decimal("0.00")
        return (daily * minutes / scheduled).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if kind == "absence_period":
        days = Decimal(str(evidence.get("absence_days", 0)))
        return (daily * days).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return Decimal("0.00")


def issue(record, *, catalog=None, request=None, marker=None):
    """Rate only after the HR facts required by the printed row are confirmed."""
    catalog = catalog or record.catalog
    profile = record.employee_profile
    occurrence = _next_occurrence(profile, catalog, record.occurred_on, exclude_id=record.pk)
    level = _rated_level(catalog, occurrence)
    record.catalog = catalog
    record.occurrence_number = occurrence
    record.action = level["action"]
    record.amount = monetary_amount(profile, level)
    five_days_wages = ((profile.total_salary or Decimal("0")) / Decimal("30") * Decimal("5")).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
    if record.amount > five_days_wages:
        raise ValueError("A single disciplinary fine cannot exceed five days' wages.")
    record.extra_wage_amount = _extra_wage_amount(record, catalog)
    record.total_deduction_amount = record.amount + record.extra_wage_amount
    record.status = PenaltyRecord.Status.ISSUED
    if marker:
        record.resolution = marker
    record.save(
        update_fields=[
            "catalog",
            "occurrence_number",
            "action",
            "amount",
            "extra_wage_amount",
            "total_deduction_amount",
            "status",
            "resolution",
            "updated_at",
        ]
    )
    if record.total_deduction_amount > 0:
        PenaltyDeduction.objects.update_or_create(
            penalty=record,
            defaults={
                "company": record.company,
                "employee_profile": profile,
                "intended_year": record.occurred_on.year,
                "intended_month": record.occurred_on.month,
                "amount": record.total_deduction_amount,
                "status": PenaltyDeduction.Status.PENDING_REVIEW,
            },
        )
    audit(
        request,
        "penalty_issued",
        "PenaltyRecord",
        record.pk,
        {
            "catalog_code": catalog.code,
            "source_page": catalog.source_page,
            "source_row": catalog.source_row,
            "occurrence": occurrence,
            "action": record.action,
            "amount": str(record.amount),
            "extra_wage_amount": str(record.extra_wage_amount),
            "total_deduction_amount": str(record.total_deduction_amount),
            "marker": marker,
        },
    )
    return record


def waive(record, *, reason, request=None, decision="waive"):
    previous = record.status
    record.status = PenaltyRecord.Status.WAIVED
    record.resolution = {"decision": decision, "reason": reason, "resolved_at": timezone.now().isoformat()}
    record.save(update_fields=["status", "resolution", "updated_at"])
    deduction = PenaltyDeduction.objects.select_for_update().filter(penalty=record).first()
    if deduction and deduction.status != PenaltyDeduction.Status.APPLIED:
        deduction.status = PenaltyDeduction.Status.VOID
        deduction.save(update_fields=["status", "updated_at"])
    audit(
        request,
        "penalty_waived",
        "PenaltyRecord",
        record.pk,
        {
            "from": previous,
            "decision": decision,
            "reason": reason,
            "payroll_status": deduction.status if deduction else None,
        },
    )
    return record


def _candidate(
    profile, catalog_code, occurred_on, source_kind, *, result=None, attendance_record=None, note="", evidence=None
):
    catalog = PenaltyCatalog.objects.get(code=catalog_code)
    source = {"attendance_result": result} if result else {"attendance_record": attendance_record}
    record, created = PenaltyRecord.objects.get_or_create(
        **source,
        source_kind=source_kind,
        defaults={
            "company": profile.company,
            "employee_profile": profile,
            "catalog": catalog,
            "occurred_on": occurred_on,
            "occurrence_number": 0,
            "action": "pending_hr_mark",
            "status": PenaltyRecord.Status.PENDING_HR_MARK,
            "source": PenaltyRecord.Source.AUTOMATIC,
            "note": note,
            "evidence": evidence or {},
        },
    )
    if (
        not created
        and record.status == PenaltyRecord.Status.WAIVED
        and ((record.resolution or {}).get("reason") == "Attendance evidence no longer supports this candidate.")
    ):
        deduction = PenaltyDeduction.objects.filter(penalty=record).first()
        if not deduction or deduction.status != PenaltyDeduction.Status.APPLIED:
            record.status = PenaltyRecord.Status.PENDING_HR_MARK
            record.resolution = None
            record.action = "pending_hr_mark"
            record.amount = Decimal("0.00")
            record.extra_wage_amount = Decimal("0.00")
            record.total_deduction_amount = Decimal("0.00")
            record.save(
                update_fields=[
                    "status",
                    "resolution",
                    "action",
                    "amount",
                    "extra_wage_amount",
                    "total_deduction_amount",
                    "updated_at",
                ]
            )
            audit(None, "penalty_attendance_candidate_reopened", "PenaltyRecord", record.pk)
    if not created and record.status == PenaltyRecord.Status.PENDING_HR_MARK:
        updates = []
        if record.catalog_id != catalog.pk:
            record.catalog = catalog
            updates.append("catalog")
        if record.occurred_on != occurred_on:
            record.occurred_on = occurred_on
            updates.append("occurred_on")
        if record.evidence != (evidence or {}):
            record.evidence = evidence or {}
            updates.append("evidence")
        if record.note != note:
            record.note = note
            updates.append("note")
        if updates:
            record.save(update_fields=[*updates, "updated_at"])
    if created:
        audit(
            None,
            "penalty_attendance_candidate_created",
            "PenaltyRecord",
            record.pk,
            {
                "catalog_code": catalog_code,
                "date": str(occurred_on),
                "source_kind": source_kind,
            },
        )
    return record


def _invalidate_record(record, reason="Attendance evidence no longer supports this candidate."):
    applied = PenaltyDeduction.objects.filter(penalty=record, status=PenaltyDeduction.Status.APPLIED).exists()
    if record.status == PenaltyRecord.Status.APPLIED or applied:
        if (record.resolution or {}).get("decision") != "manual_review":
            record.resolution = {
                "decision": "manual_review",
                "reason": reason,
                "resolved_at": timezone.now().isoformat(),
            }
            record.save(update_fields=["resolution", "updated_at"])
            audit(None, "penalty_post_payroll_correction_review", "PenaltyRecord", record.pk, {"reason": reason})
            from .notifications import notify_penalty

            transaction.on_commit(lambda record=record: notify_penalty(record, "manual_review", hr=True))
    elif record.status != PenaltyRecord.Status.WAIVED:
        waive(record, reason=reason)


def _invalidate_missing(result, observed_kinds):
    for record in (
        PenaltyRecord.objects.select_for_update()
        .filter(attendance_result=result)
        .exclude(source_kind__in=observed_kinds)
    ):
        _invalidate_record(record)


def sync_attendance_candidates(result):
    """Use final attendance projections; HR must verify permission and disruption."""
    if result.date < effective_from():
        return
    profile = result.employee_profile
    policy = (result.calculation_inputs or {}).get("policy", {})
    if not policy.get("working_day", True):
        _invalidate_missing(result, set())
        return
    observed = set()
    # The printed schedule starts at the first measured minute. The legacy
    # attendance status has a grace window and must not gate this ledger.
    if (
        result.first_check_in_at
        and result.first_check_in_at > result.shift_start_at
        and not policy.get("late_excused")
        and not policy.get("is_exempt")
    ):
        minutes = max(1, int((result.first_check_in_at - result.shift_start_at).total_seconds() // 60))
        code = "W01" if minutes <= 15 else "W03" if minutes <= 30 else "W05" if minutes <= 60 else "W07"
        _candidate(
            profile,
            code,
            result.date,
            "late_arrival",
            result=result,
            note=f"Measured {minutes} late minutes. HR must confirm permission/excuse and whether other workers were disrupted.",
            evidence={"minutes": minutes, "scheduled_minutes": result.scheduled_minutes},
        )
        observed.add("late_arrival")
    if result.final_check_out_at and result.final_check_out_at < result.shift_end_at:
        minutes = max(1, int((result.shift_end_at - result.final_check_out_at).total_seconds() // 60))
        _candidate(
            profile,
            "W08" if minutes <= 15 else "W09",
            result.date,
            "early_departure",
            result=result,
            note=f"Measured {minutes} early-departure minutes. HR must confirm there was no permission or acceptable excuse.",
            evidence={"minutes": minutes, "scheduled_minutes": result.scheduled_minutes},
        )
        observed.add("early_departure")
    if result.final_check_out_at and result.final_check_out_at > result.shift_end_at:
        _candidate(
            profile,
            "W10",
            result.date,
            "after_hours",
            result=result,
            note="Checkout is later than shift end. HR must confirm the worker stayed or returned without prior permission.",
        )
        observed.add("after_hours")
    _invalidate_missing(result, observed)
    if result.first_check_in_at or result.final_check_out_at:
        reconcile_absence_candidates(profile, result.date)


def _is_absence_eligible(record):
    from attendance.leave_resolution import with_leave_resolution
    from attendance.models import AttendanceDailyResult, AttendanceRecord
    from attendance.schedule import is_working_day

    if record.status != AttendanceRecord.Status.ABSENT or record.source != AttendanceRecord.Source.SYSTEM:
        return False
    if not is_working_day(record.employee_profile, record.date):
        return False
    if record.check_in_at or record.check_out_at:
        return False
    if (
        AttendanceDailyResult.objects.filter(employee_profile_id=record.employee_profile_id, date=record.date)
        .filter(Q(first_check_in_at__isnull=False) | Q(final_check_out_at__isnull=False))
        .exists()
    ):
        return False
    resolved = with_leave_resolution(AttendanceRecord.objects.filter(pk=record.pk)).first()
    return bool(resolved and resolved.effective_status == AttendanceRecord.Status.ABSENT)


@transaction.atomic
def reconcile_absence_candidates(profile, changed_date):
    """Re-rate pending absence bands after punch, record or leave corrections."""
    from attendance.models import AttendanceRecord

    if (
        changed_date < effective_from()
        or not PenaltyRecord.objects.filter(employee_profile=profile, source_kind="absence").exists()
    ):
        return
    cycle_start, cycle_end = get_contract_year_cycle(profile, changed_date)
    cycle_start = max(cycle_start or effective_from(), effective_from())
    cycle_end = cycle_end or changed_date
    rows = list(
        AttendanceRecord.objects.filter(
            employee_profile=profile,
            date__gte=cycle_start,
            date__lte=cycle_end,
            source=AttendanceRecord.Source.SYSTEM,
            status=AttendanceRecord.Status.ABSENT,
        ).order_by("date", "id")
    )
    eligible = [row for row in rows if _is_absence_eligible(row)]
    eligible_dates = {row.date for row in eligible}
    for candidate in PenaltyRecord.objects.select_for_update().filter(
        employee_profile=profile,
        source_kind="absence",
        occurred_on__gte=cycle_start,
        occurred_on__lte=cycle_end,
    ):
        if candidate.occurred_on not in eligible_dates or candidate.attendance_record_id not in {
            row.pk for row in eligible
        }:
            _invalidate_record(candidate)
        elif candidate.status == PenaltyRecord.Status.ISSUED:
            original_days = (candidate.evidence or {}).get("absence_days", 0)
            current_days = sum(
                1 for row in eligible if candidate.attendance_record.date <= row.date <= candidate.occurred_on
            )
            if current_days < original_days:
                _invalidate_record(candidate)
    if eligible:
        sync_absence_candidates(eligible)


def sync_absence_candidates(records):
    """Advance one continuous absence candidate through printed duration bands.

    An HR-issued earlier band is immutable; the next threshold opens its own
    candidate. A still-pending candidate advances, so a daily detector replay
    never produces one penalty per absent day.
    """
    from attendance.models import AttendanceRecord
    from attendance.schedule import is_working_day

    for record in records:
        if record.date < effective_from() or not _is_absence_eligible(record):
            continue
        profile = record.employee_profile
        cycle_start, _cycle_end = get_contract_year_cycle(profile, record.date)
        cycle_start = max(cycle_start or effective_from(), effective_from())
        rows = [
            row
            for row in AttendanceRecord.objects.filter(
                employee_profile=profile,
                date__gte=cycle_start,
                date__lte=record.date,
                source=AttendanceRecord.Source.SYSTEM,
                status=AttendanceRecord.Status.ABSENT,
            ).order_by("date", "id")
            if _is_absence_eligible(row)
        ]
        if not rows:
            continue
        by_date = {row.date: row for row in rows}
        streak = [record]
        cursor = record.date
        while cursor > cycle_start:
            cursor -= date.resolution
            if not is_working_day(profile, cursor):
                continue
            previous = by_date.get(cursor)
            if previous is None:
                break
            streak.insert(0, previous)
        # The printed continuous-absence bands use elapsed days, not working
        # days. An off-day may bridge two verified missed shifts but never
        # supplies absence evidence by itself.
        continuous_calendar_days = (record.date - streak[0].date).days + 1
        missed_shifts = len(streak)
        total = len(rows)
        if continuous_calendar_days == 15:
            # The printed bands stop at 14 and resume only when absence
            # exceeds 15 days. Day 15 adds no invented schedule action.
            continue
        code = (
            "W15"
            if continuous_calendar_days >= 16
            else "W16"
            if total >= 31
            else "W14"
            if continuous_calendar_days >= 11
            else "W13"
            if continuous_calendar_days >= 7
            else "W12"
            if continuous_calendar_days >= 2
            else "W11"
        )
        threshold = {"W11": 1, "W12": 2, "W13": 7, "W14": 11, "W15": 16}.get(code)
        anchor = (
            next(row for row in streak if (row.date - streak[0].date).days + 1 >= threshold) if threshold else rows[30]
        )
        pending = (
            PenaltyRecord.objects.filter(
                attendance_record__in=streak, source_kind="absence", status=PenaltyRecord.Status.PENDING_HR_MARK
            )
            .order_by("pk")
            .first()
        )
        if pending:
            anchor = pending.attendance_record
        _candidate(
            profile,
            code,
            record.date,
            "absence",
            attendance_record=anchor,
            note=f"System absence: {continuous_calendar_days} continuous calendar days between missed scheduled shifts, {missed_shifts} missed shifts, {total} missed shifts in this contract year. HR must confirm no written permission, acceptable excuse or covering leave and any required warning.",
            evidence={
                "absence_days": missed_shifts,
                "continuous_calendar_days": continuous_calendar_days,
                "contract_year_absence_days": total,
            },
        )
