"""Issue schedule penalties and reconcile prospective attendance evidence."""

from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from audit.utils import audit
from employees.models import EmployeeProfile

from .catalog import monetary_amount
from .models import PenaltyCatalog, PenaltyDeduction, PenaltyRecord, PenaltyWarningNotice


def effective_from():
    raw = getattr(settings, "PENALTIES_EFFECTIVE_FROM", "2026-09-29")
    try:
        return date.fromisoformat(str(raw))
    except ValueError as exc:
        raise ImproperlyConfigured("PENALTIES_EFFECTIVE_FROM must be YYYY-MM-DD.") from exc


# Company policy layered on the frozen printed schedule (the catalog is unchanged):
# the first three monthly occurrences of these rows are written warnings, issued
# automatically. Occurrence 4 onward uses the printed levels shifted by two.
AUTO_WARNING_ROWS = frozenset({"W01", "W02", "W07"})
EXTRA_AUTO_WARNINGS = 2


def auto_warnings_effective_from():
    """Rollout date of automatic warnings, or None while the feature is off."""
    raw = str(getattr(settings, "PENALTY_AUTO_WARNINGS_EFFECTIVE_FROM", "") or "").strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError as exc:
        raise ImproperlyConfigured("PENALTY_AUTO_WARNINGS_EFFECTIVE_FROM must be YYYY-MM-DD or empty.") from exc


def auto_warning_settle_hours():
    raw = getattr(settings, "PENALTY_AUTO_WARNING_SETTLE_HOURS", 12)
    try:
        hours = int(str(raw).strip())
    except ValueError:
        hours = -1
    if hours < 0:
        raise ImproperlyConfigured("PENALTY_AUTO_WARNING_SETTLE_HOURS must be a non-negative whole number.")
    return hours


def auto_warning_applies(catalog, occurred_on):
    start = auto_warnings_effective_from()
    return start is not None and catalog.code in AUTO_WARNING_ROWS and occurred_on >= start


def penalty_year_cycle(profile, occurred_on):
    """One anniversary year; contract expiry does not lengthen recurrence."""
    anchor = profile.contract_date or profile.hire_date or effective_from()

    def anniversary(year):
        try:
            return anchor.replace(year=year)
        except ValueError:
            return anchor.replace(year=year, day=28)

    year = occurred_on.year
    if anniversary(year) > occurred_on:
        year -= 1
    return anniversary(year), anniversary(year + 1) - date.resolution


def _count_period_start(profile, catalog, occurred_on):
    if catalog.count_period == PenaltyCatalog.Period.MONTHLY:
        return occurred_on.replace(day=1)
    if catalog.count_period == PenaltyCatalog.Period.CONTRACT_YEAR:
        start, _end = penalty_year_cycle(profile, occurred_on)
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
        qs = qs.filter(Q(occurred_on__lt=occurred_on) | Q(occurred_on=occurred_on, pk__lt=exclude_id))
    return qs.count() + 1


def _rated_level(catalog, occurrence, occurred_on=None):
    levels = catalog.levels
    if not levels:
        raise ValueError("Catalog row has no schedule action.")
    if occurred_on is not None and auto_warning_applies(catalog, occurred_on):
        if occurrence <= EXTRA_AUTO_WARNINGS + 1:
            return levels[0]
        occurrence -= EXTRA_AUTO_WARNINGS
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
        # Cover actual missed shifts once, including applied/waived deductions
        # whose payroll charge remains historical. Never infer a refund here.
        dates = set(evidence.get("absence_dates", []))
        previous = (
            PenaltyRecord.objects.filter(employee_profile=record.employee_profile, source_kind="absence")
            .exclude(pk=record.pk)
            .filter(extra_wage_amount__gt=0)
        )
        covered = set()
        for prior in previous:
            if (
                prior.status == PenaltyRecord.Status.WAIVED
                and not PenaltyDeduction.objects.filter(penalty=prior, status=PenaltyDeduction.Status.APPLIED).exists()
            ):
                continue
            prior_evidence = prior.evidence or {}
            prior_dates = prior_evidence.get("wage_absence_dates", prior_evidence.get("absence_dates"))
            if prior_dates is None and prior_evidence.get("spell_start_on") == evidence.get("spell_start_on"):
                raise ValueError("Earlier absence wages need HR reconciliation before another band can be issued.")
            covered.update(prior_dates or [])
        if not dates and evidence.get("absence_days"):
            raise ValueError("Verified absence dates are required before absence wages can be issued.")
        uncovered = sorted(dates - covered)
        record.evidence = {**evidence, "wage_absence_dates": uncovered}
        days = Decimal(len(uncovered))
        return (daily * days).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return Decimal("0.00")


