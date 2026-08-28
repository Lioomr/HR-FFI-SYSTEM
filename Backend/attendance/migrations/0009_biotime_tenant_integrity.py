from django.db import migrations

FORWARD_SQL = r"""
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM attendance_biotimeemployeemap mapping
        LEFT JOIN employees_employeeprofile profile ON profile.id = mapping.employee_profile_id
        LEFT JOIN organization_organizationnode company ON company.id = profile.company_id
        WHERE profile.id IS NULL
           OR profile.is_archived
           OR profile.company_id IS NULL
           OR company.id IS NULL
           OR company.node_type <> 'company'
           OR NOT company.is_active
    ) THEN
        RAISE EXCEPTION
            'BioTime mapping tenant integrity audit failed. Run audit_employee_company_integrity before migration 0009.'
            USING ERRCODE = 'check_violation';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION ffi_validate_biotime_mapping_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM employees_employeeprofile profile
        JOIN organization_organizationnode company ON company.id = profile.company_id
        WHERE profile.id = NEW.employee_profile_id
          AND NOT profile.is_archived
          AND company.node_type = 'company'
          AND company.is_active
    ) THEN
        RAISE EXCEPTION 'BioTime mappings require a non-archived employee in an active company.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER attendance_biotime_mapping_tenant_guard
BEFORE INSERT OR UPDATE OF employee_profile_id
ON attendance_biotimeemployeemap
FOR EACH ROW
EXECUTE FUNCTION ffi_validate_biotime_mapping_tenant();

CREATE OR REPLACE FUNCTION ffi_guard_biotime_employee_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM attendance_biotimeemployeemap mapping
        WHERE mapping.employee_profile_id = OLD.id
          AND (
              NEW.is_archived
              OR NOT EXISTS (
                  SELECT 1
                  FROM organization_organizationnode company
                  WHERE company.id = NEW.company_id
                    AND company.node_type = 'company'
                    AND company.is_active
              )
          )
    ) THEN
        RAISE EXCEPTION 'An employee with a BioTime mapping must remain non-archived in an active company.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER employees_biotime_mapping_guard
BEFORE UPDATE OF company_id, is_archived
ON employees_employeeprofile
FOR EACH ROW
EXECUTE FUNCTION ffi_guard_biotime_employee_change();
"""


REVERSE_SQL = r"""
DROP TRIGGER IF EXISTS employees_biotime_mapping_guard ON employees_employeeprofile;
DROP FUNCTION IF EXISTS ffi_guard_biotime_employee_change();
DROP TRIGGER IF EXISTS attendance_biotime_mapping_tenant_guard ON attendance_biotimeemployeemap;
DROP FUNCTION IF EXISTS ffi_validate_biotime_mapping_tenant();
"""


class Migration(migrations.Migration):
    dependencies = [
        ("attendance", "0008_biotimedeviceemployee"),
        ("employees", "0015_database_tenant_integrity"),
    ]

    operations = [migrations.RunSQL(FORWARD_SQL, REVERSE_SQL)]
