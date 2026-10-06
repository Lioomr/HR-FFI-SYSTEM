"""Enforce one manager per employee on existing data.

Dry run by default; ``--apply`` writes. For every employee with an active
cross-company manager assignment:

- duplicate active assignments are revoked, keeping the newest (highest id);
- a leftover direct ``manager_profile`` is cleared, because the cross-company
  manager wins;
- the kept assignment gets every manager capability (assignments never expire).

Open contract ratings (manager response not submitted, rating not decided or
cancelled) whose recorded manager is not the employee's current manager are
moved to that manager. Submitted responses and decided ratings are untouched.

Applied changes are audit-logged. Running it again finds nothing to do.
"""

import json

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from audit.utils import audit
from contract_ratings.services import open_rating_manager_mismatches, reassign_open_ratings_to_current_manager
from core.models import CrossCompanyManagerAssignment
from employees.models import EmployeeProfile
from employees.services.manager_relationships import (
    _revoke_assignments,
    full_manager_capabilities,
    log_manager_assignment_change,
    reroute_pending_manager_requests,
)

SOURCE = "consolidate_manager_relationships"


def _profile_ref(profile):
    if profile is None:
        return None
    return {
        "employee_profile_id": profile.pk,
        "employee_id": profile.employee_id,
        "company_id": profile.company_id,
        "name": profile.full_name_en or profile.full_name or profile.employee_id,
    }


def build_consolidation_plan():
    """One entry per employee whose manager data breaks the one-manager rule."""
    full_capabilities = sorted(full_manager_capabilities())
    by_employee: dict[int, list[CrossCompanyManagerAssignment]] = {}
    for assignment in (
        CrossCompanyManagerAssignment.objects.filter(is_active=True, revoked_at__isnull=True)
        .select_related("employee__manager_profile", "manager_profile")
        .order_by("employee_id", "-id")
    ):
        by_employee.setdefault(assignment.employee_id, []).append(assignment)

    plan = []
    for assignments in by_employee.values():
        keep, duplicates = assignments[0], assignments[1:]
        employee = keep.employee
        missing_capabilities = sorted(set(full_capabilities) - set(keep.capabilities or []))
        if not duplicates and not employee.manager_profile_id and not employee.manager_id and not missing_capabilities:
            continue
        plan.append(
            {
                "employee": employee,
                "keep": keep,
                "duplicates": duplicates,
                "clear_direct_manager": bool(employee.manager_profile_id or employee.manager_id),
                "missing_capabilities": missing_capabilities,
            }
        )
    return plan


def _plan_row(entry):
    employee = entry["employee"]
    keep = entry["keep"]
    return {
        "employee": _profile_ref(employee),
        "before": {
            "direct_manager": _profile_ref(employee.manager_profile),
            "legacy_manager_user_id": employee.manager_id,
            "active_assignments": [
                {
                    "assignment_id": assignment.pk,
                    "manager": _profile_ref(assignment.manager_profile),
                    "capabilities": assignment.capabilities,
                }
                for assignment in [keep, *entry["duplicates"]]
            ],
        },
        "after": {
            "direct_manager": None if entry["clear_direct_manager"] else _profile_ref(employee.manager_profile),
            "cross_company_manager": _profile_ref(keep.manager_profile),
            "kept_assignment_id": keep.pk,
            "capabilities": sorted(full_manager_capabilities()) if entry["missing_capabilities"] else keep.capabilities,
        },
        "actions": [
            *[f"revoke duplicate assignment {assignment.pk}" for assignment in entry["duplicates"]],
            *(["clear direct manager (cross-company manager wins)"] if entry["clear_direct_manager"] else []),
            *([f"grant capabilities {entry['missing_capabilities']}"] if entry["missing_capabilities"] else []),
        ],
    }


def _apply_entry(entry):
    employee = entry["employee"]
    keep = entry["keep"]
    previous_direct = employee.manager_profile
    _revoke_assignments(entry["duplicates"], actor=None, request=None, source=SOURCE, reason="duplicate")
    if entry["clear_direct_manager"]:
        EmployeeProfile.objects.filter(pk=employee.pk).update(
            manager_profile=None, manager_id=None, updated_at=timezone.now()
        )
        log_manager_assignment_change(
            employee=employee,
            previous_manager=previous_direct,
            new_manager=keep.manager_profile,
            source=SOURCE,
        )
        employee.manager_profile = None
        employee.manager_id = None
        # Manager-stage requests the cross-company manager cannot act on go to HR.
        reroute_pending_manager_requests(employee)
    if entry["missing_capabilities"]:
        keep.capabilities = full_manager_capabilities()
        keep.save(update_fields=["capabilities", "updated_at"])
        audit(
            None,
            "cross_company_manager_assignment_updated",
            entity="cross_company_manager_assignment",
            entity_id=keep.pk,
            metadata={"source": SOURCE, "granted_capabilities": entry["missing_capabilities"]},
        )


