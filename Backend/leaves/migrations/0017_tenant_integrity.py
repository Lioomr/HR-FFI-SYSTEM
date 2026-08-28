from django.db import migrations

FORWARD_SQL = r"""
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM leaves_leaverequest request
        LEFT JOIN leaves_leavetype leave_type ON leave_type.id = request.leave_type_id
        LEFT JOIN employees_employeeprofile direct_profile ON direct_profile.id = request.employee_profile_id
        LEFT JOIN employees_employeeprofile user_profile ON user_profile.user_id = request.employee_id
        LEFT JOIN employees_employeeprofile delegate_profile ON delegate_profile.user_id = request.delegated_to_id
        WHERE request.company_id IS NULL
           OR leave_type.company_id IS DISTINCT FROM request.company_id
           OR (direct_profile.id IS NULL AND user_profile.id IS NULL)
           OR (direct_profile.id IS NOT NULL AND direct_profile.company_id IS DISTINCT FROM request.company_id)
           OR (user_profile.id IS NOT NULL AND user_profile.company_id IS DISTINCT FROM request.company_id)
           OR (
               direct_profile.id IS NOT NULL
               AND user_profile.id IS NOT NULL
               AND direct_profile.id IS DISTINCT FROM user_profile.id
           )
           OR (
               request.delegated_to_id IS NOT NULL
               AND (
                   delegate_profile.id IS NULL
                   OR delegate_profile.company_id IS DISTINCT FROM request.company_id
               )
           )
    ) THEN
        RAISE EXCEPTION
            'LeaveRequest tenant integrity audit failed. Run audit_employee_company_integrity before migration 0017.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM leaves_leavebalancesnapshot snapshot
        JOIN employees_employeeprofile profile ON profile.id = snapshot.employee_profile_id
        JOIN leaves_leavetype leave_type ON leave_type.id = snapshot.leave_type_id
        WHERE profile.company_id IS NULL
           OR leave_type.company_id IS DISTINCT FROM profile.company_id
    ) THEN
        RAISE EXCEPTION
            'LeaveBalanceSnapshot tenant integrity audit failed. Run audit_employee_company_integrity before migration 0017.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM leaves_leavebalanceadjustment adjustment
        LEFT JOIN leaves_leavetype leave_type ON leave_type.id = adjustment.leave_type_id
        LEFT JOIN employees_employeeprofile direct_profile ON direct_profile.id = adjustment.employee_profile_id
        LEFT JOIN employees_employeeprofile user_profile ON user_profile.user_id = adjustment.employee_id
        WHERE adjustment.company_id IS NULL
           OR leave_type.company_id IS DISTINCT FROM adjustment.company_id
           OR (direct_profile.id IS NULL AND user_profile.id IS NULL)
           OR (direct_profile.id IS NOT NULL AND direct_profile.company_id IS DISTINCT FROM adjustment.company_id)
           OR (user_profile.id IS NOT NULL AND user_profile.company_id IS DISTINCT FROM adjustment.company_id)
           OR (
               direct_profile.id IS NOT NULL
               AND user_profile.id IS NOT NULL
               AND direct_profile.id IS DISTINCT FROM user_profile.id
           )
    ) THEN
        RAISE EXCEPTION
            'LeaveBalanceAdjustment tenant integrity audit failed. Run audit_employee_company_integrity before migration 0017.'
            USING ERRCODE = 'check_violation';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION ffi_validate_leave_request_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.company_id IS NULL THEN
        RAISE EXCEPTION 'LeaveRequest must belong to a company.' USING ERRCODE = 'check_violation';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM leaves_leavetype leave_type
        WHERE leave_type.id = NEW.leave_type_id AND leave_type.company_id = NEW.company_id
    ) THEN
        RAISE EXCEPTION 'LeaveRequest leave type must belong to the request company.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.employee_profile_id IS NULL AND NEW.employee_id IS NULL THEN
        RAISE EXCEPTION 'LeaveRequest must resolve to an employee profile.' USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.employee_profile_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM employees_employeeprofile profile
        WHERE profile.id = NEW.employee_profile_id
          AND profile.company_id = NEW.company_id
          AND (NEW.employee_id IS NULL OR profile.user_id = NEW.employee_id)
    ) THEN
        RAISE EXCEPTION 'LeaveRequest employee profile must belong to the request company and employee.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.employee_profile_id IS NULL AND NOT EXISTS (
        SELECT 1 FROM employees_employeeprofile profile
        WHERE profile.user_id = NEW.employee_id AND profile.company_id = NEW.company_id
    ) THEN
        RAISE EXCEPTION 'LeaveRequest employee must have a profile in the request company.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.delegated_to_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM employees_employeeprofile profile
        WHERE profile.user_id = NEW.delegated_to_id AND profile.company_id = NEW.company_id
    ) THEN
        RAISE EXCEPTION 'LeaveRequest delegate must belong to the request company.'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER leaves_leaverequest_tenant_guard
BEFORE INSERT OR UPDATE OF company_id, employee_id, employee_profile_id, leave_type_id, delegated_to_id
ON leaves_leaverequest
FOR EACH ROW
EXECUTE FUNCTION ffi_validate_leave_request_tenant();

CREATE OR REPLACE FUNCTION ffi_validate_leave_snapshot_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM employees_employeeprofile profile
        JOIN leaves_leavetype leave_type ON leave_type.id = NEW.leave_type_id
        WHERE profile.id = NEW.employee_profile_id
          AND profile.company_id IS NOT NULL
          AND leave_type.company_id = profile.company_id
    ) THEN
        RAISE EXCEPTION 'LeaveBalanceSnapshot employee and leave type must belong to the same company.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER leaves_leavebalancesnapshot_tenant_guard
BEFORE INSERT OR UPDATE OF employee_profile_id, leave_type_id
ON leaves_leavebalancesnapshot
FOR EACH ROW
EXECUTE FUNCTION ffi_validate_leave_snapshot_tenant();

CREATE OR REPLACE FUNCTION ffi_validate_leave_adjustment_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.company_id IS NULL THEN
        RAISE EXCEPTION 'LeaveBalanceAdjustment must belong to a company.' USING ERRCODE = 'check_violation';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM leaves_leavetype leave_type
        WHERE leave_type.id = NEW.leave_type_id AND leave_type.company_id = NEW.company_id
    ) THEN
        RAISE EXCEPTION 'LeaveBalanceAdjustment leave type must belong to the adjustment company.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.employee_profile_id IS NULL AND NEW.employee_id IS NULL THEN
        RAISE EXCEPTION 'LeaveBalanceAdjustment must resolve to an employee profile.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.employee_profile_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM employees_employeeprofile profile
        WHERE profile.id = NEW.employee_profile_id
          AND profile.company_id = NEW.company_id
          AND (NEW.employee_id IS NULL OR profile.user_id = NEW.employee_id)
    ) THEN
        RAISE EXCEPTION 'LeaveBalanceAdjustment employee profile must belong to the adjustment company and employee.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.employee_profile_id IS NULL AND NOT EXISTS (
        SELECT 1 FROM employees_employeeprofile profile
        WHERE profile.user_id = NEW.employee_id AND profile.company_id = NEW.company_id
    ) THEN
        RAISE EXCEPTION 'LeaveBalanceAdjustment employee must have a profile in the adjustment company.'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER leaves_leavebalanceadjustment_tenant_guard
BEFORE INSERT OR UPDATE OF company_id, employee_id, employee_profile_id, leave_type_id
ON leaves_leavebalanceadjustment
FOR EACH ROW
EXECUTE FUNCTION ffi_validate_leave_adjustment_tenant();

CREATE OR REPLACE FUNCTION ffi_guard_leave_type_company_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.company_id IS DISTINCT FROM OLD.company_id AND (
        EXISTS (SELECT 1 FROM leaves_leaverequest request WHERE request.leave_type_id = OLD.id)
        OR EXISTS (SELECT 1 FROM leaves_leavebalancesnapshot snapshot WHERE snapshot.leave_type_id = OLD.id)
        OR EXISTS (SELECT 1 FROM leaves_leavebalanceadjustment adjustment WHERE adjustment.leave_type_id = OLD.id)
    ) THEN
        RAISE EXCEPTION 'A leave type company cannot change while company-owned leave records reference it.'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER leaves_leavetype_company_guard
BEFORE UPDATE OF company_id
ON leaves_leavetype
FOR EACH ROW
EXECUTE FUNCTION ffi_guard_leave_type_company_change();

CREATE OR REPLACE FUNCTION ffi_guard_leave_profile_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.company_id IS DISTINCT FROM OLD.company_id AND (
        EXISTS (
            SELECT 1 FROM leaves_leaverequest request
            WHERE request.employee_profile_id = OLD.id AND request.company_id IS DISTINCT FROM NEW.company_id
        )
        OR EXISTS (
            SELECT 1 FROM leaves_leavebalancesnapshot snapshot
            JOIN leaves_leavetype leave_type ON leave_type.id = snapshot.leave_type_id
            WHERE snapshot.employee_profile_id = OLD.id AND leave_type.company_id IS DISTINCT FROM NEW.company_id
        )
        OR EXISTS (
            SELECT 1 FROM leaves_leavebalanceadjustment adjustment
            WHERE adjustment.employee_profile_id = OLD.id AND adjustment.company_id IS DISTINCT FROM NEW.company_id
        )
        OR EXISTS (
            SELECT 1 FROM leaves_leaverequest request
            WHERE request.employee_id = OLD.user_id AND request.company_id IS DISTINCT FROM NEW.company_id
        )
        OR EXISTS (
            SELECT 1 FROM leaves_leavebalanceadjustment adjustment
            WHERE adjustment.employee_id = OLD.user_id AND adjustment.company_id IS DISTINCT FROM NEW.company_id
        )
        OR EXISTS (
            SELECT 1 FROM leaves_leaverequest request
            WHERE request.delegated_to_id = OLD.user_id AND request.company_id IS DISTINCT FROM NEW.company_id
        )
    ) THEN
        RAISE EXCEPTION 'Changing this employee company would create cross-company leave relationships.'
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.user_id IS DISTINCT FROM OLD.user_id AND EXISTS (
        SELECT 1 FROM leaves_leaverequest request
        WHERE request.employee_id = OLD.user_id OR request.delegated_to_id = OLD.user_id
        UNION ALL
        SELECT 1 FROM leaves_leavebalanceadjustment adjustment
        WHERE adjustment.employee_id = OLD.user_id
    ) THEN
        RAISE EXCEPTION 'Changing this employee user would orphan leave relationships.'
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER employees_leave_relationship_guard
BEFORE UPDATE OF company_id, user_id
ON employees_employeeprofile
FOR EACH ROW
EXECUTE FUNCTION ffi_guard_leave_profile_change();
"""


