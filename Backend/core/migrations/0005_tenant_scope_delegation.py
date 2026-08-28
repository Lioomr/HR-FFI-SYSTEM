import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

from core.models import default_delegation_capabilities

FORWARD_SQL = r"""
CREATE OR REPLACE FUNCTION ffi_validate_organization_scope_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM organization_organizationnode company
        WHERE company.id = NEW.company_id
          AND company.node_type = 'company'
          AND company.is_active
    ) THEN
        RAISE EXCEPTION 'Organization scopes can contain active COMPANY nodes only.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER organization_scope_membership_guard
BEFORE INSERT OR UPDATE OF company_id
ON organization_organizationscopemembership
FOR EACH ROW EXECUTE FUNCTION ffi_validate_organization_scope_membership();

CREATE OR REPLACE FUNCTION ffi_guard_scope_company_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF (NEW.node_type IS DISTINCT FROM 'company' OR NEW.is_active IS DISTINCT FROM TRUE)
       AND EXISTS (SELECT 1 FROM organization_organizationscopemembership m WHERE m.company_id = OLD.id) THEN
        RAISE EXCEPTION 'Remove a company from organization scopes before deactivation or type change.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER organization_scope_company_guard
BEFORE UPDATE OF node_type, is_active
ON organization_organizationnode
FOR EACH ROW EXECUTE FUNCTION ffi_guard_scope_company_change();

CREATE OR REPLACE FUNCTION ffi_validate_cross_company_delegation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    from_company_id bigint;
    to_company_id bigint;
BEGIN
    SELECT company_id INTO from_company_id FROM employees_employeeprofile WHERE user_id = NEW.from_user_id;
    SELECT company_id INTO to_company_id FROM employees_employeeprofile WHERE user_id = NEW.to_user_id;
    IF from_company_id IS NULL OR to_company_id IS NULL THEN
        RAISE EXCEPTION 'Delegation users must have company-owned employee profiles.' USING ERRCODE = 'check_violation';
    END IF;
    IF jsonb_typeof(NEW.capabilities) <> 'array' OR jsonb_array_length(NEW.capabilities) = 0 THEN
        RAISE EXCEPTION 'Delegation grants require explicit capabilities.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.revoked_at IS NOT NULL AND NEW.is_active THEN
        RAISE EXCEPTION 'A revoked delegation grant cannot remain active.' USING ERRCODE = 'check_violation';
    END IF;
    IF from_company_id IS DISTINCT FROM to_company_id THEN
        IF NEW.scope_id IS NULL OR NEW.end_at IS NULL THEN
            RAISE EXCEPTION 'Cross-company delegation requires an approved scope and end time.' USING ERRCODE = 'check_violation';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM organization_organizationscope scope WHERE scope.id = NEW.scope_id AND scope.is_active)
           OR NOT EXISTS (SELECT 1 FROM organization_organizationscopemembership m WHERE m.scope_id = NEW.scope_id AND m.company_id = from_company_id)
           OR NOT EXISTS (SELECT 1 FROM organization_organizationscopemembership m WHERE m.scope_id = NEW.scope_id AND m.company_id = to_company_id) THEN
            RAISE EXCEPTION 'Cross-company delegation must remain inside an active approved organization scope.'
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF NEW.scope_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM organization_organizationscopemembership m
        WHERE m.scope_id = NEW.scope_id AND m.company_id = from_company_id
    ) THEN
        RAISE EXCEPTION 'Delegation scope must contain the delegation company.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER core_delegation_scope_guard
BEFORE INSERT OR UPDATE OF from_user_id, to_user_id, scope_id, end_at, capabilities, is_active, revoked_at
ON core_delegationrule
FOR EACH ROW EXECUTE FUNCTION ffi_validate_cross_company_delegation();

CREATE OR REPLACE FUNCTION ffi_validate_cross_company_manager_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    employee_company_id bigint;
    manager_company_id bigint;
BEGIN
    SELECT company_id INTO employee_company_id FROM employees_employeeprofile WHERE id = NEW.employee_id;
    SELECT company_id INTO manager_company_id FROM employees_employeeprofile WHERE id = NEW.manager_profile_id;
    IF NEW.employee_id = NEW.manager_profile_id OR NEW.end_at <= NEW.start_at THEN
        RAISE EXCEPTION 'Invalid cross-company manager assignment timing or self-management.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.revoked_at IS NOT NULL AND NEW.is_active THEN
        RAISE EXCEPTION 'A revoked cross-company manager assignment cannot remain active.' USING ERRCODE = 'check_violation';
    END IF;
    IF employee_company_id IS NULL OR manager_company_id IS NULL
       OR employee_company_id = manager_company_id
       OR NOT EXISTS (SELECT 1 FROM organization_organizationscope scope WHERE scope.id = NEW.scope_id AND scope.is_active)
       OR NOT EXISTS (SELECT 1 FROM organization_organizationscopemembership m WHERE m.scope_id = NEW.scope_id AND m.company_id = employee_company_id)
       OR NOT EXISTS (SELECT 1 FROM organization_organizationscopemembership m WHERE m.scope_id = NEW.scope_id AND m.company_id = manager_company_id)
       OR NOT EXISTS (
           SELECT 1 FROM employees_employeeprofile profile
           JOIN accounts_user account ON account.id = profile.user_id
           WHERE profile.id = NEW.employee_id AND NOT profile.is_archived
             AND profile.employment_status = 'ACTIVE' AND account.is_active
       )
       OR NOT EXISTS (
           SELECT 1 FROM employees_employeeprofile profile
           JOIN accounts_user account ON account.id = profile.user_id
           WHERE profile.id = NEW.manager_profile_id AND NOT profile.is_archived
             AND profile.employment_status = 'ACTIVE' AND account.is_active
       ) THEN
        RAISE EXCEPTION 'Cross-company manager assignments require active users inside one active approved scope.'
            USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
        WITH RECURSIVE reporting_chain(profile_id, path) AS (
            SELECT NEW.manager_profile_id, ARRAY[NEW.manager_profile_id]::bigint[]
            UNION ALL
            SELECT relation.manager_profile_id, chain.path || relation.manager_profile_id
            FROM reporting_chain chain
            JOIN LATERAL (
                SELECT profile.manager_profile_id
                FROM employees_employeeprofile profile
                WHERE profile.id = chain.profile_id AND profile.manager_profile_id IS NOT NULL
                UNION
                SELECT assignment.manager_profile_id
                FROM core_crosscompanymanagerassignment assignment
                WHERE assignment.employee_id = chain.profile_id
                  AND assignment.is_active
                  AND assignment.revoked_at IS NULL
                  AND assignment.start_at <= CURRENT_TIMESTAMP
                  AND assignment.end_at >= CURRENT_TIMESTAMP
            ) relation ON TRUE
            WHERE NOT relation.manager_profile_id = ANY(chain.path)
        )
        SELECT 1 FROM reporting_chain WHERE profile_id = NEW.employee_id
    ) THEN
        RAISE EXCEPTION 'Cross-company manager assignment cannot create a reporting cycle.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER core_cross_company_manager_guard
BEFORE INSERT OR UPDATE OF employee_id, manager_profile_id, scope_id, start_at, end_at, is_active, revoked_at
ON core_crosscompanymanagerassignment
FOR EACH ROW EXECUTE FUNCTION ffi_validate_cross_company_manager_assignment();
"""

