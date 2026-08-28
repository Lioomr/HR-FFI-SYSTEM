from django.db import migrations, models

from core.models import default_cross_company_manager_capabilities

FORWARD_SQL = r"""
-- A revoked/inactive exceptional edge is intentionally allowed to reference an
-- employee whose lifecycle transition caused the revocation.  Active edges
-- retain all of the original 0005 validation.
CREATE OR REPLACE FUNCTION ffi_validate_cross_company_manager_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    employee_company_id bigint;
    manager_company_id bigint;
BEGIN
    IF NEW.revoked_at IS NOT NULL AND NEW.is_active THEN
        RAISE EXCEPTION 'A revoked cross-company manager assignment cannot remain active.' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT NEW.is_active OR NEW.revoked_at IS NOT NULL THEN
        RETURN NEW;
    END IF;
    SELECT company_id INTO employee_company_id FROM employees_employeeprofile WHERE id = NEW.employee_id;
    SELECT company_id INTO manager_company_id FROM employees_employeeprofile WHERE id = NEW.manager_profile_id;
    IF NEW.employee_id = NEW.manager_profile_id OR NEW.end_at <= NEW.start_at THEN
        RAISE EXCEPTION 'Invalid cross-company manager assignment timing or self-management.' USING ERRCODE = 'check_violation';
    END IF;
    IF employee_company_id IS NULL OR manager_company_id IS NULL OR employee_company_id = manager_company_id
       OR NOT EXISTS (SELECT 1 FROM organization_organizationscope scope WHERE scope.id = NEW.scope_id AND scope.is_active)
       OR NOT EXISTS (SELECT 1 FROM organization_organizationscopemembership m WHERE m.scope_id = NEW.scope_id AND m.company_id = employee_company_id)
       OR NOT EXISTS (SELECT 1 FROM organization_organizationscopemembership m WHERE m.scope_id = NEW.scope_id AND m.company_id = manager_company_id)
       OR NOT EXISTS (SELECT 1 FROM employees_employeeprofile profile JOIN accounts_user account ON account.id = profile.user_id WHERE profile.id = NEW.employee_id AND NOT profile.is_archived AND profile.employment_status = 'ACTIVE' AND account.is_active)
       OR NOT EXISTS (SELECT 1 FROM employees_employeeprofile profile JOIN accounts_user account ON account.id = profile.user_id WHERE profile.id = NEW.manager_profile_id AND NOT profile.is_archived AND profile.employment_status = 'ACTIVE' AND account.is_active) THEN
        RAISE EXCEPTION 'Cross-company manager assignments require active users inside one active approved scope.' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
        WITH RECURSIVE reporting_chain(profile_id, path) AS (
            SELECT NEW.manager_profile_id, ARRAY[NEW.manager_profile_id]::bigint[]
            UNION ALL
            SELECT relation.manager_profile_id, chain.path || relation.manager_profile_id
            FROM reporting_chain chain
            JOIN LATERAL (
                SELECT profile.manager_profile_id FROM employees_employeeprofile profile
                WHERE profile.id = chain.profile_id AND profile.manager_profile_id IS NOT NULL
                UNION
                SELECT assignment.manager_profile_id FROM core_crosscompanymanagerassignment assignment
                WHERE assignment.employee_id = chain.profile_id AND assignment.is_active AND assignment.revoked_at IS NULL
                  AND assignment.start_at <= CURRENT_TIMESTAMP AND assignment.end_at >= CURRENT_TIMESTAMP
            ) relation ON TRUE
            WHERE NOT relation.manager_profile_id = ANY(chain.path)
        ) SELECT 1 FROM reporting_chain WHERE profile_id = NEW.employee_id
    ) THEN
        RAISE EXCEPTION 'Cross-company manager assignment cannot create a reporting cycle.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ffi_validate_cross_company_manager_capabilities()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF jsonb_typeof(NEW.capabilities) <> 'array' OR jsonb_array_length(NEW.capabilities) = 0 THEN
        RAISE EXCEPTION 'Cross-company manager assignments require explicit capabilities.' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(NEW.capabilities) capability
        WHERE capability NOT IN (
            'employees.view', 'leaves.approve', 'attendance.approve',
            'loans.approve', 'assets.approve', 'announcements.manage'
        )
    ) THEN
        RAISE EXCEPTION 'Cross-company manager assignment contains an unsupported capability.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER core_cross_company_manager_capability_guard
BEFORE INSERT OR UPDATE OF capabilities ON core_crosscompanymanagerassignment
FOR EACH ROW EXECUTE FUNCTION ffi_validate_cross_company_manager_capabilities();

CREATE OR REPLACE FUNCTION ffi_revoke_stale_cross_company_manager_assignments()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE core_crosscompanymanagerassignment
    SET is_active = FALSE, revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
    WHERE is_active AND revoked_at IS NULL
      AND (employee_id = NEW.id OR manager_profile_id = NEW.id)
      AND (
          NEW.is_archived OR NEW.employment_status <> 'ACTIVE' OR NEW.company_id IS NULL OR NEW.user_id IS NULL
          OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
      );
    RETURN NEW;
END;
$$;

CREATE TRIGGER employees_revoke_stale_cross_company_manager_assignments
AFTER UPDATE OF company_id, is_archived, employment_status, user_id ON employees_employeeprofile
FOR EACH ROW EXECUTE FUNCTION ffi_revoke_stale_cross_company_manager_assignments();

CREATE OR REPLACE FUNCTION ffi_revoke_cross_company_assignments_for_inactive_user()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.is_active AND NOT NEW.is_active THEN
        UPDATE core_crosscompanymanagerassignment assignment
        SET is_active = FALSE, revoked_at = COALESCE(assignment.revoked_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
        FROM employees_employeeprofile profile
        WHERE assignment.is_active AND assignment.revoked_at IS NULL AND profile.user_id = NEW.id
          AND (assignment.employee_id = profile.id OR assignment.manager_profile_id = profile.id);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_revoke_stale_cross_company_manager_assignments
AFTER UPDATE OF is_active ON accounts_user
FOR EACH ROW EXECUTE FUNCTION ffi_revoke_cross_company_assignments_for_inactive_user();
"""

REVERSE_SQL = r"""
DROP TRIGGER IF EXISTS accounts_revoke_stale_cross_company_manager_assignments ON accounts_user;
DROP FUNCTION IF EXISTS ffi_revoke_cross_company_assignments_for_inactive_user();
DROP TRIGGER IF EXISTS employees_revoke_stale_cross_company_manager_assignments ON employees_employeeprofile;
DROP FUNCTION IF EXISTS ffi_revoke_stale_cross_company_manager_assignments();
DROP TRIGGER IF EXISTS core_cross_company_manager_capability_guard ON core_crosscompanymanagerassignment;
DROP FUNCTION IF EXISTS ffi_validate_cross_company_manager_capabilities();
"""


class Migration(migrations.Migration):
    dependencies = [("core", "0005_tenant_scope_delegation")]

    operations = [
        migrations.AddField(
            model_name="crosscompanymanagerassignment",
            name="capabilities",
            field=models.JSONField(blank=True, default=default_cross_company_manager_capabilities),
        ),
        migrations.RunSQL(FORWARD_SQL, REVERSE_SQL),
    ]