@transaction.atomic
def issue(record, *, catalog=None, request=None, marker=None):
    """Rate only after the HR facts required by the printed row are confirmed."""
    catalog = catalog or record.catalog
    profile = EmployeeProfile.objects.select_for_update().get(pk=record.employee_profile_id)
    current = PenaltyRecord.objects.select_for_update().get(pk=record.pk)
    if current.occurrence_number and current.status != PenaltyRecord.Status.PENDING_HR_MARK:
        raise ValueError("Issued penalty snapshots cannot be re-rated; resolve the correction review first.")
    record.employee_profile = profile
    occurrence = _next_occurrence(profile, catalog, record.occurred_on, exclude_id=record.pk)
    level = _rated_level(catalog, occurrence, record.occurred_on)
    if (level.get("amount_basis") or catalog.extra_wage_deduction) and (profile.total_salary or 0) <= 0:
        raise ValueError(
            "A positive total salary is required. Update salary data before issuing this monetary penalty."
        )
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
            "evidence",
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
    _review_recurrence(record)
    return record


def _review_recurrence(record):
    profile = record.employee_profile
    catalog = record.catalog
    # Backdated incidents change chronological recurrence. Preserve issued
    # snapshots and hold downstream deductions for an explicit HR decision.
    later = (
        PenaltyRecord.objects.select_for_update()
        .filter(
            employee_profile=profile,
            catalog__recurrence_group=catalog.recurrence_group,
            status__in=[PenaltyRecord.Status.ISSUED, PenaltyRecord.Status.DISPUTED, PenaltyRecord.Status.APPLIED],
        )
        .exclude(pk=record.pk)
        .filter(Q(occurred_on__gt=record.occurred_on) | Q(occurred_on=record.occurred_on, pk__gt=record.pk))
    )
    start = _count_period_start(profile, catalog, record.occurred_on)
    if start:
        end = (
            penalty_year_cycle(profile, record.occurred_on)[1]
            if catalog.count_period == PenaltyCatalog.Period.CONTRACT_YEAR
            else date(record.occurred_on.year + (record.occurred_on.month == 12), record.occurred_on.month % 12 + 1, 1)
            - date.resolution
        )
        later = later.filter(occurred_on__gte=start, occurred_on__lte=end)
    for downstream in later.order_by("occurred_on", "pk"):
        expected = _next_occurrence(profile, downstream.catalog, downstream.occurred_on, exclude_id=downstream.pk)
        if downstream.occurrence_number == expected:
            continue
        if (
            downstream.automation == PenaltyRecord.Automation.WARNING_ISSUED
            and (downstream.resolution or {}).get("decision") != "manual_review"
            and _rated_level(downstream.catalog, expected, downstream.occurred_on)
            == _rated_level(downstream.catalog, downstream.occurrence_number, downstream.occurred_on)
        ):
            # An automatic warning that stays a warning needs no HR decision.
            previous = downstream.occurrence_number
            downstream.occurrence_number = expected
            downstream.save(update_fields=["occurrence_number", "updated_at"])
            audit(
                None,
                "penalty_auto_warning_renumbered",
                "PenaltyRecord",
                downstream.pk,
                {"previous_occurrence": previous, "occurrence": expected},
            )
        else:
            _manual_review(
                downstream, "Backdated issuance changed chronological recurrence.", {"expected_occurrence": expected}
            )
    return record


