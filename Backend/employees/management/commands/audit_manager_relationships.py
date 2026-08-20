import json

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from employees.models import EmployeeProfile
from employees.services.manager_relationships import active_direct_reports_queryset, find_reporting_cycles


def _profile_row(profile):
    return {
        "employee_profile_id": profile.id,
        "employee_id": profile.employee_id,
        "user_id": profile.user_id,
        "manager_id": profile.manager_id,
        "manager_profile_id": profile.manager_profile_id,
        "company_id": profile.company_id,
    }


def build_manager_audit_report():
    profiles = list(
        EmployeeProfile.objects.select_related(
            "user",
            "company",
            "manager",
            "manager__employee_profile",
            "manager_profile",
            "manager_profile__user",
            "manager_profile__company",
        ).order_by("id")
    )

    report = {
        "legacy_manager_missing_manager_profile": [],
        "manager_profile_legacy_mismatch": [],
        "manager_profile_without_linked_active_user": [],
        "self_manager_records": [],
        "cross_company_manager_assignments": [],
        "archived_or_inactive_managers": [],
        "reporting_cycles": find_reporting_cycles(profiles),
        "active_employees_without_manager_profile": [],
        "manager_group_users_without_direct_reports": [],
    }

    for profile in profiles:
        row = _profile_row(profile)
        manager_profile = profile.manager_profile
        if profile.manager_id and not profile.manager_profile_id:
            report["legacy_manager_missing_manager_profile"].append(row)

        expected_legacy_manager_id = manager_profile.user_id if manager_profile else None
        if manager_profile and profile.manager_id != expected_legacy_manager_id:
            report["manager_profile_legacy_mismatch"].append(
                {**row, "expected_manager_id": expected_legacy_manager_id}
            )

        if manager_profile and (not manager_profile.user_id or not manager_profile.user.is_active):
            report["manager_profile_without_linked_active_user"].append(row)

        if profile.manager_profile_id == profile.id or (profile.user_id and profile.manager_id == profile.user_id):
            report["self_manager_records"].append(row)

        cross_company = bool(
            manager_profile
            and profile.company_id != manager_profile.company_id
        )
        legacy_manager_profile = getattr(profile.manager, "employee_profile", None) if profile.manager_id else None
        if not manager_profile and legacy_manager_profile:
            cross_company = cross_company or bool(
                profile.company_id != legacy_manager_profile.company_id
            )
        if cross_company:
            report["cross_company_manager_assignments"].append(row)

        if manager_profile and (
            manager_profile.is_archived
            or manager_profile.employment_status != EmployeeProfile.EmploymentStatus.ACTIVE
        ):
            report["archived_or_inactive_managers"].append(row)

        if (
            not profile.is_archived
            and profile.employment_status == EmployeeProfile.EmploymentStatus.ACTIVE
            and not profile.manager_profile_id
        ):
            report["active_employees_without_manager_profile"].append(row)

    User = get_user_model()
    for user in User.objects.filter(groups__name="Manager").distinct().order_by("id"):
        if not active_direct_reports_queryset(user).exists():
            report["manager_group_users_without_direct_reports"].append(
                {"user_id": user.id, "email": user.email}
            )
    return report


class Command(BaseCommand):
    help = "Audit EmployeeProfile manager relationships without changing data."

    def add_arguments(self, parser):
        parser.add_argument("--format", choices=["human", "json"], default="human")

    def handle(self, *args, **options):
        report = build_manager_audit_report()
        if options["format"] == "json":
            self.stdout.write(json.dumps(report, indent=2, sort_keys=True))
            return

        self.stdout.write("Manager relationship audit (read-only)")
        for category, rows in report.items():
            self.stdout.write(f"{category}: {len(rows)}")
            for row in rows:
                self.stdout.write(f"  {json.dumps(row, sort_keys=True)}")
