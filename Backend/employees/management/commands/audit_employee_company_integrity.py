import json

from django.apps import apps
from django.core.exceptions import ObjectDoesNotExist
from django.core.management.base import BaseCommand
from django.db import connection
from django.db.models import Count, Q
from django.utils import timezone

from attendance.models import BioTimeEmployeeMap
from core.models import CrossCompanyManagerAssignment, DelegationRule
from employees.models import EmployeeProfile
from leaves.models import (
    AnnualLeavePaymentRequest,
    LeaveBalanceAdjustment,
    LeaveBalanceSnapshot,
    LeaveRequest,
)
from organization.models import OrganizationNode, OrganizationScopeMembership

PROTECTED_DELETED_EMPLOYEE_IDS = {"FFI-04FACD", "FFI-183F0F", "FFI-3E0622"}


def _profile_row(profile):
    return {
        "employee_profile_id": profile.id,
        "employee_id": profile.employee_id,
        "employee_number": profile.employee_number,
        "full_name": profile.full_name or profile.full_name_en or "",
        "company_id": profile.company_id,
        "employment_status": profile.employment_status,
        "is_archived": profile.is_archived,
        "attendance_record_count": profile.attendance_records.count(),
    }


def _duplicates_for(field_name):
    populated = EmployeeProfile.objects.exclude(**{f"{field_name}__isnull": True}).exclude(**{field_name: ""})
    groups = populated.values(field_name).annotate(record_count=Count("id")).filter(record_count__gt=1)
    result = []
    for group in groups.order_by(field_name):
        value = group[field_name]
        profiles = populated.filter(**{field_name: value}).order_by("id")
        result.append(
            {
                "field": field_name,
                "value": value,
                "record_count": group["record_count"],
                "profiles": [_profile_row(profile) for profile in profiles],
            }
        )
    return result


def _employee_relationship_issues(profile):
    issues = []
    for field_name in ["department_ref", "position_ref", "task_group_ref", "sponsor_ref"]:
        reference = getattr(profile, field_name, None)
        if reference is not None and reference.company_id != profile.company_id:
            issues.append(f"{field_name}_company_mismatch")

    manager_profile = profile.manager_profile
    if manager_profile is not None:
        if manager_profile.company_id != profile.company_id:
            issues.append("manager_profile_company_mismatch")
        if profile.manager_id != manager_profile.user_id:
            issues.append("manager_fields_disagree")
    elif profile.manager_id:
        try:
            legacy_manager_profile = profile.manager.employee_profile
        except ObjectDoesNotExist:
            legacy_manager_profile = None
        if legacy_manager_profile is None or legacy_manager_profile.company_id != profile.company_id:
            issues.append("legacy_manager_company_mismatch")
    return issues


def _leave_request_issues(row):
    issues = []
    profile_company_id = row["employee_profile__company_id"]
    profile_user_id = row["employee_profile__user_id"]
    if row["employee_profile_id"] is None:
        profile_company_id = row["employee__employee_profile__company_id"]
        profile_user_id = row["employee__employee_profile__user_id"]
    if row["company_id"] is None:
        issues.append("missing_company")
    if profile_company_id is None:
        issues.append("missing_employee_profile")
    else:
        if profile_company_id != row["company_id"]:
            issues.append("employee_company_mismatch")
        if row["employee_id"] and profile_user_id != row["employee_id"]:
            issues.append("employee_profile_mismatch")
    if row["leave_type__company_id"] != row["company_id"]:
        issues.append("leave_type_company_mismatch")
    if row["delegated_to_id"]:
        delegate_company_id = row["delegated_to__employee_profile__company_id"]
        if delegate_company_id is None:
            issues.append("delegate_missing_profile")
        elif delegate_company_id != row["company_id"]:
            issues.append("delegate_company_mismatch")
    return issues


