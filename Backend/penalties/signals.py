"""Recheck existing absence candidates after attendance or leave changes."""

from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from attendance.models import AttendanceRecord
from leaves.models import LeaveRequest

from .models import PenaltyRecord
from .services import effective_from, reconcile_absence_candidates


@receiver(post_save, sender=AttendanceRecord, dispatch_uid="penalty_absence_attendance_changed")
def attendance_record_changed(sender, instance, **kwargs):
    if instance.date < effective_from() or instance.source != AttendanceRecord.Source.SYSTEM:
        return
    if not PenaltyRecord.objects.filter(
        employee_profile_id=instance.employee_profile_id, source_kind="absence"
    ).exists():
        return
    transaction.on_commit(
        lambda profile=instance.employee_profile, day=instance.date: reconcile_absence_candidates(profile, day)
    )


@receiver(post_save, sender=LeaveRequest, dispatch_uid="penalty_absence_leave_changed")
def leave_request_changed(sender, instance, **kwargs):
    if instance.end_date < effective_from():
        return
    profile = instance.employee_profile or getattr(instance.employee, "employee_profile", None)
    if profile is None or not PenaltyRecord.objects.filter(employee_profile=profile, source_kind="absence").exists():
        return
    transaction.on_commit(
        lambda profile=profile, day=max(instance.start_date, effective_from()): reconcile_absence_candidates(
            profile, day
        )
    )