REVERSE_SQL = r"""
DROP TRIGGER IF EXISTS core_cross_company_manager_guard ON core_crosscompanymanagerassignment;
DROP FUNCTION IF EXISTS ffi_validate_cross_company_manager_assignment();
DROP TRIGGER IF EXISTS core_delegation_scope_guard ON core_delegationrule;
DROP FUNCTION IF EXISTS ffi_validate_cross_company_delegation();
DROP TRIGGER IF EXISTS organization_scope_membership_guard ON organization_organizationscopemembership;
DROP FUNCTION IF EXISTS ffi_validate_organization_scope_membership();
DROP TRIGGER IF EXISTS organization_scope_company_guard ON organization_organizationnode;
DROP FUNCTION IF EXISTS ffi_guard_scope_company_change();
"""


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("core", "0004_whatsappmessagetemplate"),
        ("employees", "0015_database_tenant_integrity"),
        ("organization", "0002_organizationscope"),
    ]

    operations = [
        migrations.AddField(
            model_name="delegationrule",
            name="capabilities",
            field=models.JSONField(blank=True, default=default_delegation_capabilities),
        ),
        migrations.AddField(
            model_name="delegationrule",
            name="revoked_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="delegationrule",
            name="revoked_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="delegation_rules_revoked",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="delegationrule",
            name="scope",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="delegation_grants",
                to="organization.organizationscope",
            ),
        ),
        migrations.AddIndex(
            model_name="delegationrule",
            index=models.Index(fields=["scope", "is_active"], name="core_del_scope_act_idx"),
        ),
        migrations.CreateModel(
            name="CrossCompanyManagerAssignment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("start_at", models.DateTimeField()),
                ("end_at", models.DateTimeField()),
                ("reason", models.TextField(blank=True)),
                ("is_active", models.BooleanField(default=True)),
                ("revoked_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="cross_company_manager_assignments_created", to=settings.AUTH_USER_MODEL)),
                ("employee", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="cross_company_manager_assignments", to="employees.employeeprofile")),
                ("manager_profile", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="cross_company_managed_assignments", to="employees.employeeprofile")),
                ("revoked_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="cross_company_manager_assignments_revoked", to=settings.AUTH_USER_MODEL)),
                ("scope", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="cross_company_manager_assignments", to="organization.organizationscope")),
            ],
            options={"ordering": ["-updated_at", "-id"]},
        ),
        migrations.AddIndex(model_name="crosscompanymanagerassignment", index=models.Index(fields=["manager_profile", "is_active"], name="core_cross_mgr_active_idx")),
        migrations.AddIndex(model_name="crosscompanymanagerassignment", index=models.Index(fields=["employee", "is_active"], name="core_cross_emp_active_idx")),
        migrations.AddIndex(model_name="crosscompanymanagerassignment", index=models.Index(fields=["scope", "is_active"], name="core_cross_scope_active_idx")),
        migrations.RunSQL(FORWARD_SQL, REVERSE_SQL),
    ]
