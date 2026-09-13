"""Shared archive operation for archive requests and contract termination."""

from django.db import transaction


@transaction.atomic
def retire_biotime_mapping_and_archive_profile(profile, execution_snapshot, actor, archive_reason, archived_at):
    """Retire live routing before archiving; preserve attendance and roll back together.

    The caller owns account deactivation and the domain decision in its outer
    transaction. The snapshot belongs in that decision's audit evidence.

    Writes the archive columns with ``QuerySet.update()`` rather than
    ``profile.save()``. ``EmployeeProfile.save()`` calls ``clean()``
    unconditionally, which re-validates the whole record -- including a
    ``manager_profile`` this write never touches. An employee whose manager's
    user account was unlinked after the assignment was made (a pre-existing,
    separately tracked data issue -- see ``sync_manager_relationships``)
    could then never be archived, even though archiving is exactly the kind
    of write that should not depend on that relationship being tidy. See
    ``employees/services/signature.py`` for the same pattern applied to
    signature uploads.
    """
    from attendance.models import BioTimeEmployeeMap
    from employees.models import EmployeeProfile

    EmployeeProfile.objects.select_for_update().get(pk=profile.pk)
    mappings = list(BioTimeEmployeeMap.objects.select_for_update().filter(employee_profile_id=profile.id))
    if mappings:
        execution_snapshot["biotime_mappings_removed"] = [
            {"id": mapping.id, "biotime_emp_code": mapping.biotime_emp_code} for mapping in mappings
        ]
        BioTimeEmployeeMap.objects.filter(pk__in=[mapping.pk for mapping in mappings]).delete()
    EmployeeProfile._base_manager.filter(pk=profile.pk).update(
        is_archived=True,
        archived_at=archived_at,
        archived_by=actor,
        archive_reason=archive_reason,
        updated_at=archived_at,
    )
    profile.is_archived = True
    profile.archived_at = archived_at
    profile.archived_by = actor
    profile.archive_reason = archive_reason
    profile.updated_at = archived_at