def _adjustment_issues(row):
    issues = []
    profile_company_id = row["employee_profile__company_id"]
    profile_user_id = row["employee_profile__user_id"]
    if row["employee_profile_id"] is None:
        profile_company_id = row["employee__employee_profile__company_id"]
        profile_user_id = row["employee__employee_profile__user_id"]
    if row["company_id"] is None:
        issues.append("missing_company")
    if profile_company_id is None:
        issues.append("missing_employee_profile")
    else:
        if profile_company_id != row["company_id"]:
            issues.append("employee_company_mismatch")
        if row["employee_id"] and profile_user_id != row["employee_id"]:
            issues.append("employee_profile_mismatch")
    if row["leave_type__company_id"] != row["company_id"]:
        issues.append("leave_type_company_mismatch")
    return issues


def _invalid_leave_requests():
    rows = []
    queryset = LeaveRequest.objects.order_by("id").values(
        "id",
        "company_id",
        "employee_id",
        "employee_profile_id",
        "employee_profile__company_id",
        "employee_profile__user_id",
        "employee__employee_profile__company_id",
        "employee__employee_profile__user_id",
        "leave_type__company_id",
        "delegated_to_id",
        "delegated_to__employee_profile__company_id",
    )
    for request in queryset:
        issues = _leave_request_issues(request)
        if issues:
            rows.append({"leave_request_id": request["id"], "company_id": request["company_id"], "issues": issues})
    return rows


def _invalid_balance_snapshots():
    rows = []
    queryset = LeaveBalanceSnapshot.objects.order_by("id").values(
        "id", "employee_profile_id", "employee_profile__company_id", "leave_type_id", "leave_type__company_id"
    )
    for snapshot in queryset:
        if (
            snapshot["employee_profile__company_id"] is None
            or snapshot["employee_profile__company_id"] != snapshot["leave_type__company_id"]
        ):
            rows.append(
                {
                    "leave_balance_snapshot_id": snapshot["id"],
                    "employee_profile_id": snapshot["employee_profile_id"],
                    "leave_type_id": snapshot["leave_type_id"],
                    "issues": ["employee_leave_type_company_mismatch"],
                }
            )
    return rows


def _invalid_balance_adjustments():
    rows = []
    queryset = LeaveBalanceAdjustment.objects.order_by("id").values(
        "id",
        "company_id",
        "employee_id",
        "employee_profile_id",
        "employee_profile__company_id",
        "employee_profile__user_id",
        "employee__employee_profile__company_id",
        "employee__employee_profile__user_id",
        "leave_type__company_id",
    )
    for adjustment in queryset:
        issues = _adjustment_issues(adjustment)
        if issues:
            rows.append(
                {
                    "leave_balance_adjustment_id": adjustment["id"],
                    "company_id": adjustment["company_id"],
                    "issues": issues,
                }
            )
    return rows


def _invalid_annual_leave_payments():
    if AnnualLeavePaymentRequest._meta.db_table not in connection.introspection.table_names():
        return []
    rows = []
    queryset = AnnualLeavePaymentRequest.objects.order_by("id").values(
        "id", "company_id", "employee_id", "employee_profile__company_id", "employee_profile__user_id"
    )
    for payment in queryset:
        issues = []
        if payment["company_id"] is None:
            issues.append("missing_company")
        if payment["employee_profile__company_id"] != payment["company_id"]:
            issues.append("employee_company_mismatch")
        if payment["employee_id"] and payment["employee_profile__user_id"] != payment["employee_id"]:
            issues.append("employee_profile_mismatch")
        if issues:
            rows.append(
                {
                    "annual_leave_payment_request_id": payment["id"],
                    "company_id": payment["company_id"],
                    "issues": issues,
                }
            )
    return rows


def _invalid_biotime_mappings():
    rows = []
    queryset = BioTimeEmployeeMap.objects.select_related("employee_profile__company").order_by("id")
    for mapping in queryset:
        profile = mapping.employee_profile
        company = profile.company
        issues = []
        if profile.is_archived:
            issues.append("archived_employee")
        if company is None:
            issues.append("missing_company")
        elif company.node_type != OrganizationNode.NodeType.COMPANY:
            issues.append("company_is_not_company_node")
        elif not company.is_active:
            issues.append("inactive_company")
        if issues:
            rows.append(
                {
                    "biotime_mapping_id": mapping.id,
                    "employee_profile_id": mapping.employee_profile_id,
                    "issues": issues,
                }
            )
    return rows


