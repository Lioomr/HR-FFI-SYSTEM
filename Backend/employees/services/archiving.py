"""Shared archive operation for archive requests and contract termination."""

from django.db import transaction


@transaction.atomic
def retire_biotime_mapping_and_archive_profile(profile, execution_snapshot, actor, archive_reason, archived_at):
    """Retire live routing before archiving; preserve attendance and roll back together.

    The caller owns account deactivation and the domain decision in its outer
    transaction. The snapshot belongs in that decision's audit evidence.
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
    profile.is_archived = True
    profile.archived_at = archived_at
    profile.archived_by = actor
    profile.archive_reason = archive_reason
    profile.save(update_fields=["is_archived", "archived_at", "archived_by", "archive_reason", "updated_at"])
