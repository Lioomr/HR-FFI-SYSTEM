from django.db import migrations

FORWARD_SQL = r"""
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM employees_employeeprofile ep
        LEFT JOIN organization_organizationnode company ON company.id = ep.company_id
        WHERE
            (ep.company_id IS NOT NULL AND (company.id IS NULL OR company.node_type <> 'company'))
            OR (
                NOT ep.is_archived
                AND (
                    ep.company_id IS NULL
                    OR company.id IS NULL
                    OR company.node_type <> 'company'
                    OR NOT company.is_active
                )
            )
    ) THEN
        RAISE EXCEPTION
            'Employee tenant integrity audit failed. Run audit_employee_company_integrity before applying migration 0015.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM employees_employeeprofile ep
        LEFT JOIN hr_reference_department department ON department.id = ep.department_ref_id
        LEFT JOIN hr_reference_position position ON position.id = ep.position_ref_id
        LEFT JOIN hr_reference_taskgroup task_group ON task_group.id = ep.task_group_ref_id
        LEFT JOIN hr_reference_sponsor sponsor ON sponsor.id = ep.sponsor_ref_id
        LEFT JOIN employees_employeeprofile manager_profile ON manager_profile.id = ep.manager_profile_id
        LEFT JOIN employees_employeeprofile legacy_manager ON legacy_manager.user_id = ep.manager_id
        WHERE
            (ep.department_ref_id IS NOT NULL AND department.company_id IS DISTINCT FROM ep.company_id)
            OR (ep.position_ref_id IS NOT NULL AND position.company_id IS DISTINCT FROM ep.company_id)
            OR (ep.task_group_ref_id IS NOT NULL AND task_group.company_id IS DISTINCT FROM ep.company_id)
            OR (ep.sponsor_ref_id IS NOT NULL AND sponsor.company_id IS DISTINCT FROM ep.company_id)
            OR (
                ep.manager_profile_id IS NOT NULL
                AND (
                    manager_profile.company_id IS DISTINCT FROM ep.company_id
                    OR ep.manager_id IS DISTINCT FROM manager_profile.user_id
                )
            )
            OR (
                ep.manager_profile_id IS NULL
                AND ep.manager_id IS NOT NULL
                AND legacy_manager.company_id IS DISTINCT FROM ep.company_id
            )
    ) THEN
        RAISE EXCEPTION
            'Employee relationship integrity audit failed. Run audit_employee_company_integrity before applying migration 0015.'
            USING ERRCODE = 'check_violation';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION ffi_validate_employee_profile_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    company_type text;
    company_active boolean;
    manager_company_id bigint;
    manager_user_id bigint;
BEGIN
    IF NEW.company_id IS NOT NULL THEN
        SELECT node_type, is_active
        INTO company_type, company_active
        FROM organization_organizationnode
        WHERE id = NEW.company_id;

        IF company_type IS DISTINCT FROM 'company' THEN
            RAISE EXCEPTION 'EmployeeProfile company must reference a COMPANY organization node.'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    IF NOT NEW.is_archived AND (
        NEW.company_id IS NULL
        OR company_type IS DISTINCT FROM 'company'
        OR company_active IS DISTINCT FROM TRUE
    ) THEN
        RAISE EXCEPTION 'Every non-archived EmployeeProfile must belong to an active company.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.department_ref_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM hr_reference_department ref
        WHERE ref.id = NEW.department_ref_id AND ref.company_id = NEW.company_id
    ) THEN
        RAISE EXCEPTION 'EmployeeProfile department must belong to the employee company.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.position_ref_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM hr_reference_position ref
        WHERE ref.id = NEW.position_ref_id AND ref.company_id = NEW.company_id
    ) THEN
        RAISE EXCEPTION 'EmployeeProfile position must belong to the employee company.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.task_group_ref_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM hr_reference_taskgroup ref
        WHERE ref.id = NEW.task_group_ref_id AND ref.company_id = NEW.company_id
    ) THEN
        RAISE EXCEPTION 'EmployeeProfile task group must belong to the employee company.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.sponsor_ref_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM hr_reference_sponsor ref
        WHERE ref.id = NEW.sponsor_ref_id AND ref.company_id = NEW.company_id
    ) THEN
        RAISE EXCEPTION 'EmployeeProfile sponsor must belong to the employee company.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.manager_profile_id IS NOT NULL THEN
        SELECT company_id, user_id
        INTO manager_company_id, manager_user_id
        FROM employees_employeeprofile
        WHERE id = NEW.manager_profile_id;

        IF manager_company_id IS DISTINCT FROM NEW.company_id THEN
            RAISE EXCEPTION 'EmployeeProfile manager must belong to the employee company.'
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.manager_id IS DISTINCT FROM manager_user_id THEN
            RAISE EXCEPTION 'EmployeeProfile manager fields must identify the same manager.'
                USING ERRCODE = 'check_violation';
        END IF;
    ELSIF NEW.manager_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM employees_employeeprofile manager
        WHERE manager.user_id = NEW.manager_id AND manager.company_id = NEW.company_id
    ) THEN
        RAISE EXCEPTION 'Legacy EmployeeProfile manager must belong to the employee company.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF TG_OP = 'UPDATE' AND EXISTS (
        SELECT 1
        FROM employees_employeeprofile report
        WHERE report.manager_profile_id = OLD.id
          AND (
              report.company_id IS DISTINCT FROM NEW.company_id
              OR report.manager_id IS DISTINCT FROM NEW.user_id
          )
    ) THEN
        RAISE EXCEPTION 'Changing this manager company would create cross-company direct reports.'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER employees_employeeprofile_tenant_guard
BEFORE INSERT OR UPDATE OF company_id, user_id, is_archived, department_ref_id, position_ref_id,
    task_group_ref_id, sponsor_ref_id, manager_id, manager_profile_id
ON employees_employeeprofile
FOR EACH ROW
EXECUTE FUNCTION ffi_validate_employee_profile_tenant();

CREATE OR REPLACE FUNCTION ffi_guard_employee_company_node()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.node_type IS DISTINCT FROM 'company' AND EXISTS (
        SELECT 1 FROM employees_employeeprofile ep WHERE ep.company_id = OLD.id
    ) THEN
        RAISE EXCEPTION 'An organization referenced by employees must remain a COMPANY node.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.is_active IS DISTINCT FROM TRUE AND EXISTS (
        SELECT 1
        FROM employees_employeeprofile ep
        WHERE ep.company_id = OLD.id AND NOT ep.is_archived
    ) THEN
        RAISE EXCEPTION 'A company with non-archived employees cannot be deactivated.'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER organization_employee_company_guard
BEFORE UPDATE OF node_type, is_active
ON organization_organizationnode
FOR EACH ROW
EXECUTE FUNCTION ffi_guard_employee_company_node();
"""


REVERSE_SQL = r"""
DROP TRIGGER IF EXISTS organization_employee_company_guard ON organization_organizationnode;
DROP FUNCTION IF EXISTS ffi_guard_employee_company_node();
DROP TRIGGER IF EXISTS employees_employeeprofile_tenant_guard ON employees_employeeprofile;
DROP FUNCTION IF EXISTS ffi_validate_employee_profile_tenant();
"""


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0014_employeeimport_company"),
        ("hr_reference", "0002_department_company_position_company_sponsor_company_and_more"),
        ("organization", "0001_initial"),
    ]

    operations = [migrations.RunSQL(FORWARD_SQL, REVERSE_SQL)]
