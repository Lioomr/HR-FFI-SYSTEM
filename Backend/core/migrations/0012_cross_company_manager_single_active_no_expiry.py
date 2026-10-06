"""One manager per employee; cross-company manager assignments never expire.

Order matters on production data:

1. Replace the trigger functions so they no longer read ``end_at`` and recreate
   the column-scoped guard trigger without it (PostgreSQL refuses to drop a
   column that a column-scoped trigger depends on).
2. End every active row whose ``end_at`` already passed (it was not effective,
   and dropping the column must not bring it back), then keep only the newest
   active row per employee. Both steps are idempotent and no-ops on an empty table.
3. Migration 0013 (its own transaction, so no row-update trigger events are
   pending when the table is altered) drops ``end_at`` and adds the partial
   unique constraint.

Collapsing a direct same-company manager into a cross-company one is a data
decision, done by ``manage.py consolidate_manager_relationships``, not here.
"""

from django.db import migrations

END_EXPIRED_AND_DUPLICATES_SQL = r"""
UPDATE core_crosscompanymanagerassignment
SET is_active = FALSE,
    revoked_at = COALESCE(revoked_at, end_at),
    updated_at = CURRENT_TIMESTAMP
WHERE is_active AND revoked_at IS NULL AND end_at < CURRENT_TIMESTAMP;

UPDATE core_crosscompanymanagerassignment older
SET is_active = FALSE,
    revoked_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE older.is_active AND older.revoked_at IS NULL
  AND EXISTS (
      SELECT 1 FROM core_crosscompanymanagerassignment newer
      WHERE newer.employee_id = older.employee_id
        AND newer.is_active AND newer.revoked_at IS NULL
        AND newer.id > older.id
  );
"""

FORWARD_TRIGGER_SQL = r"""
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
    IF NEW.employee_id = NEW.manager_profile_id THEN
        RAISE EXCEPTION 'An employee cannot be their own manager.' USING ERRCODE = 'check_violation';
    END IF;
    SELECT company_id INTO employee_company_id FROM employees_employeeprofile WHERE id = NEW.employee_id;
    SELECT company_id INTO manager_company_id FROM employees_employeeprofile WHERE id = NEW.manager_profile_id;
    -- The managed employee only needs to be a current company employee (like a
    -- direct report); the manager must be an active employee with an active login.
    IF employee_company_id IS NULL OR manager_company_id IS NULL OR employee_company_id = manager_company_id
       OR NOT EXISTS (SELECT 1 FROM organization_organizationscope scope WHERE scope.id = NEW.scope_id AND scope.is_active)
       OR NOT EXISTS (SELECT 1 FROM organization_organizationscopemembership m WHERE m.scope_id = NEW.scope_id AND m.company_id = employee_company_id)
       OR NOT EXISTS (SELECT 1 FROM organization_organizationscopemembership m WHERE m.scope_id = NEW.scope_id AND m.company_id = manager_company_id)
       OR NOT EXISTS (SELECT 1 FROM employees_employeeprofile profile WHERE profile.id = NEW.employee_id AND NOT profile.is_archived)
       OR NOT EXISTS (SELECT 1 FROM employees_employeeprofile profile JOIN accounts_user account ON account.id = profile.user_id WHERE profile.id = NEW.manager_profile_id AND NOT profile.is_archived AND profile.employment_status = 'ACTIVE' AND account.is_active) THEN
        RAISE EXCEPTION 'Cross-company manager assignments require an active manager inside one active approved scope.' USING ERRCODE = 'check_violation';
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
                WHERE assignment.employee_id = chain.profile_id AND assignment.id IS DISTINCT FROM NEW.id
                  AND assignment.is_active AND assignment.revoked_at IS NULL
                  AND assignment.start_at <= CURRENT_TIMESTAMP
            ) relation ON TRUE
            WHERE NOT relation.manager_profile_id = ANY(chain.path)
        ) SELECT 1 FROM reporting_chain WHERE profile_id = NEW.employee_id
    ) THEN
        RAISE EXCEPTION 'Cross-company manager assignment cannot create a reporting cycle.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS core_cross_company_manager_guard ON core_crosscompanymanagerassignment;
CREATE TRIGGER core_cross_company_manager_guard
BEFORE INSERT OR UPDATE OF employee_id, manager_profile_id, scope_id, start_at, is_active, revoked_at
ON core_crosscompanymanagerassignment
FOR EACH ROW EXECUTE FUNCTION ffi_validate_cross_company_manager_assignment();

-- Assignments do not expire. They end when the managed employee leaves the
-- company (archived or moved), or when the manager stops being a valid manager.
-- Linking or disabling the managed employee's login does not end them, exactly
-- like a direct manager link.
CREATE OR REPLACE FUNCTION ffi_revoke_stale_cross_company_manager_assignments()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE core_crosscompanymanagerassignment
    SET is_active = FALSE, revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
    WHERE is_active AND revoked_at IS NULL
      AND (
          (employee_id = NEW.id AND (
              NEW.is_archived OR NEW.company_id IS NULL OR NEW.company_id IS DISTINCT FROM OLD.company_id
          ))
          OR (manager_profile_id = NEW.id AND (
              NEW.is_archived OR NEW.employment_status <> 'ACTIVE' OR NEW.company_id IS NULL OR NEW.user_id IS NULL
              OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
          ))
      );
    RETURN NEW;
END;
$$;

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
          AND assignment.manager_profile_id = profile.id;
    END IF;
    RETURN NEW;
END;
$$;
"""

# Restores the 0006 definitions. Runs after the reverse of the column drop has
# re-added ``end_at``.
REVERSE_TRIGGER_SQL = r"""
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

DROP TRIGGER IF EXISTS core_cross_company_manager_guard ON core_crosscompanymanagerassignment;
CREATE TRIGGER core_cross_company_manager_guard
BEFORE INSERT OR UPDATE OF employee_id, manager_profile_id, scope_id, start_at, end_at, is_active, revoked_at
ON core_crosscompanymanagerassignment
FOR EACH ROW EXECUTE FUNCTION ffi_validate_cross_company_manager_assignment();

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
"""


class Migration(migrations.Migration):
    dependencies = [("core", "0011_workflow_public_references")]

    operations = [
        # Trigger DDL first: no row events are pending when the trigger is replaced.
        migrations.RunSQL(FORWARD_TRIGGER_SQL, REVERSE_TRIGGER_SQL),
        migrations.RunSQL(END_EXPIRED_AND_DUPLICATES_SQL, migrations.RunSQL.noop),
    ]
