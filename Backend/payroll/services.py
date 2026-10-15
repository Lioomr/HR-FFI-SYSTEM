"""Compatibility entry points; the shared engine owns every payroll monetary write."""

from .configuration import PayrollDomainError
from .engine import apply_claims, recalculate


class PayrollRunNotDraftError(Exception):
    pass


def sync_attendance_deductions(run, *, request=None):
    try:
        return recalculate(run, request=request)["counts"]["attendance"]
    except PayrollDomainError as exc:
        if exc.payload["errors"][0]["code"] == "run_not_draft":
            raise PayrollRunNotDraftError(str(run.pk)) from exc
        raise


def finalize_attendance_deductions(run, *, request=None):
    from django.db import transaction

    with transaction.atomic():
        counts = sync_attendance_deductions(run, request=request)
        counts["applied"] = apply_claims(run, request, penalty=False)["attendance"]
        return counts
