"""Compatibility entry points into the single payroll calculator/writer."""

from payroll.engine import apply_claims, recalculate


def sync_penalty_deductions(run, *, request=None):
    counts = recalculate(run, request=request)["counts"]["penalty"]
    return {"claimed": counts["claimed"] + counts["adjusted"], "released": counts["released"]}


def finalize_penalty_deductions(run, *, request=None):
    from django.db import transaction

    with transaction.atomic():
        counts = sync_penalty_deductions(run, request=request)
        counts["applied"] = apply_claims(run, request, attendance=False)["penalty"]
        return counts