REVERSE_SQL = r"""
DROP TRIGGER IF EXISTS employees_leave_relationship_guard ON employees_employeeprofile;
DROP FUNCTION IF EXISTS ffi_guard_leave_profile_change();
DROP TRIGGER IF EXISTS leaves_leavetype_company_guard ON leaves_leavetype;
DROP FUNCTION IF EXISTS ffi_guard_leave_type_company_change();
DROP TRIGGER IF EXISTS leaves_leavebalanceadjustment_tenant_guard ON leaves_leavebalanceadjustment;
DROP FUNCTION IF EXISTS ffi_validate_leave_adjustment_tenant();
DROP TRIGGER IF EXISTS leaves_leavebalancesnapshot_tenant_guard ON leaves_leavebalancesnapshot;
DROP FUNCTION IF EXISTS ffi_validate_leave_snapshot_tenant();
DROP TRIGGER IF EXISTS leaves_leaverequest_tenant_guard ON leaves_leaverequest;
DROP FUNCTION IF EXISTS ffi_validate_leave_request_tenant();
"""


class Migration(migrations.Migration):
    dependencies = [
        ("employees", "0015_database_tenant_integrity"),
        ("leaves", "0016_hr_completion"),
    ]

    operations = [migrations.RunSQL(FORWARD_SQL, REVERSE_SQL)]
