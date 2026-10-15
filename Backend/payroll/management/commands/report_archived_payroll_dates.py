import csv
from collections import Counter

from attendance.biotime_policy import attendance_enforced_from
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from employees.models import EmployeeProfile

from payroll.calculator import EmployeeInput, calculate_employee, date_set, default_settings, period_dates
from payroll.models import PayrollRun


class Command(BaseCommand):
    help = "Read-only pre-go-live payroll data audit; stdout counts only, details in a private CSV."

    def add_arguments(self, parser):
        parser.add_argument("--output", required=True)
        parser.add_argument("--year", type=int)
        parser.add_argument("--month", type=int)

    def handle(self, *args, **options):
        if bool(options["year"]) != bool(options["month"]):
            raise CommandError("--year and --month must be supplied together")
        rows = []
        first = last = None
        if options["year"]:
            try:
                first, last = period_dates(options["year"], options["month"])
            except ValueError as exc:
                raise CommandError("invalid_period") from exc
        for profile in EmployeeProfile.objects.select_related("company").order_by("pk").iterator():
            base = {
                "profile_id": profile.pk,
                "employee_id": profile.employee_id,
                "company_id": profile.company_id,
                "employment_status": profile.employment_status,
                "allowed_overtime": profile.allowed_overtime,
            }
            if profile.is_archived and not profile.archived_at:
                rows.append({**base, "issue_code": "archived_without_date"})
            if profile.employment_status == "TERMINATED" and not profile.archived_at and not profile.is_archived:
                rows.append({**base, "issue_code": "terminated_without_end_date"})
            if profile.allowed_overtime in (0, 1):
                rows.append({**base, "issue_code": "allowed_overtime_import_review"})
            if first:
                if not profile.company_id or not profile.company.is_active or profile.company.node_type != "company":
                    continue
                archive = timezone.localtime(profile.archived_at).date() if profile.archived_at else None
                eligibility = calculate_employee(
                    EmployeeInput(
                        profile.pk,
                        first.year,
                        first.month,
                        {},
                        hire_date=profile.hire_date,
                        archive_date=archive,
                        is_archived=profile.is_archived,
                        employment_status=profile.employment_status,
                    ),
                    default_settings(),
                )
                if not eligibility["included"]:
                    continue
                employed = date_set(max(first, profile.hire_date or first), min(last, archive or last))
                mapped, starts = attendance_enforced_from(profile)
                uncovered = employed if not mapped else frozenset(d for d in employed if starts and d < starts)
                if uncovered:
                    rows.append(
                        {
                            **base,
                            "issue_code": "attendance_source_unavailable",
                            "coverage": "unmapped" if not mapped else "partial",
                            "attendance_start_date": starts.isoformat() if starts else "",
                            "uncovered_dates": ";".join(d.isoformat() for d in sorted(uncovered)),
                        }
                    )
        for run in PayrollRun.objects.only("pk", "company_id", "validation_snapshot").iterator():
            for issue in run.validation_snapshot.get("legacy_link_issues", []):
                rows.append(
                    {
                        "company_id": run.company_id,
                        "run_id": run.pk,
                        "issue_code": issue["code"],
                        "detail": issue.get("detail", ""),
                        "item_id": issue.get("item_id", ""),
                        "payslip_id": issue.get("payslip_id", ""),
                    }
                )
        columns = [
            "profile_id",
            "employee_id",
            "company_id",
            "employment_status",
            "issue_code",
            "allowed_overtime",
            "coverage",
            "attendance_start_date",
            "uncovered_dates",
            "run_id",
            "item_id",
            "payslip_id",
            "detail",
        ]
        with open(options["output"], "w", encoding="utf-8-sig", newline="") as output:
            writer = csv.DictWriter(output, fieldnames=columns)
            writer.writeheader()
            writer.writerows(rows)
        counts = Counter(row["issue_code"] for row in rows)
        coverage = Counter(row.get("coverage") for row in rows if row["issue_code"] == "attendance_source_unavailable")
        self.stdout.write(f"rows={len(rows)} " + " ".join(f"{code}={count}" for code, count in sorted(counts.items())))
        if first:
            self.stdout.write(f"unmapped={coverage['unmapped']} partial={coverage['partial']}")
