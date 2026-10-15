"""Recheck existing absence candidates after attendance, leave or BioTime mapping changes."""

from attendance.models import AttendanceRecord, BioTimeEmployeeMap
from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver
from leaves.models import LeaveRequest

from .models import PenaltyRecord
from .services import effective_from, invalidate_unmapped_candidates, reconcile_absence_candidates


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


@receiver(post_save, sender=BioTimeEmployeeMap, dispatch_uid="penalty_biotime_mapping_saved")
@receiver(post_delete, sender=BioTimeEmployeeMap, dispatch_uid="penalty_biotime_mapping_deleted")
def biotime_mapping_changed(sender, instance, **kwargs):
    """Withdraw candidates that a removed mapping or a later start date no longer supports."""
    profile_id = instance.employee_profile_id
    if not PenaltyRecord.objects.filter(
        employee_profile_id=profile_id, status=PenaltyRecord.Status.PENDING_HR_MARK
    ).exists():
        return

    def recheck():
        invalidate_unmapped_candidates([profile_id])
        if (
            instance.attendance_start_date
            and PenaltyRecord.objects.filter(employee_profile_id=profile_id, source_kind="absence").exists()
        ):
            reconcile_absence_candidates(
                instance.employee_profile, max(instance.attendance_start_date, effective_from())
            )

    transaction.on_commit(recheck)