def _company_owned_record_issues():
    """Read-only inventory of every concrete model with a company FK."""
    issues = []
    for model in apps.get_models():
        if model._meta.proxy or not model._meta.managed:
            continue
        try:
            company_field = model._meta.get_field("company")
        except Exception:
            continue
        if not getattr(company_field, "is_relation", False):
            continue
        table_name = model._meta.db_table
        if table_name not in connection.introspection.table_names():
            continue
        table_columns = {column.name for column in connection.introspection.get_table_description(connection.cursor(), table_name)}
        if company_field.column not in table_columns:
            issues.append(
                {
                    "model": model._meta.label,
                    "table": table_name,
                    "schema_unavailable": True,
                    "missing_columns": [company_field.column],
                }
            )
            continue
        queryset = model._default_manager.all()
        null_count = queryset.filter(company__isnull=True).count()
        invalid_count = queryset.filter(
            Q(company__isnull=False)
            & (~Q(company__node_type=OrganizationNode.NodeType.COMPANY) | Q(company__is_active=False))
        ).count()
        if null_count or invalid_count:
            issues.append(
                {
                    "model": model._meta.label,
                    "table": table_name,
                    "null_company_count": null_count,
                    "inactive_or_non_company_count": invalid_count,
                    "sample_ids": list(
                        queryset.filter(
                            Q(company__isnull=True)
                            | ~Q(company__node_type=OrganizationNode.NodeType.COMPANY)
                            | Q(company__is_active=False)
                        )[:20].values_list("pk", flat=True)
                    ),
                }
            )
    return issues


def _scope_and_delegation_issues():
    issues = {"organization_scope_memberships": [], "delegation_grants": [], "cross_company_manager_assignments": []}
    existing_tables = set(connection.introspection.table_names())
    if "organization_organizationscopemembership" not in existing_tables:
        return issues
    for membership in OrganizationScopeMembership.objects.select_related("scope", "company").order_by("id"):
        if not membership.scope.is_active or membership.company.node_type != OrganizationNode.NodeType.COMPANY or not membership.company.is_active:
            issues["organization_scope_memberships"].append(
                {"id": membership.id, "scope_id": membership.scope_id, "company_id": membership.company_id}
            )

    now = timezone.now()
    if "core_delegationrule" not in existing_tables or "core_crosscompanymanagerassignment" not in existing_tables:
        return issues
    for grant in DelegationRule.objects.select_related("from_user__employee_profile", "to_user__employee_profile", "scope").order_by("id"):
        from_profile = getattr(grant.from_user, "employee_profile", None)
        to_profile = getattr(grant.to_user, "employee_profile", None)
        grant_issues = []
        if not grant.capabilities:
            grant_issues.append("missing_capabilities")
        if grant.revoked_at and grant.is_active:
            grant_issues.append("revoked_but_active")
        if not from_profile or not to_profile or not from_profile.company_id or not to_profile.company_id:
            grant_issues.append("missing_company_owned_profile")
        elif from_profile.company_id != to_profile.company_id:
            member_ids = set(grant.scope.memberships.values_list("company_id", flat=True)) if grant.scope_id else set()
            if not grant.scope_id or not grant.scope.is_active or grant.end_at is None:
                grant_issues.append("cross_company_missing_active_timed_scope")
            elif {from_profile.company_id, to_profile.company_id} - member_ids:
                grant_issues.append("cross_company_scope_mismatch")
        if grant_issues:
            issues["delegation_grants"].append({"id": grant.id, "issues": grant_issues, "active_now": grant.start_at <= now})

    for assignment in CrossCompanyManagerAssignment.objects.select_related(
        "employee__user", "manager_profile__user", "scope"
    ).order_by("id"):
        assignment_issues = []
        employee = assignment.employee
        manager = assignment.manager_profile
        members = set(assignment.scope.memberships.values_list("company_id", flat=True))
        if assignment.employee_id == assignment.manager_profile_id:
            assignment_issues.append("self_management")
        if assignment.end_at <= assignment.start_at:
            assignment_issues.append("invalid_time_window")
        if assignment.revoked_at and assignment.is_active:
            assignment_issues.append("revoked_but_active")
        if not assignment.scope.is_active or {employee.company_id, manager.company_id} - members:
            assignment_issues.append("scope_mismatch")
        if employee.is_archived or manager.is_archived or not employee.user_id or not manager.user_id:
            assignment_issues.append("inactive_or_archived_profile")
        elif not employee.user.is_active or not manager.user.is_active:
            assignment_issues.append("inactive_user")
        if assignment_issues:
            issues["cross_company_manager_assignments"].append({"id": assignment.id, "issues": assignment_issues})
    return issues