def rerate_recurrence(record, *, note, request=None):
    """HR clears a recurrence-only review by re-rating the unapplied snapshot.

    Uses the same recurrence, schedule-level and five-day rules as ``issue``.
    Extra wages and their date allocation are unchanged because they do not
    depend on the occurrence number. Applied deductions are never changed.
    """
    review = record.resolution or {}
    proposal = review.get("proposed_evidence") or {}
    deduction = PenaltyDeduction.objects.select_for_update().filter(penalty=record).first()
    if (
        review.get("decision") != "manual_review"
        or "expected_occurrence" not in proposal
        or proposal.get("catalog_code")
        or record.status not in {PenaltyRecord.Status.ISSUED, PenaltyRecord.Status.DISPUTED}
        or (deduction and deduction.status == PenaltyDeduction.Status.APPLIED)
    ):
        raise PermissionError("Only unapplied recurrence-only correction reviews can be re-rated.")
    profile = EmployeeProfile.objects.select_for_update().get(pk=record.employee_profile_id)
    occurrence = _next_occurrence(profile, record.catalog, record.occurred_on, exclude_id=record.pk)
    level = _rated_level(record.catalog, occurrence, record.occurred_on)
    amount = monetary_amount(profile, level)
    five_days_wages = ((profile.total_salary or Decimal("0")) / Decimal("30") * Decimal("5")).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
    if level.get("amount_basis") and (profile.total_salary or 0) <= 0:
        raise ValueError(
            "A positive total salary is required. Update salary data before issuing this monetary penalty."
        )
    if amount > five_days_wages:
        raise ValueError("A single disciplinary fine cannot exceed five days' wages.")
    previous = {
        "occurrence": record.occurrence_number,
        "action": record.action,
        "amount": str(record.amount),
        "total_deduction_amount": str(record.total_deduction_amount),
    }
    record.occurrence_number = occurrence
    record.action = level["action"]
    record.amount = amount
    record.total_deduction_amount = amount + record.extra_wage_amount
    record.save(update_fields=["occurrence_number", "action", "amount", "total_deduction_amount", "updated_at"])
    if deduction:
        deduction.amount = record.total_deduction_amount
        deduction.save(update_fields=["amount", "updated_at"])
    elif record.total_deduction_amount > 0:
        deduction = PenaltyDeduction.objects.create(
            penalty=record,
            company=record.company,
            employee_profile=profile,
            intended_year=record.occurred_on.year,
            intended_month=record.occurred_on.month,
            amount=record.total_deduction_amount,
            status=PenaltyDeduction.Status.HELD
            if record.status == PenaltyRecord.Status.DISPUTED
            else PenaltyDeduction.Status.PENDING_REVIEW,
        )
    _clear_review(
        record,
        "penalty_recurrence_rerated",
        request=request,
        resolution={
            "decision": "recurrence_rerated",
            "note": note,
            "resolved_at": timezone.now().isoformat(),
            "previous_resolution": review.get("previous_resolution"),
        },
        details={"note": note, "previous": previous, "occurrence": occurrence, "action": record.action},
    )
    _review_recurrence(record)
    return record


def current_replacement(record):
    """Recompute an automatic record from current attendance evidence.

    Returns ``(catalog_code, occurred_on, note, evidence)`` or None when the
    current evidence no longer establishes a candidate of this kind.
    """
    if record.source_kind == "absence":
        profile = record.employee_profile
        cycle_start, _cycle_end = penalty_year_cycle(profile, record.occurred_on)
        cycle_start = max(cycle_start, effective_from())
        rows = _eligible_absences(profile, cycle_start, record.occurred_on)
        endpoint = next((row for row in rows if row.date == record.occurred_on), None)
        if endpoint is None:
            return None
        code, _streak, note, evidence = _absence_candidate_spec(profile, endpoint, rows, cycle_start)
        return (code, record.occurred_on, note, evidence) if code else None
    if record.attendance_result_id:
        spec = _attendance_candidate_specs(record.attendance_result).get(record.source_kind)
        if spec:
            return spec[0], record.attendance_result.date, spec[1], spec[2]
    return None


