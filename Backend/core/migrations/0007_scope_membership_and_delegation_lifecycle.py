from django.db import migrations

FORWARD_SQL = r"""
CREATE OR REPLACE FUNCTION ffi_validate_cross_company_delegation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    from_company_id bigint;
    to_company_id bigint;
BEGIN
    IF NEW.revoked_at IS NOT NULL AND NEW.is_active THEN
        RAISE EXCEPTION 'A revoked delegation grant cannot remain active.' USING ERRCODE = 'check_violation';
    END IF;
    -- Historical revoked records must remain auditable even after a profile
    -- lifecycle change invalidates the relationship.
    IF NOT NEW.is_active OR NEW.revoked_at IS NOT NULL THEN
        RETURN NEW;
    END IF;
    IF jsonb_typeof(NEW.capabilities) <> 'array' OR jsonb_array_length(NEW.capabilities) = 0 THEN
        RAISE EXCEPTION 'Delegation grants require explicit capabilities.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.capabilities @> '["employees.read"]'::jsonb
       AND (
           NEW.scope_id IS NULL
           OR NOT EXISTS (
               SELECT 1 FROM organization_organizationscope scope
               WHERE scope.id = NEW.scope_id AND scope.is_active
           )
       ) THEN
        RAISE EXCEPTION 'Employee-read delegation grants require a non-null active organization scope.'
            USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM employees_employeeprofile profile
        JOIN accounts_user account ON account.id = profile.user_id
        JOIN organization_organizationnode company ON company.id = profile.company_id
        WHERE profile.user_id = NEW.from_user_id
          AND account.is_active AND NOT profile.is_archived
          AND profile.employment_status = 'ACTIVE' AND company.node_type = 'company' AND company.is_active
    ) OR NOT EXISTS (
        SELECT 1 FROM employees_employeeprofile profile
        JOIN accounts_user account ON account.id = profile.user_id
        JOIN organization_organizationnode company ON company.id = profile.company_id
        WHERE profile.user_id = NEW.to_user_id
          AND account.is_active AND NOT profile.is_archived
          AND profile.employment_status = 'ACTIVE' AND company.node_type = 'company' AND company.is_active
    ) THEN
        RAISE EXCEPTION 'Active delegation grants require active, company-owned employee profiles linked to active users.'
            USING ERRCODE = 'check_violation';
    END IF;
    SELECT company_id INTO from_company_id FROM employees_employeeprofile WHERE user_id = NEW.from_user_id;
    SELECT company_id INTO to_company_id FROM employees_employeeprofile WHERE user_id = NEW.to_user_id;
    IF from_company_id IS NULL OR to_company_id IS NULL THEN
        RAISE EXCEPTION 'Delegation users must have company-owned employee profiles.' USING ERRCODE = 'check_violation';
    END IF;
    IF from_company_id IS DISTINCT FROM to_company_id THEN
        IF NEW.scope_id IS NULL OR NEW.end_at IS NULL THEN
            RAISE EXCEPTION 'Cross-company delegation requires an approved scope and end time.' USING ERRCODE = 'check_violation';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM organization_organizationscope scope WHERE scope.id = NEW.scope_id AND scope.is_active)
           OR NOT EXISTS (SELECT 1 FROM organization_organizationscopemembership m WHERE m.scope_id = NEW.scope_id AND m.company_id = from_company_id)
           OR NOT EXISTS (SELECT 1 FROM organization_organizationscopemembership m WHERE m.scope_id = NEW.scope_id AND m.company_id = to_company_id) THEN
            RAISE EXCEPTION 'Cross-company delegation must remain inside an active approved organization scope.' USING ERRCODE = 'check_violation';
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

CREATE OR REPLACE FUNCTION ffi_guard_organization_scope_membership_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    protected_scope_ids bigint[];
BEGIN
    -- A membership move affects two scopes: it must not remove a company from a
    -- protected source scope merely because the destination is unprotected.
    protected_scope_ids := CASE
        WHEN TG_OP = 'INSERT' THEN ARRAY[NEW.scope_id]
        WHEN TG_OP = 'DELETE' THEN ARRAY[OLD.scope_id]
        ELSE ARRAY[OLD.scope_id, NEW.scope_id]
    END;
    IF EXISTS (
        SELECT 1 FROM core_delegationrule rule
        WHERE rule.scope_id = ANY(protected_scope_ids)
          AND rule.is_active
          AND rule.revoked_at IS NULL
    ) OR EXISTS (
        SELECT 1 FROM core_crosscompanymanagerassignment assignment
        WHERE assignment.scope_id = ANY(protected_scope_ids)
          AND assignment.is_active
          AND assignment.revoked_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Cannot change organization scope membership while active grants or assignments reference the scope. Revoke and re-approve first.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION ffi_guard_organization_scope_activation_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.is_active IS DISTINCT FROM OLD.is_active
       AND (
           EXISTS (
               SELECT 1 FROM core_delegationrule rule
               WHERE rule.scope_id = OLD.id
                 AND rule.is_active
                 AND rule.revoked_at IS NULL
           )
           OR EXISTS (
               SELECT 1 FROM core_crosscompanymanagerassignment assignment
               WHERE assignment.scope_id = OLD.id
                 AND assignment.is_active
                 AND assignment.revoked_at IS NULL
           )
       ) THEN
        RAISE EXCEPTION 'Cannot change organization scope active state while active grants or assignments reference it. Revoke and re-approve first.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER organization_scope_membership_lifecycle_insert_delete_guard
BEFORE INSERT OR DELETE
ON organization_organizationscopemembership
FOR EACH ROW EXECUTE FUNCTION ffi_guard_organization_scope_membership_lifecycle();

CREATE TRIGGER organization_scope_membership_lifecycle_update_guard
BEFORE UPDATE OF scope_id, company_id
ON organization_organizationscopemembership
FOR EACH ROW EXECUTE FUNCTION ffi_guard_organization_scope_membership_lifecycle();

CREATE TRIGGER organization_scope_activation_lifecycle_guard
BEFORE UPDATE OF is_active
ON organization_organizationscope
FOR EACH ROW EXECUTE FUNCTION ffi_guard_organization_scope_activation_lifecycle();

CREATE OR REPLACE FUNCTION ffi_revoke_delegations_for_profile_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.is_archived
       OR NEW.employment_status <> 'ACTIVE'
       OR NEW.company_id IS NULL
       OR NEW.user_id IS NULL
       OR NEW.company_id IS DISTINCT FROM OLD.company_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
        UPDATE core_delegationrule rule
        SET is_active = FALSE,
            revoked_at = COALESCE(rule.revoked_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
        WHERE rule.is_active
          AND rule.revoked_at IS NULL
          AND (rule.from_user_id = OLD.user_id OR rule.to_user_id = OLD.user_id);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER employees_revoke_delegations_for_profile_lifecycle
BEFORE UPDATE OF company_id, is_archived, employment_status, user_id
ON employees_employeeprofile
FOR EACH ROW EXECUTE FUNCTION ffi_revoke_delegations_for_profile_lifecycle();

CREATE OR REPLACE FUNCTION ffi_revoke_delegations_for_disabled_user()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.is_active AND NOT NEW.is_active THEN
        UPDATE core_delegationrule rule
        SET is_active = FALSE,
            revoked_at = COALESCE(rule.revoked_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
        WHERE rule.is_active
          AND rule.revoked_at IS NULL
          AND (rule.from_user_id = NEW.id OR rule.to_user_id = NEW.id);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_revoke_delegations_for_disabled_user
BEFORE UPDATE OF is_active
ON accounts_user
FOR EACH ROW EXECUTE FUNCTION ffi_revoke_delegations_for_disabled_user();
"""


REVERSE_SQL = r"""
DROP TRIGGER IF EXISTS accounts_revoke_delegations_for_disabled_user ON accounts_user;
DROP FUNCTION IF EXISTS ffi_revoke_delegations_for_disabled_user();
DROP TRIGGER IF EXISTS employees_revoke_delegations_for_profile_lifecycle ON employees_employeeprofile;
DROP FUNCTION IF EXISTS ffi_revoke_delegations_for_profile_lifecycle();
DROP TRIGGER IF EXISTS organization_scope_activation_lifecycle_guard ON organization_organizationscope;
DROP FUNCTION IF EXISTS ffi_guard_organization_scope_activation_lifecycle();
DROP TRIGGER IF EXISTS organization_scope_membership_lifecycle_update_guard ON organization_organizationscopemembership;
DROP TRIGGER IF EXISTS organization_scope_membership_lifecycle_insert_delete_guard ON organization_organizationscopemembership;
DROP FUNCTION IF EXISTS ffi_guard_organization_scope_membership_lifecycle();
"""


class Migration(migrations.Migration):
    dependencies = [("core", "0006_cross_company_manager_assignment_capabilities")]

    operations = [migrations.RunSQL(FORWARD_SQL, REVERSE_SQL)]