def _user_ref(user):
    if user is None:
        return None
    return {"user_id": user.pk, "name": user.full_name or user.email}


def _rating_row(mismatch):
    profile = mismatch["profile"]
    return {
        "rating_id": mismatch["rating"].pk,
        "status": mismatch["rating"].status,
        "employee": _profile_ref(profile),
        "recorded_manager": _user_ref(mismatch["previous"]),
        "current_manager": _user_ref(mismatch["target"]),
    }


class Command(BaseCommand):
    help = "Collapse manager data to one manager per employee (dry run unless --apply)."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Write the changes. Without it nothing is changed.")
        parser.add_argument("--format", choices=["human", "json"], default="human")

    def handle(self, *args, **options):
        apply = options["apply"]
        plan = build_consolidation_plan()
        rows = [_plan_row(entry) for entry in plan]
        rating_mismatches = open_rating_manager_mismatches()
        rating_rows = [_rating_row(mismatch) for mismatch in rating_mismatches]

        if apply and (plan or rating_mismatches):
            with transaction.atomic():
                for entry in plan:
                    _apply_entry(entry)
                # Re-evaluated after the consolidation, which may change the current manager.
                profiles = {
                    mismatch["profile"].pk: mismatch["profile"] for mismatch in open_rating_manager_mismatches()
                }
                reassign_open_ratings_to_current_manager(list(profiles.values()), source=SOURCE)
            from core.response_cache import bump_cache_version
            from employees.cache import employee_list_cache_version_key

            for company_id in {entry["employee"].company_id for entry in plan if entry["employee"].company_id}:
                bump_cache_version(employee_list_cache_version_key(company_id))
        remaining = len(build_consolidation_plan()) if apply else len(plan)
        remaining_ratings = len(open_rating_manager_mismatches()) if apply else len(rating_mismatches)

        summary = {
            "mode": "apply" if apply else "dry-run",
            "employees_needing_changes": len(plan),
            "duplicate_assignments_revoked": sum(len(entry["duplicates"]) for entry in plan),
            "direct_managers_cleared": sum(1 for entry in plan if entry["clear_direct_manager"]),
            "assignments_granted_full_capabilities": sum(1 for entry in plan if entry["missing_capabilities"]),
            "employees_still_needing_changes": remaining,
            "open_contract_ratings_to_reassign": len(rating_rows),
            "open_contract_ratings_still_mismatched": remaining_ratings,
        }
        if options["format"] == "json":
            self.stdout.write(
                json.dumps(
                    {"summary": summary, "employees": rows, "open_contract_ratings": rating_rows},
                    indent=2,
                    sort_keys=True,
                )
            )
            return

        self.stdout.write(f"Manager consolidation ({summary['mode']})")
        if not rows:
            self.stdout.write("Nothing to change: every employee already has at most one manager.")
        for row in rows:
            employee = row["employee"]
            self.stdout.write(f"- employee {employee['employee_profile_id']} ({employee['employee_id']})")
            self.stdout.write(f"    before: {json.dumps(row['before'], sort_keys=True)}")
            self.stdout.write(f"    after:  {json.dumps(row['after'], sort_keys=True)}")
            for action in row["actions"]:
                self.stdout.write(f"    {'applied' if apply else 'would'}: {action}")
        for row in rating_rows:
            self.stdout.write(
                f"- contract rating {row['rating_id']} ({row['status']}) of employee "
                f"{row['employee']['employee_profile_id']}: {'moved' if apply else 'would move'} from "
                f"{json.dumps(row['recorded_manager'], sort_keys=True)} to "
                f"{json.dumps(row['current_manager'], sort_keys=True)}"
            )
        for key, value in summary.items():
            self.stdout.write(f"{key}: {value}")
        if not apply and (rows or rating_rows):
            self.stdout.write("Dry run only. Re-run with --apply to write these changes.")
