from collections import Counter

from django.db import migrations


def backfill(apps, schema_editor):
    from audit.utils import audit

    alias = schema_editor.connection.alias
    Run = apps.get_model("payroll", "PayrollRun")
    Item = apps.get_model("payroll", "PayrollRunItem")
    Slip = apps.get_model("payroll", "Payslip")
    Line = apps.get_model("payroll", "PayrollLine")
    Profile = apps.get_model("employees", "EmployeeProfile")
    components = {
        "basic_salary": "BASIC_SALARY",
        "accommodation_allowance": "ACCOMMODATION_ALLOWANCE",
        "transportation_allowance": "TRANSPORTATION_ALLOWANCE",
        "telephone_allowance": "TELEPHONE_ALLOWANCE",
        "petrol_allowance": "PETROL_ALLOWANCE",
        "other_allowance": "OTHER_ALLOWANCE",
    }
    for run in Run.objects.using(alias).all().iterator():
        items = list(Item.objects.using(alias).filter(payroll_run_id=run.pk))
        counts = Counter(item.employee_id for item in items)
        run.settings_snapshot = {"schema_version": 0, "legacy_unknown": True}
        run.legacy_calculation = True
        run.calculator_version = "legacy"
        run.save(using=alias, update_fields=["settings_snapshot", "legacy_calculation", "calculator_version"])
        resolved = {}
        issues = []
        for item in items:
            profiles = (
                list(Profile.objects.using(alias).filter(employee_id=item.employee_id, company_id=run.company_id))
                if run.company_id
                else []
            )
            item.company_id = run.company_id
            item.input_snapshot = {
                "schema_version": 0,
                "legacy_unknown": True,
                "legacy_allowance_aggregate": str(item.total_allowances),
            }
            if len(profiles) == 1 and counts[item.employee_id] == 1:
                profile = profiles[0]
                item.employee_profile_id = profile.pk
                resolved[profile.pk] = item
                item.input_snapshot["legacy_accountless"] = profile.user_id is None
            else:
                issues.append(
                    {"code": "legacy_link_unresolved", "item_id": item.pk, "detail": "ambiguous_or_missing_profile"}
                )
            item.save(using=alias, update_fields=["company", "employee_profile", "input_snapshot"])
        slips = list(Slip.objects.using(alias).filter(payroll_run_id=run.pk))
        slip_counts = Counter(slip.employee_id for slip in slips)
        linked_items = set()
        for slip in slips:
            original = {
                "status": slip.status,
                "is_active": slip.is_active,
                "employee_profile_id": slip.employee_profile_id,
                "payroll_run_item_id": slip.payroll_run_item_id,
            }
            profiles = (
                list(Profile.objects.using(alias).filter(user_id=slip.employee_id, company_id=run.company_id))
                if run.company_id and slip.employee_id
                else []
            )
            item = resolved.get(profiles[0].pk) if len(profiles) == 1 and slip_counts[slip.employee_id] == 1 else None
            slip.company_id = run.company_id
            slip.status = run.status
            if run.status == "CANCELLED":
                slip.is_active = False
            if item:
                slip.employee_profile_id = item.employee_profile_id
                slip.payroll_run_item_id = item.pk
                linked_items.add(item.pk)
                item.gross_salary = slip.total_salary
                item.save(using=alias, update_fields=["gross_salary"])
                evidence = {
                    "schema_version": 0,
                    "legacy_unknown": True,
                    "payslip_id": slip.pk,
                    "preserved_amount": str(slip.total_deductions),
                }
                Line.objects.using(alias).get_or_create(
                    item_id=item.pk,
                    source_key="legacy:previous_total_deductions",
                    defaults={
                        "company_id": run.company_id,
                        "category": "DEDUCTION",
                        "type": "PREVIOUS_TOTAL_DEDUCTIONS",
                        "source_kind": "legacy",
                        "amount": slip.total_deductions,
                        "calculation_snapshot": evidence,
                    },
                )
                for field, kind in components.items():
                    Line.objects.using(alias).get_or_create(
                        item_id=item.pk,
                        source_key="legacy:" + field,
                        defaults={
                            "company_id": run.company_id,
                            "category": "SALARY",
                            "type": kind,
                            "source_kind": "legacy",
                            "amount": getattr(slip, field),
                            "calculation_snapshot": {"payslip_id": slip.pk, "preserved": True},
                        },
                    )
            else:
                issues.append(
                    {"code": "legacy_link_unresolved", "payslip_id": slip.pk, "detail": "ambiguous_or_missing_item"}
                )
            slip.save(
                using=alias, update_fields=["company", "status", "is_active", "employee_profile", "payroll_run_item"]
            )
            audit(
                None,
                "payroll_legacy_backfilled",
                entity="Payslip",
                entity_id=slip.pk,
                metadata={
                    "company_id": run.company_id,
                    "run_id": run.pk,
                    "original_value": original,
                    "new_value": {
                        "status": slip.status,
                        "is_active": slip.is_active,
                        "employee_profile_id": slip.employee_profile_id,
                        "payroll_run_item_id": slip.payroll_run_item_id,
                    },
                    "reason": "Preserve legacy money; align payroll linkage and status",
                },
            )
        for item in items:
            if item.employee_profile_id and item.pk not in linked_items:
                # Legacy items have only an allowance aggregate, not an exact component split.
                issues.append(
                    {
                        "code": "legacy_link_unresolved",
                        "item_id": item.pk,
                        "detail": "exact_legacy_payslip_components_unavailable",
                    }
                )
        run.validation_snapshot = {"schema_version": 0, "legacy_link_issues": issues}
        run.save(using=alias, update_fields=["validation_snapshot"])
        audit(
            None,
            "payroll_legacy_backfilled",
            entity="PayrollRun",
            entity_id=run.pk,
            metadata={
                "company_id": run.company_id,
                "reason": "Preserve legacy values; report unresolved links",
                "resolved_items": len(resolved),
                "issues": issues,
            },
        )


class Migration(migrations.Migration):
    dependencies = [("payroll", "0007_payroll_rebuild_foundation"), ("audit", "0001_initial")]
    # No reverse data mutation: audit and preserved historical money must survive rollback.
    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]