def _manual_review(record, reason, evidence=None):
    resolution = {"decision": "manual_review", "reason": reason, "proposed_evidence": evidence or {}}
    if all((record.resolution or {}).get(key) == value for key, value in resolution.items()):
        return
    previous_resolution = prior = record.resolution
    deduction = PenaltyDeduction.objects.select_for_update().filter(penalty=record).first()
    held_from = deduction.status if deduction else None
    if (previous_resolution or {}).get("decision") == "manual_review":
        # A refreshed review keeps the state from before the first review.
        held_from = previous_resolution.get("held_from")
        previous_resolution = previous_resolution.get("previous_resolution")
    record.resolution = {
        **resolution,
        "resolved_at": timezone.now().isoformat(),
        "previous_resolution": previous_resolution,
        "held_from": held_from,
    }
    record.save(update_fields=["resolution", "updated_at"])
    if deduction and deduction.status not in {PenaltyDeduction.Status.APPLIED, PenaltyDeduction.Status.VOID}:
        deduction.status = PenaltyDeduction.Status.HELD
        deduction.save(update_fields=["status", "updated_at"])
    audit(
        None,
        "penalty_evidence_review_required",
        "PenaltyRecord",
        record.pk,
        {"reason": reason, "previous_resolution": prior, "proposed_evidence": evidence or {}},
    )
    from .notifications import notify_penalty

    transaction.on_commit(lambda: notify_penalty(record, "manual_review", hr=True))


def _clear_review(record, event, *, request=None, resolution=None, details=None):
    """Clear an unapplied manual review; restore only a deduction the review held."""
    review = record.resolution or {}
    deduction = PenaltyDeduction.objects.select_for_update().filter(penalty=record).first()
    if (
        review.get("decision") != "manual_review"
        or record.status == PenaltyRecord.Status.APPLIED
        or (deduction and deduction.status == PenaltyDeduction.Status.APPLIED)
    ):
        return False
    record.resolution = resolution if resolution is not None else review.get("previous_resolution")
    record.save(update_fields=["resolution", "updated_at"])
    if (
        deduction
        and deduction.status == PenaltyDeduction.Status.HELD
        and review.get("held_from") not in {None, PenaltyDeduction.Status.HELD}
        and record.status == PenaltyRecord.Status.ISSUED
    ):
        # Held solely by the review: return to HR payroll review, never approved.
        deduction.status = PenaltyDeduction.Status.PENDING_REVIEW
        deduction.save(update_fields=["status", "updated_at"])
    audit(
        request,
        event,
        "PenaltyRecord",
        record.pk,
        {**(details or {}), "previous_resolution": review, "payroll_status": deduction.status if deduction else None},
    )
    return True


def _review_absence_allocation(waived_record, deduction):
    """A released earlier reservation requires explicit downstream reallocation."""
    if waived_record.source_kind != "absence" or not waived_record.extra_wage_amount:
        return
    if deduction and deduction.status == PenaltyDeduction.Status.APPLIED:
        return  # Paid dates remain covered; waiver is never a payroll refund.
    evidence = waived_record.evidence or {}
    released_dates = set(evidence.get("wage_absence_dates", evidence.get("absence_dates", [])))
    spell_start = evidence.get("spell_start_on")
    if not spell_start:
        return
    downstream = (
        PenaltyRecord.objects.select_for_update()
        .filter(
            employee_profile=waived_record.employee_profile,
            source_kind="absence",
            status__in=[PenaltyRecord.Status.ISSUED, PenaltyRecord.Status.DISPUTED, PenaltyRecord.Status.APPLIED],
        )
        .exclude(pk=waived_record.pk)
        .order_by("occurred_on", "pk")
    )
    for record in downstream:
        current_evidence = record.evidence or {}
        if current_evidence.get("spell_start_on") != spell_start or not record.catalog.extra_wage_deduction:
            continue  # Wage-less rows (for example W15/W16) hold no released dates.
        if record.occurred_on < waived_record.occurred_on:
            continue
        affected = released_dates.intersection(current_evidence.get("absence_dates", []))
        if not affected:
            continue
        _manual_review(
            record,
            "Earlier absence wages were waived; allocation requires HR review.",
            {
                "catalog_code": record.catalog.code,
                "occurred_on": record.occurred_on.isoformat(),
                "evidence": current_evidence,
                "released_wage_dates": sorted(affected),
                "proposed_wage_absence_dates": sorted(set(current_evidence.get("wage_absence_dates", [])) | affected),
                "waived_penalty_id": waived_record.pk,
            },
        )


