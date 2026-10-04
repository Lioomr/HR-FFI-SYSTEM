"""Preview or apply one company's employee-code mapping without changing primary keys."""

import csv
import re
from collections import Counter
from datetime import date
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from audit.models import AuditLog
from employees.models import EmployeeIdAlias, EmployeeProfile
from organization.models import OrganizationNode
from payroll.models import PayrollRun, PayrollRunItem

COMPANY_PREFIXES = {"FFI": "FFI", "ASECO_PRO": "ASECO", "ATHROYA": "ATH"}
FFI_FIXED_PROFILES = (2, 1, 22)  # Fathi, Abdelaal, MD Julfiker, confirmed against production.
CSV_FIELDS = ("profile_pk", "old_employee_id", "new_employee_id")


def proposed_rows(company, profiles):
    """Return stable company-specific numbering using saved hire dates."""
    by_pk = {profile.pk: profile for profile in profiles}
    fixed = []
    if company.code == "FFI":
        missing = set(FFI_FIXED_PROFILES) - by_pk.keys()
        if missing:
            raise CommandError(f"FFI fixed profiles missing from roster: {sorted(missing)}")
        fixed = [by_pk[pk] for pk in FFI_FIXED_PROFILES]

    remaining = [profile for profile in profiles if profile not in fixed]
    remaining.sort(
        key=lambda profile: (
            profile.hire_date is None,
            profile.hire_date or date.max,
            (profile.created_at.isoformat() if profile.created_at else "~") if profile.hire_date is None else "",
            profile.pk,
        )
    )
    numbered = fixed + remaining
    first = 1 if company.code == "FFI" else 3
    prefix = COMPANY_PREFIXES[company.code]
    return [
        {
            "profile_pk": profile.pk,
            "old_employee_id": profile.employee_id,
            "new_employee_id": f"{prefix}-{index:04d}",
        }
        for index, profile in enumerate(numbered, start=first)
    ]


def read_mapping(path):
    try:
        with Path(path).open(newline="", encoding="utf-8-sig") as handle:
            reader = csv.DictReader(handle)
            if reader.fieldnames != list(CSV_FIELDS):
                raise CommandError(f"CSV header must be: {','.join(CSV_FIELDS)}")
            rows = []
            for line, row in enumerate(reader, start=2):
                if None in row or any(value is None for value in row.values()):
                    raise CommandError(f"Malformed CSV line {line}")
                try:
                    pk = int(row["profile_pk"])
                except ValueError as exc:
                    raise CommandError(f"Invalid profile_pk on line {line}") from exc
                rows.append(
                    {
                        "profile_pk": pk,
                        "old_employee_id": row["old_employee_id"].strip(),
                        "new_employee_id": row["new_employee_id"].strip(),
                    }
                )
            return rows
    except OSError as exc:
        raise CommandError(f"Cannot read mapping CSV: {exc}") from exc


def validate_mapping(company, profiles, proposed, rows):
    if not rows:
        raise CommandError("Mapping CSV is empty")
    pks = [row["profile_pk"] for row in rows]
    old_ids = [row["old_employee_id"] for row in rows]
    new_ids = [row["new_employee_id"] for row in rows]
    if len(set(pks)) != len(pks) or len(set(old_ids)) != len(old_ids) or len(set(new_ids)) != len(new_ids):
        raise CommandError("Duplicate profile PK, old code, or new code in mapping")
    roster = {profile.pk: profile for profile in profiles}
    if set(pks) != set(roster):
        raise CommandError(
            f"CSV must contain the exact company roster; missing={sorted(set(roster) - set(pks))}, extra={sorted(set(pks) - set(roster))}"
        )
    expected = {row["profile_pk"]: row for row in proposed}
    pattern = re.compile(rf"^{re.escape(COMPANY_PREFIXES[company.code])}-\d{{4}}$")
    for row in rows:
        pk = row["profile_pk"]
        if row["old_employee_id"] != roster[pk].employee_id:
            raise CommandError(f"Profile {pk} no longer has expected old code")
        if not pattern.fullmatch(row["new_employee_id"]):
            raise CommandError(f"Invalid new code for profile {pk}")
        if row["new_employee_id"] != expected[pk]["new_employee_id"]:
            raise CommandError(f"Profile {pk} differs from saved-date proposal; review hire dates and regenerate CSV")
    existing = EmployeeProfile.objects.filter(employee_id__in=new_ids).exclude(pk__in=pks)
    if existing.exists():
        raise CommandError("New code already belongs to another employee")
    if EmployeeIdAlias.objects.filter(old_employee_id__in=old_ids + new_ids).exists():
        raise CommandError("A mapped old or new code is already an alias")


