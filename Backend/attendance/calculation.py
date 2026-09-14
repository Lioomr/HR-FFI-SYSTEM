"""Deterministic attendance normalization and daily calculation primitives.

These functions deliberately have no permission-request or payroll knowledge.
They turn immutable device evidence into an explainable daily result that later
workflow code can enrich with approved permission minutes.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date as date_type
from datetime import datetime, timedelta
from typing import Iterable

from django.db import transaction
from django.utils import timezone

from admin_portal.models import SystemSettings

from .models import AttendanceAdjustment, AttendanceDailyResult, BioTimeRawPunch, NormalizedAttendanceEvent


@dataclass(frozen=True)
class DailyShiftDTO:
    start_at: datetime
    end_at: datetime
    scheduled_minutes: int


@dataclass(frozen=True)
class DailyAttendanceDTO:
    shift: DailyShiftDTO
    physical_work_minutes: int
    unpaid_break_minutes: int
    approved_permission_minutes: int
    accounted_attendance_minutes: int
    first_check_in_at: datetime | None
    final_check_out_at: datetime | None
    missing_minutes: int
    status_input: str


# BioTime 8.5 deployments commonly use punch_state 0..3. Explicit string
# aliases support agents that expose a human-readable provider field instead.
PUNCH_TYPE_MAP = {
    "0": NormalizedAttendanceEvent.EventType.CHECK_IN,
    "1": NormalizedAttendanceEvent.EventType.CHECK_OUT,
    "2": NormalizedAttendanceEvent.EventType.BREAK_OUT,
    "3": NormalizedAttendanceEvent.EventType.BREAK_IN,
    "CHECK_IN": NormalizedAttendanceEvent.EventType.CHECK_IN,
    "CHECKOUT": NormalizedAttendanceEvent.EventType.CHECK_OUT,
    "CHECK_OUT": NormalizedAttendanceEvent.EventType.CHECK_OUT,
    "BREAK_OUT": NormalizedAttendanceEvent.EventType.BREAK_OUT,
    "BREAK_IN": NormalizedAttendanceEvent.EventType.BREAK_IN,
    "IN": NormalizedAttendanceEvent.EventType.CHECK_IN,
    "OUT": NormalizedAttendanceEvent.EventType.CHECK_OUT,
}


def provider_punch_type(payload: dict) -> str:
    """Return the best provider punch type without guessing absent fields."""
    for key in ("punch_state", "punch_type", "state"):
        value = payload.get(key)
        if value not in (None, ""):
            return str(value).strip().upper()
    return ""


def resolve_shift(work_date: date_type, settings_obj: SystemSettings | None = None) -> DailyShiftDTO:
    settings_obj = settings_obj or SystemSettings.get_solo()
    tz = timezone.get_current_timezone()
    start_at = timezone.make_aware(datetime.combine(work_date, settings_obj.work_day_start_time), tz)
    end_at = timezone.make_aware(datetime.combine(work_date, settings_obj.default_shift_end_time), tz)
    if end_at <= start_at:
        end_at += timedelta(days=1)
    return DailyShiftDTO(
        start_at=start_at,
        end_at=end_at,
        scheduled_minutes=max(0, int((end_at - start_at).total_seconds() // 60)),
    )


def normalize_raw_punches(raw_punches: Iterable[BioTimeRawPunch]) -> list[tuple[BioTimeRawPunch, str, bool]]:
    """Classify punches in order, preferring trustworthy provider punch types.

    Untyped sequences are deterministic: first is check-in, last is check-out,
    and any interior events alternate break-out/break-in. This avoids pretending
    an opaque event has vendor type semantics while still producing a useful
    projection for older BioTime agents.
    """
    punches = sorted(raw_punches, key=lambda punch: (punch.occurred_at, punch.id))
    normalized: list[tuple[BioTimeRawPunch, str, bool]] = []
    for index, punch in enumerate(punches):
        event_type = PUNCH_TYPE_MAP.get((punch.raw_punch_type or "").upper())
        if event_type:
            normalized.append((punch, event_type, False))
            continue
        if index == 0:
            fallback = NormalizedAttendanceEvent.EventType.CHECK_IN
        elif index == len(punches) - 1:
            fallback = NormalizedAttendanceEvent.EventType.CHECK_OUT
        else:
            prior_type = normalized[-1][1] if normalized else NormalizedAttendanceEvent.EventType.CHECK_IN
            fallback = (
                NormalizedAttendanceEvent.EventType.BREAK_IN
                if prior_type == NormalizedAttendanceEvent.EventType.BREAK_OUT
                else NormalizedAttendanceEvent.EventType.BREAK_OUT
            )
        normalized.append((punch, fallback, True))
    return normalized


def calculate_daily_attendance(
    normalized_events: Iterable[NormalizedAttendanceEvent],
    *,
    work_date: date_type,
    approved_permission_minutes: int = 0,
    adjustments: Iterable[AttendanceAdjustment] | None = None,
    settings_obj: SystemSettings | None = None,
) -> DailyAttendanceDTO:
    """Calculate time inputs only. It never produces a penalty or deduction."""
    settings_obj = settings_obj or SystemSettings.get_solo()
    shift = resolve_shift(work_date, settings_obj)
    events = sorted(normalized_events, key=lambda event: (event.occurred_at, event.id or 0))
    first_check_in = next(
        (event.occurred_at for event in events if event.event_type == NormalizedAttendanceEvent.EventType.CHECK_IN),
        None,
    )
    if first_check_in is None and events:
        first_check_in = events[0].occurred_at

    break_started_at = None
    unpaid_break_minutes = 0
    departures: list[datetime] = []
    for event in events:
        if event.event_type == NormalizedAttendanceEvent.EventType.CHECK_OUT:
            departures.append(event.occurred_at)
        elif event.event_type == NormalizedAttendanceEvent.EventType.BREAK_OUT:
            break_started_at = event.occurred_at
        elif event.event_type == NormalizedAttendanceEvent.EventType.BREAK_IN and break_started_at:
            # A break that returns after shift end is still only unpaid through
            # the end of the scheduled shift.
            returned_at = min(event.occurred_at, shift.end_at)
            if returned_at > break_started_at:
                unpaid_break_minutes += int((returned_at - break_started_at).total_seconds() // 60)
            break_started_at = None

    # An unmatched Break Out is evidence of departure, not a mutable break.
    # It counts only when no later Break In arrives before shift end.
    for event in events:
        if event.event_type != NormalizedAttendanceEvent.EventType.BREAK_OUT:
            continue
        has_return = any(
            later.event_type == NormalizedAttendanceEvent.EventType.BREAK_IN
            and event.occurred_at < later.occurred_at <= shift.end_at
            for later in events
        )
        if not has_return:
            departures.append(event.occurred_at)

    final_check_out = max(departures) if departures else None
    physical_work_minutes = 0
    if first_check_in and final_check_out and final_check_out > first_check_in:
        physical_work_minutes = max(
            0, int((final_check_out - first_check_in).total_seconds() // 60) - unpaid_break_minutes
        )
    # Late/Exit adjustments deliberately never contribute minutes.  During
    # Shift time is interval-unioned, clamped to the shift, and discounted for
    # actual work intervals so approval cannot double-count physical work.
    if adjustments is not None:
        from .policy import union_permission_minutes

        physical_intervals = []
        if first_check_in and final_check_out and final_check_out > first_check_in:
            physical_intervals = [(first_check_in, final_check_out)]
            for event in events:
                if event.event_type != NormalizedAttendanceEvent.EventType.BREAK_OUT:
                    continue
                returned = next(
                    (
                        later.occurred_at
                        for later in events
                        if later.event_type == NormalizedAttendanceEvent.EventType.BREAK_IN
                        and later.occurred_at > event.occurred_at
                    ),
                    None,
                )
                if returned:
                    next_intervals = []
                    for left, right in physical_intervals:
                        if returned <= left or event.occurred_at >= right:
                            next_intervals.append((left, right))
                        else:
                            if left < event.occurred_at:
                                next_intervals.append((left, event.occurred_at))
                            if returned < right:
                                next_intervals.append((returned, right))
                    physical_intervals = next_intervals
        approved_permission_minutes = union_permission_minutes(
            adjustments,
            shift_start=shift.start_at,
            shift_end=shift.end_at,
            physical_intervals=physical_intervals,
        )
    approved_permission_minutes = max(0, int(approved_permission_minutes))
    accounted = physical_work_minutes + approved_permission_minutes
    missing = max(0, shift.scheduled_minutes - accounted)

    # Grace use exhaustion and the later five-minute tolerance are permission
    # workflow concerns. This foundation only classifies against the full
    # configured grace window.
    late_cutoff = shift.start_at + timedelta(minutes=int(settings_obj.grace_window_minutes))
    status_input = "LATE" if first_check_in and first_check_in > late_cutoff else "PRESENT"
    return DailyAttendanceDTO(
        shift=shift,
        physical_work_minutes=physical_work_minutes,
        unpaid_break_minutes=unpaid_break_minutes,
        approved_permission_minutes=approved_permission_minutes,
        accounted_attendance_minutes=accounted,
        first_check_in_at=first_check_in,
        final_check_out_at=final_check_out,
        missing_minutes=missing,
        status_input=status_input,
    )


class AttendanceCalculationService:
    """Transaction-safe persistence boundary for raw-punch recalculation."""

    @classmethod
    def recalculate(cls, employee_profile, work_date: date_type, *, apply_policy: bool = True) -> AttendanceDailyResult:
        with transaction.atomic():
            profile = type(employee_profile).objects.select_for_update().get(pk=employee_profile.pk)
            raw_punches = list(
                BioTimeRawPunch.objects.select_for_update()
                .filter(employee_profile=profile, attendance_date=work_date)
                .order_by("occurred_at", "id")
            )
            # A previous projection is replaceable; the source rows are not.
            NormalizedAttendanceEvent.objects.filter(employee_profile=profile, attendance_date=work_date).delete()
            events = [
                NormalizedAttendanceEvent(
                    raw_punch=punch,
                    employee_profile=profile,
                    attendance_date=work_date,
                    occurred_at=punch.occurred_at,
                    event_type=event_type,
                    sequence=sequence,
                    used_fallback=used_fallback,
                )
                for sequence, (punch, event_type, used_fallback) in enumerate(
                    normalize_raw_punches(raw_punches), start=1
                )
            ]
            NormalizedAttendanceEvent.objects.bulk_create(events)
            adjustments = AttendanceAdjustment.objects.select_for_update().filter(
                employee_profile=profile, date=work_date
            )
            adjustments = list(adjustments)
            result_dto = calculate_daily_attendance(
                events,
                work_date=work_date,
                adjustments=adjustments,
            )
            defaults = {
                "company": profile.company,
                "shift_start_at": result_dto.shift.start_at,
                "shift_end_at": result_dto.shift.end_at,
                "scheduled_minutes": result_dto.shift.scheduled_minutes,
                "first_check_in_at": result_dto.first_check_in_at,
                "final_check_out_at": result_dto.final_check_out_at,
                "physical_work_minutes": result_dto.physical_work_minutes,
                "unpaid_break_minutes": result_dto.unpaid_break_minutes,
                "approved_permission_minutes": result_dto.approved_permission_minutes,
                "accounted_attendance_minutes": result_dto.accounted_attendance_minutes,
                "missing_minutes": result_dto.missing_minutes,
                "status_input": result_dto.status_input,
                "calculation_inputs": {
                    "raw_punch_ids": [punch.id for punch in raw_punches],
                    "approved_adjustment_minutes": result_dto.approved_permission_minutes,
                    "normalization_version": 1,
                },
            }
            result, _ = AttendanceDailyResult.objects.select_for_update().update_or_create(
                employee_profile=profile, date=work_date, defaults=defaults
            )
            if apply_policy:
                from .policy import AttendancePolicyService

                return AttendancePolicyService.reconcile_month(profile, work_date)
            return result
