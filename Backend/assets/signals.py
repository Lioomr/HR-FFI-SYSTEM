from django.db import transaction
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver
from django.utils import timezone

from audit.utils import audit
from employees.models import EmployeeProfile

from .models import Asset, AssetAssignment


@receiver(pre_save, sender=EmployeeProfile)
def capture_previous_employment_status(sender, instance, **kwargs):
    if not instance.pk:
        instance._previous_employment_status = None
        return

    previous_status = (
        EmployeeProfile.objects.filter(pk=instance.pk)
        .values_list("employment_status", flat=True)
        .first()
    )
    instance._previous_employment_status = previous_status


@receiver(post_save, sender=EmployeeProfile)
def auto_close_asset_assignments_on_termination(sender, instance, created, **kwargs):
    if created:
        return

    previous_status = getattr(instance, "_previous_employment_status", None)
    if instance.employment_status != EmployeeProfile.EmploymentStatus.TERMINATED:
        return
    if previous_status == EmployeeProfile.EmploymentStatus.TERMINATED:
        return

    with transaction.atomic():
        assignments = list(
            AssetAssignment.objects.select_for_update()
            .select_related("asset")
            .filter(employee=instance, is_active=True)
        )

        for assignment in assignments:
            asset = assignment.asset
            old_status = asset.status

            assignment.returned_at = timezone.now()
            assignment.is_active = False
            assignment.return_note = "Auto-return on termination"
            assignment.condition_on_return = assignment.condition_on_return or ""
            assignment.save(
                update_fields=[
                    "returned_at",
                    "is_active",
                    "return_note",
                    "condition_on_return",
                    "updated_at",
                ]
            )

            asset.status = Asset.AssetStatus.AVAILABLE
            asset.save(update_fields=["status", "updated_at"])

            audit(
                request=None,
                action="asset_returned_auto_termination",
                entity="AssetAssignment",
                entity_id=assignment.id,
                metadata={
                    "asset_id": asset.id,
                    "employee_id": instance.id,
                    "status_before": old_status,
                    "status_after": asset.status,
                },
                actor=instance.user,
            )