def build_employee_company_integrity_report():
    null_company = EmployeeProfile.objects.filter(company__isnull=True).order_by("id")
    active_null_company = null_company.filter(is_archived=False)
    invalid_company_profiles = EmployeeProfile.objects.select_related("company").filter(
        Q(company__isnull=False) & ~Q(company__node_type=OrganizationNode.NodeType.COMPANY)
        | Q(is_archived=False, company__isnull=True)
        | Q(is_archived=False, company__is_active=False)
    ).order_by("id")
    invalid_relationships = []
    relationship_queryset = EmployeeProfile.objects.select_related(
        "department_ref",
        "position_ref",
        "task_group_ref",
        "sponsor_ref",
        "manager",
        "manager__employee_profile",
        "manager_profile",
    ).order_by("id")
    for profile in relationship_queryset:
        issues = _employee_relationship_issues(profile)
        if issues:
            invalid_relationships.append({**_profile_row(profile), "issues": issues})
    protected_ids_present = EmployeeProfile.objects.filter(employee_id__in=PROTECTED_DELETED_EMPLOYEE_IDS).order_by("id")
    aryam_profiles = EmployeeProfile.objects.filter(
        Q(full_name__icontains="Aryam Ahmed Alghamdi")
        | Q(full_name_en__icontains="Aryam Ahmed Alghamdi")
    ).order_by("id")

    return {
        "null_company_profiles": [_profile_row(profile) for profile in null_company],
        "non_archived_null_company_profiles": [_profile_row(profile) for profile in active_null_company],
        "invalid_company_profiles": [_profile_row(profile) for profile in invalid_company_profiles],
        "invalid_employee_relationships": invalid_relationships,
        "invalid_leave_requests": _invalid_leave_requests(),
        "invalid_leave_balance_snapshots": _invalid_balance_snapshots(),
        "invalid_leave_balance_adjustments": _invalid_balance_adjustments(),
        "invalid_annual_leave_payment_requests": _invalid_annual_leave_payments(),
        "invalid_biotime_mappings": _invalid_biotime_mappings(),
        "company_owned_record_issues": _company_owned_record_issues(),
        "scope_and_delegation_issues": _scope_and_delegation_issues(),
        "duplicate_employee_numbers": _duplicates_for("employee_number"),
        "duplicate_national_ids": _duplicates_for("national_id"),
        "duplicate_passport_numbers": _duplicates_for("passport_no"),
        "exact_name_duplicates": _duplicates_for("full_name"),
        "protected_deleted_employee_ids_present": [
            _profile_row(profile) for profile in protected_ids_present
        ],
        "aryam_ahmed_alghamdi_records": [_profile_row(profile) for profile in aryam_profiles],
    }


class Command(BaseCommand):
    help = "Report null-company and possible duplicate employee records without changing data."

    def add_arguments(self, parser):
        parser.add_argument("--format", choices=["human", "json"], default="human")

    def handle(self, *args, **options):
        report = build_employee_company_integrity_report()
        if options["format"] == "json":
            self.stdout.write(json.dumps(report, indent=2, sort_keys=True))
            return

        self.stdout.write("Employee company integrity audit (read-only; no assignments inferred from names)")
        for category, rows in report.items():
            self.stdout.write(f"{category}: {len(rows)}")
            for row in rows:
                self.stdout.write(f"  {json.dumps(row, sort_keys=True)}")
