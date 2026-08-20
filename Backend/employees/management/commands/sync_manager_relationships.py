import json

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from audit.utils import audit
from employees.models import EmployeeProfile
from employees.services.manager_relationships import (
    log_manager_assignment_change,
    reroute_pending_manager_requests,
    validate_manager_assignment,
)


class Command(BaseCommand):
    help = "Safely backfill manager_profile and synchronize the legacy manager field."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Apply safe changes. The default is a dry run.")
        parser.add_argument("--format", choices=["human", "json"], default="human")
        parser.add_argument("--changed-by-email", help="User recorded as the actor for applied changes.")

    def handle(self, *args, **options):
        apply_changes = options["apply"]
        actor = None
        if options.get("changed_by_email"):
            actor = get_user_model().objects.filter(email__iexact=options["changed_by_email"]).first()
            if actor is None:
                raise CommandError("No user matches --changed-by-email.")

        result = {
            "dry_run": not apply_changes,
            "backfilled_manager_profile": [],
            "synced_legacy_manager": [],
            "conflicts": [],
            "unchanged": 0,
        }

        with transaction.atomic():
            profiles = EmployeeProfile.objects.select_for_update(of=("self",)).select_related(
                "user", "manager", "manager_profile", "manager_profile__user"
            )
            for profile in profiles.order_by("id"):
                if profile.manager_profile_id:
                    manager_profile = profile.manager_profile
                    try:
                        validate_manager_assignment(profile, manager_profile)
                    except ValidationError as exc:
                        result["conflicts"].append(
                            {
                                "employee_profile_id": profile.id,
                                "manager_profile_id": profile.manager_profile_id,
                                "legacy_manager_id": profile.manager_id,
                                "reason": "; ".join(exc.messages),
                            }
                        )
                        continue

                    if profile.manager_id == manager_profile.user_id:
                        result["unchanged"] += 1
                        continue

                    result["synced_legacy_manager"].append(
                        {
                            "employee_profile_id": profile.id,
                            "previous_manager_id": profile.manager_id,
                            "new_manager_id": manager_profile.user_id,
                        }
                    )
                    if apply_changes:
                        profile.manager_id = manager_profile.user_id
                        profile.save(update_fields=["manager", "updated_at"])
                        audit(
                            None,
                            "employee_manager_legacy_synced",
                            entity="EmployeeProfile",
                            entity_id=profile.id,
                            actor=actor,
                            metadata={
                                "manager_profile_id": manager_profile.id,
                                "manager_user_id": manager_profile.user_id,
                                "changed_by": getattr(actor, "id", None),
                                "source": "sync_manager_relationships",
                            },
                        )
                    continue

                if not profile.manager_id:
                    result["unchanged"] += 1
                    continue

                candidates = list(
                    EmployeeProfile.objects.select_related("user").filter(user_id=profile.manager_id)
                )
                if len(candidates) != 1:
                    result["conflicts"].append(
                        {
                            "employee_profile_id": profile.id,
                            "legacy_manager_id": profile.manager_id,
                            "reason": f"Legacy manager maps to {len(candidates)} employee profiles.",
                        }
                    )
                    continue

                manager_profile = candidates[0]
                try:
                    validate_manager_assignment(profile, manager_profile)
                except ValidationError as exc:
                    result["conflicts"].append(
                        {
                            "employee_profile_id": profile.id,
                            "legacy_manager_id": profile.manager_id,
                            "candidate_manager_profile_id": manager_profile.id,
                            "reason": "; ".join(exc.messages),
                        }
                    )
                    continue

                result["backfilled_manager_profile"].append(
                    {
                        "employee_profile_id": profile.id,
                        "manager_profile_id": manager_profile.id,
                        "manager_user_id": manager_profile.user_id,
                    }
                )
                if apply_changes:
                    profile.manager_profile = manager_profile
                    profile.save(update_fields=["manager_profile", "updated_at"])
                    log_manager_assignment_change(
                        employee=profile,
                        previous_manager=None,
                        new_manager=manager_profile,
                        changed_by=actor,
                        source="sync_manager_relationships",
                    )

            if not apply_changes:
                transaction.set_rollback(True)

        if apply_changes:
            reroute_pending_manager_requests(
                EmployeeProfile.objects.filter(
                    id__in=[item["employee_profile_id"] for item in result["backfilled_manager_profile"]]
                ),
                actor=actor,
            )

        if options["format"] == "json":
            self.stdout.write(json.dumps(result, indent=2, sort_keys=True))
            return

        mode = "APPLY" if apply_changes else "DRY RUN"
        self.stdout.write(f"Manager relationship sync ({mode})")
        for category in ("backfilled_manager_profile", "synced_legacy_manager", "conflicts"):
            self.stdout.write(f"{category}: {len(result[category])}")
            for row in result[category]:
                self.stdout.write(f"  {json.dumps(row, sort_keys=True)}")
        self.stdout.write(f"unchanged: {result['unchanged']}")