@transaction.atomic
def waive(record, *, reason, request=None, decision="waive"):
    EmployeeProfile.objects.select_for_update().get(pk=record.employee_profile_id)
    PenaltyRecord.objects.select_for_update().get(pk=record.pk)
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
    if previous != PenaltyRecord.Status.PENDING_HR_MARK:
        _review_recurrence(record)
        _review_absence_allocation(record, deduction)
    if record.automation == PenaltyRecord.Automation.WARNING_ISSUED and previous != PenaltyRecord.Status.WAIVED:
        from .warning_notices import notify_warning_withdrawn

        transaction.on_commit(lambda: notify_warning_withdrawn(record))
    return record


def _candidate_automation(catalog, occurred_on):
    return PenaltyRecord.Automation.WARNING_PENDING if auto_warning_applies(catalog, occurred_on) else ""


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
            "automation": _candidate_automation(catalog, occurred_on),
            "note": note,
            "evidence": evidence or {},
        },
    )
    reopened = False
    if (
        not created
        and record.status == PenaltyRecord.Status.WAIVED
        and ((record.resolution or {}).get("reason") == "Attendance evidence no longer supports this candidate.")
    ):
        deduction = PenaltyDeduction.objects.filter(penalty=record).first()
        if not deduction or deduction.status != PenaltyDeduction.Status.APPLIED:
            record.status = PenaltyRecord.Status.PENDING_HR_MARK
            # reopened_at restarts the HR queue age used by check_aged_penalties.
            record.resolution = {
                "decision": "reopened",
                "reason": "Attendance evidence supports this candidate again.",
                "reopened_at": timezone.now().isoformat(),
            }
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
            reopened = True
    if not created and record.status == PenaltyRecord.Status.PENDING_HR_MARK:
        updates = []
        if record.catalog_id != catalog.pk:
            record.catalog = catalog
            updates.append("catalog")
        if reopened or "catalog" in updates:
            # A withdrawn letter is never re-sent: a reopened issued warning goes to HR.
            automation = (
                ""
                if PenaltyWarningNotice.objects.filter(penalty=record).exists()
                else _candidate_automation(catalog, occurred_on)
            )
            if record.automation != automation:
                record.automation = automation
                updates.append("automation")
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
    elif not created and record.status in {
        PenaltyRecord.Status.ISSUED,
        PenaltyRecord.Status.DISPUTED,
        PenaltyRecord.Status.APPLIED,
    }:
        current = {key: value for key, value in (record.evidence or {}).items() if key != "wage_absence_dates"}
        # Disruption branches share the same measured attendance evidence.
        old_code = record.catalog.code
        same_band = old_code == catalog_code or {old_code, catalog_code} in (
            {"W01", "W02"},
            {"W03", "W04"},
            {"W05", "W06"},
        )
        if not same_band or current != (evidence or {}) or record.occurred_on != occurred_on:
            _manual_review(
                record,
                "Attendance evidence changed after issuance.",
                {"catalog_code": catalog_code, "occurred_on": str(occurred_on), "evidence": evidence or {}},
            )
        elif (record.resolution or {}).get("reason") == "Attendance evidence changed after issuance.":
            # Evidence returned to the issued snapshot; payroll-applied rows stay flagged.
            _clear_review(
                record,
                "penalty_evidence_review_cleared",
                details={"reason": "Attendance evidence returned to the issued snapshot."},
            )
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


def _permission_covers(result, start, end):
    from attendance.models import AttendanceAdjustment

    intervals = []
    for adjustment in AttendanceAdjustment.objects.filter(
        employee_profile=result.employee_profile,
        company_id=result.company_id,
        date=result.date,
        kind__in=[AttendanceAdjustment.Kind.EXIT_PERMISSION, AttendanceAdjustment.Kind.DURING_SHIFT_PERMISSION],
    ):
        if adjustment.start_time is None or adjustment.end_time is None:
            continue
        interval_start = timezone.make_aware(datetime.combine(result.date, adjustment.start_time))
        interval_end = timezone.make_aware(datetime.combine(result.date, adjustment.end_time))
        if interval_end <= interval_start:
            interval_end += timedelta(days=1)
        intervals.append((interval_start, interval_end))
    cursor = start
    for interval_start, interval_end in sorted(intervals):
        if interval_start > cursor:
            break
        cursor = max(cursor, interval_end)
        if cursor >= end:
            return True
    return False