def draft_items_for_mapping(company, rows, *, lock=False):
    old_ids = [row["old_employee_id"] for row in rows]
    new_ids = [row["new_employee_id"] for row in rows]
    qs = PayrollRunItem.objects.filter(
        payroll_run__company=company, payroll_run__status=PayrollRun.Status.DRAFT
    ).order_by("payroll_run_id", "id")
    if lock:
        qs = qs.select_for_update(of=("self",))
    items = list(qs)
    per_run = Counter((item.payroll_run_id, item.employee_id) for item in items)
    repeated = [(run_id, code) for (run_id, code), count in per_run.items() if count > 1 and code in old_ids]
    if repeated:
        raise CommandError(f"Duplicate mapped employee rows in draft payroll: {repeated}")
    if any(item.employee_id in new_ids and item.employee_id not in old_ids for item in items):
        raise CommandError("Draft payroll already contains a target employee code")
    mapped = [item for item in items if item.employee_id in old_ids]
    unmatched = [item for item in items if item.employee_id not in old_ids]
    return mapped, unmatched


class Command(BaseCommand):
    help = "Preview one company's saved-hire-date employee ID plan; apply a verified complete CSV with --apply."

    def add_arguments(self, parser):
        parser.add_argument("--company-code", required=True, choices=tuple(COMPANY_PREFIXES))
        parser.add_argument("--csv", dest="csv_path")
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **options):
        if options["apply"] and not options["csv_path"]:
            raise CommandError("--apply requires --csv with the complete reviewed mapping")
        with transaction.atomic():
            company_qs = OrganizationNode.objects
            if options["apply"]:
                company_qs = company_qs.select_for_update()
            company = company_qs.get(code=options["company_code"], node_type=OrganizationNode.NodeType.COMPANY)
            profile_qs = EmployeeProfile.objects.filter(company=company).order_by("pk")
            if options["apply"]:
                profile_qs = profile_qs.select_for_update()
            profiles = list(profile_qs)
            proposed = proposed_rows(company, profiles)
            rows = read_mapping(options["csv_path"]) if options["csv_path"] else proposed
            validate_mapping(company, profiles, proposed, rows)
            draft_items, unmatched = draft_items_for_mapping(company, rows, lock=options["apply"])
            self.stdout.write(",".join(CSV_FIELDS))
            for row in rows:
                self.stdout.write(",".join(str(row[field]) for field in CSV_FIELDS))
            self.stdout.write(f"Company profiles: {len(rows)}; mapped draft payroll rows: {len(draft_items)}")
            if unmatched:
                self.stdout.write(
                    self.style.WARNING(
                        f"Unmatched existing draft payroll rows left unchanged: {[(item.pk, item.employee_id) for item in unmatched]}"
                    )
                )
            conflicts = [
                profile
                for profile in profiles
                if profile.hire_date_raw and str(profile.hire_date) != profile.hire_date_raw
            ]
            for profile in conflicts:
                self.stdout.write(
                    self.style.WARNING(
                        f"Hire-date conflict for profile {profile.pk}: saved={profile.hire_date}, raw={profile.hire_date_raw}"
                    )
                )
            if not options["apply"]:
                self.stdout.write("Preview only; no records changed.")
                return

            by_old = {row["old_employee_id"]: row for row in rows}
            for row in rows:
                profile = next(profile for profile in profiles if profile.pk == row["profile_pk"])
                EmployeeIdAlias.objects.create(
                    company=company,
                    employee_profile=profile,
                    old_employee_id=row["old_employee_id"],
                    new_employee_id=row["new_employee_id"],
                )
                EmployeeProfile.objects.filter(pk=profile.pk).update(employee_id=row["new_employee_id"])
                AuditLog.objects.create(
                    action="employee_id.migrated",
                    entity="EmployeeProfile",
                    entity_id=str(profile.pk),
                    metadata={
                        "company_id": company.pk,
                        "old_employee_id": row["old_employee_id"],
                        "new_employee_id": row["new_employee_id"],
                    },
                )
            for item in draft_items:
                item.employee_id = by_old[item.employee_id]["new_employee_id"]
                item.save(update_fields=["employee_id"])
            if PayrollRunItem.objects.filter(
                pk__in=[item.pk for item in draft_items], employee_id__in=list(by_old)
            ).exists():
                raise CommandError("A mapped draft payroll row retained an old employee code")
            self.stdout.write(
                self.style.SUCCESS(f"Applied {len(rows)} employee codes and {len(draft_items)} draft payroll rows.")
            )
