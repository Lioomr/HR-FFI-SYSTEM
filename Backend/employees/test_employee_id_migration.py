from datetime import date, datetime, timezone
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from audit.models import AuditLog
from employees.management.commands.migrate_employee_ids import proposed_rows
from employees.models import EmployeeIdAlias, EmployeeProfile
from organization.models import OrganizationNode
from payroll.models import PayrollRun, PayrollRunItem


class EmployeeIdMigrationTests(TestCase):
    def setUp(self):
        self.company, _ = OrganizationNode.objects.get_or_create(
            code="ASECO_PRO",
            defaults={
                "name": "Aseco Pro",
                "node_type": OrganizationNode.NodeType.COMPANY,
                "employee_id_prefix": "ASECO",
            },
        )
        self.later = EmployeeProfile.objects.create(
            company=self.company,
            employee_id="ASECO-111111",
            full_name="Later",
            hire_date=date(2025, 8, 1),
        )
        self.earlier = EmployeeProfile.objects.create(
            company=self.company,
            employee_id="ASECO-222222",
            full_name="Earlier",
            hire_date=date(2025, 4, 1),
        )

    def mapping_csv(self, directory):
        path = Path(directory) / "mapping.csv"
        rows = proposed_rows(self.company, [self.later, self.earlier])
        path.write_text(
            "profile_pk,old_employee_id,new_employee_id\n"
            + "".join(f"{row['profile_pk']},{row['old_employee_id']},{row['new_employee_id']}\n" for row in rows),
            encoding="utf-8",
        )
        return path

    def test_preview_does_not_change_records(self):
        output = StringIO()
        call_command("migrate_employee_ids", company_code="ASECO_PRO", stdout=output)
        self.assertIn(f"{self.earlier.pk},ASECO-222222,ASECO-0003", output.getvalue())
        self.earlier.refresh_from_db()
        self.assertEqual(self.earlier.employee_id, "ASECO-222222")
        self.assertFalse(EmployeeIdAlias.objects.exists())

    def test_dated_tie_uses_pk_and_null_dates_use_created_at(self):
        self.later.hire_date = date(2025, 4, 1)
        self.earlier.hire_date = date(2025, 4, 1)
        self.earlier.created_at = datetime(2020, 1, 1, tzinfo=timezone.utc)
        self.later.created_at = datetime(2025, 1, 1, tzinfo=timezone.utc)
        rows = proposed_rows(self.company, [self.earlier, self.later])
        self.assertEqual([row["profile_pk"] for row in rows], [self.later.pk, self.earlier.pk])

        self.later.hire_date = None
        self.earlier.hire_date = None
        rows = proposed_rows(self.company, [self.earlier, self.later])
        self.assertEqual([row["profile_pk"] for row in rows], [self.earlier.pk, self.later.pk])

    def test_apply_updates_profiles_aliases_and_only_draft_payroll(self):
        draft = PayrollRun.objects.create(company=self.company, year=2026, month=9)
        locked = PayrollRun.objects.create(company=self.company, year=2026, month=8, status=PayrollRun.Status.PAID)
        draft_item = PayrollRunItem.objects.create(
            payroll_run=draft, employee_id=self.earlier.employee_id, employee_name="Earlier"
        )
        locked_item = PayrollRunItem.objects.create(
            payroll_run=locked, employee_id=self.earlier.employee_id, employee_name="Earlier"
        )
        with TemporaryDirectory() as directory:
            path = self.mapping_csv(directory)
            call_command(
                "migrate_employee_ids", company_code="ASECO_PRO", csv_path=str(path), apply=True, stdout=StringIO()
            )
        self.earlier.refresh_from_db()
        draft_item.refresh_from_db()
        locked_item.refresh_from_db()
        self.assertEqual(self.earlier.employee_id, "ASECO-0003")
        self.assertEqual(draft_item.employee_id, "ASECO-0003")
        self.assertEqual(locked_item.employee_id, "ASECO-222222")
        self.assertEqual(EmployeeIdAlias.objects.filter(company=self.company).count(), 2)
        self.assertEqual(AuditLog.objects.filter(action="employee_id.migrated").count(), 2)

    def test_incomplete_mapping_is_rejected_without_changes(self):
        with TemporaryDirectory() as directory:
            path = self.mapping_csv(directory)
            path.write_text(
                f"profile_pk,old_employee_id,new_employee_id\n{self.earlier.pk},ASECO-222222,ASECO-0003\n",
                encoding="utf-8",
            )
            with self.assertRaises(CommandError):
                call_command(
                    "migrate_employee_ids", company_code="ASECO_PRO", csv_path=str(path), apply=True, stdout=StringIO()
                )
        self.assertFalse(EmployeeIdAlias.objects.exists())
        self.assertEqual(EmployeeProfile.objects.get(pk=self.earlier.pk).employee_id, "ASECO-222222")

    def test_apply_does_not_revalidate_unrelated_legacy_profile_fields(self):
        with TemporaryDirectory() as directory:
            path = self.mapping_csv(directory)
            with patch.object(EmployeeProfile, "save", side_effect=AssertionError("profile save must not run")):
                call_command(
                    "migrate_employee_ids", company_code="ASECO_PRO", csv_path=str(path), apply=True, stdout=StringIO()
                )
        self.earlier.refresh_from_db()
        self.assertEqual(self.earlier.employee_id, "ASECO-0003")