def _attendance_candidate_specs(result):
    """Return {source_kind: (catalog_code, note, evidence)} for one daily result."""
    inputs = result.calculation_inputs or {}
    policy = inputs.get("policy", {})
    if result.date < effective_from() or not policy.get("working_day", True) or inputs.get("lone_opaque_punch"):
        # A lone untyped punch or lone non-check-in punch cannot establish
        # arrival or departure; the attendance projection keeps it unchanged.
        return {}
    specs = {}
    # The printed schedule starts at the first measured minute. The legacy
    # attendance status has a grace window and must not gate this ledger.
    if (
        result.first_check_in_at
        and result.first_check_in_at > result.shift_start_at
        and not policy.get("late_excused")
        and not policy.get("is_exempt")
    ):
        minutes = max(1, int((result.first_check_in_at - result.shift_start_at).total_seconds() // 60))
        specs["late_arrival"] = (
            "W01" if minutes <= 15 else "W03" if minutes <= 30 else "W05" if minutes <= 60 else "W07",
            f"Measured {minutes} late minutes. HR must confirm permission/excuse and whether other workers were disrupted.",
            {"minutes": minutes, "scheduled_minutes": result.scheduled_minutes},
        )
    if (
        result.final_check_out_at
        and result.final_check_out_at < result.shift_end_at
        and not _permission_covers(result, result.final_check_out_at, result.shift_end_at)
    ):
        minutes = max(1, int((result.shift_end_at - result.final_check_out_at).total_seconds() // 60))
        specs["early_departure"] = (
            "W08" if minutes <= 15 else "W09",
            f"Measured {minutes} early-departure minutes. HR must confirm there was no permission or acceptable excuse.",
            {"minutes": minutes, "scheduled_minutes": result.scheduled_minutes},
        )
    if (
        result.final_check_out_at
        and result.final_check_out_at > result.shift_end_at
        and not _permission_covers(result, result.shift_end_at, result.final_check_out_at)
    ):
        specs["after_hours"] = (
            "W10",
            "Checkout is later than shift end. HR must confirm the worker stayed or returned without prior permission.",
            {},
        )
    return specs


@transaction.atomic
def sync_attendance_candidates(result):
    """Use final attendance projections; HR must verify permission and disruption."""
    if result.date < effective_from():
        return
    profile = result.employee_profile
    EmployeeProfile.objects.select_for_update().get(pk=profile.pk)
    if not (result.calculation_inputs or {}).get("policy", {}).get("working_day", True):
        _invalidate_missing(result, set())
        return
    specs = _attendance_candidate_specs(result)
    for kind, (code, note, evidence) in specs.items():
        _candidate(profile, code, result.date, kind, result=result, note=note, evidence=evidence)
    _invalidate_missing(result, set(specs))
    if result.first_check_in_at or result.final_check_out_at:
        reconcile_absence_candidates(profile, result.date)


def _is_absence_eligible(record, *, punch_dates=None):
    from attendance.leave_resolution import with_leave_resolution
    from attendance.models import AttendanceDailyResult, AttendanceRecord
    from attendance.schedule import is_working_day

    if record.status != AttendanceRecord.Status.ABSENT or record.source != AttendanceRecord.Source.SYSTEM:
        return False
    if not is_working_day(record.employee_profile, record.date):
        return False
    if record.check_in_at or record.check_out_at:
        return False
    if punch_dates is not None:
        if record.date in punch_dates:
            return False
    elif (
        AttendanceDailyResult.objects.filter(employee_profile_id=record.employee_profile_id, date=record.date)
        .filter(Q(first_check_in_at__isnull=False) | Q(final_check_out_at__isnull=False))
        .exists()
    ):
        return False
    resolved = (
        record
        if hasattr(record, "effective_status")
        else with_leave_resolution(AttendanceRecord.objects.filter(pk=record.pk)).first()
    )
    return bool(resolved and resolved.effective_status == AttendanceRecord.Status.ABSENT)


def _eligible_absences(profile, start, end):
    from attendance.leave_resolution import with_leave_resolution
    from attendance.models import AttendanceDailyResult, AttendanceRecord

    punch_dates = set(
        AttendanceDailyResult.objects.filter(employee_profile=profile, date__gte=start, date__lte=end)
        .filter(Q(first_check_in_at__isnull=False) | Q(final_check_out_at__isnull=False))
        .values_list("date", flat=True)
    )
    rows = (
        with_leave_resolution(
            AttendanceRecord.objects.filter(
                employee_profile=profile,
                date__gte=start,
                date__lte=end,
                source=AttendanceRecord.Source.SYSTEM,
                status=AttendanceRecord.Status.ABSENT,
            )
        )
        .select_related("employee_profile")
        .order_by("date", "id")
    )
    return [row for row in rows if _is_absence_eligible(row, punch_dates=punch_dates)]


def _continuous_absence_streak(profile, record, by_date, cycle_start):
    from attendance.schedule import is_working_day

    streak = [record]
    cursor = record.date
    while cursor > cycle_start:
        cursor -= date.resolution
        if not is_working_day(profile, cursor):
            continue
        previous = by_date.get(cursor)
        if previous is None:
            break
        streak.append(previous)
    return list(reversed(streak))


def _absence_band(continuous_calendar_days, contract_year_missed_shifts):
    if continuous_calendar_days >= 16:
        return "W15"
    if contract_year_missed_shifts >= 31:
        return "W16"
    if continuous_calendar_days == 15:
        return None  # The printed continuous band has no day-15 action.
    if continuous_calendar_days >= 11:
        return "W14"
    if continuous_calendar_days >= 7:
        return "W13"
    if continuous_calendar_days >= 2:
        return "W12"
    return "W11"


@transaction.atomic
def reconcile_absence_candidates(profile, changed_date):
    """Re-rate pending absence bands after punch, record or leave corrections."""
    from attendance.schedule import is_working_day

    if (
        changed_date < effective_from()
        or not PenaltyRecord.objects.filter(employee_profile=profile, source_kind="absence").exists()
    ):
        return
    EmployeeProfile.objects.select_for_update().get(pk=profile.pk)
    cycle_start, cycle_end = penalty_year_cycle(profile, changed_date)
    cycle_start = max(cycle_start or effective_from(), effective_from())
    if cycle_end is None:
        # Profiles without a recorded contract start still have prospective
        # candidates after the changed day; include them in correction review.
        latest_candidate_on = (
            PenaltyRecord.objects.filter(employee_profile=profile, source_kind="absence")
            .order_by("-occurred_on")
            .values_list("occurred_on", flat=True)
            .first()
        )
        cycle_end = max(changed_date, latest_candidate_on or changed_date)
    eligible = _eligible_absences(profile, cycle_start, cycle_end)
    eligible_ids = {row.pk for row in eligible}
    eligible_dates = {row.date for row in eligible}
    eligible_by_date = {row.date: row for row in eligible}
    for candidate in PenaltyRecord.objects.select_for_update().filter(
        employee_profile=profile,
        source_kind="absence",
        occurred_on__gte=cycle_start,
        occurred_on__lte=cycle_end,
    ):
        if candidate.attendance_record_id not in eligible_ids:
            _invalidate_record(candidate)
        elif candidate.status == PenaltyRecord.Status.PENDING_HR_MARK:
            # Its last observed day may have been corrected; the remaining
            # spell endpoint below will re-rate this unissued candidate.
            continue
        elif candidate.occurred_on not in eligible_dates:
            _invalidate_record(candidate)
        elif candidate.status in {
            PenaltyRecord.Status.ISSUED,
            PenaltyRecord.Status.DISPUTED,
            PenaltyRecord.Status.APPLIED,
        }:
            streak = _continuous_absence_streak(
                profile, eligible_by_date[candidate.occurred_on], eligible_by_date, cycle_start
            )
            calendar_days = (candidate.occurred_on - streak[0].date).days + 1
            missed_shifts_through_occurrence = sum(row.date <= candidate.occurred_on for row in eligible)
            if _absence_band(calendar_days, missed_shifts_through_occurrence) != candidate.catalog.code:
                _invalidate_record(candidate)
            elif set((candidate.evidence or {}).get("absence_dates", [])) != {row.date.isoformat() for row in streak}:
                _manual_review(
                    candidate,
                    "Absence evidence changed after issuance.",
                    {"absence_dates": [row.date.isoformat() for row in streak]},
                )
    if eligible:
        # Replaying every day would reopen earlier levels already represented
        # by an issued record. Reconcile only each spell's latest evidence.
        endpoints = []
        for index, row in enumerate(eligible):
            next_row = eligible[index + 1] if index + 1 < len(eligible) else None
            if next_row is None or any(
                is_working_day(profile, row.date + date.resolution * gap)
                for gap in range(1, (next_row.date - row.date).days)
            ):
                endpoints.append(row)
        sync_absence_candidates(endpoints, eligible_rows=eligible)


def _absence_candidate_spec(profile, record, rows, cycle_start):
    """Band, streak, note and evidence for a spell ending at ``record``."""
    by_date = {row.date: row for row in rows}
    streak = _continuous_absence_streak(profile, record, by_date, cycle_start)
    # The printed continuous-absence bands use elapsed days, not working
    # days. An off-day may bridge two verified missed shifts but never
    # supplies absence evidence by itself.
    continuous_calendar_days = (record.date - streak[0].date).days + 1
    missed_shifts = len(streak)
    total = len(rows)
    note = f"System absence: {continuous_calendar_days} continuous calendar days between missed scheduled shifts, {missed_shifts} missed shifts, {total} missed shifts in this contract year. HR must confirm no written permission, acceptable excuse or covering leave and any required warning."
    evidence = {
        "absence_days": missed_shifts,
        "absence_dates": [row.date.isoformat() for row in streak],
        "continuous_calendar_days": continuous_calendar_days,
        "spell_start_on": streak[0].date.isoformat(),
        "contract_year_absence_days": total,
    }
    return _absence_band(continuous_calendar_days, total), streak, note, evidence


@transaction.atomic
def sync_absence_candidates(records, *, eligible_rows=None):
    """Advance one continuous absence candidate through printed duration bands.

    An HR-issued earlier band is immutable; the next threshold opens its own
    candidate. A still-pending candidate advances, so a daily detector replay
    never produces one penalty per absent day.
    """

    records = sorted(records, key=lambda row: (row.employee_profile_id, row.date, row.pk))
    scopes = {}
    for row in records:
        start, _end = penalty_year_cycle(row.employee_profile, row.date)
        key = (row.employee_profile_id, max(start, effective_from()))
        scopes[key] = max(scopes.get(key, row.date), row.date)
    loaded = {}
    for record in records:
        if record.date < effective_from():
            continue
        profile = record.employee_profile
        EmployeeProfile.objects.select_for_update().get(pk=profile.pk)
        cycle_start, _cycle_end = penalty_year_cycle(profile, record.date)
        cycle_start = max(cycle_start or effective_from(), effective_from())
        key = (profile.pk, cycle_start)
        if key not in loaded:
            loaded[key] = (
                eligible_rows if eligible_rows is not None else _eligible_absences(profile, cycle_start, scopes[key])
            )
        rows = [row for row in loaded[key] if cycle_start <= row.date <= record.date]
        if record.pk not in {row.pk for row in rows}:
            continue
        if not rows:
            continue
        code, streak, note, evidence = _absence_candidate_spec(profile, record, rows, cycle_start)
        if code is None:
            continue
        if PenaltyRecord.objects.filter(
            employee_profile=profile,
            source_kind="absence",
            catalog__code=code,
            status__in=[PenaltyRecord.Status.ISSUED, PenaltyRecord.Status.DISPUTED, PenaltyRecord.Status.APPLIED],
            occurred_on__gte=streak[0].date,
            occurred_on__lte=record.date,
        ).exists():
            continue
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
        _candidate(profile, code, record.date, "absence", attendance_record=anchor, note=note, evidence=evidence)
